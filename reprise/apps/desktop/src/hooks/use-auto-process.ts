/**
 * Prepares songs in the background (Settings → "Prepare songs automatically", on by default):
 * every downloaded song is brought up to date, one step at a time —
 *
 *   1. lyrics, when it has none (LRCLIB, same rules as a fresh download)
 *   2. stem separation (→ pitch and chords follow on their own, see use-task-queue-processor);
 *      chords from an older analysis are redone once
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
import { followTranslations, splitLines } from "@reprise/shared";
import { usePreferencesStore } from "../stores/preferences-store";
import { useSongStore } from "../stores/song-store";
import { useTaskQueueStore } from "../stores/task-queue-store";
import { backupChain, useCoachStore } from "../stores/coach-store";
import { isJapanese } from "../lib/language";
import type { Line, Section, Song } from "../types/song";
import { fitLyrics } from "../lib/fit-lyrics";
import { CHORD_ANALYSIS_VERSION } from "../lib/chord-analysis";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { loadVocalMap } from "../lib/take-review";
import { usePrepareStore } from "../stores/prepare-store";
import { lrclibResting } from "../lib/lrclib";

/** What a step did, for the preparation log. */
type Outcome = { result: string; changed: boolean };

// "fit2": fitting got the singer's-entry check (Oct 2026), so every song is fitted once more.
type Step = "lyrics" | "sections" | "fit2";
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

/** Where each downloaded song stands with the timing fit (for Settings). */
export function fitStatus(songs: Song[], lines: Record<string, Line[]>) {
  const t = tried();
  const out: { song: Song; state: "fitted" | "next" | "waiting"; why?: string }[] = [];
  for (const song of songs) {
    if (song.download_status !== "done") continue;
    const primary = primaryLines(song, lines[song.id] ?? []);
    const timed = primary.filter((l) => l.start_ms != null).length;
    if (t[song.id]?.fit2) out.push({ song, state: "fitted" });
    else if (primary.length === 0) out.push({ song, state: "waiting", why: "no lyrics" });
    else if (timed < 5 || timed < primary.length * 0.8) out.push({ song, state: "waiting", why: "lyrics have no timing" });
    else if (song.pitch_status !== "done") out.push({ song, state: "waiting", why: "pitch not analyzed yet" });
    else out.push({ song, state: "next" });
  }
  return out;
}

/** Ask the coach to split the song into sections and save them (no preview: it's the automatic run). */
async function coachSections(song: Song, lines: Line[]): Promise<Outcome> {
  const coach = useCoachStore.getState();
  const apiKey = coach.keys[coach.provider];
  const model = coach.models[coach.provider];
  if (!apiKey || !model) return { result: "No coach key", changed: false };
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
  if (!plan?.length) return { result: "The coach gave no usable sections", changed: false };
  // Sections may have been added by hand while the coach was thinking.
  if ((useSongStore.getState().sections[song.id]?.length ?? 0) > 0) return { result: "You added sections meanwhile", changed: false };
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
  return { result: `Added ${list.length} sections`, changed: true };
}

