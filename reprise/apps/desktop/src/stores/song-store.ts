import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Song, ImportDraft } from "../types/song";

interface SongStore {
  songs: Song[];
  importDraft: ImportDraft | null;
  setImportDraft: (draft: ImportDraft | null) => void;
  addSong: (
    data: Omit<Song, "id" | "created_at" | "updated_at" | "mastery" | "pinned">
  ) => Song;
  updateSong: (id: string, data: Partial<Song>) => void;
  removeSong: (id: string) => void;
  togglePin: (id: string) => void;
}

export const useSongStore = create<SongStore>()(
  persist(
    (set) => ({
      songs: [],
      importDraft: null,

      setImportDraft: (draft) => set({ importDraft: draft }),

      addSong: (data) => {
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
        set((s) => ({ songs: [...s.songs, song] }));
        return song;
      },

      updateSong: (id, data) =>
        set((s) => ({
          songs: s.songs.map((song) =>
            song.id === id
              ? { ...song, ...data, updated_at: new Date().toISOString() }
              : song
          ),
        })),

      removeSong: (id) =>
        set((s) => ({ songs: s.songs.filter((song) => song.id !== id) })),

      togglePin: (id) =>
        set((s) => ({
          songs: s.songs.map((song) =>
            song.id === id
              ? {
                  ...song,
                  pinned: !song.pinned,
                  updated_at: new Date().toISOString(),
                }
              : song
          ),
        })),
    }),
    { name: "reprise-songs" }
  )
);
