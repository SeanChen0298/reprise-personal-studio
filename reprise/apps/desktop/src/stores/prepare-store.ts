// What the automatic preparation (hooks/use-auto-process.ts) is doing now and what it did lately —
// shown in the sidebar while it works and in Settings → Audio processing.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PrepareEntry {
  songId: string;
  title: string;
  /** What was tried, e.g. "Fit timing to the vocals". */
  step: string;
  /** What came of it, in plain words. */
  result: string;
  /** True when it changed the song. */
  changed: boolean;
  at: number;
}

interface PrepareStore {
  current: { title: string; step: string } | null;
  log: PrepareEntry[];
  start: (title: string, step: string) => void;
  finish: (entry: Omit<PrepareEntry, "at">) => void;
  clearLog: () => void;
}

const MAX_LOG = 80;

export const usePrepareStore = create<PrepareStore>()(
  persist(
    (set) => ({
      current: null,
      log: [],
      start: (title, step) => set({ current: { title, step } }),
      finish: (entry) => set((s) => ({ current: null, log: [{ ...entry, at: Date.now() }, ...s.log].slice(0, MAX_LOG) })),
      clearLog: () => set({ log: [] }),
    }),
    { name: "reprise-prepare-log", partialize: (s) => ({ log: s.log }) },
  ),
);
