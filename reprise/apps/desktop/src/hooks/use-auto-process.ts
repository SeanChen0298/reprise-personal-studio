/**
 * Prepares songs in the background (Settings → "Prepare songs automatically", on by default):
 * every downloaded song is brought up to date, one step at a time —
 *
 *   1. lyrics, when it has none (LRCLIB, same rules as a fresh download)
 *   2. stem separation (→ pitch and chords follow on their own, see use-task-queue-processor)
 *   3. lyric timing: timed lyrics are fitted to this recording's vocals (shifted to where the
 *      singing is, each line ending where the singing stops)
 *   4. furigana and romaji for Japanese lyrics (a song with no language whose lyrics are mostly
 *      kana is set to Japanese first)
 *   5. sections from the coach, when the song has none and a coach key is set
 *
 * Heavy jobs go on the task queue (one at a time, shown there); light ones (lyrics, readings,
 * sections) run here one after another. Each step is tried once per song (remembered in
 * localStorage), so something that can't work isn't retried forever, and deleted sections stay deleted.
 */

import { useEffect, useRef } from "react";
import { splitLines } from "@reprise/shared";
import { usePreferencesStore } from "../stores/preferences-store";
import { useSongStore } from "../stores/song-store";
import { useTaskQueueStore } from "../stores/task-queue-store";
import { backupChain, useCoachStore } from "../stores/coach-store";
import { isJapanese } from "../lib/language";
import type { Line, Section, Song } from "../types/song";
import { fitLyrics } from "../lib/fit-lyrics";
import { loadVocalMap } from "../lib/take-review";

type Step = "lyrics" | "sections" | "fit";
const TRIED_KEY = "reprise-auto-prepared";

