import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Line } from "../types/song";

interface LineStore {
  linesBySong: Record<string, Line[]>;
  setLines: (songId: string, lines: Line[]) => void;
  addLine: (songId: string, text?: string) => void;
  updateLine: (songId: string, lineId: string, text: string) => void;
  removeLine: (songId: string, lineId: string) => void;
  reorderLines: (songId: string, lines: Line[]) => void;
  getLines: (songId: string) => Line[];
}

export const useLineStore = create<LineStore>()(
  persist(
    (set, get) => ({
      linesBySong: {},

      setLines: (songId, lines) =>
        set((s) => ({ linesBySong: { ...s.linesBySong, [songId]: lines } })),

      addLine: (songId, text = "") => {
        const existing = get().linesBySong[songId] ?? [];
        const now = new Date().toISOString();
        const newLine: Line = {
          id: crypto.randomUUID(),
          song_id: songId,
          text,
          status: "not_started",
          order: existing.length,
          updated_at: now,
        };
        set((s) => ({
          linesBySong: {
            ...s.linesBySong,
            [songId]: [...(s.linesBySong[songId] ?? []), newLine],
          },
        }));
      },

      updateLine: (songId, lineId, text) =>
        set((s) => ({
          linesBySong: {
            ...s.linesBySong,
            [songId]: (s.linesBySong[songId] ?? []).map((l) =>
              l.id === lineId
                ? { ...l, text, updated_at: new Date().toISOString() }
                : l
            ),
          },
        })),

      removeLine: (songId, lineId) =>
        set((s) => ({
          linesBySong: {
            ...s.linesBySong,
            [songId]: (s.linesBySong[songId] ?? [])
              .filter((l) => l.id !== lineId)
              .map((l, i) => ({ ...l, order: i })),
          },
        })),

      reorderLines: (songId, lines) =>
        set((s) => ({
          linesBySong: {
            ...s.linesBySong,
            [songId]: lines.map((l, i) => ({ ...l, order: i })),
          },
        })),

      getLines: (songId) => get().linesBySong[songId] ?? [],
    }),
    { name: "reprise-lines" }
  )
);
