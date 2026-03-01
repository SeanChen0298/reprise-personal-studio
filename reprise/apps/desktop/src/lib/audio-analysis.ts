import { Command } from "@tauri-apps/plugin-shell";
import { exists } from "@tauri-apps/plugin-fs";
import { spawnAndWait } from "./audio-download";

export interface PitchPoint {
  time_ms: number;
  freq_hz: number;
  confidence: number;
}

/**
 * Analyze pitch of a vocals file using torchcrepe.
 * Returns the path to the output CSV file.
 */
export async function analyzePitch(
  vocalsPath: string,
  songFolder: string,
): Promise<string> {
  const outputPath = `${songFolder}/pitch.csv`;
  const monoPath = `${songFolder}/vocals_mono.wav`;

  // torchcrepe requires mono audio — Demucs outputs stereo
  const ffmpegCmd = Command.create("ffmpeg", [
    "-y", "-i", vocalsPath,
    "-ac", "1", "-ar", "16000",
    monoPath,
  ]);
  const ffResult = await spawnAndWait(ffmpegCmd, "[ffmpeg→mono]");
  if (ffResult.code !== 0) {
    throw new Error("Failed to convert vocals to mono: " + (ffResult.stderr.split("\n").filter(Boolean).pop() || "ffmpeg error"));
  }

  const command = Command.create("python", [
    "-m", "torchcrepe",
    "--audio_files", monoPath,
    "--output_files", outputPath,
    "--model", "full",
    "--hop_length", "160",
    "--decoder", "viterbi",
    "--batch_size", "512",
  ]);

  const result = await spawnAndWait(command, "[torchcrepe]");

  if (result.code !== 0) {
    if (result.stderr.includes("No module named 'torchcrepe'")) {
      throw new Error("torchcrepe is not installed. Run: pip install torchcrepe");
    }
    throw new Error(
      result.stderr.split("\n").filter(Boolean).pop() || "Pitch analysis failed"
    );
  }

  const fileExists = await exists(outputPath);
  if (!fileExists) {
    throw new Error("torchcrepe completed but output file was not found");
  }

  return outputPath;
}

/** Parse torchcrepe CSV output into PitchPoint array.
 *  torchcrepe outputs one frequency per line, one line per hop (10ms at hop_length=160, sr=16000).
 *  Format: single column of frequency values (Hz). */
export function parsePitchData(content: string, hopMs = 10): PitchPoint[] {
  const lines = content.trim().split("\n");
  const points: PitchPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // torchcrepe CSV may have a header or be headerless — skip non-numeric lines
    const freq = parseFloat(line);
    if (Number.isNaN(freq) || freq <= 0) continue;

    points.push({
      time_ms: i * hopMs,
      freq_hz: freq,
      confidence: 1, // torchcrepe CLI doesn't output confidence; assume full
    });
  }

  return points;
}

/** Convert frequency (Hz) to semitone (MIDI note number). A4=440Hz=69 */
export function freqToSemitone(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Check if torchcrepe is installed. Returns version string or null. */
export async function checkTorchcrepeInstalled(): Promise<string | null> {
  try {
    const command = Command.create("python", [
      "-c",
      "import torchcrepe; print(torchcrepe.__version__)",
    ]);
    const result = await command.execute();
    return result.code === 0 ? result.stdout.trim() || "installed" : null;
  } catch {
    return null;
  }
}
