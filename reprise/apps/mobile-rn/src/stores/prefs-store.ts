import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "auto" | "light" | "dark";

interface PrefsState {
  themeMode: ThemeMode;
  /** Accent colour; follows the desktop's theme unless picked here. */
  accent: string | null;
  showTranslation: boolean;
  showFurigana: boolean;
  /** High notes / long phrases of the original under the lines. */
  showHints: boolean;
  /** Seconds of count-in before a take (0 = none). */
  countIn: number;
  /** Fetch a song's audio as soon as it's opened (on Wi-Fi with the computer). */
  autoDownload: boolean;
  setThemeMode: (v: ThemeMode) => void;
  setAccent: (v: string | null) => void;
  setShowTranslation: (v: boolean) => void;
  setShowFurigana: (v: boolean) => void;
  setShowHints: (v: boolean) => void;
  setCountIn: (v: number) => void;
  setAutoDownload: (v: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      themeMode: "auto",
      accent: null,
      showTranslation: true,
      showFurigana: true,
      showHints: true,
      countIn: 3,
      autoDownload: true,
      setThemeMode: (v) => set({ themeMode: v }),
      setAccent: (v) => set({ accent: v }),
      setShowTranslation: (v) => set({ showTranslation: v }),
      setShowFurigana: (v) => set({ showFurigana: v }),
      setShowHints: (v) => set({ showHints: v }),
      setCountIn: (v) => set({ countIn: v }),
      setAutoDownload: (v) => set({ autoDownload: v }),
    }),
    { name: "reprise-prefs", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
