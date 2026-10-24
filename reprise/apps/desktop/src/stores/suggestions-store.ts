import { create } from "zustand";
import { localDb } from "../lib/local-db";
import { ensureFreshYtDlp } from "../lib/yt-dlp-update";
import { parseYouTubeVideoId } from "../lib/youtube";
import {
  diversify,
  fetchCaptionLangs,
  fetchMix,
  guessLanguage,
  parseSongTitle,
  pickSeeds,
  rankCandidates,
  seedableSongs,
  thumbnailUrl,
  titleKey,
  type Candidate,
  type Seed,
  type Suggestion,
  type SuggestionStatus,
} from "../lib/suggestions";
import { useSongStore } from "./song-store";
import { useTaskQueueStore } from "./task-queue-store";
import type { Song } from "../types/song";

const LOCAL_USER_ID = "local";
const SEEDS_PER_BATCH = 3;
const BATCH_SIZE = 12;
const MAX_PER_ARTIST = 3;
const CAPTION_CHUNK = 6;
const MAX_CAPTION_CHECKS = 48;
/** "Seen" suggestions (skipped with "New suggestions") may come back after this long. */
const SEEN_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_SEEDS_KEY = "suggestions_recent_seeds";
const LAST_GENERATED_KEY = "suggestions_last_generated_at";

interface SuggestionsState {
  suggestions: Suggestion[];
  loaded: boolean;
  generating: boolean;
  progress: string | null;
  error: string | null;
  /** Seeds behind the latest batch, for the "Based on …" line. */
  seeds: Seed[];

  load: () => Promise<void>;
  /**
   * Build a new batch. `fresh` sets the current suggestions aside first (they
   * won't come back for a while); `seedSongId` makes it "more like this song".
   */
  generate: (opts?: { fresh?: boolean; seedSongId?: string }) => Promise<void>;
  dismiss: (videoId: string) => Promise<void>;
  addToLibrary: (videoId: string) => Promise<Song | null>;
  /** Hours since the last batch was built, or null if never. */
  hoursSinceLastBatch: () => Promise<number | null>;
}

function now() {
  return new Date().toISOString();
}

async function persist(rows: Suggestion[]) {
  if (rows.length === 0) return;
  const { error } = await localDb.putSuggestions(rows as unknown as Record<string, unknown>[]);
  if (error) console.error("[suggestions] persist failed:", error);
}

function playCountsBySong(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [songId, lines] of Object.entries(useSongStore.getState().lines)) {
    counts[songId] = lines.reduce((sum, l) => sum + (l.play_count ?? 0), 0);
  }
  return counts;
}

