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
}

export interface ChordSegment {
  start_ms: number;
  end_ms: number;
  beats: number;
  label: string;        // e.g. "F#m7", or "N" for no chord
  root: string | null;
  quality: "maj" | "m" | "7" | "m7" | "N";
  confidence: number;   // 0–1
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
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Run chord analysis on `instrumentalPath` and write `chords.json` into
 * `songFolder`. Returns the output file path on success; throws on failure.
 */
export async function analyzeChords(
  instrumentalPath: string,
  songFolder: string,
): Promise<string> {
  // Resolve bundled Python script (src-tauri/sidecars/chord_analyze.py)
  const scriptPath = await resolveResource("sidecars/chord_analyze.py");
  const outputPath = `${songFolder}/chords.json`;

  const command = Command.create("python", [
    scriptPath,
    "--audio_path",  instrumentalPath,
    "--output_path", outputPath,
  ]);

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
