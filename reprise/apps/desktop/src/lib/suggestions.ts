// Song suggestions from YouTube, built from the library — no API key needed.
//
// Every YouTube video has an auto-generated "Mix" playlist (list=RD<videoId>) of
// related songs. We pull the Mix for a few library songs (the seeds) with
// yt-dlp --flat-playlist (fast, no download), rank the candidates, then keep
// only videos with uploaded (non auto-generated) captions — those are the ones
// that almost always carry real lyrics.

import { YT_DLP_BASE, makeYtDlpCommand, spawnAndWait } from "./yt-dlp-runtime";
import { COOKIES_EXPIRED_MESSAGE, isBotDetectionError } from "./audio-download";
import { parseYouTubeVideoId } from "./youtube";
import type { Song } from "../types/song";

export type SuggestionStatus = "new" | "seen" | "dismissed" | "added" | "no_captions";

export interface Suggestion {
  video_id: string;
  youtube_url: string;
  raw_title: string;
  channel: string;
  /** Cleaned-up song title / artist parsed from the video title + channel. */
  title: string;
  artist: string;
  duration_ms: number;
  thumbnail_url: string;
  /** Uploaded caption languages (base codes, e.g. ["ja", "en"]). */
  caption_langs: string[];
  seed_song_id: string;
  seed_title: string;
  batch_id: string;
  status: SuggestionStatus;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface MixEntry {
  videoId: string;
  title: string;
  channel: string;
  durationMs: number;
  position: number;
}

const MIX_LENGTH = 50;
const MIN_DURATION_MS = 90_000;
const MAX_DURATION_MS = 480_000;

/** Titles that are rarely the studio version of a song. */
const NON_SONG_PATTERN =
  /\blive\b|ライブ|reaction|karaoke|カラオケ|instrumental|off ?vocal|1 ?hour|\bloop\b|playlist|medley|メドレー|compilation|teaser|trailer|making|interview|予告|ダイジェスト|digest|\bxfd\b|crossfade|クロスフェード|全曲|\bperformance\b|紅白|\bdvd\b|blu-?ray|behind the scenes|\bshorts?\b|nightcore|sped up|slowed/i;

// ---------------------------------------------------------------------------
// yt-dlp calls
// ---------------------------------------------------------------------------

/** Fetch the YouTube Mix ("radio") playlist for a video. Entries only, no download. */
export async function fetchMix(videoId: string): Promise<MixEntry[]> {
  const args = [
    ...YT_DLP_BASE,
    "--yes-playlist",
    "--flat-playlist",
    "--playlist-end", String(MIX_LENGTH),
    // %(...)j is JSON with non-ASCII escaped, so Japanese titles survive Tauri's stdout decoding.
    "--print", "%(id)s\t%(duration)s\t%(channel)j\t%(title)j",
    `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
  ];
  const result = await spawnAndWait(await makeYtDlpCommand(args), "[suggestions][mix]");
  if (result.code !== 0 && isBotDetectionError(result.stderr)) {
    throw new Error(COOKIES_EXPIRED_MESSAGE);
  }

  const entries: MixEntry[] = [];
  for (const line of result.stdout.split("\n")) {
    const [id, duration, channelJson, titleJson] = line.split("\t");
    if (!id || !titleJson) continue;
    entries.push({
      videoId: id.trim(),
      durationMs: Math.round((parseFloat(duration) || 0) * 1000),
      channel: parseJsonString(channelJson),
      title: parseJsonString(titleJson),
      position: entries.length,
    });
  }
  return entries;
}

/**
 * Look up the uploaded caption languages of several videos in one yt-dlp run.
 * `onResult` fires per video as yt-dlp prints it (videos that fail to load are
 * simply absent from the returned map).
 */
export async function fetchCaptionLangs(
  videoIds: string[],
  onResult?: (videoId: string, langs: string[]) => void,
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (videoIds.length === 0) return found;

  const args = [
    ...YT_DLP_BASE,
    "--ignore-errors",
    "--skip-download",
    "--print", "%(id)s\t%(subtitles)j",
    ...videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`),
  ];
  const result = await spawnAndWait(
    await makeYtDlpCommand(args),
    "[suggestions][captions]",
    (line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return;
      const id = line.slice(0, tab).trim();
      const langs = parseCaptionLangs(line.slice(tab + 1));
      found.set(id, langs);
      onResult?.(id, langs);
    },
  );
  if (found.size === 0 && isBotDetectionError(result.stderr)) {
    throw new Error(COOKIES_EXPIRED_MESSAGE);
  }
  return found;
}

