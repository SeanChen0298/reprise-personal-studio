import { useColorScheme } from "react-native";
import { usePreferencesStore } from "../stores/preferences-store";

export type ThemeColors = {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  theme: string;
  accent: string;
};

export const lightC: ThemeColors = {
  bg:      "#FAFAF9",   // warm off-white — Japanese washi
  surface: "#FFFFFF",   // pure white
  border:  "#EBEBEA",   // warm light separator
  text:    "#1C1C1E",   // near-black
  muted:   "#8E8E93",   // warm medium gray
  theme:   "#5856D6",   // indigo — quiet but present
  accent:  "#5856D6",
} as const;

export const darkC: ThemeColors = {
  bg:      "#0C0C10",   // near-black
  surface: "#13131A",   // dark surface
  border:  "#1E1E26",   // subtle dark border
  text:    "#F3F4F6",   // off-white
  muted:   "#6B7280",   // gray-500
  theme:   "#818CF8",   // indigo-400 (lighter for dark bg)
  accent:  "#818CF8",
} as const;

// Backward-compat alias — always light
export const C = lightC;

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  const themeMode = usePreferencesStore((s) => s.themeMode);
  if (themeMode === "light") return lightC;
  if (themeMode === "dark") return darkC;
  return scheme === "dark" ? darkC : lightC;
}

/** True when the given theme object is the dark palette */
export function isDark(C: ThemeColors): boolean {
  return C === darkC;
}

const OPACITY_MAP = [1, 0.5, 0.22, 0.08, 0.03] as const;

export function lineOpacity(distance: number): number {
  return OPACITY_MAP[Math.min(Math.abs(distance), OPACITY_MAP.length - 1)];
}
