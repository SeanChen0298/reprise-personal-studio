// Fit timed lyrics (LRCLIB's, made for the album version) to this recording's vocals:
//   1. slide all lines by the shift that puts them best over the singing (a video's intro);
//   2. per section, allow a different shift when it clearly fits better (a video edited mid-song);
//   3. start each line where the singing begins, if that's within a moment of its time;
//   4. end each line where the singing stops before the next one (LRCLIB has only starts).
// The lines' spacing — a person's careful timing — is kept; nothing is re-transcribed.

import { bestOffset } from "./lyrics-check";
import type { Phrase } from "./vocal-map";

export interface FitLine {
  id: string;
  order: number;
  start_ms?: number;
  end_ms?: number;
}

export interface FitSection {
  start_line_order: number;
  end_line_order: number;
}

export interface FitResult {
  changes: { lineId: string; start_ms: number; end_ms: number }[];
  /** The whole-song shift applied (ms), and how many sections got their own. */
  offsetMs: number;
  sectionsShifted: number;
}

const SNAP_MS = 400;
const LOCAL_RANGE_MS = 4000;
const LOCAL_STEP_MS = 50;
const TAIL_MS = 120;
const MIN_LINE_MS = 300;

/** Share of [a, b) that has singing under it. */
function coverage(singing: Phrase[], a: number, b: number): number {
  if (b <= a) return 0;
  let sung = 0;
  for (const p of singing) {
    if (p.endMs <= a) continue;
    if (p.startMs >= b) break;
    sung += Math.min(b, p.endMs) - Math.max(a, p.startMs);
  }
  return sung / (b - a);
}

export function fitLyrics(input: FitLine[], sections: FitSection[], singing: Phrase[], songEndMs?: number): FitResult | null {
  const sung = [...singing].sort((a, b) => a.startMs - b.startMs);
  const lines = input.filter((l) => l.start_ms != null).sort((a, b) => a.order - b.order);
  if (lines.length < 5 || !sung.length) return null;
  // Lyrics stored twice (two lines at one position) — fix the lyrics first; don't guess here.
  if (new Set(lines.map((l) => l.order)).size !== lines.length) return null;

  const spanEnd = (i: number, starts: number[]) => Math.min(starts[i + 1] ?? starts[i] + 6000, starts[i] + 12000);
  const starts0 = lines.map((l) => l.start_ms!);
  const spans = starts0.map((s, i) => ({ start: s, end: spanEnd(i, starts0) }));

  // 1. The whole-song shift.
  const g = bestOffset(spans, sung);
  // Same bar as the lyrics check's "Shift all lines": a clear improvement — or a smaller one that
  // agrees with where the voice first comes in (the first line should start with the first singing:
  // a constant shift barely moves the overall fit, but the first entry shows it plainly).
  const entryShift = sung[0].startMs - lines[0].start_ms!;
  const agrees = Math.abs(entryShift) <= 10000 && Math.abs(g.ms - entryShift) <= 800;
  const offsetMs = Math.abs(g.ms) >= 300 && (g.fitAfter - g.fitBefore >= 0.08 || (agrees && g.fitAfter - g.fitBefore >= 0.01)) ? g.ms : 0;
  const starts = starts0.map((s) => s + offsetMs);

  // 2. A section's own shift, when it clearly fits better and keeps the order.
  const fit = (idx: number[], off: number) =>
    idx.reduce((sum, i) => sum + coverage(sung, starts[i] + off, spanEnd(i, starts) + off), 0) / idx.length;
  let sectionsShifted = 0;
  for (const sec of sections) {
    const idx = lines.map((l, i) => (l.order >= sec.start_line_order && l.order <= sec.end_line_order ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 3) continue;
    const base = fit(idx, 0);
    let best = 0;
    let bestFit = base;
    for (let off = -LOCAL_RANGE_MS; off <= LOCAL_RANGE_MS; off += LOCAL_STEP_MS) {
      const f = fit(idx, off);
      if (f > bestFit + 1e-9) {
        bestFit = f;
        best = off;
      }
    }
    if (Math.abs(best) < 300 || bestFit - base < 0.08) continue;
    const first = idx[0];
    const last = idx[idx.length - 1];
    const prevStart = first > 0 ? starts[first - 1] : -Infinity;
    const nextStart = last + 1 < starts.length ? starts[last + 1] : Infinity;
    if (starts[first] + best <= prevStart + MIN_LINE_MS || starts[last] + best >= nextStart - MIN_LINE_MS) continue;
    for (const i of idx) starts[i] += best;
    sectionsShifted++;
  }

  // 3. Start where the singing begins, if it begins within a moment of the line's time.
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    let onset: Phrase | undefined;
    for (const p of sung) {
      if (p.startMs < s - SNAP_MS) continue;
      if (p.startMs > s + SNAP_MS) break;
      if (!onset || Math.abs(p.startMs - s) < Math.abs(onset.startMs - s)) onset = p;
    }
    if (!onset) continue;
    const lo = i > 0 ? starts[i - 1] + MIN_LINE_MS : 0;
    const hi = i + 1 < starts.length ? starts[i + 1] - MIN_LINE_MS : Infinity;
    if (onset.startMs > lo && onset.startMs < hi) starts[i] = onset.startMs;
  }

  // 4. End where the singing stops before the next line.
  const changes: FitResult["changes"] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = Math.max(0, Math.round(starts[i]));
    const limit = i + 1 < starts.length ? starts[i + 1] : Math.min(s + 12000, songEndMs ?? Infinity);
    let end = s;
    for (const p of sung) {
      if (p.startMs >= limit) break;
      if (p.endMs <= s) continue;
      end = Math.max(end, Math.min(limit, p.endMs + TAIL_MS));
    }
    if (end < s + MIN_LINE_MS) end = Math.min(limit, s + Math.max(MIN_LINE_MS, Math.min(4000, limit - s)));
    end = Math.round(Math.max(end, s + MIN_LINE_MS));
    const l = lines[i];
    if (l.start_ms !== s || l.end_ms !== end) changes.push({ lineId: l.id, start_ms: s, end_ms: end });
  }
  // Safety net: only if the lines now sit over the singing at least as well as before.
  const after = new Map(changes.map((c) => [c.lineId, c]));
  const share = (get: (l: FitLine, i: number) => [number, number]) =>
    lines.reduce((sum, l, i) => sum + coverage(sung, ...get(l, i)), 0) / lines.length;
  const before = share((l, i) => [l.start_ms!, l.end_ms ?? spanEnd(i, starts0)]);
  const now = share((l) => {
    const c = after.get(l.id);
    return c ? [c.start_ms, c.end_ms] : [l.start_ms!, l.end_ms ?? l.start_ms! + 4000];
  });
  if (now < before) return null;
  return { changes, offsetMs, sectionsShifted };
}
