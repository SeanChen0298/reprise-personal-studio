import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreferencesState {
  showWaveform: boolean;
  setShowWaveform: (v: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      showWaveform: true,
      setShowWaveform: (v) => set({ showWaveform: v }),
    }),
    { name: "reprise-preferences" },
  ),
);