function parseJsonString(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** `{"ja": [...], "en-J7tYDCHXc_Q": [...], "live_chat": [...]}` → ["ja", "en"] */
function parseCaptionLangs(raw: string): string[] {
  let subs: unknown;
  try {
    subs = JSON.parse(raw);
  } catch {
    return []; // "NA" when the video has no uploaded captions
  }
  if (!subs || typeof subs !== "object") return [];
  const langs = new Set<string>();
  for (const key of Object.keys(subs)) {
    if (key === "live_chat") continue;
    const base = key.match(/^[a-z]{2,3}/)?.[0];
    if (base) langs.add(base);
  }
  return [...langs];
}

// ---------------------------------------------------------------------------
// Seeds & ranking
// ---------------------------------------------------------------------------

export interface Seed {
  songId: string;
  videoId: string;
  title: string;
  artist: string;
}

/** Library songs that can seed a Mix (they have a YouTube video). */
export function seedableSongs(songs: Song[]): Seed[] {
  const seeds: Seed[] = [];
  for (const s of songs) {
    const videoId = s.youtube_url ? parseYouTubeVideoId(s.youtube_url) : null;
    if (videoId) seeds.push({ songId: s.id, videoId, title: s.title, artist: s.artist });
  }
  return seeds;
}

/**
 * Pick `count` distinct seeds, weighted towards songs the user cares about
 * (pinned, mastered, played a lot) and away from seeds used recently — so
 * each "New suggestions" press explores a different corner of the library.
 */
export function pickSeeds(
  songs: Song[],
  playCounts: Record<string, number>,
  recentSeedIds: string[],
  count: number,
): Seed[] {
  const pool = seedableSongs(songs).map((seed) => {
    const song = songs.find((s) => s.id === seed.songId)!;
    const plays = playCounts[seed.songId] ?? 0;
    const recentUses = recentSeedIds.filter((id) => id === seed.songId).length;
    const weight =
      (1 + (song.pinned ? 3 : 0) + song.mastery / 25 + Math.log2(1 + plays) / 2) / (1 + 2 * recentUses);
    return { seed, weight };
  });

  const picked: Seed[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = Math.random() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].weight) {
      r -= pool[i].weight;
      i++;
    }
    picked.push(pool[i].seed);
    pool.splice(i, 1);
  }
  return picked;
}

export interface Candidate {
  entry: MixEntry;
  seed: Seed;
  hits: number;
  score: number;
}

/**
 * Merge the seeds' Mixes into a ranked candidate list. A video that shows up in
 * several Mixes ranks higher (it matches more of the library); a little jitter
 * keeps repeated refreshes from always surfacing the same order.
 */
export function rankCandidates(
  mixes: { seed: Seed; entries: MixEntry[] }[],
  excludeVideoIds: Set<string>,
  excludeTitleKeys: Set<string>,
): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const { seed, entries } of mixes) {
    for (const entry of entries) {
      if (entry.videoId === seed.videoId) continue;
      const existing = byId.get(entry.videoId);
      if (existing) {
        existing.hits++;
        continue;
      }
      if (excludeVideoIds.has(entry.videoId)) continue;
      if (entry.durationMs < MIN_DURATION_MS || entry.durationMs > MAX_DURATION_MS) continue;
      if (NON_SONG_PATTERN.test(entry.title)) continue;
      byId.set(entry.videoId, { entry, seed, hits: 1, score: 0 });
    }
  }

  const seenTitleKeys = new Set(excludeTitleKeys);
  const ranked: Candidate[] = [];
  for (const c of byId.values()) {
    c.score = c.hits * 2 + (1 - c.entry.position / MIX_LENGTH) + Math.random() * 1.5;
  }
  for (const c of [...byId.values()].sort((a, b) => b.score - a.score)) {
    // Same song, different upload (MV vs lyric video vs Topic channel) — keep the best-ranked one.
    const key = titleKey(c.entry.title, c.entry.channel);
    if (seenTitleKeys.has(key)) continue;
    seenTitleKeys.add(key);
    ranked.push(c);
  }
  return ranked;
}

/** Reorder so no artist (channel) takes more than `maxPerArtist` of the first slots. */
export function diversify(candidates: Candidate[], maxPerArtist: number): Candidate[] {
  const counts = new Map<string, number>();
  const head: Candidate[] = [];
  const tail: Candidate[] = [];
  for (const c of candidates) {
    // The channel is spelled consistently; artist text in titles isn't
    // ("米津玄師" vs "米津玄師 Kenshi Yonezu").
    const artist = norm(cleanChannel(c.entry.channel)) || norm(parseSongTitle(c.entry.title, c.entry.channel).artist);
    const n = counts.get(artist) ?? 0;
    if (n < maxPerArtist) {
      counts.set(artist, n + 1);
      head.push(c);
    } else {
      tail.push(c);
    }
  }
  return [...head, ...tail];
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

const JAPANESE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF65-\uFF9F]/;

function containsJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanChannel(channel: string): string {
  return channel
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .split(/\s+\/\s+/)[0]
    .replace(/\s*(official\s*)?(youtube\s*)?channel\s*$/i, "")
    .replace(/\s+official\s*$/i, "")
    .trim();
}

