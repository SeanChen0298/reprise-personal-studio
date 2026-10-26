/**
 * chord-analysis.ts
 *
 * TypeScript wrapper for the chord_analyze.py sidecar script.
 * Resolves the bundled script via Tauri's resource system, runs it on the
 * instrumental stem, and reads back `chords.json` from the song folder.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { resolveResource } from "@tauri-apps/api/path";
import { spawnAndWait } from "./audio-download";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChordKey {
  tonic: string;        // e.g. "F#"
  tonic_pc: number;     // pitch class 0–11 (C = 0)
  mode: "major" | "minor";
  name: string;         // e.g. "F# minor"
  confidence: number;   // 0–1
}

export interface ChordBar {
  index: number;
  start_ms: number;
  end_ms: number;
  first_beat: number;   // index into beats_ms
  beats: number;
  pickup: boolean;      // partial bar before the first downbeat
  /** No steady pulse here (intro, outro, pause): placeholder bar, not played along. */
  free?: boolean;
}

export interface ChordSegment {
  start_ms: number;
  end_ms: number;
  beats: number;
  label: string;        // e.g. "F#m7", or "N" for no chord
  root: string | null;
  root_pc: number | null;
  quality:
    | "maj" | "m" | "7" | "m7" | "maj7" | "m7b5" | "dim" | "sus4"
    | "maj9" | "9" | "m9" | "add9" | "6" | "m6" | "sus2" | "7sus4" | "aug" | "dim7" | "N";
  confidence: number;   // 0–1
  /** Set when the user corrected this chord (see chord-edits.ts). */
  edited?: boolean;
  /** The analysis' original label, when edited. */
  detected_label?: string;
  /** Runner-up chords that fit this stretch almost as well (fit relative to the winner, 0–1). */
  alternatives?: { label: string; fit: number }[];
  /** Set when the bass check renamed this chord (e.g. F#m7 -> Dmaj7); the original label. */
  reranked_from?: string;
}

export interface StrumSection {
  start_bar: number;
  end_bar: number;      // inclusive
  start_ms: number;
  end_ms: number;
  /** One character per eighth note: D = down, U = up, - = rest. */
  pattern: string;
  /** "detected" = read from the audio; "suggested" = a fallback that fits the tempo. */
  source: "detected" | "suggested";
  confidence: number | null;
}

export interface StrummingSheet {
  subdivision: number;  // pattern characters per beat
  main_pattern: string;
  main_pattern_source: "detected" | "suggested";
  sections: StrumSection[];
}

export interface CapoSuggestion {
  fret: number;                    // 0 = no capo
  shapes: Record<string, string>;  // chord label -> shape to play with the capo on
  barre_share_no_capo: number;
  barre_share_with_capo: number;
}

/** Shape of chords.json. Fields are added as later analysis stages land. */
export interface ChordAnalysis {
  version: number;
  status: "ok" | "error";
  analyzed_at: string;
  source_audio: string;
  message?: string;
  duration_ms?: number;
  tempo_bpm?: number;
  key?: ChordKey;
  time_signature?: { beats_per_bar: number; beat_unit: number };
  beats_ms?: number[];
  bars?: ChordBar[];
  chords?: ChordSegment[];
  /** Settings the analysis ran with (incl. tempo_hint when the tempo was corrected). */
  tuning?: { tempo_hint?: number | null; use_stems?: boolean } & Record<string, unknown>;
  strumming?: StrummingSheet;
  capo?: CapoSuggestion;
  /** Stretches without a steady pulse, [start, end] in ms. */
  free_ranges_ms?: [number, number][];
  /** Which audio each part of the analysis used (stems when available). */
  sources?: { beats: string; chords: string; bass: string; strumming: string };
  fingerstyle?: FingerstyleArrangement;
}

export interface FingerstyleNote {
  string: number;   // 1 = high E … 6 = low E
  fret: number;     // 0 = open
  midi: number;
  role: "melody" | "bass" | "fill";
}

export interface FingerstyleEvent {
  bar: number;      // index into bars
  slot: number;     // eighth-note slot within the bar
  t_ms: number;
  notes: FingerstyleNote[];
}

