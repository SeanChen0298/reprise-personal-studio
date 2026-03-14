export const C = {
  bg:      "#FAFAF9",   // warm off-white — Japanese washi
  surface: "#FFFFFF",   // pure white
  border:  "#EBEBEA",   // warm light separator
  text:    "#1C1C1E",   // near-black
  muted:   "#8E8E93",   // warm medium gray
  theme:   "#5856D6",   // indigo — quiet but present
  accent:  "#5856D6",
} as const;

const OPACITY_MAP = [1, 0.5, 0.22, 0.08, 0.03] as const;

export function lineOpacity(distance: number): number {
  return OPACITY_MAP[Math.min(Math.abs(distance), OPACITY_MAP.length - 1)];
}
