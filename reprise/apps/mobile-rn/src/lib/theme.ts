import { useColorScheme } from "react-native";
import { usePreferencesStore } from "../stores/preferences-store";
import type { AccentKey } from "../stores/preferences-store";

export type ThemeColors = {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  theme: string;
  accent: string;
  dark: boolean;
};

// Accent palettes: light color, dark color
const ACCENT: Record<AccentKey, { light: string; dark: string }> = {
  blue:     { light: "#2563EB", dark: "#60A5FA" },
  midnight: { light: "#374151", dark: "#9CA3AF" },
  violet:   { light: "#7C3AED", dark: "#818CF8" },
  emerald:  { light: "#059669", dark: "#34D399" },
  red:      { light: "#DC2626", dark: "#F87171" },
  amber:    { light: "#D97706", dark: "#FBBF24" },
};

// Dot colors for the picker (always shown at full saturation regardless of dark mode)
export const ACCENT_DOT: Record<AccentKey, string> = {
  blue:     "#2563EB",
  midnight: "#374151",
  violet:   "#7C3AED",
  emerald:  "#059669",
  red:      "#DC2626",
  amber:    "#D97706",
};

const BASE_LIGHT = {
  bg:      "#FAFAF9",
  surface: "#FFFFFF",
  border:  "#EBEBEA",
  text:    "#1C1C1E",
  muted:   "#8E8E93",
  dark:    false,
} as const;

const BASE_DARK = {
  bg:      "#0C0C10",
  surface: "#13131A",
  border:  "#1E1E26",
  text:    "#F3F4F6",
  muted:   "#6B7280",
  dark:    true,
} as const;

function buildTheme(base: typeof BASE_LIGHT | typeof BASE_DARK, key: AccentKey): ThemeColors {
  const color = base.dark ? ACCENT[key].dark : ACCENT[key].light;
  return { ...base, theme: color, accent: color };
}

// Backward-compat alias — violet light
export const lightC: ThemeColors = buildTheme(BASE_LIGHT, "violet");
export const darkC:  ThemeColors = buildTheme(BASE_DARK,  "violet");

// Backward-compat alias — always light violet
export const C = lightC;

export function useTheme(): ThemeColors {
  const scheme    = useColorScheme();
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const accentKey = usePreferencesStore((s) => s.accentKey);

  const isDarkMode =
    themeMode === "dark" ? true :
    themeMode === "light" ? false :
    scheme === "dark";

  return buildTheme(isDarkMode ? BASE_DARK : BASE_LIGHT, accentKey);
}

/** True when the given theme object is the dark palette */
export function isDark(C: ThemeColors): boolean {
  return C.dark;
}

const OPACITY_MAP = [1, 0.5, 0.22, 0.08, 0.03] as const;

export function lineOpacity(distance: number): number {
  return OPACITY_MAP[Math.min(Math.abs(distance), OPACITY_MAP.length - 1)];
}
