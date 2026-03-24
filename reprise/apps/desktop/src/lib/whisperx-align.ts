/**
 * whisperx-align.ts
 *
 * TypeScript wrapper for the whisperx_align.py sidecar script.
 * Resolves the bundled script via Tauri's resource system, writes the
 * lines input JSON, invokes `python whisperx_align.py ...`, and parses
 * the output.
 */

import { Command } from "@tauri-apps/plugin-shell";
import { writeTextFile, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { resolveResource } from "@tauri-apps/api/path";
import { spawnAndWait } from "./audio-download";
import type { Line } from "../types/song";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlignedLineResult {
  order: number;
  start_ms: number;
  end_ms: number;
  confidence: number;
}

export interface AlignOutput {
  status: "ok" | "error";
  lines: AlignedLineResult[];
  unmatched_lines: number[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the hiragana reading from furigana HTML like:
 *   <ruby>歌<rt>うた</rt></ruby>う  →  うたう
 * Non-ruby text (already kana/ASCII) is kept as-is.
 */
function extractHiraganaReading(html: string): string {
  return html
    .replace(/<ruby>[^<]*<rt>([^<]+)<\/rt><\/ruby>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Run WhisperX alignment on `audioPath` and map resulting timestamps to
 * the provided `lines`.  Returns the structured output on success; throws
 * on failure.
 */
export async function alignLyrics(
  audioPath: string,
  lines: Line[],
  songFolder: string,
  language: string,
  model = "medium",
): Promise<AlignOutput> {
  // Resolve bundled Python script (src-tauri/sidecars/whisperx_align.py)
  const scriptPath = await resolveResource("sidecars/whisperx_align.py");

  const linesPath  = `${songFolder}/lines_input.json`;
  const outputPath = `${songFolder}/align_output.json`;

  // Write the lines input JSON (only fields the script needs)
  // For Japanese: extract hiragana readings from furigana HTML so the Python
  // matcher compares hiragana↔hiragana instead of kanji↔hiragana.
  const payload = lines.map((l) => {
    const furiganaSource = l.custom_furigana_html || l.furigana_html;
    const reading = furiganaSource ? extractHiraganaReading(furiganaSource) : undefined;
    return {
      order: l.order,
      text: l.text,
      custom_text: l.custom_text,
      reading,
    };
  });
  await writeTextFile(linesPath, JSON.stringify(payload));

  // Spawn Python with the resolved script path
  const command = Command.create("python", [
    scriptPath,
    "--audio_path",  audioPath,
    "--lines_path",  linesPath,
    "--output_path", outputPath,
    "--language",    language || "en",
    "--model",       model,
  ]);

  const result = await spawnAndWait(command, "[whisperx]");

  // Try to read structured output first (present even on script-level errors)
  const outputExists = await exists(outputPath);
  if (outputExists) {
    try {
      const raw = await readTextFile(outputPath);
      const output: AlignOutput = JSON.parse(raw);
      if (output.status === "error") throw new Error(output.message ?? "Alignment failed");
      if (output.status === "ok")    return output;
    } catch (parseErr) {
      // Re-throw only if it's our structured error, not a JSON parse issue
      if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
        if (result.code !== 0 || (parseErr.message && !parseErr.message.startsWith("Unexpected"))) {
          throw parseErr;
        }
      }
    }
  }

  if (result.code !== 0) {
    if (result.stderr.includes("No module named 'whisperx'")) {
      throw new Error("whisperx is not installed. Run: pip install whisperx");
    }
    const lastLine = result.stderr.split("\n").filter(Boolean).pop();
    throw new Error(lastLine || "whisperx_align failed");
  }

  if (!outputExists) {
    throw new Error("whisperx_align completed but output file was not found");
  }

  const raw = await readTextFile(outputPath);
  const output: AlignOutput = JSON.parse(raw);
  if (output.status === "error") throw new Error(output.message ?? "Alignment failed");
  return output;
}
