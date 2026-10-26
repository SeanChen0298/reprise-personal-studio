// Phone sync over the home Wi-Fi (desktop side).
//
// The Rust side (src-tauri/src/sync_server.rs) runs a small HTTP server while
// it's switched on. This module keeps `C:/Reprise/sync/library.json` up to date
// for it to serve, and imports what the phone uploads to `C:/Reprise/sync/inbox/`:
// takes (audio + `<id>.take.json`) and edits (`changes-*.json`).

import { invoke } from "@tauri-apps/api/core";
import { exists, mkdir, readDir, readTextFile, remove, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { normaliseCard } from "@reprise/shared";
import type { Line, PhoneChanges, PhoneTake, SyncCoach, SyncFileRef, SyncLineHint, SyncSnapshot, SyncSongFiles } from "@reprise/shared";
import { useSongStore } from "../stores/song-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useHighlightStore } from "./highlight-config";
import { analyzeRecording, canReview, peekVocalMap } from "./take-review";
import { parsePitchData } from "./audio-analysis";
import { buildVocalMap, LONG_PHRASE_MS, lineVocalInfo, semitoneToNoteName } from "./vocal-map";
import { splitLines } from "@reprise/shared";
import type { Recording, Song } from "../types/song";

export const REPRISE_ROOT = "C:/Reprise";
const SYNC_DIR = `${REPRISE_ROOT}/sync`;
const INBOX = `${SYNC_DIR}/inbox`;
const LIBRARY = `${SYNC_DIR}/library.json`;
const PROFILE = `${REPRISE_ROOT}/coach-profile.json`;
export const DEFAULT_PORT = 47615;

export interface ServerStatus {
  running: boolean;
  ip: string | null;
  port: number | null;
}

export const startServer = (token: string, port: number) =>
  invoke<ServerStatus>("sync_server_start", { root: REPRISE_ROOT, token, port });
export const stopServer = () => invoke<ServerStatus>("sync_server_stop");
export const serverStatus = () => invoke<ServerStatus>("sync_server_status");

/** A pairing token: 24 characters, easy to read out if the QR can't be scanned. */
export function newToken(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/** What the QR code holds — the phone app opens this. */
export function pairingUrl(ip: string, port: number, token: string, host: string): string {
  return `reprise://pair?h=${encodeURIComponent(`${ip}:${port}`)}&t=${token}&n=${encodeURIComponent(host)}`;
}

async function fileRef(path: string | undefined): Promise<SyncFileRef | undefined> {
  if (!path) return undefined;
  try {
    const s = await stat(path);
    if (!s.isFile) return undefined;
    return { path, size: s.size, mtime: s.mtime ? new Date(s.mtime).getTime() : 0 };
  } catch {
    return undefined;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    if (!(await exists(path))) return null;
    return JSON.parse(await readTextFile(path)) as T;
  } catch {
    return null;
  }
}

const hintCache = new Map<string, Record<string, SyncLineHint>>();

/**
 * Song hints per line, as the lyric sheet shows them: high notes from pitch.csv,
 * and long phrases only once the full vocal map (with the stem's loudness to
 * trim reverb tails) has been built in this session — pitch alone runs long.
 */
async function songHints(song: Song, all: Line[]): Promise<Record<string, SyncLineHint> | undefined> {
  if (song.pitch_status !== "done" || !song.pitch_data_path) return undefined;
  const { lines } = splitLines(all, song.translation_language);
  const full = peekVocalMap(song);
  const key = `${song.pitch_data_path}|${full ? "full" : "pitch"}|${lines.map((l) => `${l.id}:${l.start_ms}:${l.end_ms}`).join(",")}`;
  const cached = hintCache.get(key);
  if (cached) return cached;
  try {
    const map = full ? await full : buildVocalMap(parsePitchData(await readTextFile(song.pitch_data_path)));
    const out: Record<string, SyncLineHint> = {};
    for (const l of lines) {
      const info = lineVocalInfo(map, l);
      if (!info) continue;
      const h: SyncLineHint = {};
      if (full && info.longestPhraseMs >= LONG_PHRASE_MS) h.long_ms = info.longestPhraseMs;
      if (info.peakSemitone != null) h.high = semitoneToNoteName(info.peakSemitone);
      if (h.long_ms || h.high) out[l.id] = h;
    }
    if (hintCache.size > 300) hintCache.clear();
    hintCache.set(key, out);
    return out;
  } catch {
    return undefined;
  }
}

/** Build the snapshot the phone pulls. */
export async function buildSnapshot(host: string): Promise<SyncSnapshot> {
  const st = useSongStore.getState();
  const songs = st.songs;
  const files: Record<string, SyncSongFiles> = {};
  const coach: Record<string, SyncCoach> = {};
  const hints: Record<string, Record<string, SyncLineHint>> = {};
  await Promise.all(
    songs.map(async (song) => {
      const [audio, vocals, instrumental] = await Promise.all([
        fileRef(song.download_status === "done" ? song.audio_path : undefined),
        fileRef(song.stem_status === "done" ? song.vocals_path : undefined),
        fileRef(song.stem_status === "done" ? song.instrumental_path : undefined),
      ]);
      files[song.id] = { audio, vocals, instrumental };
      const h = await songHints(song, st.lines[song.id] ?? []);
      if (h && Object.keys(h).length) hints[song.id] = h;
      if (song.audio_folder) {
        const k = await readJson<{ card?: Record<string, unknown>; card_made_at?: string; memory?: string[] }>(
          `${song.audio_folder}/coach.json`,
        );
        if (k && (k.card || k.memory?.length)) {
          coach[song.id] = { card: normaliseCard(k.card ?? null), card_made_at: k.card_made_at, memory: k.memory ?? [] };
        }
      }
    }),
  );
  const profile = await readJson<{ facts?: string[] }>(PROFILE);
  return {
    format: "reprise-sync",
    version: 1,
    generated_at: new Date().toISOString(),
    host,
    songs: songs.map(({ download_error: _d, stem_error: _s, pitch_error: _p, align_error: _a, chord_error: _c, ...rest }) => rest as Song),
    lines: Object.values(st.lines).flat(),
    sections: Object.values(st.sections).flat(),
    recordings: Object.values(st.recordings).flat(),
    highlights: useHighlightStore.getState().highlights,
    coach,
    files,
    singer_facts: profile?.facts ?? [],
    theme: usePreferencesStore.getState().theme,
    practiced: usePreferencesStore.getState().lastPracticed,
    hints,
  };
}

/** What was last written, minus the timestamp (an unchanged library isn't rewritten, so the phone can tell nothing changed). */
let lastWritten: string | null = null;

export async function writeSnapshot(host: string): Promise<void> {
  if (!(await exists(SYNC_DIR))) await mkdir(SYNC_DIR, { recursive: true });
  const snap = await buildSnapshot(host);
  const body = JSON.stringify({ ...snap, generated_at: "" });
  if (body === lastWritten && (await exists(LIBRARY))) return;
  lastWritten = body;
  // Write then rename, so the server never sends half a file.
  await writeTextFile(`${LIBRARY}.tmp`, JSON.stringify(snap));
  if (await exists(LIBRARY)) await remove(LIBRARY);
  await rename(`${LIBRARY}.tmp`, LIBRARY);
}

/** When the phone last pulled the library (ms), if ever. */
export async function lastPull(): Promise<number | null> {
  try {
    const p = `${SYNC_DIR}/last-pull.txt`;
    if (!(await exists(p))) return null;
    const secs = Number((await readTextFile(p)).trim());
    return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
  } catch {
    return null;
  }
}

const newer = (a: string | undefined, b: string | undefined) => !!a && (!b || a > b);

/**
 * Import what the phone uploaded. Returns what came in, for a short notice.
 * Files are removed from the inbox once handled (a take's audio moves into the song folder).
 */
export async function importInbox(): Promise<{ takes: number; edits: number }> {
  const done = { takes: 0, edits: 0 };
  if (!(await exists(INBOX))) return done;
  const entries = (await readDir(INBOX)).filter((e) => e.isFile && !e.name.endsWith(".part"));
  const names = new Set(entries.map((e) => e.name));
  const store = useSongStore.getState();

  for (const e of entries) {
    const path = `${INBOX}/${e.name}`;
    if (e.name.endsWith(".take.json")) {
      const t = await readJson<PhoneTake>(path);
      if (!t || t.type !== "take") {
        await remove(path).catch(() => {});
        continue;
      }
      if (!names.has(t.file)) continue; // audio not here yet — next round
      const song = store.songs.find((s) => s.id === t.song_id);
      const already = (store.recordings[t.song_id] ?? []).some((r) => r.id === t.id);
      if (!song?.audio_folder || already) {
        await remove(`${INBOX}/${t.file}`).catch(() => {});
        await remove(path).catch(() => {});
        continue;
      }
      const dir = `${song.audio_folder}/recordings`;
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const dest = `${dir}/${t.file}`;
      await rename(`${INBOX}/${t.file}`, dest);
      const rec: Recording = {
        id: t.id,
        song_id: t.song_id,
        line_id: null,
        section_id: t.section_id,
        file_path: dest,
        duration_ms: t.duration_ms,
        is_master_take: false,
        is_best_take: false,
        note: t.note?.trim() || undefined,
        song_start_ms: t.song_start_ms,
        backing: t.backing,
        created_at: t.created_at,
        updated_at: t.created_at,
      };
      await store.addRecording(t.song_id, rec);
      await remove(path).catch(() => {});
      done.takes++;
      if (canReview(rec, song)) reviewSoon(rec, song);
    } else if (e.name.startsWith("changes-") && e.name.endsWith(".json")) {
      const c = await readJson<PhoneChanges>(path);
      if (c?.type === "changes") done.edits += await applyChanges(c);
      await remove(path).catch(() => {});
    }
  }
  return done;
}

async function applyChanges(c: PhoneChanges): Promise<number> {
  const store = useSongStore.getState();
  let n = 0;
  for (const l of c.lines ?? []) {
    const cur = (store.lines[l.song_id] ?? []).find((x) => x.id === l.id);
    if (!cur || !newer(l.updated_at, cur.updated_at)) continue;
    const patch: Record<string, string | undefined> = {};
    if (l.note !== undefined) patch.note = l.note ?? undefined;
    if (l.register !== undefined) patch.register = l.register ?? undefined;
    if (l.placement !== undefined) patch.placement = l.placement ?? undefined;
    await store.updateLine(l.song_id, l.id, patch);
    n++;
  }
  for (const r of c.recordings ?? []) {
    const cur = (store.recordings[r.song_id] ?? []).find((x) => x.id === r.id);
    if (!cur || !newer(r.updated_at, cur.updated_at)) continue;
    const patch: Partial<Pick<Recording, "note" | "is_best_take">> = {};
    if (r.note !== undefined) patch.note = r.note ?? undefined;
    if (r.is_best_take !== undefined) patch.is_best_take = r.is_best_take;
    await store.updateRecording(r.song_id, r.id, patch);
    n++;
  }
  const prefs = usePreferencesStore.getState();
  for (const [songId, at] of Object.entries(c.practiced ?? {})) {
    if (newer(at, prefs.lastPracticed[songId])) {
      usePreferencesStore.setState((s) => ({ lastPracticed: { ...s.lastPracticed, [songId]: at } }));
    }
  }
  return n;
}

/** Phone takes get their breath / high-note review here, one at a time, so the phone sees it on its next sync. */
let reviewing: Promise<void> = Promise.resolve();
function reviewSoon(rec: Recording, song: Song) {
  reviewing = reviewing.then(async () => {
    try {
      const { lines } = splitLines(useSongStore.getState().lines[song.id] ?? [], song.translation_language);
      const analysis = await analyzeRecording(rec, song, lines);
      await useSongStore.getState().updateRecording(song.id, rec.id, { analysis });
    } catch (err) {
      console.warn("[phone-sync] couldn't review a phone take:", err);
    }
  });
}
