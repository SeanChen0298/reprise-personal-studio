import type { LineStatus } from "../types/song";

// Linear order from lowest to highest achievement
export const STATUS_ORDER: LineStatus[] = [
  "new",
  "listened",
  "annotated",
  "practiced",
  "recorded",
  "best_take_set",
];

export const STATUS_CONFIG: Record<
  LineStatus,
  { dot: string; label: string; tagBg: string; tagColor: string; barColor: string }
> = {
  new:          { dot: "#94A3B8", label: "New",          tagBg: "#F1F5F9", tagColor: "#64748B", barColor: "#CBD5E1" },
  listened:     { dot: "#60A5FA", label: "Listened",     tagBg: "#DBEAFE", tagColor: "#1D4ED8", barColor: "#60A5FA" },
  annotated:    { dot: "#F59E0B", label: "Annotated",    tagBg: "#FEF3C7", tagColor: "#92400E", barColor: "#F59E0B" },
  practiced:    { dot: "#F97316", label: "Practiced",    tagBg: "#FFEDD5", tagColor: "#9A3412", barColor: "#F97316" },
  recorded:     { dot: "#22C55E", label: "Recorded",     tagBg: "#DCFCE7", tagColor: "#15803D", barColor: "#22C55E" },
  best_take_set:{ dot: "#EAB308", label: "Best take",    tagBg: "#FEF9C3", tagColor: "#713F12", barColor: "#EAB308" },
};

/** Only move status forward — never downgrade */
export function upgradeStatus(current: LineStatus, target: LineStatus): LineStatus {
  const currentIdx = STATUS_ORDER.indexOf(current);
  const targetIdx = STATUS_ORDER.indexOf(target);
  return targetIdx > currentIdx ? target : current;
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
