// A song's colors, from its artwork color (sent by the computer), tuned for the light / dark theme:
//   wash   the page behind the song (a breath of its color, never dark in light mode)
//   soft   chips / secondary buttons
//   tint   text and icons in the song's color (readable on the page)
//   solid  the main button
import { useMemo } from "react";
import { useLibraryStore } from "../stores/library-store";
import type { Theme } from "./theme";

export interface SongPalette {
  wash: string;
  soft: string;
  tint: string;
  solid: string;
  onSolid: string;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function paletteFor(hex: string | undefined, t: Theme): SongPalette {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    return { wash: t.bg, soft: t.themeSoft, tint: t.themeText, solid: t.theme, onSolid: "#fff" };
  }
  const [h, s0] = hexToHsl(hex);
  // Grey artwork stays grey-ish; colorful artwork keeps a calm version of its hue.
  const s = Math.min(s0, 0.55);
  if (t.dark) {
    return {
      wash: hsl(h, s * 0.5, 0.1),
      soft: hsl(h, s * 0.55, 0.2),
      tint: hsl(h, Math.max(s, 0.25), 0.74),
      solid: hsl(h, Math.max(s, 0.3), 0.66),
      onSolid: "#111111",
    };
  }
  return {
    wash: hsl(h, s * 0.6, 0.965),
    soft: hsl(h, s * 0.7, 0.92),
    tint: hsl(h, Math.max(s, 0.3), 0.34),
    solid: hsl(h, Math.max(s, 0.35), 0.38),
    onSolid: "#ffffff",
  };
}

export function useSongPalette(songId: string | undefined, t: Theme): SongPalette {
  const hex = useLibraryStore((s) => (songId ? s.snapshot?.colors?.[songId] : undefined));
  return useMemo(() => paletteFor(hex, t), [hex, t]);
}

export interface VividLook {
  /** The screen in the song's colour: a theme for everything drawn on it… */
  t: Theme;
  p: SongPalette;
  /** …and its background, a gradient from the top to the bottom. */
  top: string;
  bottom: string;
}

/** The song screen's "Vivid" look: the page is the song's colour (deep, so white lyrics read well). */
export function vividLook(hex: string | undefined, t: Theme): VividLook {
  const [h, s0] = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hexToHsl(hex) : hexToHsl(t.dark ? "#3b4a6b" : "#2f4a8a");
  const s = Math.min(0.7, Math.max(0.18, s0));
  const top = hsl(h, s * 0.85, 0.3);
  const bottom = hsl(h, s * 0.75, 0.12);
  const theme: Theme = {
    ...t,
    dark: true,
    bg: bottom,
    surface: hsl(h, s * 0.55, 0.19),
    raised: hsl(h, s * 0.55, 0.23),
    border: "#FFFFFF2E",
    borderSubtle: "#FFFFFF17",
    text: "#FFFFFF",
    textSecondary: "#FFFFFFD0",
    muted: "#FFFFFF8F",
    theme: "#FFFFFF",
    themeSoft: "#FFFFFF1F",
    themeText: "#FFFFFF",
    accent: "#FFFFFF",
    onAccent: bottom,
    danger: "#FCA5A5",
    voice: "#E9E3FF",
    voiceSoft: "#FFFFFF1F",
  };
  return {
    t: theme,
    p: { wash: bottom, soft: "#FFFFFF22", tint: "#FFFFFF", solid: "#FFFFFF", onSolid: hsl(h, s, 0.24) },
    top,
    bottom,
  };
}
