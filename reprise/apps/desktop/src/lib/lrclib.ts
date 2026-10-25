/**
 * lrclib.ts
 *
 * Lyrics from LRCLIB (https://lrclib.net) — a free, open lyrics database with
 * no key. Many songs have *synced* lyrics (a timestamp per line, LRC format),
 * so a fresh song can arrive already timed.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { TimedLyricLine } from "./audio-download";
import { parseSongTitle } from "./suggestions";

const API = "https://lrclib.net/api";

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number; // seconds
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LyricsCandidate {
  id: number;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  /** Lines come with start times (from LRC). */
  synced: boolean;
  lines: TimedLyricLine[];
  /** Untimed lines have start_ms/end_ms = -1. */
}

/** A line with no timing (plain lyrics) uses -1 for both times. */
export const UNTIMED = -1;

/** Lines from LRC text: "[mm:ss.xx] text". Empty timed lines end the line before them. */
export function parseSyncedLyrics(lrc: string, durationMs?: number): TimedLyricLine[] {
  const marks: { ms: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) {
      const ms = Math.round((Number(s[1]) * 60 + Number(s[2].replace(":", "."))) * 1000);
      if (Number.isFinite(ms)) marks.push({ ms, text });
    }
  }
  marks.sort((a, b) => a.ms - b.ms);
  const out: TimedLyricLine[] = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (!m.text || /^[♪\s]+$/.test(m.text)) continue;
    const next = marks[i + 1];
    // Cap a line before a long instrumental gap that has no empty mark.
    const end = next ? Math.min(next.ms, m.ms + 12000) : Math.min(m.ms + 6000, durationMs ?? Infinity);
    out.push({ text: m.text, start_ms: m.ms, end_ms: Math.max(end, m.ms + 300) });
  }
  return out;
}

export function parsePlainLyrics(text: string): TimedLyricLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l))
    .map((l) => ({ text: l, start_ms: UNTIMED, end_ms: UNTIMED }));
}

async function get(path: string, params: Record<string, string>): Promise<LrclibTrack[]> {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
  const data = (await res.json()) as LrclibTrack[] | LrclibTrack;
  return Array.isArray(data) ? data : [data];
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Find lyrics for a song: by title + artist first, then with the YouTube title
 * cleaned up, then as a free-text search. Closest length and synced first.
 */
export async function searchLyrics(song: { title: string; artist?: string; durationMs?: number }): Promise<LyricsCandidate[]> {
  const artist = song.artist?.trim() ?? "";
  const parsed = parseSongTitle(song.title, artist);
  const queries: [string, Record<string, string>][] = [];
  if (artist) queries.push(["search", { track_name: song.title, artist_name: artist }]);
  if (parsed.title && (norm(parsed.title) !== norm(song.title) || norm(parsed.artist) !== norm(artist))) {
    queries.push(["search", { track_name: parsed.title, artist_name: parsed.artist }]);
  }
  queries.push(["search", { q: `${parsed.title || song.title} ${parsed.artist || artist}`.trim() }]);
  queries.push(["search", { q: parsed.title || song.title }]);

  const seen = new Map<number, LrclibTrack>();
  let lastError: unknown = null;
  for (const [path, params] of queries) {
    try {
      for (const t of await get(path, params)) if (!seen.has(t.id)) seen.set(t.id, t);
    } catch (err) {
      lastError = err;
    }
    // Enough to choose from once something with lyrics turned up.
    if ([...seen.values()].some((t) => !t.instrumental && (t.syncedLyrics || t.plainLyrics))) break;
  }
  if (seen.size === 0 && lastError) throw lastError;

  const wantTitle = norm(parsed.title || song.title);
  const wantArtist = norm(parsed.artist || artist);
  const score = (t: LrclibTrack) => {
    let s = 0;
    if (t.syncedLyrics) s += 3;
    if (song.durationMs && t.duration) {
      const diff = Math.abs(t.duration * 1000 - song.durationMs);
      s += diff <= 3000 ? 4 : diff <= 10000 ? 1 : -3;
    }
    if (norm(t.trackName) === wantTitle) s += 2;
    if (wantArtist && (norm(t.artistName).includes(wantArtist) || wantArtist.includes(norm(t.artistName)))) s += 2;
    return s;
  };

  return [...seen.values()]
    .filter((t) => !t.instrumental && (t.syncedLyrics || t.plainLyrics))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 8)
    .map((t) => {
      const durationMs = t.duration ? Math.round(t.duration * 1000) : undefined;
      const synced = t.syncedLyrics ? parseSyncedLyrics(t.syncedLyrics, durationMs) : [];
      return {
        id: t.id,
        title: t.trackName,
        artist: t.artistName,
        album: t.albumName && t.albumName !== "Unknown Album" ? t.albumName : undefined,
        durationMs,
        synced: synced.length > 0,
        lines: synced.length > 0 ? synced : parsePlainLyrics(t.plainLyrics ?? ""),
      };
    })
    .filter((c) => c.lines.length > 0);
}

/**
 * The best candidate if it clearly is this song: synced, and its length within
 * 3 s of the audio (so the timestamps fit this recording).
 */
export function confidentMatch(cands: LyricsCandidate[], durationMs?: number): LyricsCandidate | null {
  const c = cands.find((x) => x.synced);
  if (!c || !durationMs || !c.durationMs) return null;
  return Math.abs(c.durationMs - durationMs) <= 3000 ? c : null;
}

/** Length of a local audio file, read from its metadata. */
export function audioDurationMs(path: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (v?: number) => {
      a.removeAttribute("src");
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined);
    a.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 8000);
    a.src = convertFileSrc(path);
  });
}
