import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CoachProvider = "gemini" | "claude";

/**
 * Web search the coach may do:
 *  off  — never
 *  card — only while writing a song card (meaning, the original singer)
 *  auto — whenever it needs to, up to `maxPerAnswer` searches per answer
 */
export type SearchMode = "off" | "card" | "auto";

export const DEFAULT_MODELS: Record<CoachProvider, string> = {
  gemini: "",
  claude: "claude-opus-5-5",
};

interface CoachState {
  provider: CoachProvider;
  /** API keys live only in this machine's app storage — never in the library backup. */
  keys: Record<CoachProvider, string>;
  models: Record<CoachProvider, string>;
  searchMode: SearchMode;
  /** Upper bound per answer (Claude enforces it exactly; Gemini only on/off). */
  maxSearchesPerAnswer: number;
  /** Searches used today, for the counter in Settings and the panel. */
  usage: { date: string; searches: number };
  setProvider: (p: CoachProvider) => void;
  setKey: (p: CoachProvider, key: string) => void;
  setModel: (p: CoachProvider, model: string) => void;
  setSearchMode: (m: SearchMode) => void;
  setMaxSearchesPerAnswer: (n: number) => void;
  addSearches: (n: number) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export const useCoachStore = create<CoachState>()(
  persist(
    (set, get) => ({
      provider: "gemini",
      keys: { gemini: "", claude: "" },
      models: { ...DEFAULT_MODELS },
      searchMode: "card",
      maxSearchesPerAnswer: 3,
      usage: { date: today(), searches: 0 },
      setProvider: (provider) => set({ provider }),
      setKey: (p, key) => set((s) => ({ keys: { ...s.keys, [p]: key.trim() } })),
      setModel: (p, model) => set((s) => ({ models: { ...s.models, [p]: model } })),
      setSearchMode: (searchMode) => set({ searchMode }),
      setMaxSearchesPerAnswer: (n) => set({ maxSearchesPerAnswer: Math.max(1, Math.min(10, Math.round(n))) }),
      addSearches: (n) => {
        if (n <= 0) return;
        const u = get().usage;
        set({ usage: u.date === today() ? { date: u.date, searches: u.searches + n } : { date: today(), searches: n } });
      },
    }),
    { name: "reprise-coach" },
  ),
);

/** Today's search count (resets at midnight). */
export function searchesToday(usage: { date: string; searches: number }): number {
  return usage.date === today() ? usage.searches : 0;
}
