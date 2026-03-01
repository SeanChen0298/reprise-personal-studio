import { Command } from "@tauri-apps/plugin-shell";
import { mkdir, exists } from "@tauri-apps/plugin-fs";

const REPRISE_ROOT = "C:/Reprise";

export const COOKIES_EXPIRED_MESSAGE =
  "YouTube cookies have expired. Please re-export your cookies:\n" +
  "1. Open Chrome and make sure you're logged into YouTube\n" +
  "2. Use the cookie export extension to export cookies\n" +
  "3. Save to C:/Reprise/cookies.txt\n" +
  "4. Try again";

function isBotDetectionError(stderr: string): boolean {
  return (
    stderr.includes("Sign in to confirm") ||
    stderr.includes("not a bot") ||
    stderr.includes("confirm you're not a bot")
  );
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn a command and stream stdout/stderr to console in real-time */
function spawnAndWait(
  command: ReturnType<typeof Command.create>,
  tag: string,
  onProgress?: (line: string) => void
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    command.stdout.on("data", (line: string) => {
      console.log(`${tag} stdout:`, line);
      stdout += line + "\n";
      onProgress?.(line);
    });
    command.stderr.on("data", (line: string) => {
      console.warn(`${tag} stderr:`, line);
      stderr += line + "\n";
    });
    command.on("close", (data: { code: number | null }) => {
      console.log(`${tag} exited with code:`, data.code);
      resolve({ code: data.code, stdout, stderr });
    });
    command.on("error", (err: string) => {
      // Tauri emits "error" for non-UTF-8 output (e.g. Japanese filenames).
      // Log but don't reject — wait for the "close" event to determine success.
      console.warn(`${tag} error (non-fatal):`, err);
      stderr += `[encoding error] ${err}\n`;
    });
    command.spawn().then(() => {
      console.log(`${tag} spawned, waiting...`);
    }).catch((err: unknown) => {
      console.error(`${tag} spawn failed:`, err);
      reject(err);
    });
  });
}

/** Strip playlist/index params from a YouTube URL to ensure single-video download */
function sanitizeYouTubeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("list");
    u.searchParams.delete("index");
    u.searchParams.delete("start_radio");
    return u.toString();
  } catch {
    return url;
  }
}

export const COOKIES_PATH = `${REPRISE_ROOT}/cookies.txt`;

/** Common yt-dlp args: single video, Node.js runtime, challenge solver, cookies for YouTube auth */
const YT_DLP_BASE = [
  "--no-playlist",
  "--js-runtimes", "node",
  "--remote-components", "ejs:github",
  "--cookies", COOKIES_PATH,
];

/** Remove characters invalid for Windows folder names and non-ASCII chars
 *  that cause Tauri shell encoding errors */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    // biome-ignore: strip non-ASCII to avoid Tauri UTF-8 encoding issues
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the song folder path: C:/Reprise/{Title} - {Artist} */
export function buildSongFolder(title: string, artist: string): string {
  const folderName = sanitizeFolderName(
    artist ? `${title} - ${artist}` : title
  );
  return `${REPRISE_ROOT}/${folderName}`;
}

/** Ensure the song folder exists, creating it if necessary */
async function ensureSongFolder(folderPath: string): Promise<void> {
  console.log("[ensureSongFolder] Checking root:", REPRISE_ROOT);
  try {
    const rootExists = await exists(REPRISE_ROOT);
    console.log("[ensureSongFolder] Root exists:", rootExists);
    if (!rootExists) {
      await mkdir(REPRISE_ROOT, { recursive: true });
      console.log("[ensureSongFolder] Root created");
    }
  } catch (err) {
    console.error("[ensureSongFolder] Root check/create failed:", err);
    throw err;
  }
  console.log("[ensureSongFolder] Checking folder:", folderPath);
  try {
    const folderExists = await exists(folderPath);
    console.log("[ensureSongFolder] Folder exists:", folderExists);
    if (!folderExists) {
      await mkdir(folderPath, { recursive: true });
      console.log("[ensureSongFolder] Folder created");
    }
  } catch (err) {
    console.error("[ensureSongFolder] Folder check/create failed:", err);
    throw err;
  }
}

