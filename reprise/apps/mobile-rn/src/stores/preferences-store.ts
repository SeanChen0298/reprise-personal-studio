import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";
import { fetchHighlights } from "../lib/supabase";

export type ThemeMode = "system" | "light" | "dark";

interface PreferencesState {
  themeMode: ThemeMode;
  highlights: HighlightType[];
  setThemeMode: (mode: ThemeMode) => void;
  loadHighlights: (userId: string) => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      themeMode: "system",
      highlights: DEFAULT_HIGHLIGHTS,
      setThemeMode: (mode) => set({ themeMode: mode }),
      loadHighlights: async (userId: string) => {
        const highlights = await fetchHighlights(userId);
        set({ highlights });
      },
    }),
    {
      name: "reprise-preferences",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist themeMode and highlights — loadHighlights is a function
      partialize: (s) => ({ themeMode: s.themeMode, highlights: s.highlights }),
    }
  )
);