/** Fit the song's timed lyrics to its vocals and save the new times. */
async function fitToVocals(song: Song, lines: Line[], translations: Line[], sections: Section[]): Promise<Outcome> {
  const map = await loadVocalMap(song);
  if (!map) return { result: "Couldn't read the vocals' pitch", changed: false };
  const r = fitLyrics(lines, sections, map.singing, map.semitones.length * 10);
  if (!r?.changes.length) return { result: "Already fits — left as it was", changed: false };
  const store = useSongStore.getState();
  // The translation moves with its lines.
  for (const c of [...r.changes, ...followTranslations(lines, translations, r.changes)]) {
    await store.updateLine(song.id, c.lineId, { start_ms: c.start_ms, end_ms: c.end_ms });
  }
  const shift = r.offsetMs ? `, whole song ${r.offsetMs > 0 ? "later" : "earlier"} by ${(Math.abs(r.offsetMs) / 1000).toFixed(1)} s` : "";
  const secs = r.sectionsShifted ? `, ${r.sectionsShifted} section${r.sectionsShifted === 1 ? "" : "s"} on their own` : "";
  return { result: `Retimed ${r.changes.length} line${r.changes.length === 1 ? "" : "s"}${shift}${secs}`, changed: true };
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
  /** chords.json versions checked this session. */
  const chordsChecked = useRef(new Set<string>());

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

  // Every few minutes, look again for work that waited (LRCLIB resting).
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => useSongStore.setState((s) => ({ songs: [...s.songs] })), 5 * 60_000);
    return () => clearInterval(id);
  }, [on]);

  // Light jobs: one at a time, here.
  useEffect(() => {
    if (!on || !loaded || busy.current) return;
    const t = tried();
    const coach = useCoachStore.getState();
    const coachReady = !!coach.keys[coach.provider] && !!coach.models[coach.provider];
    let job: (() => Promise<Outcome | void>) | null = null;
    /** Steps worth showing in the log (cheap checks like readings are left out). */
    let shown: { song: Song; step: string } | null = null;
    for (const song of songs) {
      if (song.download_status !== "done") continue;
      const all = lines[song.id] ?? [];
      if (all.length === 0) {
        if (!t[song.id]?.lyrics && !lrclibResting()) {
          markTried(song.id, "lyrics");
          shown = { song, step: "Find lyrics on LRCLIB" };
          job = async () => {
            const found = await useSongStore.getState().findLyricsForSong(song.id);
            if (found) return { result: "Lyrics added", changed: true };
            // LRCLIB was busy, not empty: look again once it has rested.
            if (lrclibResting()) {
              forgetPrepared(song.id, "lyrics");
              return { result: "LRCLIB was busy — will look again later", changed: false };
            }
            return { result: "None found", changed: false };
          };
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
      if (song.chord_status === "done" && song.chord_data_path && !chordsChecked.current.has(song.id)) {
        chordsChecked.current.add(song.id);
        const path = song.chord_data_path;
        job = async () => {
          const head = (await readTextFile(path)).slice(0, 200);
          const version = Number(/"version"\s*:\s*(\d+)/.exec(head)?.[1] ?? 0);
          const queue = useTaskQueueStore.getState();
          if (version < CHORD_ANALYSIS_VERSION && !queue.tasks.some((x) => x.songId === song.id && x.type === "chords")) {
            queue.enqueue(song.id, song.title, "chords");
            usePrepareStore.getState().finish({ songId: song.id, title: song.title, step: "Chords", result: "Queued again (newer analysis)", changed: true });
          }
        };
        break;
      }
      const primary = primaryLines(song, all);
      const timed = primary.filter((l) => l.start_ms != null).length;
      if (song.pitch_status === "done" && timed >= 5 && timed >= primary.length * 0.8 && !t[song.id]?.fit2) {
        markTried(song.id, "fit2");
        shown = { song, step: "Fit timing to the vocals" };
        job = () => fitToVocals(song, primary, splitLines(all, song.translation_language).translations, sections[song.id] ?? []);
        break;
      }
      if (coachReady && primary.length >= 6 && (sections[song.id]?.length ?? 0) === 0 && !t[song.id]?.sections) {
        markTried(song.id, "sections");
        shown = { song, step: "Sections from the coach" };
        job = () => coachSections(song, primary);
        break;
      }
    }
    if (!job) return;
    busy.current = true;
    const log = usePrepareStore.getState();
    const what = shown;
    if (what) log.start(what.song.title, what.step);
    job()
      .then((o) => {
        if (what && o) log.finish({ songId: what.song.id, title: what.song.title, step: what.step, ...o });
      })
      .catch((err) => {
        console.warn("[prepare]", err);
        if (what) log.finish({ songId: what.song.id, title: what.song.title, step: what.step, result: `Failed: ${err instanceof Error ? err.message : String(err)}`, changed: false });
      })
      .finally(() => {
        if (usePrepareStore.getState().current) usePrepareStore.setState({ current: null });
        busy.current = false;
        // Look for the next job (the stores may not have changed, e.g. no lyrics were found).
        useSongStore.setState((s) => ({ songs: [...s.songs] }));
      });
  }, [on, loaded, songs, lines, sections]);
}
