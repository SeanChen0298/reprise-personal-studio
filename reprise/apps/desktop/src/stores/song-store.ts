import { create } from "zustand";
import type { Song, ImportDraft } from "../types/song";
import { getDb } from "../lib/db";

const IS_TAURI = typeof window !== "undefined" && "__TAURI__" in window;

// SQLite row shape (sqlite returns numbers for booleans, nulls for optionals)
interface SongRow {
  id: string;
  title: string;
  artist: string;
  youtube_url: string | null;
  thumbnail_url: string | null;
  duration_ms: number | null;
  bpm: number | null;
  language: string | null;
  tags: string; // JSON-encoded string[]
  notes: string | null;
  pinned: number; // 0 | 1
  mastery: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    youtube_url: row.youtube_url ?? undefined,
    thumbnail_url: row.thumbnail_url ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    bpm: row.bpm ?? undefined,
    language: row.language ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    notes: row.notes ?? undefined,
    pinned: row.pinned === 1,
    mastery: row.mastery,
    user_id: row.user_id ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

interface SongStore {
  songs: Song[];
  loading: boolean;
  importDraft: ImportDraft | null;

  /** Load all songs from SQLite (Tauri) or no-op in browser mode. */
  loadSongs: () => Promise<void>;

  setImportDraft: (draft: ImportDraft | null) => void;

  addSong: (
    data: Omit<Song, "id" | "created_at" | "updated_at" | "mastery" | "pinned">
  ) => Song;

  updateSong: (id: string, data: Partial<Song>) => void;
  removeSong: (id: string) => void;
  togglePin: (id: string) => void;
}

export const useSongStore = create<SongStore>()((set, get) => ({
  songs: [],
  loading: false,
  importDraft: null,

  setImportDraft: (draft) => set({ importDraft: draft }),

  async loadSongs() {
    if (!IS_TAURI) return;
    set({ loading: true });
    try {
      const db = await getDb();
      const rows = await db.select<SongRow[]>(
        "SELECT * FROM songs ORDER BY created_at DESC"
      );
      set({ songs: rows.map(rowToSong), loading: false });
    } catch (e) {
      console.error("[song-store] loadSongs failed:", e);
      set({ loading: false });
    }
  },

  addSong(data) {
    const now = new Date().toISOString();
    const song: Song = {
      ...data,
      id: crypto.randomUUID(),
      mastery: 0,
      pinned: false,
      tags: data.tags ?? [],
      created_at: now,
      updated_at: now,
    };
    // Update in-memory immediately for snappy UI
    set((s) => ({ songs: [song, ...s.songs] }));

    // Persist to SQLite asynchronously
    if (IS_TAURI) {
      getDb()
        .then((db) =>
          db.execute(
            `INSERT INTO songs (id, title, artist, youtube_url, thumbnail_url, duration_ms, bpm, language, tags, notes, pinned, mastery, user_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
            [
              song.id,
              song.title,
              song.artist,
              song.youtube_url ?? null,
              song.thumbnail_url ?? null,
              song.duration_ms ?? null,
              song.bpm ?? null,
              song.language ?? null,
              JSON.stringify(song.tags),
              song.notes ?? null,
              song.pinned ? 1 : 0,
              song.mastery,
              song.user_id ?? null,
              song.created_at,
              song.updated_at,
            ]
          )
        )
        .catch((e) => console.error("[song-store] addSong persist failed:", e));
    }
    return song;
  },

  updateSong(id, data) {
    const now = new Date().toISOString();
    set((s) => ({
      songs: s.songs.map((song) =>
        song.id === id ? { ...song, ...data, updated_at: now } : song
      ),
    }));

    if (IS_TAURI) {
      const updated = get().songs.find((s) => s.id === id);
      if (updated) {
        getDb()
          .then((db) =>
            db.execute(
              `UPDATE songs SET title=?1, artist=?2, bpm=?3, language=?4, tags=?5, notes=?6, updated_at=?7 WHERE id=?8`,
              [
                updated.title,
                updated.artist,
                updated.bpm ?? null,
                updated.language ?? null,
                JSON.stringify(updated.tags),
                updated.notes ?? null,
                now,
                id,
              ]
            )
          )
          .catch((e) =>
            console.error("[song-store] updateSong persist failed:", e)
          );
      }
    }
  },

  removeSong(id) {
    set((s) => ({ songs: s.songs.filter((song) => song.id !== id) }));
    if (IS_TAURI) {
      getDb()
        .then((db) => db.execute("DELETE FROM songs WHERE id=?1", [id]))
        .catch((e) =>
          console.error("[song-store] removeSong persist failed:", e)
        );
    }
  },

  togglePin(id) {
    const now = new Date().toISOString();
    const song = get().songs.find((s) => s.id === id);
    if (!song) return;
    const newPinned = !song.pinned;
    set((s) => ({
      songs: s.songs.map((s) =>
        s.id === id ? { ...s, pinned: newPinned, updated_at: now } : s
      ),
    }));
    if (IS_TAURI) {
      getDb()
        .then((db) =>
          db.execute(
            "UPDATE songs SET pinned=?1, updated_at=?2 WHERE id=?3",
            [newPinned ? 1 : 0, now, id]
          )
        )
        .catch((e) =>
          console.error("[song-store] togglePin persist failed:", e)
        );
    }
  },
}));
