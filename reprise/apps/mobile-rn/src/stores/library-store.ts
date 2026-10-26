// The phone's copy of the library.
//
//   snapshot   what the computer sent last (documentDirectory/library.json)
//   local      what only the phone has (local.json): downloaded audio, takes
//              recorded here, edits not yet acknowledged by the computer,
//              when songs were last practiced here
//
// Sync (pull-to-refresh, opening the app, after a take) sends the phone's
// takes and edits to the computer first, then pulls the library again.

import { create } from "zustand";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Line, PhoneChanges, PhoneTake, Recording, SyncFileRef, SyncSnapshot } from "@reprise/shared/core";
import { downloadFile, fetchLibrary, ping, SyncError, uploadFile, uploadJson, type Pairing } from "../lib/sync-client";
import { recentSongs } from "../lib/recent";
import { usePrefsStore } from "./prefs-store";

const DOCS = FileSystem.documentDirectory!;
const SNAPSHOT_FILE = `${DOCS}library.json`;
const LOCAL_FILE = `${DOCS}local.json`;
const PAIRING_KEY = "reprise-pairing";

export type TrackKind = "audio" | "vocals" | "instrumental";
export const TRACKS: TrackKind[] = ["audio", "instrumental", "vocals"];

export interface LocalFile {
  uri: string;
  size: number;
  /** The desktop file's mtime when downloaded — a newer one means download again. */
  mtime: number;
}

/** A take recorded on this phone. */
export interface LocalTake {
  id: string;
  song_id: string;
  uri: string;
  duration_ms: number;
  song_start_ms?: number;
  backing?: Recording["backing"];
  section_id?: string;
  note?: string;
  created_at: string;
  /** Sent to the computer. */
  uploaded: boolean;
}

export interface LineEdit {
  song_id: string;
  note?: string | null;
  register?: string | null;
  placement?: string | null;
  updated_at: string;
  sent: boolean;
}

export interface TakeEdit {
  song_id: string;
  note?: string | null;
  is_best_take?: boolean;
  updated_at: string;
  sent: boolean;
}

interface LocalState {
  downloads: Record<string, Partial<Record<TrackKind, LocalFile>>>;
  /** Desktop takes fetched to listen to: recording id → file. */
  takeFiles: Record<string, string>;
  takes: LocalTake[];
  lineEdits: Record<string, LineEdit>;
  takeEdits: Record<string, TakeEdit>;
  practiced: Record<string, string>;
  /** Practiced times already sent. */
  practicedSent: Record<string, string>;
  /** Where you last were in each song (ms). */
  positions?: Record<string, number>;
}

const EMPTY_LOCAL: LocalState = { downloads: {}, takeFiles: {}, takes: [], lineEdits: {}, takeEdits: {}, practiced: {}, practicedSent: {} };

interface LibraryState {
  ready: boolean;
  pairing: Pairing | null;
  snapshot: SyncSnapshot | null;
  local: LocalState;
  syncing: boolean;
  /** Last sync problem (null after a good sync). `unreachable` = just not home. */
  syncError: { message: string; unreachable: boolean } | null;
  lastSync: number | null;
  /** Song id → download progress 0–1 while downloading. */
  downloading: Record<string, number>;

  load: () => Promise<void>;
  pair: (p: Pairing) => Promise<void>;
  unpair: () => Promise<void>;
  /** `quiet`: a background check (no spinner). `force`: pull even if the computer says nothing changed. */
  sync: (opts?: { quiet?: boolean; force?: boolean }) => Promise<void>;
  /** Called every few seconds while the app is open: checks the computer when it's time. */
  poll: () => void;
  downloadSong: (songId: string, kinds?: TrackKind[]) => Promise<void>;
  removeDownloads: (songId: string) => Promise<void>;
  fetchTakeAudio: (rec: Recording) => Promise<string | null>;
  editLine: (songId: string, lineId: string, patch: Pick<LineEdit, "note" | "register" | "placement">) => void;
  editTake: (songId: string, recId: string, patch: Pick<TakeEdit, "note" | "is_best_take">) => void;
  addTake: (take: Omit<LocalTake, "uploaded">) => Promise<void>;
  deleteLocalTake: (id: string) => Promise<void>;
  touchPracticed: (songId: string) => void;
  setPosition: (songId: string, ms: number) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveLocalSoon(get: () => LibraryState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void FileSystem.writeAsStringAsync(LOCAL_FILE, JSON.stringify(get().local)).catch(() => {});
  }, 400);
}

