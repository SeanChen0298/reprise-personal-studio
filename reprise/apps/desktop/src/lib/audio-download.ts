import { Command } from "@tauri-apps/plugin-shell";
import { mkdir, exists } from "@tauri-apps/plugin-fs";

const REPRISE_ROOT = "C:/Reprise";

/** Remove characters invalid for Windows folder names */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
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
  const rootExists = await exists(REPRISE_ROOT);
  if (!rootExists) {
    await mkdir(REPRISE_ROOT, { recursive: true });
  }
  const folderExists = await exists(folderPath);
  if (!folderExists) {
    await mkdir(folderPath, { recursive: true });
  }
}

export interface DownloadResult {
  audioPath: string;
  lyrics?: string[];
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
  await ensureSongFolder(songFolder);

  const audioOutput = `${songFolder}/audio.%(ext)s`;

  const command = Command.create("yt-dlp", [
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
    youtubeUrl,
  ]);

  // First pass: download subtitles only
  try {
    await command.execute();
  } catch {
    // Subtitles may not exist, that's fine
  }

  // Second pass: download audio
  const audioCommand = Command.create("yt-dlp", [
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "--extract-audio",
    "--audio-format",
    "m4a",
    "-o",
    audioOutput,
    "--no-overwrites",
    youtubeUrl,
  ]);

  let stderr = "";

  audioCommand.stdout.on("data", (line: string) => {
    onProgress?.(line);
  });

  audioCommand.stderr.on("data", (line: string) => {
    stderr += line + "\n";
  });

  const result = await audioCommand.execute();

  if (result.code !== 0) {
    if (stderr.includes("is not recognized") || stderr.includes("not found")) {
      throw new Error(
        "yt-dlp is not installed. Please install it from https://github.com/yt-dlp/yt-dlp and add it to your PATH."
      );
    }
    throw new Error(`yt-dlp failed (exit code ${result.code}): ${stderr}`);
  }

  const audioPath = `${songFolder}/audio.m4a`;

  // Try to parse subtitles for lyrics
  const lyrics = await tryParseLyrics(songFolder);

  return { audioPath, lyrics };
}

/** Attempt to find and parse VTT subtitle files for lyrics */
async function tryParseLyrics(songFolder: string): Promise<string[] | undefined> {
  // yt-dlp writes subtitles as audio.{lang}.vtt
  // We'll try to read any .vtt file in the folder
  try {
    const { readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(songFolder);
    const vttFile = entries.find(
      (e) => e.name?.endsWith(".vtt") && e.isFile !== false
    );
    if (!vttFile?.name) return undefined;

    const content = await readTextFile(`${songFolder}/${vttFile.name}`);
    return parseVttToLines(content);
  } catch {
    return undefined;
  }
}

/** Parse VTT content into deduplicated lyric lines */
function parseVttToLines(vtt: string): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const line of vtt.split("\n")) {
    const trimmed = line.trim();
    // Skip VTT headers, timestamps, empty lines, and tags
    if (
      !trimmed ||
      trimmed === "WEBVTT" ||
      trimmed.startsWith("Kind:") ||
      trimmed.startsWith("Language:") ||
      trimmed.startsWith("NOTE") ||
      /^\d{2}:\d{2}/.test(trimmed) ||
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
      lines.push(cleaned);
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
): Promise<string[]> {
  await ensureSongFolder(songFolder);

  // Clean up existing vtt files first
  try {
    const { readDir, remove } = await import("@tauri-apps/plugin-fs");
    const entries = await readDir(songFolder);
    for (const entry of entries) {
      if (entry.name?.endsWith(".vtt")) {
        await remove(`${songFolder}/${entry.name}`);
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  const command = Command.create("yt-dlp", [
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    langCode,
    "--sub-format",
    "vtt",
    "--skip-download",
    "-o",
    `${songFolder}/audio.%(ext)s`,
    youtubeUrl,
  ]);

  const result = await command.execute();

  if (result.code !== 0) {
    throw new Error(`Failed to fetch subtitles for language "${langCode}"`);
  }

  const lyrics = await tryParseLyrics(songFolder);
  if (!lyrics || lyrics.length === 0) {
    throw new Error(`No subtitles found for language "${langCode}"`);
  }

  return lyrics;
}

/** Check if yt-dlp is available on the system */
export async function checkYtDlpInstalled(): Promise<boolean> {
  try {
    const command = Command.create("yt-dlp", ["--version"]);
    const result = await command.execute();
    return result.code === 0;
  } catch {
    return false;
  }
}
