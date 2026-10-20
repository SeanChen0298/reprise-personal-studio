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

/** Shape of chords.json. Fields are added as later analysis stages land. */
export interface ChordAnalysis {
  version: number;
  status: "ok" | "error";
  analyzed_at: string;
  source_audio: string;
  duration_ms?: number;
  message?: string;
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
    if (result.stderr.includes("No module named 'soundfile'")) {
      throw new Error("soundfile is not installed. Run: pip install soundfile");
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
