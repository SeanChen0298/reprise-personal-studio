import { useColorScheme } from "react-native";
import { usePrefsStore } from "../stores/prefs-store";
import { useLibraryStore } from "../stores/library-store";

/** Same accents as the desktop (Settings → Preferences → Theme). */
export const ACCENTS: Record<string, { light: string; dark: string; soft: string; softDark: string; text: string }> = {
  blue: { light: "#2563EB", dark: "#60A5FA", soft: "#EFF6FF", softDark: "#172554", text: "#1D4ED8" },
  midnight: { light: "#111111", dark: "#E5E7EB", soft: "#F5F5F5", softDark: "#262626", text: "#111111" },
  violet: { light: "#7C3AED", dark: "#A78BFA", soft: "#F5F3FF", softDark: "#2E1065", text: "#6D28D9" },
  emerald: { light: "#059669", dark: "#34D399", soft: "#ECFDF5", softDark: "#022C22", text: "#047857" },
  red: { light: "#DC2626", dark: "#F87171", soft: "#FEF2F2", softDark: "#450A0A", text: "#B91C1C" },
  amber: { light: "#D97706", dark: "#FBBF24", soft: "#FFFBEB", softDark: "#451A03", text: "#B45309" },
};

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderSubtle: string;
  text: string;
  textSecondary: string;
  muted: string;
  /** Accent (buttons, the current line). */
  theme: string;
  /** Soft accent background (chips, the current line's band). */
  themeSoft: string;
  themeText: string;
  /** Primary button background / text. */
  accent: string;
  onAccent: string;
  danger: string;
  voice: string;
  voiceSoft: string;
}

const LIGHT = {
  bg: "#F9F9F9",
  surface: "#FFFFFF",
  raised: "#FFFFFF",
  border: "#E4E4E4",
  borderSubtle: "#EFEFEF",
  text: "#111111",
  textSecondary: "#555555",
  muted: "#999999",
  danger: "#DC2626",
  voice: "#6D28D9",
  voiceSoft: "#F5F3FF",
};

const DARK = {
  bg: "#0C0C10",
  surface: "#15151C",
  raised: "#1C1C24",
  border: "#2A2A33",
  borderSubtle: "#1F1F27",
  text: "#F3F4F6",
  textSecondary: "#B4B7BF",
  muted: "#7B7F8A",
  danger: "#F87171",
  voice: "#C4B5FD",
  voiceSoft: "#C4B5FD22",
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode = usePrefsStore((s) => s.themeMode);
  const picked = usePrefsStore((s) => s.accent);
  const desktopTheme = useLibraryStore((s) => s.snapshot?.theme);
  const dark = mode === "dark" || (mode === "auto" && scheme === "dark");
  const a = ACCENTS[picked ?? desktopTheme ?? "blue"] ?? ACCENTS.blue;
  const base = dark ? DARK : LIGHT;
  const theme = dark ? a.dark : a.light;
  return {
    dark,
    ...base,
    theme,
    // A quiet tint in the dark (a solid deep colour shouts).
    themeSoft: dark ? `${a.dark}1F` : a.soft,
    themeText: dark ? a.dark : a.text,
    accent: dark ? "#F3F4F6" : "#111111",
    onAccent: dark ? "#111111" : "#FFFFFF",
  };
}

export const SERIF = "serif";
