import { create } from "zustand";
import type { Song } from "../types/song";

interface QueueStore {
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  enqueue: (song: Song) => void;
  removeFromQueue: (songId: string) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  setCurrentIndex: (n: number) => void;
  setIsPlaying: (v: boolean) => void;
  next: () => void;
  prev: () => void;
}

export const useQueueStore = create<QueueStore>((set) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,

  enqueue: (song) =>
    set((s) => {
      if (s.queue.some((q) => q.id === song.id)) return s;
      const queue = [...s.queue, song];
      // Auto-start if nothing is playing
      const currentIndex = s.currentIndex === -1 ? 0 : s.currentIndex;
      return { queue, currentIndex };
    }),

  removeFromQueue: (songId) =>
    set((s) => {
      const idx = s.queue.findIndex((q) => q.id === songId);
      if (idx === -1) return s;
      const queue = s.queue.filter((q) => q.id !== songId);
      let currentIndex = s.currentIndex;
      if (queue.length === 0) {
        currentIndex = -1;
      } else if (idx < currentIndex) {
        currentIndex = currentIndex - 1;
      } else if (idx === currentIndex) {
        currentIndex = Math.min(currentIndex, queue.length - 1);
      }
      return { queue, currentIndex, isPlaying: queue.length > 0 ? s.isPlaying : false };
    }),

  reorderQueue: (from, to) =>
    set((s) => {
      if (from === to) return s;
      const queue = [...s.queue];
      const [item] = queue.splice(from, 1);
      queue.splice(to, 0, item);
      let currentIndex = s.currentIndex;
      if (from === currentIndex) currentIndex = to;
      else if (from < currentIndex && to >= currentIndex) currentIndex--;
      else if (from > currentIndex && to <= currentIndex) currentIndex++;
      return { queue, currentIndex };
    }),

  clearQueue: () => set({ queue: [], currentIndex: -1, isPlaying: false }),

  setCurrentIndex: (n) => set({ currentIndex: n }),

  setIsPlaying: (v) => set({ isPlaying: v }),

  next: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      const next = (s.currentIndex + 1) % s.queue.length;
      return { currentIndex: next, isPlaying: true };
    }),

  prev: () =>
    set((s) => {
      if (s.queue.length === 0) return s;
      const prev = (s.currentIndex - 1 + s.queue.length) % s.queue.length;
      return { currentIndex: prev, isPlaying: true };
    }),
}));

// Convenience selector for the currently playing song
export function useCurrentQueueSong(): Song | null {
  return useQueueStore((s) =>
    s.currentIndex >= 0 && s.currentIndex < s.queue.length
      ? s.queue[s.currentIndex]
      : null
  );
}