async function readJson<T>(uri: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as T;
  } catch {
    return null;
  }
}

const extOf = (path: string) => (path.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "bin").toLowerCase();
const songDir = (songId: string) => `${DOCS}songs/${songId}/`;
const newer = (a?: string, b?: string) => !!a && (!b || a > b);

/** One sync at a time (background checks don't show the spinner, so `syncing` can't be the lock). */
let busy = false;
/** When the computer's library last changed, as of the last pull. */
let libraryStamp: number | null = null;
let lastCheck = 0;
let keepingRecent = false;

/** How often to check the computer: often while a take waits for its review, otherwise now and then. */
const CHECK_MS = 20_000;
const REVIEW_CHECK_MS = 4_000;

export const useLibraryStore = create<LibraryState>()((set, get) => {
  const setLocal = (fn: (l: LocalState) => LocalState) => {
    set((s) => ({ local: fn(s.local) }));
    saveLocalSoon(get);
  };

  return {
    ready: false,
    pairing: null,
    snapshot: null,
    local: EMPTY_LOCAL,
    syncing: false,
    syncError: null,
    lastSync: null,
    downloading: {},

    load: async () => {
      const [pairingRaw, snapshot, local] = await Promise.all([
        AsyncStorage.getItem(PAIRING_KEY).catch(() => null),
        readJson<SyncSnapshot>(SNAPSHOT_FILE),
        readJson<LocalState>(LOCAL_FILE),
      ]);
      let pairing: Pairing | null = null;
      try {
        pairing = pairingRaw ? (JSON.parse(pairingRaw) as Pairing) : null;
      } catch {
        pairing = null;
      }
      set({
        ready: true,
        pairing,
        snapshot,
        local: { ...EMPTY_LOCAL, ...(local ?? {}) },
        lastSync: snapshot ? Date.parse(snapshot.generated_at) || null : null,
      });
    },

    pair: async (p) => {
      const info = await ping(p);
      const pairing = { ...p, name: info.host || p.name };
      await AsyncStorage.setItem(PAIRING_KEY, JSON.stringify(pairing));
      set({ pairing, syncError: null });
      await get().sync();
    },

    unpair: async () => {
      await AsyncStorage.removeItem(PAIRING_KEY);
      set({ pairing: null, syncError: null });
    },

    sync: async (opts) => {
      const p = get().pairing;
      if (!p || busy) return;
      busy = true;
      lastCheck = Date.now();
      if (!opts?.quiet) set({ syncing: true });
      let sent = false;
      try {
        const info = await ping(p);
        // 1. Takes recorded here: audio first, then the note that says what it is.
        for (const t of get().local.takes.filter((x) => !x.uploaded)) {
          const file = `${t.id}.${extOf(t.uri)}`;
          await uploadFile(p, t.uri, file);
          const manifest: PhoneTake = {
            type: "take",
            id: t.id,
            song_id: t.song_id,
            file,
            duration_ms: t.duration_ms,
            song_start_ms: t.song_start_ms,
            backing: t.backing,
            section_id: t.section_id,
            note: t.note,
            created_at: t.created_at,
          };
          await uploadJson(p, manifest, `${t.id}.take.json`);
          setLocal((l) => ({ ...l, takes: l.takes.map((x) => (x.id === t.id ? { ...x, uploaded: true } : x)) }));
          sent = true;
        }
        // 2. Edits and practice times.
        const { local } = get();
        const lines = Object.entries(local.lineEdits).filter(([, e]) => !e.sent);
        const recs = Object.entries(local.takeEdits).filter(([, e]) => !e.sent);
        const practiced = Object.fromEntries(
          Object.entries(local.practiced).filter(([id, at]) => newer(at, local.practicedSent[id])),
        );
        if (lines.length || recs.length || Object.keys(practiced).length) {
          const changes: PhoneChanges = {
            type: "changes",
            lines: lines.map(([id, e]) => ({ id, song_id: e.song_id, note: e.note, register: e.register, placement: e.placement, updated_at: e.updated_at })),
            recordings: recs.map(([id, e]) => ({ id, song_id: e.song_id, note: e.note, is_best_take: e.is_best_take, updated_at: e.updated_at })),
            practiced,
          };
          await uploadJson(p, changes, `changes-${Date.now()}.json`);
          sent = true;
          setLocal((l) => ({
            ...l,
            lineEdits: Object.fromEntries(Object.entries(l.lineEdits).map(([id, e]) => [id, { ...e, sent: true }])),
            takeEdits: Object.fromEntries(Object.entries(l.takeEdits).map(([id, e]) => [id, { ...e, sent: true }])),
            practicedSent: { ...l.practicedSent, ...practiced },
          }));
        }
        // 3. The library. (The computer imports uploads every few seconds, so
        //    edits just sent may not be in it yet — they stay shown from `local`.)
        //    Skipped when the computer's library hasn't changed since the last pull.
        const unchanged = !opts?.force && !sent && info.library != null && info.library === libraryStamp && !!get().snapshot;
        if (!unchanged) {
          const snap = await fetchLibrary(p);
          await FileSystem.writeAsStringAsync(SNAPSHOT_FILE, JSON.stringify(snap));
          libraryStamp = info.library ?? null;
          set({ snapshot: snap });
          prune(snap);
        }
        set({ lastSync: Date.now(), syncError: null });
        void keepRecent();
      } catch (err) {
        const unreachable = err instanceof SyncError && err.unreachable;
        set({ syncError: { message: err instanceof Error ? err.message : String(err), unreachable } });
      } finally {
        busy = false;
        set({ syncing: false });
      }
    },

    poll: () => {
      const { pairing, snapshot, local } = get();
      if (!pairing || busy) return;
      const now = Date.now();
      const reviewed = new Set((snapshot?.recordings ?? []).filter((r) => r.analysis).map((r) => r.id));
      const waiting = local.takes.some(
        (t) => t.uploaded && t.song_start_ms != null && !reviewed.has(t.id) && now - Date.parse(t.created_at) < 5 * 60_000,
      );
      if (now - lastCheck >= (waiting ? REVIEW_CHECK_MS : CHECK_MS)) void get().sync({ quiet: true });
    },

    downloadSong: async (songId, kinds = TRACKS) => {
      const { pairing: p, snapshot } = get();
      const files = snapshot?.files[songId];
      if (!p || !files || songId in get().downloading) return;
      const wanted = kinds
        .map((k) => [k, files[k]] as const)
        .filter((x): x is readonly [TrackKind, SyncFileRef] => !!x[1])
        .filter(([k, ref]) => {
          const have = get().local.downloads[songId]?.[k];
          return !have || have.mtime !== ref.mtime || have.size !== ref.size;
        });
      if (!wanted.length) return;
      const total = wanted.reduce((n, [, r]) => n + r.size, 0) || 1;
      let done = 0;
      set((s) => ({ downloading: { ...s.downloading, [songId]: 0 } }));
      try {
        await FileSystem.makeDirectoryAsync(songDir(songId), { intermediates: true });
        for (const [kind, ref] of wanted) {
          const dest = `${songDir(songId)}${kind}.${extOf(ref.path)}`;
          await downloadFile(p, ref.path, dest, (f) =>
            set((s) => ({ downloading: { ...s.downloading, [songId]: (done + f * ref.size) / total } })),
          );
          done += ref.size;
          setLocal((l) => ({
            ...l,
            downloads: { ...l.downloads, [songId]: { ...l.downloads[songId], [kind]: { uri: dest, size: ref.size, mtime: ref.mtime } } },
          }));
        }
      } catch (err) {
        const unreachable = err instanceof SyncError && err.unreachable;
        set({ syncError: { message: err instanceof Error ? err.message : String(err), unreachable } });
      } finally {
        set((s) => {
          const { [songId]: _, ...rest } = s.downloading;
          return { downloading: rest };
        });
      }
    },

    removeDownloads: async (songId) => {
      await FileSystem.deleteAsync(songDir(songId), { idempotent: true });
      setLocal((l) => {
        const { [songId]: _, ...rest } = l.downloads;
        return { ...l, downloads: rest };
      });
    },

    fetchTakeAudio: async (rec) => {
      const local = get().local.takes.find((t) => t.id === rec.id);
      if (local) return local.uri;
      const have = get().local.takeFiles[rec.id];
      if (have && (await FileSystem.getInfoAsync(have)).exists) return have;
      const p = get().pairing;
      if (!p) return null;
      const dir = `${DOCS}takes/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}${rec.id}.${extOf(rec.file_path)}`;
      try {
        await downloadFile(p, rec.file_path, dest);
      } catch {
        return null;
      }
      setLocal((l) => ({ ...l, takeFiles: { ...l.takeFiles, [rec.id]: dest } }));
      return dest;
    },

    editLine: (songId, lineId, patch) => {
      setLocal((l) => ({
        ...l,
        lineEdits: { ...l.lineEdits, [lineId]: { ...l.lineEdits[lineId], ...patch, song_id: songId, updated_at: new Date().toISOString(), sent: false } },
      }));
      queueSync(get);
    },

    editTake: (songId, recId, patch) => {
      const local = get().local.takes.find((t) => t.id === recId && !t.uploaded);
      if (local) {
        setLocal((l) => ({ ...l, takes: l.takes.map((t) => (t.id === recId ? { ...t, note: patch.note ?? t.note } : t)) }));
        return;
      }
      setLocal((l) => ({
        ...l,
        takeEdits: { ...l.takeEdits, [recId]: { ...l.takeEdits[recId], ...patch, song_id: songId, updated_at: new Date().toISOString(), sent: false } },
      }));
      queueSync(get);
    },

    addTake: async (take) => {
      setLocal((l) => ({ ...l, takes: [...l.takes, { ...take, uploaded: false }] }));
      queueSync(get, 500);
    },

    deleteLocalTake: async (id) => {
      const t = get().local.takes.find((x) => x.id === id);
      if (!t || t.uploaded) return;
      await FileSystem.deleteAsync(t.uri, { idempotent: true });
      setLocal((l) => ({ ...l, takes: l.takes.filter((x) => x.id !== id) }));
    },

    setPosition: (songId, ms) => {
      if (Math.abs((get().local.positions?.[songId] ?? -1e9) - ms) < 2000) return;
      setLocal((l) => ({ ...l, positions: { ...l.positions, [songId]: Math.round(ms) } }));
    },

    touchPracticed: (songId) => {
      const now = new Date().toISOString();
      const last = get().local.practiced[songId];
      // Once a minute is plenty.
      if (last && Date.now() - Date.parse(last) < 60_000) return;
      setLocal((l) => ({ ...l, practiced: { ...l.practiced, [songId]: now } }));
    },
  };

  /** Keep the most recent songs' audio on the phone (only runs while the computer is reachable, i.e. at home). */
  async function keepRecent() {
    const n = usePrefsStore.getState().keepRecent;
    const { snapshot, local } = get();
    if (!n || keepingRecent || !snapshot) return;
    keepingRecent = true;
    try {
      const wanted = recentSongs(snapshot, local.practiced, local.takes)
        .map((x) => x.song)
        .concat([...snapshot.songs].sort((a, b) => b.created_at.localeCompare(a.created_at)))
        .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i && snapshot.files[s.id]?.audio)
        .slice(0, n);
      for (const s of wanted) {
        if (!get().pairing || get().syncError) break;
        await get().downloadSong(s.id);
      }
    } finally {
      keepingRecent = false;
    }
  }

  /** After a pull: drop edits the computer now has, forget removed songs' files. */
  function prune(snap: SyncSnapshot) {
    const lineUpdated = new Map(snap.lines.map((l) => [l.id, l.updated_at]));
    const recUpdated = new Map(snap.recordings.map((r) => [r.id, r.updated_at]));
    const songIds = new Set(snap.songs.map((s) => s.id));
    const gone = Object.keys(get().local.downloads).filter((id) => !songIds.has(id));
    for (const id of gone) void FileSystem.deleteAsync(songDir(id), { idempotent: true });
    setLocal((l) => ({
      ...l,
      downloads: Object.fromEntries(Object.entries(l.downloads).filter(([id]) => songIds.has(id))),
      lineEdits: Object.fromEntries(
        Object.entries(l.lineEdits).filter(([id, e]) => !e.sent || (lineUpdated.has(id) && newer(e.updated_at, lineUpdated.get(id)))),
      ),
      takeEdits: Object.fromEntries(
        Object.entries(l.takeEdits).filter(([id, e]) => !e.sent || (recUpdated.has(id) && newer(e.updated_at, recUpdated.get(id)))),
      ),
    }));
  }
});

