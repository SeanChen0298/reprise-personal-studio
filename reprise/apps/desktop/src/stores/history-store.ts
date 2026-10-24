import { create } from "zustand";

/** An edit that has already been applied, and how to take it back / redo it. */
export interface EditCommand {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 200;

interface HistoryState {
  /** History belongs to one song at a time; switching songs starts fresh. */
  scope: string | null;
  past: EditCommand[];
  future: EditCommand[];
  busy: boolean;
  setScope: (scope: string) => void;
  push: (cmd: EditCommand) => void;
  undo: () => Promise<string | null>;
  redo: () => Promise<string | null>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  scope: null,
  past: [],
  future: [],
  busy: false,

  setScope: (scope) => {
    if (get().scope !== scope) set({ scope, past: [], future: [] });
  },

  push: (cmd) =>
    set((s) => ({ past: [...s.past, cmd].slice(-MAX_HISTORY), future: [] })),

  undo: async () => {
    const { past, busy } = get();
    const cmd = past[past.length - 1];
    if (!cmd || busy) return null;
    set({ busy: true });
    try {
      await cmd.undo();
      set((s) => ({ past: s.past.slice(0, -1), future: [...s.future, cmd] }));
      return cmd.label;
    } finally {
      set({ busy: false });
    }
  },

  redo: async () => {
    const { future, busy } = get();
    const cmd = future[future.length - 1];
    if (!cmd || busy) return null;
    set({ busy: true });
    try {
      await cmd.redo();
      set((s) => ({ future: s.future.slice(0, -1), past: [...s.past, cmd] }));
      return cmd.label;
    } finally {
      set({ busy: false });
    }
  },
}));