export type FingerstyleArrangement =
  | {
      status: "ok";
      tuning: "standard";
      melody_shift_semitones: number;
      slots_per_bar: number;
      events: FingerstyleEvent[];
      dropped_notes: number;
      highest_fret: number;
      tab_path: string;
      musicxml_path: string;
    }
  | { status: "skipped" | "error"; message: string };

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Run chord analysis on `instrumentalPath` and write `chords.json` into
 * `songFolder`. When `pitchPath` (the vocals' pitch.csv) is given, a
 * fingerstyle arrangement is also written next to it. Returns the output
 * file path on success; throws on failure.
 */
export async function analyzeChords(
  instrumentalPath: string,
  songFolder: string,
  pitchPath?: string,
  title?: string,
  /** The original song audio; lets the analysis split drums / bass / other. */
  mixPath?: string,
): Promise<string> {
  // Resolve bundled Python script (src-tauri/sidecars/chord_analyze.py);
  // it imports fingerstyle_arrange.py from the same folder.
  const scriptPath = await resolveResource("sidecars/chord_analyze.py");
  const outputPath = `${songFolder}/chords.json`;

  const args = [
    scriptPath,
    "--audio_path",  instrumentalPath,
    "--output_path", outputPath,
  ];
  if (pitchPath) args.push("--pitch_path", pitchPath);
  if (title) args.push("--title", title);
  if (mixPath) args.push("--mix_path", mixPath);

  const command = Command.create("python", args);

  const result = await spawnAndWait(command, "[chords]");

  // The script writes chords.json even on failure, with the reason inside.
  if (await exists(outputPath)) {
    const output = await readChordAnalysis(outputPath);
    if (output.status === "error") throw new Error(output.message ?? "Chord analysis failed");
    if (output.status === "ok" && result.code === 0) return outputPath;
  }

  if (result.code !== 0) {
    if (result.stderr.includes("No module named 'librosa'")) {
      throw new Error("librosa is not installed. Run: pip install librosa");
    }
    const lastLine = result.stderr.split("\n").filter(Boolean).pop();
    throw new Error(lastLine || "chord_analyze failed");
  }

  throw new Error("chord_analyze completed but chords.json was not found");
}

/** Read and parse a chords.json file. */
export async function readChordAnalysis(path: string): Promise<ChordAnalysis> {
  const raw = await readTextFile(path);
  return JSON.parse(raw) as ChordAnalysis;
}

// ---------------------------------------------------------------------------
// Per-song analysis settings (chord_settings.json next to chords.json)
// ---------------------------------------------------------------------------

export interface ChordSettings {
  /** Force the beat grid to this BPM (fixes half / double-time detection). */
  tempo_hint?: number | null;
  /** Analyse on separated drums / bass / other stems (for drum-heavy songs). */
  use_stems?: boolean;
  /** The strum pattern the guide plays: 8 eighth notes per 4-beat bar, "D" / "U" / "-". */
  strum_pattern?: string;
}

/** Common strum patterns (8 eighth notes: 1 & 2 & 3 & 4 &). */
export const STRUM_PRESETS: { name: string; pattern: string }[] = [
  { name: "Pop / folk", pattern: "D-DU-UDU" },
  { name: "Ballad", pattern: "D-D-DUDU" },
  { name: "Down on each beat", pattern: "D-D-D-D-" },
  { name: "Every eighth", pattern: "DUDUDUDU" },
  { name: "Island", pattern: "D-DU-UD-" },
  { name: "Slow (1 & 3)", pattern: "D---D---" },
  { name: "Whole bar", pattern: "D-------" },
];
export const DEFAULT_STRUM_PATTERN = STRUM_PRESETS[0].pattern;

/** chords.json written by an older analysis is redone once (see use-auto-process). */
export const CHORD_ANALYSIS_VERSION = 15;

function settingsPath(chordDataPath: string): string {
  return chordDataPath.replace(/[\/][^\/]*$/, "") + "/chord_settings.json";
}

/** Merge `patch` into the song's chord_settings.json; the analysis reads it on the next run. */
export async function saveChordSettings(chordDataPath: string, patch: ChordSettings): Promise<void> {
  const path = settingsPath(chordDataPath);
  let current: ChordSettings = {};
  if (await exists(path)) {
    try { current = JSON.parse(await readTextFile(path)); } catch { current = {}; }
  }
  const next = { ...current, ...patch };
  if (next.tempo_hint == null) delete next.tempo_hint;
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, JSON.stringify(next, null, 2));
}

/** Read a song's chord_settings.json from its folder ({} if missing or unreadable). */
export async function readChordSettings(songFolder: string): Promise<ChordSettings> {
  const path = `${songFolder}/chord_settings.json`;
  if (!(await exists(path))) return {};
  try { return JSON.parse(await readTextFile(path)) as ChordSettings; } catch { return {}; }
}

/** Files holding a song's chord work (corrections, fingering picks, analysis options). */
const CHORD_WORK_FILES = [
  "chord_edits.json", "chord_edits.fingerstyle.json",
  "chord_fingerings.json", "chord_fingerings.fingerstyle.json",
  "chord_settings.json", "fingerstyle_tab_edits.json",
];

/**
 * Start a song's chords over: move its chord work into
 * backup/chords-<date>/ in the song folder (nothing is deleted), so the next
 * analysis starts clean. Returns how many files were moved.
 */
export async function backUpAndClearChordWork(songFolder: string): Promise<number> {
  const { mkdir, rename } = await import("@tauri-apps/plugin-fs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = `${songFolder}/backup/chords-${stamp}`;
  let moved = 0;
  for (const name of CHORD_WORK_FILES) {
    const path = `${songFolder}/${name}`;
    if (!(await exists(path))) continue;
    if (moved === 0) await mkdir(backupDir, { recursive: true });
    await rename(path, `${backupDir}/${name}`);
    moved++;
  }
  return moved;
}
