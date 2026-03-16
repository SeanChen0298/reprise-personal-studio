import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";
import { fetchHighlights } from "../lib/supabase";

export type ThemeMode = "system" | "light" | "dark";
export type AccentKey = "blue" | "midnight" | "violet" | "emerald" | "red" | "amber";

interface PreferencesState {
  themeMode: ThemeMode;
  accentKey: AccentKey;
  highlights: HighlightType[];
  setThemeMode: (mode: ThemeMode) => void;
  setAccentKey: (key: AccentKey) => void;
  loadHighlights: (userId: string) => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      themeMode: "system",
      accentKey: "violet",
      highlights: DEFAULT_HIGHLIGHTS,
      setThemeMode: (mode) => set({ themeMode: mode }),
      setAccentKey: (key) => set({ accentKey: key }),
      loadHighlights: async (userId: string) => {
        const highlights = await fetchHighlights(userId);
        set({ highlights });
      },
    }),
    {
      name: "reprise-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ themeMode: s.themeMode, accentKey: s.accentKey, highlights: s.highlights }),
    }
  )
);