let syncTimer: ReturnType<typeof setTimeout> | null = null;
/** Send edits a little after the last one (if the computer is reachable). */
function queueSync(get: () => LibraryState, ms = 4000) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (get().pairing) void get().sync();
  }, ms);
}

// ---------------------------------------------------------------------------
// Selectors (memoised by the caller with useMemo / useShallow)
// ---------------------------------------------------------------------------

/** A song's lines with the phone's own unacknowledged edits on top. */
export function linesWithEdits(snapshot: SyncSnapshot | null, local: LocalState, songId: string): Line[] {
  if (!snapshot) return [];
  return snapshot.lines
    .filter((l) => l.song_id === songId)
    .map((l) => {
      const e = local.lineEdits[l.id];
      if (!e || !newer(e.updated_at, l.updated_at)) return l;
      return {
        ...l,
        note: e.note === undefined ? l.note : e.note ?? undefined,
        register: e.register === undefined ? l.register : e.register ?? undefined,
        placement: e.placement === undefined ? l.placement : e.placement ?? undefined,
      };
    });
}

/** A song's takes: the computer's (with phone edits) and the phone's not yet in the library. Newest first. */
export function takesFor(snapshot: SyncSnapshot | null, local: LocalState, songId: string): (Recording & { onPhone?: boolean })[] {
  const fromDesktop = (snapshot?.recordings ?? [])
    .filter((r) => r.song_id === songId)
    .map((r) => {
      const e = local.takeEdits[r.id];
      if (!e || !newer(e.updated_at, r.updated_at)) return r;
      return { ...r, note: e.note === undefined ? r.note : e.note ?? undefined, is_best_take: e.is_best_take ?? r.is_best_take };
    });
  const known = new Set(fromDesktop.map((r) => r.id));
  const fromPhone = local.takes
    .filter((t) => t.song_id === songId && !known.has(t.id))
    .map((t) => ({
      id: t.id,
      song_id: t.song_id,
      line_id: null,
      section_id: t.section_id,
      file_path: t.uri,
      duration_ms: t.duration_ms,
      is_master_take: false,
      is_best_take: false,
      note: t.note,
      song_start_ms: t.song_start_ms,
      backing: t.backing,
      created_at: t.created_at,
      updated_at: t.created_at,
      onPhone: true,
    }));
  return [...fromDesktop, ...fromPhone].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
