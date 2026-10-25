import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PORT, newToken, type ServerStatus } from "../lib/phone-sync";

interface PhoneSyncState {
  /** Sync server on (it starts with the app while this is on). */
  enabled: boolean;
  /** Pairing token — shown as a QR code; kept out of backups. */
  token: string;
  port: number;
  // Runtime (not persisted)
  status: ServerStatus;
  error: string | null;
  lastPull: number | null;
  lastImport: { at: number; takes: number; edits: number } | null;
  setEnabled: (v: boolean) => void;
  /** New token: phones paired before have to scan again. */
  resetToken: () => void;
  setRuntime: (p: Partial<Pick<PhoneSyncState, "status" | "error" | "lastPull" | "lastImport">>) => void;
}

export const usePhoneSyncStore = create<PhoneSyncState>()(
  persist(
    (set) => ({
      enabled: false,
      token: newToken(),
      port: DEFAULT_PORT,
      status: { running: false, ip: null, port: null },
      error: null,
      lastPull: null,
      lastImport: null,
      setEnabled: (v) => set({ enabled: v }),
      resetToken: () => set({ token: newToken() }),
      setRuntime: (p) => set(p),
    }),
    {
      name: "reprise-phone-sync",
      partialize: (s) => ({ enabled: s.enabled, token: s.token, port: s.port }),
    },
  ),
);
