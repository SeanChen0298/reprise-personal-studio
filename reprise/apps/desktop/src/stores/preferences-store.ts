import { create } from "zustand";
import { persist } from "zustand/middleware";

const THEME_MAP: Record<string, { color: string; light: string; text: string }> = {
  blue:     { color: "#2563EB", light: "#EFF6FF", text: "#1D4ED8" },
  midnight: { color: "#111111", light: "#F5F5F5", text: "#111111" },
  violet:   { color: "#7C3AED", light: "#F5F3FF", text: "#6D28D9" },
  emerald:  { color: "#059669", light: "#ECFDF5", text: "#047857" },
  red:      { color: "#DC2626", light: "#FEF2F2", text: "#B91C1C" },
  amber:    { color: "#D97706", light: "#FFFBEB", text: "#B45309" },
};

export function applyThemeCssVars(key: string) {
  const t = THEME_MAP[key];
  if (!t) return;
  document.documentElement.style.setProperty("--theme", t.color);
  document.documentElement.style.setProperty("--theme-light", t.light);
  document.documentElement.style.setProperty("--theme-text", t.text);
}

interface PreferencesState {
  theme: string;
  showWaveform: boolean;
  showPitchCurve: boolean;
  libraryView: "grid" | "list";
  librarySort: "custom" | "title" | "artist" | "mastery" | "date_added";
  libraryGroup: "none" | "artist" | "last_practiced";
  songOrder: Record<string, number>;
  lastPracticed: Record<string, string>;
  collapsedGroups: Record<string, boolean>;
  countInEnabled: boolean;
  recordingPlaybackGain: number;
  playbackVolume: number;
  autoSyncDrive: boolean;
  autoDemucs: boolean;
  autoPitch: boolean;
  setTheme: (v: string) => void;
  setShowWaveform: (v: boolean) => void;
  setShowPitchCurve: (v: boolean) => void;
  setLibraryView: (v: "grid" | "list") => void;
  setLibrarySort: (v: PreferencesState["librarySort"]) => void;
  setLibraryGroup: (v: PreferencesState["libraryGroup"]) => void;
  setSongOrder: (v: Record<string, number>) => void;
  touchLastPracticed: (songId: string) => void;
  setGroupCollapsed: (key: string, collapsed: boolean) => void;
  setCountInEnabled: (v: boolean) => void;
  setRecordingPlaybackGain: (v: number) => void;
  setPlaybackVolume: (v: number) => void;
  setAutoSyncDrive: (v: boolean) => void;
  setAutoDemucs: (v: boolean) => void;
  setAutoPitch: (v: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "blue",
      showWaveform: true,
      showPitchCurve: true,
      countInEnabled: true,
      recordingPlaybackGain: 8.0,
      playbackVolume: 1.0,
      autoSyncDrive: false,
      autoDemucs: false,
      autoPitch: false,
      libraryView: "grid" as const,
      librarySort: "custom" as const,
      libraryGroup: "none" as const,
      songOrder: {} as Record<string, number>,
      lastPracticed: {} as Record<string, string>,
      collapsedGroups: {} as Record<string, boolean>,
      setTheme: (v) => {
        applyThemeCssVars(v);
        set({ theme: v });
      },
      setShowWaveform: (v) => set({ showWaveform: v }),
      setShowPitchCurve: (v) => set({ showPitchCurve: v }),
      setLibraryView: (v) => set({ libraryView: v }),
      setLibrarySort: (v) => set({ librarySort: v }),
      setLibraryGroup: (v) => set({ libraryGroup: v }),
      setSongOrder: (v) => set({ songOrder: v }),
      touchLastPracticed: (songId) =>
        set((s) => ({ lastPracticed: { ...s.lastPracticed, [songId]: new Date().toISOString() } })),
      setGroupCollapsed: (key, collapsed) =>
        set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [key]: collapsed } })),
      setCountInEnabled: (v) => set({ countInEnabled: v }),
      setRecordingPlaybackGain: (v) => set({ recordingPlaybackGain: v }),
      setPlaybackVolume: (v) => set({ playbackVolume: Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 }),
      setAutoSyncDrive: (v) => set({ autoSyncDrive: v }),
      setAutoDemucs: (v) => set({ autoDemucs: v }),
      setAutoPitch: (v) => set({ autoPitch: v }),
    }),
    {
      name: "reprise-preferences",
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyThemeCssVars(state.theme);
      },
    },
  ),
);
