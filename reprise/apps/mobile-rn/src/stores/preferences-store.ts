import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "system" | "light" | "dark";

interface PreferencesState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      themeMode: "system",
      setThemeMode: (mode) => set({ themeMode: mode }),
    }),
    {
      name: "reprise-preferences",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
