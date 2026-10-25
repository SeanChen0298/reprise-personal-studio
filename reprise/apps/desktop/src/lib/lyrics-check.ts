/**
 * lyrics-check.ts
 *
 * Checks the lyrics against the song itself:
 *  - singing that no lyric line covers (a missing line, or a repeat the lyrics leave out)
 *  - lines with no singing under them (an extra line, or the timing is off)
 *  - lines the alignment couldn't place confidently
 * Singing comes from the vocal map (pitch of the vocal stem); WhisperX's
 * transcript, when there is one, suggests the words for a gap.
 */

import type { Line } from "../types/song";
import type { Phrase } from "./vocal-map";

export interface LyricsGap {
  /** Stable id for dismissing (rounded start). */
  key: string;
  startMs: number;
  endMs: number;
  /** Seconds of actual singing inside the gap. */
  singingMs: number;
  /** The line the gap comes after (null = before the first line). */
  afterLineId: string | null;
  /** What WhisperX heard there, if it ran. */
  heard?: string;
}

export interface LyricsCheck {
  /**
   * The lyrics' timing as a whole is off from this audio (e.g. lyrics timed to
   * the album version, the video has an intro): shift every line by `ms`.
   */
  offset?: { ms: number; fitBefore: number; fitAfter: number };
  gaps: LyricsGap[];
  /** Line id → why it's flagged. */
  lines: Map<string, "silent" | "unsure">;
}

/** Singing this long with no line over it counts as a gap. */
const MIN_GAP_SINGING_MS = 3000;
/** Pieces of uncovered singing closer than this join into one gap. */
const JOIN_MS = 2000;
/** Lines' own edges are a bit loose. */
const LINE_PAD_MS = 400;
/** Search range / step for a whole-song timing offset. */
const OFFSET_RANGE_MS = 30000;
const OFFSET_STEP_MS = 100;

/**
 * The shift of all lines that best puts them over singing. Score = average
 * share of each line's span that has singing under it.
 */
export function bestOffset(spans: { start: number; end: number }[], singing: Phrase[]): { ms: number; fitBefore: number; fitAfter: number } {
  const end = Math.max(...singing.map((p) => p.endMs), ...spans.map((s) => s.end)) + OFFSET_RANGE_MS;
  const frames = Math.ceil(end / OFFSET_STEP_MS) + 1;
  // Singing per 100 ms bucket (fraction), then a running sum.
  const cover = new Float64Array(frames);
  for (const p of singing) {
    for (let t = p.startMs; t < p.endMs; t += 10) cover[Math.floor(t / OFFSET_STEP_MS)] += 10 / OFFSET_STEP_MS;
  }
  const cum = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) cum[i + 1] = cum[i] + Math.min(1, cover[i]);
  const share = (a: number, b: number) => {
    const i = Math.max(0, Math.min(frames, Math.round(a / OFFSET_STEP_MS)));
    const j = Math.max(0, Math.min(frames, Math.round(b / OFFSET_STEP_MS)));
    return j > i ? (cum[j] - cum[i]) / (j - i) : 0;
  };
  const fit = (off: number) => spans.reduce((sum, s) => sum + share(s.start + off, s.end + off), 0) / spans.length;
  const fitBefore = fit(0);
  let ms = 0;
  let fitAfter = fitBefore;
  for (let off = -OFFSET_RANGE_MS; off <= OFFSET_RANGE_MS; off += OFFSET_STEP_MS) {
    const f = fit(off);
    if (f > fitAfter + 1e-9) {
      fitAfter = f;
      ms = off;
    }
  }
  return { ms, fitBefore, fitAfter };
}

/** Below this the alignment wasn't sure of the line. */
export const UNSURE_CONFIDENCE = 0.6;

function lineSpans(lines: Line[]): { line: Line; start: number; end: number }[] {
  const timed = lines.filter((l) => l.start_ms != null);
  return timed.map((l, i) => {
    const next = timed[i + 1];
    const end = l.end_ms ?? (next?.start_ms != null ? next.start_ms : l.start_ms! + 4000);
    return { line: l, start: l.start_ms!, end: Math.max(end, l.start_ms! + 200) };
  });
}

