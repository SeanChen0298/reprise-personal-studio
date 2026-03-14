import { create } from "zustand";

interface DriveSyncState {
  syncingIds: string[]; // song IDs currently uploading
  addSyncing: (id: string) => void;
  removeSyncing: (id: string) => void;
}

export const useDriveSyncStore = create<DriveSyncState>((set) => ({
  syncingIds: [],
  addSyncing: (id) => set((s) => ({ syncingIds: [...s.syncingIds, id] })),
  removeSyncing: (id) => set((s) => ({ syncingIds: s.syncingIds.filter((x) => x !== id) })),
}));