function tried(): Record<string, Partial<Record<Step, number>>> {
  try {
    return JSON.parse(localStorage.getItem(TRIED_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function markTried(songId: string, step: Step) {
  try {
    const t = tried();
    t[songId] = { ...t[songId], [step]: Date.now() };
    localStorage.setItem(TRIED_KEY, JSON.stringify(t));
  } catch {
    // Storage unavailable: the step may be tried again next time, which is harmless.
  }
}

/** Let a step run again for a song (its lyrics or timing changed). */
export function forgetPrepared(songId: string, step: Step) {
  try {
    const t = tried();
    if (!t[songId]) return;
    delete t[songId][step];
    localStorage.setItem(TRIED_KEY, JSON.stringify(t));
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

const primaryLines = (song: Song, lines: Line[]) => splitLines(lines, song.translation_language).lines;

/** Ask the coach to split the song into sections and save them (no preview: it's the automatic run). */
async function coachSections(song: Song, lines: Line[]): Promise<void> {
  const coach = useCoachStore.getState();
  const apiKey = coach.keys[coach.provider];
  const model = coach.models[coach.provider];
  if (!apiKey || !model) return;
  const [{ askCoach }, { COACH_SYSTEM, SECTIONS_PROMPT }, kn] = await Promise.all([
    import("../lib/coach/providers"),
    import("../lib/coach/persona"),
    import("../lib/coach/knowledge"),
  ]);
  const st = useSongStore.getState();
  const [knowledge, profile] = await Promise.all([kn.loadKnowledge(song), kn.loadProfile()]);
  const context = kn.buildContext({
    song,
    lines,
    translationById: new Map(),
    sections: [],
    highlights: [],
    takes: st.recordings[song.id] ?? [],
    knowledge,
    profile,
  });
  const r = await askCoach({
    provider: coach.provider,
    apiKey,
    model,
    system: COACH_SYSTEM,
    context,
    history: [],
    prompt: SECTIONS_PROMPT,
    maxSearches: null,
    fallbackModels: backupChain(coach),
    quick: true,
  });
  const plan = kn.parseSectionPlan(r.text, lines.length);
  if (!plan?.length) return;
  // Sections may have been added by hand while the coach was thinking.
  if ((useSongStore.getState().sections[song.id]?.length ?? 0) > 0) return;
  const now = new Date().toISOString();
  const list: Section[] = plan
    .map((s) => ({ name: s.name, startIndex: s.start - 1 }))
    .filter((s) => lines[s.startIndex])
    .map((s, i, all) => {
      const endLine = all[i + 1] ? lines[all[i + 1].startIndex - 1] : lines[lines.length - 1];
      return {
        id: crypto.randomUUID(),
        song_id: song.id,
        name: s.name,
        start_line_order: lines[s.startIndex].order,
        end_line_order: Math.max(lines[s.startIndex].order, endLine.order),
        created_at: now,
        updated_at: now,
      };
    });
  for (const s of list) await useSongStore.getState().addSection(song.id, s);
}

/** Fit the song's timed lyrics to its vocals and save the new times. */
async function fitToVocals(song: Song, lines: Line[], sections: Section[]): Promise<void> {
  const map = await loadVocalMap(song);
  if (!map) return;
  const r = fitLyrics(lines, sections, map.singing, map.semitones.length * 10);
  if (!r?.changes.length) return;
  const store = useSongStore.getState();
  for (const c of r.changes) await store.updateLine(song.id, c.lineId, { start_ms: c.start_ms, end_ms: c.end_ms });
}

export function useAutoProcess() {
  const on = usePreferencesStore((s) => s.autoPrepare);
  const songs = useSongStore((s) => s.songs);
  const lines = useSongStore((s) => s.lines);
  const sections = useSongStore((s) => s.sections);
  const loaded = useSongStore((s) => s.hasLoaded);
  const tasks = useTaskQueueStore((s) => s.tasks);
  const busy = useRef(false);
  /** Readings (furigana / romaji) tried this session — they're cheap, so per session is enough. */
  const readingsDone = useRef(new Set<string>());

  // Heavy jobs: queue them.
  useEffect(() => {
    if (!on || !loaded) return;
    const { enqueue } = useTaskQueueStore.getState();
    const queued = (id: string, type: string) => tasks.some((t) => t.songId === id && t.type === type);
    for (const song of songs) {
      if (song.download_status !== "done") continue;
      if ((!song.stem_status || song.stem_status === "idle") && !queued(song.id, "stems")) enqueue(song.id, song.title, "stems");
    }
  }, [on, loaded, songs, lines, tasks]);

  // Light jobs: one at a time, here.
  useEffect(() => {
    if (!on || !loaded || busy.current) return;
    const t = tried();
    const coach = useCoachStore.getState();
    const coachReady = !!coach.keys[coach.provider] && !!coach.models[coach.provider];
    let job: (() => Promise<unknown>) | null = null;
    for (const song of songs) {
      if (song.download_status !== "done") continue;
      const all = lines[song.id] ?? [];
      if (all.length === 0) {
        if (!t[song.id]?.lyrics) {
          markTried(song.id, "lyrics");
          job = () => useSongStore.getState().findLyricsForSong(song.id);
          break;
        }
        continue;
      }
      if (!song.language?.trim()) {
        const kana = all.filter((l) => /[぀-ヿ]/.test(l.text)).length;
        if (kana >= all.length * 0.5) {
          job = () => useSongStore.getState().updateSong(song.id, { language: "ja" });
          break;
        }
      }
      const japanese = isJapanese(song.language) || all.some((l) => isJapanese(l.language));
      const needsReading = japanese && all.some(
        (l) =>
          (isJapanese(l.language) || (!l.language && isJapanese(song.language))) &&
          ((!l.furigana_html && /[一-龯㐀-䶿]/.test(l.text)) || l.romaji_of !== (l.custom_text ?? l.text)),
      );
      if (needsReading && !readingsDone.current.has(song.id)) {
        readingsDone.current.add(song.id);
        job = () => useSongStore.getState().generateFuriganaForSong(song.id);
        break;
      }
      const primary = primaryLines(song, all);
      const timed = primary.filter((l) => l.start_ms != null).length;
      if (song.pitch_status === "done" && timed >= 5 && timed >= primary.length * 0.8 && !t[song.id]?.fit) {
        markTried(song.id, "fit");
        job = () => fitToVocals(song, primary, sections[song.id] ?? []);
        break;
      }
      if (coachReady && primary.length >= 6 && (sections[song.id]?.length ?? 0) === 0 && !t[song.id]?.sections) {
        markTried(song.id, "sections");
        job = () => coachSections(song, primary);
        break;
      }
    }
    if (!job) return;
    busy.current = true;
    job()
      .catch((err) => console.warn("[prepare]", err))
      .finally(() => {
        busy.current = false;
        // Look for the next job (the stores may not have changed, e.g. no lyrics were found).
        useSongStore.setState((s) => ({ songs: [...s.songs] }));
      });
  }, [on, loaded, songs, lines, sections]);
}
