import { create } from "zustand";

interface DriveSyncState {
  syncingIds: string[]; // song IDs currently uploading
  resetInProgress: boolean; // blocks auto-sync during a full Drive reset
  addSyncing: (id: string) => void;
  removeSyncing: (id: string) => void;
  setResetInProgress: (v: boolean) => void;
}

export const useDriveSyncStore = create<DriveSyncState>((set) => ({
  syncingIds: [],
  resetInProgress: false,
  addSyncing: (id) => set((s) => ({ syncingIds: [...s.syncingIds, id] })),
  removeSyncing: (id) => set((s) => ({ syncingIds: s.syncingIds.filter((x) => x !== id) })),
  setResetInProgress: (v) => set({ resetInProgress: v }),
}));
