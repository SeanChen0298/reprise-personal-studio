import { invoke } from "@tauri-apps/api/core";
import type { YouTubeMetadata } from "../types/song";

const IS_TAURI = typeof window !== "undefined" && "__TAURI__" in window;

export function parseYouTubeVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function isValidYouTubeUrl(url: string): boolean {
  return parseYouTubeVideoId(url) !== null;
}

/** Response shape from the map_song.py sidecar via the Rust command. */
interface YtDlpResult {
  song_name?: string;
  artist?: string;
  icon_url?: string;
  language_fetched?: string;
  lyrics?: string;
  error?: string;
}

export async function fetchYouTubeMetadata(
  url: string
): Promise<YouTubeMetadata> {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  if (IS_TAURI) {
    // Call the Rust command which invokes the yt-dlp Python sidecar
    const result = await invoke<YtDlpResult>("fetch_youtube_metadata", { url });
    if (result.error) {
      throw new Error(result.error);
    }
    return {
      video_id: videoId,
      youtube_url: url,
      title: result.song_name ?? "Unknown Title",
      author: result.artist ?? "Unknown Artist",
      thumbnail_url:
        result.icon_url ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      lyrics: result.lyrics ?? undefined,
    };
  }

  // Browser dev fallback: oEmbed API (no lyrics available)
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok)
    throw new Error(
      "Could not fetch video info. The video may be private or unavailable."
    );

  const data = (await res.json()) as { title: string; author_name: string };
  return {
    video_id: videoId,
    youtube_url: url,
    title: data.title,
    author: data.author_name,
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