const AUDIO_EXTENSIONS = [".m4a", ".webm", ".opus", ".ogg", ".mp3", ".wav"];

/** Find the downloaded audio file in the song folder */
async function findAudioFile(songFolder: string): Promise<string> {
  const { readDir } = await import("@tauri-apps/plugin-fs");
  const entries = await readDir(songFolder);
  const audioFile = entries.find(
    (e) => e.name && AUDIO_EXTENSIONS.some((ext) => e.name!.startsWith("audio") && e.name!.endsWith(ext))
  );
  if (!audioFile?.name) {
    throw new Error(`No audio file found in ${songFolder}`);
  }
  return `${songFolder}/${audioFile.name}`;
}

export interface DownloadResult {
  audioPath: string;
  lyrics?: TimedLyricLine[];
}

/**
 * Download audio from YouTube using yt-dlp.
 * Also attempts to fetch subtitles for lyrics.
 */
export async function downloadAudio(
  youtubeUrl: string,
  songFolder: string,
  onProgress?: (line: string) => void
): Promise<DownloadResult> {
  const cleanUrl = sanitizeYouTubeUrl(youtubeUrl);
  console.log("[downloadAudio] Starting", { youtubeUrl, cleanUrl, songFolder });
  await ensureSongFolder(songFolder);
  console.log("[downloadAudio] Song folder ensured");

  const audioOutput = `${songFolder}/audio.%(ext)s`;

  // First pass: download subtitles only
  const subArgs = [
    ...YT_DLP_BASE,
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "--extract-audio",
    "--audio-format",
    "m4a",
    "-o",
    audioOutput,
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en,ja,ko,zh,es,fr,de,pt,it",
    "--sub-format",
    "vtt",
    "--skip-download",
    "--no-overwrites",
    cleanUrl,
  ];
  console.log("[downloadAudio] Subtitle pass args:", subArgs);
  try {
    const subCommand = Command.create("yt-dlp", subArgs);
    console.log("[downloadAudio] Command.create succeeded for subtitles");
    const subResult = await spawnAndWait(subCommand, "[downloadAudio][sub]");
    console.log("[downloadAudio] Subtitle pass done, code:", subResult.code);
  } catch (err) {
    console.warn("[downloadAudio] Subtitle pass failed:", err);
  }

  // Second pass: download audio
  // Prefer m4a natively; fall back to best audio without re-encoding
  // (re-encoding requires ffmpeg which may not be installed)
  const audioArgs = [
    ...YT_DLP_BASE,
    "-f",
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "-o",
    audioOutput,
    "--no-overwrites",
    cleanUrl,
  ];
  console.log("[downloadAudio] Audio pass args:", audioArgs);

  let audioCommand;
  try {
    audioCommand = Command.create("yt-dlp", audioArgs);
    console.log("[downloadAudio] Command.create succeeded for audio");
  } catch (err) {
    console.error("[downloadAudio] Command.create FAILED for audio:", err);
    throw err;
  }

  const result = await spawnAndWait(audioCommand, "[downloadAudio][audio]", onProgress);
  console.log("[downloadAudio] Audio pass done:", { code: result.code });

  if (result.code !== 0) {
    if (result.stderr.includes("is not recognized") || result.stderr.includes("not found")) {
      throw new Error(
        "yt-dlp is not installed. Please install it from https://github.com/yt-dlp/yt-dlp and add it to your PATH."
      );
    }
    if (isBotDetectionError(result.stderr)) {
      throw new Error(COOKIES_EXPIRED_MESSAGE);
    }
    throw new Error(`yt-dlp failed (exit code ${result.code}): ${result.stderr}`);
  }

  // Find the actual audio file (could be .m4a, .webm, .opus, etc.)
  const audioPath = await findAudioFile(songFolder);
  console.log("[downloadAudio] Audio file found:", audioPath);

  // Try to parse subtitles for lyrics
  const lyrics = await tryParseLyrics(songFolder);
  console.log("[downloadAudio] Parsed lyrics:", lyrics?.length ?? 0, "lines");

  return { audioPath, lyrics };
}

