import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface HighlightType {
  id: string;
  name: string;
  description: string;
  bg: string;
  color: string;
}

export const DEFAULT_HIGHLIGHTS: HighlightType[] = [
  { id: "falsetto", name: "Falsetto", description: "Mark sections that use falsetto technique", bg: "#DBEAFE", color: "#1D4ED8" },
  { id: "whisper", name: "Whisper", description: "Soft, breathy vocal sections", bg: "#DCFCE7", color: "#15803D" },
  { id: "accent", name: "Accent", description: "Words or syllables to emphasize", bg: "#FEE2E2", color: "#B91C1C" },
  { id: "vibrato", name: "Vibrato", description: "Sections with intentional vibrato", bg: "#F5F3FF", color: "#6D28D9" },
  { id: "breath", name: "Breath mark", description: "Where to take breaths", bg: "#FFF7ED", color: "#C2410C" },
];

const EXTRA_BG_COLORS = ["#FEF3C7", "#E0E7FF", "#FCE7F3", "#CCFBF1"];
const EXTRA_TEXT_COLORS = ["#92400E", "#3730A3", "#9D174D", "#0F766E"];

interface HighlightStore {
  highlights: HighlightType[];
  addHighlight: (name: string) => void;
  removeHighlight: (id: string) => void;
}

export const useHighlightStore = create<HighlightStore>()(
  persist(
    (set, get) => ({
      highlights: DEFAULT_HIGHLIGHTS,

      addHighlight: (name: string) => {
        const existing = get().highlights;
        const idx = existing.length % EXTRA_BG_COLORS.length;
        const hl: HighlightType = {
          id: crypto.randomUUID(),
          name,
          description: "",
          bg: EXTRA_BG_COLORS[idx],
          color: EXTRA_TEXT_COLORS[idx],
        };
        set({ highlights: [...existing, hl] });
      },

      removeHighlight: (id: string) => {
        set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
      },
    }),
    { name: "reprise-highlights" }
  )
);
