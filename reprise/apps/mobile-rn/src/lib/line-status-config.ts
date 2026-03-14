import type { LineStatus } from "@reprise/shared";

export const STATUS_CONFIG: Record<
  LineStatus,
  { label: string; tagBg: string; tagColor: string }
> = {
  new:           { label: "New",       tagBg: "#1a1a24", tagColor: "#4a4a60" },
  listened:      { label: "Listened",  tagBg: "#141e2c", tagColor: "#4a6a9a" },
  annotated:     { label: "Annotated", tagBg: "#231a10", tagColor: "#8a6830" },
  practiced:     { label: "Practiced", tagBg: "#231210", tagColor: "#8a4830" },
  recorded:      { label: "Recorded",  tagBg: "#101c14", tagColor: "#3a7a50" },
  best_take_set: { label: "Best take", tagBg: "#1c1810", tagColor: "#7a6030" },
};

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