/** Attempt to find and parse VTT subtitle files for lyrics */
async function tryParseLyrics(songFolder: string): Promise<TimedLyricLine[] | undefined> {
  // yt-dlp writes subtitles as audio.{lang}.vtt
  // We'll try to read any .vtt file in the folder
  try {
    const { readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    console.log("[tryParseLyrics] Reading dir:", songFolder);
    const entries = await readDir(songFolder);
    console.log("[tryParseLyrics] Entries:", entries.map((e) => ({ name: e.name, isFile: e.isFile })));
    const vttFile = entries.find(
      (e) => e.name?.endsWith(".vtt") && e.isFile !== false
    );
    if (!vttFile?.name) {
      console.warn("[tryParseLyrics] No .vtt file found in directory");
      return undefined;
    }

    const vttPath = `${songFolder}/${vttFile.name}`;
    console.log("[tryParseLyrics] Reading VTT:", vttPath);
    const content = await readTextFile(vttPath);
    console.log("[tryParseLyrics] VTT content length:", content.length, "first 200 chars:", content.slice(0, 200));
    const lines = parseVttToTimedLines(content);
    console.log("[tryParseLyrics] Parsed lines:", lines.length);
    return lines;
  } catch (err) {
    console.error("[tryParseLyrics] Error:", err);
    return undefined;
  }
}

export interface TimedLyricLine {
  text: string;
  start_ms: number;
  end_ms: number;
}

/** Parse VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to milliseconds */
function parseVttTimestamp(ts: string): number {
  const parts = ts.split(":");
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
    seconds = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0], 10);
    seconds = parseFloat(parts[1]);
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/** Parse VTT content into deduplicated lyric lines with timestamps */
function parseVttToTimedLines(vtt: string): TimedLyricLine[] {
  const lines: TimedLyricLine[] = [];
  const seen = new Set<string>();
  const rawLines = vtt.split("\n");

  let currentStart = 0;
  let currentEnd = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();

    // Match timestamp lines: "00:00:11.940 --> 00:00:16.682"
    const tsMatch = trimmed.match(/^(\d{1,2}:\d{2}[:\.][\d.]+)\s*-->\s*(\d{1,2}:\d{2}[:\.][\d.]+)/);
    if (tsMatch) {
      currentStart = parseVttTimestamp(tsMatch[1]);
      currentEnd = parseVttTimestamp(tsMatch[2]);
      continue;
    }

    // Skip VTT headers, empty lines, numeric cue identifiers
    if (
      !trimmed ||
      trimmed === "WEBVTT" ||
      trimmed.startsWith("Kind:") ||
      trimmed.startsWith("Language:") ||
      trimmed.startsWith("NOTE") ||
      /^[\d]+$/.test(trimmed)
    ) {
      continue;
    }

    // Strip VTT formatting tags like <c>, </c>, <00:00:01.000>
    const cleaned = trimmed
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();

    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      lines.push({ text: cleaned, start_ms: currentStart, end_ms: currentEnd });
    }
  }

  return lines;
}