export function checkLyrics(
  lines: Line[],
  singing: Phrase[] | null,
  heard: [number, number, string][] | null,
  dismissed: ReadonlySet<string> = new Set(),
): LyricsCheck {
  const out: LyricsCheck = { gaps: [], lines: new Map() };
  for (const l of lines) {
    if (l.align_confidence != null && l.align_confidence < UNSURE_CONFIDENCE && !dismissed.has(`line:${l.id}`)) {
      out.lines.set(l.id, "unsure");
    }
  }

  const spans = lineSpans(lines);
  // Checking singing only means something once most lines have timing.
  if (!singing || singing.length === 0 || spans.length < Math.max(3, lines.length * 0.6)) return out;

  // Is the whole thing shifted? Then fix that first — gaps / silent lines would just be noise.
  if (spans.length >= 5 && !dismissed.has("offset")) {
    const off = bestOffset(spans, singing);
    if (Math.abs(off.ms) >= 300 && off.fitAfter - off.fitBefore >= 0.08) {
      out.offset = off;
      return out;
    }
  }

  // Covered time, merged.
  const covered: [number, number][] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const a = s.start - LINE_PAD_MS;
    const b = s.end + LINE_PAD_MS;
    const last = covered[covered.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else covered.push([a, b]);
  }

  // Singing outside the covered time.
  const pieces: [number, number][] = [];
  for (const p of singing) {
    let cur = p.startMs;
    for (const [a, b] of covered) {
      if (b <= cur) continue;
      if (a >= p.endMs) break;
      if (a > cur) pieces.push([cur, Math.min(a, p.endMs)]);
      cur = Math.max(cur, b);
      if (cur >= p.endMs) break;
    }
    if (cur < p.endMs) pieces.push([cur, p.endMs]);
  }

  const groups: { start: number; end: number; singing: number }[] = [];
  for (const [a, b] of pieces) {
    const g = groups[groups.length - 1];
    if (g && a - g.end <= JOIN_MS) {
      g.end = b;
      g.singing += b - a;
    } else groups.push({ start: a, end: b, singing: b - a });
  }

  for (const g of groups) {
    if (g.singing < MIN_GAP_SINGING_MS) continue;
    const key = `gap:${Math.round(g.start / 1000)}`;
    if (dismissed.has(key)) continue;
    let after: Line | null = null;
    for (const s of spans) if (s.start <= g.start) after = s.line;
    const words = (heard ?? [])
      .filter(([a, b]) => {
        const mid = (a + b) / 2;
        return mid >= g.start - 500 && mid <= g.end + 500;
      })
      .map(([, , t]) => t.trim())
      .filter(Boolean);
    out.gaps.push({
      key,
      startMs: g.start,
      endMs: g.end,
      singingMs: g.singing,
      afterLineId: after?.id ?? null,
      heard: words.length ? words.join(" ") : undefined,
    });
  }

  // Lines with (almost) no singing under them.
  for (const s of spans) {
    const len = s.end - s.start;
    if (len < 1000 || out.lines.has(s.line.id) || dismissed.has(`line:${s.line.id}`)) continue;
    let sung = 0;
    for (const p of singing) {
      if (p.endMs <= s.start) continue;
      if (p.startMs >= s.end) break;
      sung += Math.min(p.endMs, s.end) - Math.max(p.startMs, s.start);
    }
    if (sung < len * 0.1) out.lines.set(s.line.id, "silent");
  }
  return out;
}

/** Dismissed checks per song ("not lyrics", "timing is fine") — a per-machine convenience. */
const STORE_KEY = "reprise-lyrics-check-dismissed";

export function loadDismissed(songId: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string[]>;
    return new Set(all[songId] ?? []);
  } catch {
    return new Set();
  }
}

export function saveDismissed(songId: string, keys: Set<string>) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string[]>;
    all[songId] = [...keys];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
