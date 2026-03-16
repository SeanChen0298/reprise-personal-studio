import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";

export type { HighlightType };
export { DEFAULT_HIGHLIGHTS };

const EXTRA_BG_COLORS = ["#FEF3C7", "#E0E7FF", "#FCE7F3", "#CCFBF1"];
const EXTRA_TEXT_COLORS = ["#92400E", "#3730A3", "#9D174D", "#0F766E"];

interface HighlightStore {
  highlights: HighlightType[];
  addHighlight: (name: string) => void;
  updateHighlight: (id: string, updates: Partial<Pick<HighlightType, "name" | "bg" | "color">>) => void;
  removeHighlight: (id: string) => void;
  setHighlights: (highlights: HighlightType[]) => void;
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

      updateHighlight: (id, updates) => {
        set((s) => ({
          highlights: s.highlights.map((h) =>
            h.id === id ? { ...h, ...updates } : h
          ),
        }));
      },

      removeHighlight: (id: string) => {
        set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
      },

      setHighlights: (highlights) => set({ highlights }),
    }),
    { name: "reprise-highlights" }
  )
);