/** Available subtitle languages for lyrics import */
export const SUBTITLE_LANGUAGES = [
  { code: "ja", label: "Japanese" },
  { code: "en", label: "English" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
] as const;

/**
 * Fetch lyrics from YouTube subtitles for a specific language.
 * Downloads subtitles via yt-dlp and parses VTT into lines.
 */
export async function fetchLyricsForLanguage(
  youtubeUrl: string,
  songFolder: string,
  langCode: string
): Promise<TimedLyricLine[]> {
  const cleanUrl = sanitizeYouTubeUrl(youtubeUrl);
  console.log("[fetchLyrics] Starting", { youtubeUrl, cleanUrl, songFolder, langCode });
  await ensureSongFolder(songFolder);
  console.log("[fetchLyrics] Song folder ensured");

  // Clean up existing vtt files first
  try {
    const { readDir, remove } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(songFolder);
    console.log("[fetchLyrics] Existing files in folder:", entries.map((e) => e.name));
    for (const entry of entries) {
      if (entry.name?.endsWith(".vtt")) {
        console.log("[fetchLyrics] Removing old vtt:", entry.name);
        await remove(`${songFolder}/${entry.name}`);
      }
    }
  } catch (err) {
    console.warn("[fetchLyrics] Cleanup error (non-fatal):", err);
  }

  const args = [
    ...YT_DLP_BASE,
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    langCode,
    "--sub-format",
    "vtt",
    "--skip-download",
    "-o",
    `${songFolder}/audio.%(ext)s`,
    cleanUrl,
  ];
  console.log("[fetchLyrics] yt-dlp args:", args);

  let command;
  try {
    command = Command.create("yt-dlp", args);
    console.log("[fetchLyrics] Command.create succeeded");
  } catch (err) {
    console.error("[fetchLyrics] Command.create FAILED:", err);
    throw err;
  }

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    command.stdout.on("data", (line: string) => {
      console.log("[fetchLyrics] stdout:", line);
      stdout += line + "\n";
    });
    command.stderr.on("data", (line: string) => {
      console.warn("[fetchLyrics] stderr:", line);
      stderr += line + "\n";
    });
    command.on("close", (data: { code: number | null }) => {
      console.log("[fetchLyrics] process exited with code:", data.code);
      resolve({ code: data.code, stdout, stderr });
    });
    command.on("error", (err: string) => {
      // Tauri emits "error" for non-UTF-8 output — log but don't reject
      console.warn("[fetchLyrics] process error (non-fatal):", err);
      stderr += `[encoding error] ${err}\n`;
    });
    command.spawn().then(() => {
      console.log("[fetchLyrics] spawn succeeded, waiting for output...");
    }).catch((err: unknown) => {
      console.error("[fetchLyrics] spawn failed:", err);
      reject(err);
    });
  });

  console.log("[fetchLyrics] yt-dlp result:", { code: result.code, stdout: result.stdout, stderr: result.stderr });

  if (result.code !== 0) {
    if (isBotDetectionError(result.stderr)) {
      throw new Error(COOKIES_EXPIRED_MESSAGE);
    }
    throw new Error(`Failed to fetch subtitles for language "${langCode}": ${result.stderr}`);
  }

  const lyrics = await tryParseLyrics(songFolder);
  console.log("[fetchLyrics] Parsed lyrics:", lyrics?.length ?? 0, "lines");
  if (!lyrics || lyrics.length === 0) {
    throw new Error(`No subtitles found for language "${langCode}"`);
  }

  return lyrics;
}

/** Check if yt-dlp is available on the system. Returns version string or null. */
export async function checkYtDlpInstalled(): Promise<string | null> {
  try {
    const command = Command.create("yt-dlp", ["--version"]);
    const result = await command.execute();
    return result.code === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Check if Python is available. Returns version string or null. */
export async function checkPythonInstalled(): Promise<string | null> {
  try {
    const command = Command.create("python", ["--version"]);
    const result = await command.execute();
    if (result.code === 0) {
      const match = result.stdout.trim().match(/Python\s+([\d.]+)/);
      return match ? match[1] : result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if FFmpeg is available. Returns version string or null. */
export async function checkFfmpegInstalled(): Promise<string | null> {
  try {
    const command = Command.create("ffmpeg", ["-version"]);
    const result = await command.execute();
    if (result.code === 0) {
      const match = result.stdout.match(/ffmpeg version\s+(\S+)/);
      return match ? match[1] : "installed";
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if Demucs is installed via pip. Returns "installed" or null. */
export async function checkDemucsInstalled(): Promise<string | null> {
  try {
    const command = Command.create("python", ["-c", "import demucs; print(demucs.__version__)"]);
    const result = await command.execute();
    return result.code === 0 ? result.stdout.trim() || "installed" : null;
  } catch {
    return null;
  }
}
