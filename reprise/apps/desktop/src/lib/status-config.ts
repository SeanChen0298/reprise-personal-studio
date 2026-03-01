import type { LineStatus } from "../types/song";

export const STATUS_CONFIG: Record<
  LineStatus,
  { dot: string; label: string; tagBg: string; tagColor: string }
> = {
  mastered: { dot: "#22C55E", label: "Mastered", tagBg: "#DCFCE7", tagColor: "#15803D" },
  learning: { dot: "var(--theme)", label: "Learning", tagBg: "var(--theme-light)", tagColor: "var(--theme-text)" },
  not_started: { dot: "var(--border)", label: "New", tagBg: "#F1F5F9", tagColor: "#64748B" },
};

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_CYCLE: LineStatus[] = ["not_started", "learning", "mastered"];

export function nextStatus(current: LineStatus): LineStatus {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}
