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
  const csvPath = `${songFolder}/pitch.csv`;
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

  // Use torchcrepe Python API to get both pitch and confidence.
  // The CLI only outputs pitch; the API gives us confidence scores
  // to filter out silence, breaths, and unreliable harmony frames.
  const script = [
    "import torchcrepe, torch, torchaudio",
    `audio, sr = torchaudio.load(r'${monoPath}')`,
    "if sr != 16000:",
    "    audio = torchaudio.functional.resample(audio, sr, 16000)",
    "    sr = 16000",
    "pitch, confidence = torchcrepe.predict(",
    "    audio, sr, hop_length=160, model='full',",
    "    decoder=torchcrepe.decode.viterbi, batch_size=512,",
    "    return_periodicity=True,",
    ")",
    "# Apply periodicity median filter before squeezing (requires 2D input)",
    "torchcrepe.filter.median(confidence, 3)",
    "pitch = pitch.squeeze()",
    "confidence = confidence.squeeze()",
    `with open(r'${csvPath}', 'w') as f:`,
    "    for p, c in zip(pitch.tolist(), confidence.tolist()):",
    "        f.write(f'{p:.2f},{c:.4f}\\n')",
  ].join("\n");

  const command = Command.create("python", ["-c", script]);
  const result = await spawnAndWait(command, "[torchcrepe]");

  if (result.code !== 0) {
    if (result.stderr.includes("No module named 'torchcrepe'")) {
      throw new Error("torchcrepe is not installed. Run: pip install torchcrepe");
    }
    throw new Error(
      result.stderr.split("\n").filter(Boolean).pop() || "Pitch analysis failed"
    );
  }

  if (!(await exists(csvPath))) {
    throw new Error("torchcrepe completed but output file was not found");
  }

  return csvPath;
}

/** Parse torchcrepe CSV output into PitchPoint array.
 *  Supports two formats:
 *  - New: "freq,confidence" per line (from Python API)
 *  - Legacy: single frequency value per line
 *  One line per hop (10ms at hop_length=160, sr=16000). */
export function parsePitchData(content: string, hopMs = 10): PitchPoint[] {
  const lines = content.trim().split("\n");
  const points: PitchPoint[] = [];
  let frameIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");
    const freq = parseFloat(parts[0]);
    if (Number.isNaN(freq) || freq <= 0) continue;

    const confidence = parts.length > 1 ? parseFloat(parts[1]) : 1;

    points.push({
      time_ms: frameIndex * hopMs,
      freq_hz: freq,
      confidence: Number.isNaN(confidence) ? 1 : confidence,
    });
    frameIndex++;
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
