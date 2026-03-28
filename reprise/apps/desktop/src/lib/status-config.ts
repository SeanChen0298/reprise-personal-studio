import type { Line, LineStatus } from "../types/song";

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

/**
 * Tiered weights for song progress calculation.
 * Each tier reflects increasing effort: listened < annotated < practiced < recorded < best_take_set.
 * Max weight per line = 20 (best_take_set).
 */
const PROGRESS_WEIGHTS: Record<LineStatus, number> = {
  new:          0,
  listened:     1,   //  5% of max — first interaction
  annotated:    3,   // 15% of max — engaged with it
  practiced:    7,   // 35% of max — worked it seriously (10+ plays)
  recorded:     13,  // 65% of max — performed attempt
  best_take_set: 20, // 100% of max — perfected
};
const MAX_LINE_WEIGHT = 20;

/**
 * Computes song progress 0–100 from line statuses using tiered weights.
 * Includes all lines, not just best_take_set, so every stage of practice counts.
 */
export function computeSongProgress(lines: Line[]): number {
  if (lines.length === 0) return 0;
  const total = lines.reduce((sum, l) => sum + (PROGRESS_WEIGHTS[l.status] ?? 0), 0);
  return Math.round((total / (lines.length * MAX_LINE_WEIGHT)) * 100);
}

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
