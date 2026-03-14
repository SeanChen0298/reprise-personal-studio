import type { LineStatus } from "@reprise/shared";

export const STATUS_CONFIG: Record<
  LineStatus,
  { label: string; tagBg: string; tagColor: string }
> = {
  new:           { label: "New",       tagBg: "#F1F5F9", tagColor: "#64748B" },
  listened:      { label: "Listened",  tagBg: "#DBEAFE", tagColor: "#1D4ED8" },
  annotated:     { label: "Annotated", tagBg: "#FEF3C7", tagColor: "#92400E" },
  practiced:     { label: "Practiced", tagBg: "#FFEDD5", tagColor: "#9A3412" },
  recorded:      { label: "Recorded",  tagBg: "#DCFCE7", tagColor: "#15803D" },
  best_take_set: { label: "Best take", tagBg: "#FEF9C3", tagColor: "#713F12" },
};

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