/** Remove "Official Music Video", "(MV)", "【...】", tie-in notes etc. */
function stripNoise(text: string, isArtist = false): string {
  let t = text
    .replace(/【[^】]*】/g, " ")
    .replace(/\s*\/\s*THE FIRST TAKE\b/gi, " ")
    .replace(/[(（[［]([^)）\]］]*(official|video|mv|m\/v|audio|lyric|lyrics|歌詞|visualizer|full|hd|4k|アニメ|テーマ|主題歌|theme|映画|ドラマ|drama|cm)[^)）\]］]*)[)）\]］]/gi, " ")
    .replace(/\b(official\s+)?(music\s+video|lyric\s+video|video|audio|mv|m\/v)\b/gi, " ")
    .replace(/[(（[［]\s*[)）\]］]/g, " ")
    .replace(/\s{2,}/g, " ");
  // "Official HIGE DANDISM" is a band name; in titles "Official" is noise.
  if (!isArtist) t = t.replace(/\bofficial\b/gi, " ");
  return t.replace(/^[\s\-–—|/:：]+|[\s\-–—|/:：]+$/g, "").trim();
}

/** Keep the native name when a romanisation follows ("米津玄師 Kenshi Yonezu" → "米津玄師"). */
function cleanArtist(artist: string): string {
  // "Kenshi Yonezu  \u7c73\u6d25\u7384\u5e2b" / "\u30ad\u30bf\u30cb\u30bf\u30c4\u30e4 / Tatsuya Kitani": prefer the native-script name
  // so the same artist is spelled one way across the library.
  const parts = artist.split(/\s{2,}|\u3000|\s+\/\s+/).filter((p) => p.trim());
  let a = stripNoise(parts.find((p) => containsJapanese(p)) ?? parts[0] ?? "", true);
  if (JAPANESE.test(a.charAt(0))) a = a.match(/^[^\x00-\x7F]+(?:[\s.][^\x00-\x7F]+)*/)?.[0] ?? a;
  return a.trim();
}

/**
 * Clean a song title. `romanised` is the artist's Latin name when the channel also
 * has a native-script one ("Kenshi Yonezu 米津玄師") — it's dropped from the title.
 */
function cleanTitle(title: string, romanised?: string): string {
  let t = title.trim();
  if (containsJapanese(t)) {
    // "馬と鹿   Kenshi Yonezu - Uma to Shika" / "さよーならまたいつか！ Kenshi Yonezu - Sayonara…"
    t = t.split(/\s{2,}|\u3000|\s+[-–—]\s+/)[0];
  }
  // "LOSER , Kenshi Yonezu"
  const at = romanised ? t.toLowerCase().indexOf(romanised.toLowerCase()) : -1;
  if (at > 0) t = t.slice(0, at) + t.slice(at + romanised!.length);
  return stripNoise(t).replace(/[\s,、]+$/, "");
}

/** Best-effort split of a YouTube title into song title + artist. */
export function parseSongTitle(rawTitle: string, channel: string): { title: string; artist: string } {
  const channelArtist = cleanChannel(channel);
  const romanised = containsJapanese(channel) ? channel.match(/[A-Za-z][A-Za-z .'&]*[A-Za-z]/)?.[0] : undefined;
  const isChannel = (part: string) => {
    const p = norm(cleanArtist(part));
    return p.length >= 2 && norm(channel).includes(p);
  };
  const finish = (title: string, artist: string) => ({
    title: cleanTitle(title, romanised) || title.trim(),
    artist: cleanArtist(artist) || channelArtist,
  });

  const bracket = rawTitle.match(/[「『“](.+?)[」』”]/);
  const dash = rawTitle.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  const slash = rawTitle.match(/^(.+?)(?:\s+\/\s+|\s*／\s*)(.+)$/);

  // Artist「Title」... (unless a dash comes first: "Artist - Title「tie-in」")
  if (bracket && bracket[1].trim() && (!dash || bracket.index! < dash[1].length)) {
    return finish(bracket[1], rawTitle.slice(0, bracket.index).trim() || channelArtist);
  }
  // "Artist - Title", or "Title - Artist" when the right side is the channel
  if (dash) {
    return isChannel(dash[2]) && !isChannel(dash[1]) ? finish(dash[1], dash[2]) : finish(dash[2], dash[1]);
  }
  // "Title / Artist" (the usual Japanese order), or "Artist / Title" when the left side is the channel
  if (slash) {
    return isChannel(slash[1]) && !isChannel(slash[2]) ? finish(slash[2], slash[1]) : finish(slash[1], slash[2]);
  }
  // "back number-Suiheisen": the title starts with the channel's name
  if (channelArtist && rawTitle.toLowerCase().startsWith(channelArtist.toLowerCase())) {
    const rest = rawTitle.slice(channelArtist.length).replace(/^[\s\-–—|:：]+/, "");
    if (rest) return finish(rest, channelArtist);
  }
  return finish(rawTitle, channelArtist);
}

/** Normalised key used to spot the same song uploaded more than once. */
export function titleKey(rawTitle: string, channel: string): string {
  const { title, artist } = parseSongTitle(rawTitle, channel);
  return `${norm(artist)}|${norm(title)}`;
}

/** Library language label for a suggestion, matching what the Add Song form fills in. */
export function guessLanguage(s: Pick<Suggestion, "raw_title" | "channel">): string | undefined {
  return containsJapanese(s.raw_title) || containsJapanese(s.channel) ? "Japanese" : undefined;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
