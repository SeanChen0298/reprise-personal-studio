import type { YouTubeMetadata } from "../types/song";

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

/** Strip playlist/index params from a YouTube URL to get a single-video URL */
export function cleanYouTubeUrl(url: string): string {
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

export async function fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata> {
  const cleanUrl = cleanYouTubeUrl(url);
  const videoId = parseYouTubeVideoId(cleanUrl);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) throw new Error("Could not fetch video info. The video may be private or unavailable.");

  const data = (await res.json()) as { title: string; author_name: string };
  return {
    video_id: videoId,
    youtube_url: cleanUrl,
    title: data.title,
    author: data.author_name,
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}
