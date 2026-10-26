import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Classic: light, with a touch of the song's color. Vivid: dark, in the colors of your songs (it's the dark mode). */
export type Look = "classic" | "vivid";

interface PrefsState {
  look: Look;
  /** Accent color; follows the desktop's theme unless picked here. */
  accent: string | null;
  showTranslation: boolean;
  showFurigana: boolean;
  /** High notes / long phrases of the original under the lines. */
  showHints: boolean;
  /** Seconds of count-in before a take (0 = none). */
  countIn: number;
  /** Fetch a song's audio as soon as it's opened (on Wi-Fi with the computer). */
  autoDownload: boolean;
  /** Keep this many of the most recent songs' audio on the phone (downloaded at home). 0 = off. */
  keepRecent: number;
  /** What Play all plays: the song, or the backing to sing along to. */
  radioTrack: "audio" | "instrumental";
  radioShuffle: boolean;
  /** Song screen: show only the start of each line, for singing from memory. */
  memorize: boolean;
  /** The song screen's Practice tray is open. */
  practiceOpen: boolean;
  setLook: (v: Look) => void;
  setAccent: (v: string | null) => void;
  setShowTranslation: (v: boolean) => void;
  setShowFurigana: (v: boolean) => void;
  setShowHints: (v: boolean) => void;
  setCountIn: (v: number) => void;
  setAutoDownload: (v: boolean) => void;
  setKeepRecent: (v: number) => void;
  setRadioTrack: (v: "audio" | "instrumental") => void;
  setRadioShuffle: (v: boolean) => void;
  setMemorize: (v: boolean) => void;
  setPracticeOpen: (v: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      look: "classic",
      accent: null,
      showTranslation: true,
      showFurigana: true,
      showHints: true,
      countIn: 3,
      autoDownload: true,
      keepRecent: 5,
      radioTrack: "audio",
      radioShuffle: false,
      memorize: false,
      practiceOpen: false,
      setLook: (v) => set({ look: v }),
      setAccent: (v) => set({ accent: v }),
      setShowTranslation: (v) => set({ showTranslation: v }),
      setShowFurigana: (v) => set({ showFurigana: v }),
      setShowHints: (v) => set({ showHints: v }),
      setCountIn: (v) => set({ countIn: v }),
      setAutoDownload: (v) => set({ autoDownload: v }),
      setKeepRecent: (v) => set({ keepRecent: v }),
      setRadioTrack: (v) => set({ radioTrack: v }),
      setRadioShuffle: (v) => set({ radioShuffle: v }),
      setMemorize: (v) => set({ memorize: v }),
      setPracticeOpen: (v) => set({ practiceOpen: v }),
    }),
    {
      name: "reprise-prefs",
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Before: themeMode (auto / light / dark) and the song screen's songLook (calm / vivid).
      migrate: (old, from) => {
        const o = (old ?? {}) as Record<string, unknown>;
        if (from < 1) o.look = o.songLook === "vivid" || o.themeMode === "dark" ? "vivid" : "classic";
        delete o.songLook;
        delete o.themeMode;
        return o as unknown as PrefsState;
      },
    },
  ),
);
