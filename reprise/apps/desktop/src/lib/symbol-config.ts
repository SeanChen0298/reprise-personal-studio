import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface VocalSymbol {
  id: string;
  label: string;
  char: string;
}

export const DEFAULT_SYMBOLS: VocalSymbol[] = [
  { id: "slur-up", label: "Slide up", char: "\u2934" },
  { id: "slur-down", label: "Slide down", char: "\u2935" },
  { id: "connect", label: "Connect", char: "~" },
  { id: "break", label: "Break", char: "/" },
];

interface SymbolStore {
  symbols: VocalSymbol[];
  addSymbol: (label: string, char: string) => void;
  removeSymbol: (id: string) => void;
}

export const useSymbolStore = create<SymbolStore>()(
  persist(
    (set, get) => ({
      symbols: DEFAULT_SYMBOLS,

      addSymbol: (label: string, char: string) => {
        const symbol: VocalSymbol = {
          id: crypto.randomUUID(),
          label,
          char,
        };
        set({ symbols: [...get().symbols, symbol] });
      },

      removeSymbol: (id: string) => {
        set((s) => ({ symbols: s.symbols.filter((sym) => sym.id !== id) }));
      },
    }),
    { name: "reprise-symbols" }
  )
);