function toSuggestion(c: Candidate, langs: string[], batchId: string, status: SuggestionStatus): Suggestion {
  const { title, artist } = parseSongTitle(c.entry.title, c.entry.channel);
  const ts = now();
  return {
    video_id: c.entry.videoId,
    youtube_url: `https://www.youtube.com/watch?v=${c.entry.videoId}`,
    raw_title: c.entry.title,
    channel: c.entry.channel,
    title,
    artist,
    duration_ms: c.entry.durationMs,
    thumbnail_url: thumbnailUrl(c.entry.videoId),
    caption_langs: langs,
    seed_song_id: c.seed.songId,
    seed_title: c.seed.title,
    batch_id: batchId,
    status,
    created_at: ts,
    updated_at: ts,
    user_id: LOCAL_USER_ID,
  };
}

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  suggestions: [],
  loaded: false,
  generating: false,
  progress: null,
  error: null,
  seeds: [],

  load: async () => {
    if (get().loaded) return;
    const rows = (await localDb.getAllSuggestions()) as unknown as Suggestion[];
    set({ suggestions: rows, loaded: true });
  },

  generate: async (opts = {}) => {
    if (get().generating) return;
    await get().load();
    set({ generating: true, error: null, progress: "Picking songs from your library…" });

    try {
      try {
        await ensureFreshYtDlp();
      } catch (err) {
        console.warn("[suggestions] yt-dlp freshness check failed (continuing):", err);
      }

      const songs = useSongStore.getState().songs;

      if (opts.fresh) {
        const ts = now();
        const setAside = get().suggestions
          .filter((s) => s.status === "new")
          .map((s) => ({ ...s, status: "seen" as const, updated_at: ts }));
        await persist(setAside);
        set((st) => ({
          suggestions: st.suggestions.map((s) => setAside.find((x) => x.video_id === s.video_id) ?? s),
        }));
      }

      const recentSeedIds = ((await localDb.getMeta(RECENT_SEEDS_KEY)) as string[] | undefined) ?? [];
      const seeds = opts.seedSongId
        ? seedableSongs(songs).filter((s) => s.songId === opts.seedSongId)
        : pickSeeds(songs, playCountsBySong(), recentSeedIds, SEEDS_PER_BATCH);
      if (seeds.length === 0) {
        throw new Error("Add a song from YouTube first — suggestions are based on your library.");
      }
      set({ seeds, progress: `Finding songs like ${seeds.map((s) => s.title).join(", ")}…` });

      const mixResults = await Promise.allSettled(
        seeds.map(async (seed) => ({ seed, entries: await fetchMix(seed.videoId) })),
      );
      const mixes = mixResults.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (mixes.length === 0) {
        const reason = mixResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw reason?.reason ?? new Error("Couldn't reach YouTube.");
      }

      // Skip library songs and anything already suggested (unless it was set aside long ago).
      const cutoff = Date.now() - SEEN_COOLDOWN_MS;
      const excludeIds = new Set<string>();
      for (const s of songs) {
        const id = s.youtube_url ? parseYouTubeVideoId(s.youtube_url) : null;
        if (id) excludeIds.add(id);
      }
      for (const s of get().suggestions) {
        if (s.status === "seen" && Date.parse(s.updated_at) < cutoff) continue;
        excludeIds.add(s.video_id);
      }
      const excludeTitleKeys = new Set<string>([
        ...songs.map((s) => titleKey(s.title, s.artist)),
        ...get().suggestions
          .filter((s) => s.status === "new" || s.status === "added")
          .map((s) => titleKey(s.raw_title, s.channel)),
      ]);

      const candidates = diversify(rankCandidates(mixes, excludeIds, excludeTitleKeys), MAX_PER_ARTIST);
      const batchId = crypto.randomUUID();
      let found = 0;
      let checked = 0;

      while (found < BATCH_SIZE && checked < Math.min(candidates.length, MAX_CAPTION_CHECKS)) {
        const chunk = candidates.slice(checked, checked + CAPTION_CHUNK);
        checked += chunk.length;
        set({ progress: `Checking for lyrics… ${found} of ${BATCH_SIZE} found` });

        const langsById = await fetchCaptionLangs(
          chunk.map((c) => c.entry.videoId),
          (videoId, langs) => {
            if (langs.length === 0 || found >= BATCH_SIZE) return;
            const c = chunk.find((x) => x.entry.videoId === videoId);
            if (!c) return;
            found++;
            const row = toSuggestion(c, langs, batchId, "new");
            set((st) => ({
              suggestions: [...st.suggestions.filter((s) => s.video_id !== videoId), row],
              progress: `Checking for lyrics… ${found} of ${BATCH_SIZE} found`,
            }));
            void persist([row]);
          },
        );

        // Remember videos without uploaded captions so they aren't re-checked next time.
        const rejected = chunk
          .filter((c) => !(langsById.get(c.entry.videoId)?.length))
          .map((c) => toSuggestion(c, [], batchId, "no_captions"));
        await persist(rejected);
        const rejectedIds = new Set(rejected.map((r) => r.video_id));
        set((st) => ({
          suggestions: [...st.suggestions.filter((s) => !rejectedIds.has(s.video_id)), ...rejected],
        }));
      }

      await localDb.setMeta(RECENT_SEEDS_KEY, [...recentSeedIds, ...seeds.map((s) => s.songId)].slice(-9));
      await localDb.setMeta(LAST_GENERATED_KEY, now());

      set({
        progress: null,
        error: found === 0 ? "No new songs with lyrics turned up this time — try again or pick a different song." : null,
      });
    } catch (err) {
      console.error("[suggestions] generate failed:", err);
      set({ progress: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ generating: false });
    }
  },

  dismiss: async (videoId) => {
    const ts = now();
    set((st) => ({
      suggestions: st.suggestions.map((s) =>
        s.video_id === videoId ? { ...s, status: "dismissed", updated_at: ts } : s,
      ),
    }));
    await localDb.updateSuggestion(videoId, { status: "dismissed", updated_at: ts });
  },

  addToLibrary: async (videoId) => {
    const s = get().suggestions.find((x) => x.video_id === videoId);
    if (!s) return null;

    const song = await useSongStore.getState().addSong({
      title: s.title,
      artist: s.artist,
      youtube_url: s.youtube_url,
      thumbnail_url: s.thumbnail_url,
      duration_ms: s.duration_ms,
      language: guessLanguage(s),
      tags: [],
      user_id: undefined,
    });
    // Same as the Add Song page: the queue downloads, then stems/pitch/chords chain on.
    useTaskQueueStore.getState().enqueue(song.id, song.title, "download");

    const ts = now();
    set((st) => ({
      suggestions: st.suggestions.map((x) =>
        x.video_id === videoId ? { ...x, status: "added", updated_at: ts } : x,
      ),
    }));
    await localDb.updateSuggestion(videoId, { status: "added", updated_at: ts });
    return song;
  },

  hoursSinceLastBatch: async () => {
    const last = (await localDb.getMeta(LAST_GENERATED_KEY)) as string | undefined;
    return last ? (Date.now() - Date.parse(last)) / 3_600_000 : null;
  },
}));
