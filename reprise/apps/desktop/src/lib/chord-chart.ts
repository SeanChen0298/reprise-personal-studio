/**
 * chord-chart.ts
 *
 * Import a chord chart the player trusts (pasted text) and line it up with
 * the song. Understands:
 *   - chords above lyrics (U-Fret / Ultimate Guitar text):
 *         Dmaj7      C#m7
 *         あなたは夕日に溶けて
 *   - inline brackets (ChordPro):  [Dmaj7]あなたは[C#m7]夕日に溶けて
 *   - chords only:  | Dmaj7 | C#m7 | F#m7 Em7 |
 *
 * Lyric charts are anchored on the app's timed lyric lines (matched by text,
 * in order, so repeated choruses land on the right occurrence); each chord
 * goes to the time of the syllable it sits over, snapped to the beat grid.
 * Chord-only charts are aligned with the detected chord sequence by shared
 * notes. The result is a list of chord spans to save as one undoable edit.
 */

import type { ChordAnalysis } from "./chord-analysis";
import { canonicalChord, parseChordLabel, QUALITY_INTERVALS } from "./chord-shapes";
import type { Line } from "../types/song";

export interface ChartLine {
  lyric: string | null;                       // null for a chord-only line
  chords: { label: string; at: number }[];    // at = character index in the lyric
}

export interface ChartSpan { start_ms: number; end_ms: number; label: string }

export interface ChartPlacement {
  spans: ChartSpan[];
  mode: "lyrics" | "chords-only";
  chartLines: number;           // lyric lines (or chords, for chord-only) in the chart
  matchedLines: number;         // how many found a place in the song
  unmatched: string[];          // chart lyric lines that couldn't be placed
  unknownChords: string[];      // tokens that looked like chords but couldn't be read
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Read one chord token ("C#m7", "DM7(9)", "Bm7-5", "C/E" …) into a canonical label, or null. */
export function readChordToken(token: string): string | null {
  let t = token.trim().replace(/[|()[\]]/g, (c) => (c === "(" || c === ")" ? c : ""));
  if (!t) return null;
  if (/^(N\.?C\.?|NC)$/i.test(t)) return "N";
  t = t.replace(/\/[A-G][#b♯♭]?$/, "");          // slash bass: keep the chord
  t = t.replace(/m7-5$/, "m7b5").replace(/m7\(-5\)$/, "m7b5");
  const canonical = canonicalChord(t);
  return parseChordLabel(canonical) ? canonical : null;
}

/** Display width of a character in a monospaced chart (full-width CJK = 2). */
function charWidth(ch: string): number {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
}

/** Character index in `lyric` that sits under display column `col`. */
function columnToIndex(lyric: string, col: number): number {
  const chars = Array.from(lyric);
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    if (width >= col) return i;
    width += charWidth(chars[i]);
  }
  return chars.length;
}

/** Tokens and their display columns on a line. */
function tokensWithColumns(line: string): { token: string; col: number }[] {
  const out: { token: string; col: number }[] = [];
  let col = 0;
  let current = "";
  let start = 0;
  for (const ch of Array.from(line)) {
    if (/\s/.test(ch)) {
      if (current) { out.push({ token: current, col: start }); current = ""; }
    } else {
      if (!current) start = col;
      current += ch;
    }
    col += ch === "\t" ? 4 : charWidth(ch);
  }
  if (current) out.push({ token: current, col: start });
  return out;
}

/** A line made (almost) entirely of chord tokens and bar marks. */
function isChordLine(line: string): boolean {
  const tokens = tokensWithColumns(line).map((t) => t.token).filter((t) => !/^[|:%\-/.]+$/.test(t));
  if (tokens.length === 0) return false;
  const chords = tokens.filter((t) => readChordToken(t) != null).length;
  return chords / tokens.length >= 0.8;
}

export function parseChart(text: string): { lines: ChartLine[]; unknown: string[] } {
  const raw = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const lines: ChartLine[] = [];
  const unknown = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (!line.trim()) continue;

    // A line of only bracketed words that aren't chords is a section title: [Verse], [Chorus].
    const bracketed = line.match(/\[([^\]]+)\]/g);
    if (bracketed && !line.replace(/\[[^\]]+\]/g, "").trim() &&
        bracketed.every((b) => readChordToken(b.slice(1, -1)) == null)) {
      continue;
    }

    // Inline brackets: [C]lyric[G]lyric
    if (/\[[^\]]+\]/.test(line)) {
      const chords: { label: string; at: number }[] = [];
      let lyric = "";
      for (const part of line.split(/(\[[^\]]+\])/)) {
        const m = /^\[([^\]]+)\]$/.exec(part);
        if (m) {
          const label = readChordToken(m[1]);
          if (label) chords.push({ label, at: Array.from(lyric).length });
          else unknown.add(m[1]);
        } else {
          lyric += part;
        }
      }
      lines.push({ lyric: lyric.trim() ? lyric : null, chords });
      continue;
    }

    if (isChordLine(line)) {
      const next = raw[i + 1];
      const tokens = tokensWithColumns(line).filter((t) => !/^[|:%\-/.]+$/.test(t.token));
      if (next && next.trim() && !isChordLine(next) && !/\[[^\]]+\]/.test(next)) {
        // Chords above a lyric line.
        const chords = tokens.flatMap((t) => {
          const label = readChordToken(t.token);
          if (!label) { unknown.add(t.token); return []; }
          return [{ label, at: columnToIndex(next, t.col) }];
        });
        lines.push({ lyric: next, chords });
        i++;
      } else {
        // Chord-only line.
        const chords = tokens.flatMap((t, k) => {
          const label = readChordToken(t.token);
          if (!label) { unknown.add(t.token); return []; }
          return [{ label, at: k }];
        });
        lines.push({ lyric: null, chords });
      }
    }
    // Any other line (section titles, plain lyrics without chords) is skipped.
  }
  return { lines, unknown: [...unknown] };
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 2·LCS / (|a| + |b|): 1 = same text, 0 = nothing in common. */
function similarity(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  if (!x.length || !y.length) return 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return (2 * prev[y.length]) / (x.length + y.length);
}

const MIN_LINE_MATCH = 0.5;

/** Match chart lyric lines to song lines in order (repeats resolve by position). */
function matchLines(chart: string[], song: string[]): (number | null)[] {
  const n = chart.length, m = song.length;
  const sim = chart.map((c) => song.map((s) => similarity(c, s)));
  // dp[i][j] = best total similarity matching chart[0..i) within song[0..j)
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const take = sim[i - 1][j - 1] >= MIN_LINE_MATCH ? dp[i - 1][j - 1] + sim[i - 1][j - 1] : -Infinity;
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], take);
    }
  }
  const match: (number | null)[] = new Array(n).fill(null);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const s = sim[i - 1][j - 1];
    if (s >= MIN_LINE_MATCH && dp[i][j] === dp[i - 1][j - 1] + s) { match[i - 1] = j - 1; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  return match;
}

function nearestBeat(beats: number[], t: number): number {
  if (!beats.length) return t;
  let best = beats[0];
  for (const b of beats) {
    if (Math.abs(b - t) < Math.abs(best - t)) best = b;
    if (b > t + 2000) break;
  }
  return best;
}

function pitchClasses(label: string): number[] {
  const p = parseChordLabel(label);
  return p ? QUALITY_INTERVALS[p.quality].map((iv) => (p.pc + iv) % 12) : [];
}

function chordDistance(a: string, b: string): number {
  if (a === b) return 0;
  const x = pitchClasses(a), y = pitchClasses(b);
  if (!x.length || !y.length) return 1;
  const shared = x.filter((pc) => y.includes(pc)).length;
  return 1 - shared / new Set([...x, ...y]).size;
}

/** Turn time-ordered chord changes into spans (each lasts until the next change). */
function eventsToSpans(events: { t: number; label: string }[], lastEnd: number): ChartSpan[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const spans: ChartSpan[] = [];
  sorted.forEach((e, k) => {
    const end = k + 1 < sorted.length ? sorted[k + 1].t : lastEnd;
    if (end > e.t) spans.push({ start_ms: e.t, end_ms: end, label: e.label });
  });
  return spans;
}

export function placeChart(text: string, analysis: ChordAnalysis, songLines: Line[]): ChartPlacement {
  const { lines, unknown } = parseChart(text);
  const beats = analysis.beats_ms ?? [];
  const lyricLines = lines.filter((l) => l.lyric != null && l.chords.length > 0);

  if (lyricLines.length > 0) {
    const timed = songLines.filter((l) => l.start_ms != null && l.end_ms != null && l.end_ms > l.start_ms);
    const match = matchLines(
      lyricLines.map((l) => normalise(l.lyric!)),
      timed.map((l) => normalise(l.custom_text ?? l.text)),
    );
    const events: { t: number; label: string }[] = [];
    let lastEnd = 0;
    lyricLines.forEach((cl, k) => {
      const j = match[k];
      if (j == null) return;
      const line = timed[j];
      const chartLen = Math.max(1, Array.from(cl.lyric!).length);
      const dur = line.end_ms! - line.start_ms!;
      for (const c of cl.chords) {
        const t = line.start_ms! + (Math.min(c.at, chartLen) / chartLen) * dur;
        events.push({ t: nearestBeat(beats, t), label: c.label });
      }
      lastEnd = Math.max(lastEnd, line.end_ms!);
    });
    // De-duplicate changes that snapped onto the same beat (keep the later one).
    const byTime = new Map<number, string>();
    for (const e of events) byTime.set(e.t, e.label);
    const spans = eventsToSpans([...byTime].map(([t, label]) => ({ t, label })), nearestBeat(beats, lastEnd));
    return {
      spans,
      mode: "lyrics",
      chartLines: lyricLines.length,
      matchedLines: match.filter((m) => m != null).length,
      unmatched: lyricLines.filter((_, k) => match[k] == null).map((l) => l.lyric!),
      unknownChords: unknown,
    };
  }

  // Chord-only chart: align its sequence with the detected chords.
  const chart = lines.flatMap((l) => l.chords.map((c) => c.label));
  const detected = (analysis.chords ?? []).filter((c) => c.label !== "N");
  const n = detected.length, m = chart.length;
  if (!n || !m) {
    return { spans: [], mode: "chords-only", chartLines: m, matchedLines: 0, unmatched: [], unknownChords: unknown };
  }
  // dp[i][j]: detected[0..i] covered, detected[i] assigned chart[j]. Each
  // detected chord takes the chart chord it's on or the next one; skipping a
  // chart chord is allowed at a cost.
  const INF = 1e9, SKIP = 0.8;
  const dp = Array.from({ length: n }, () => new Array(m).fill(INF));
  const from = Array.from({ length: n }, () => new Array(m).fill(-1));
  for (let j = 0; j < m; j++) dp[0][j] = chordDistance(detected[0].label, chart[j]) + j * SKIP;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const cost = chordDistance(detected[i].label, chart[j]);
      for (const [pj, extra] of [[j, 0], [j - 1, 0], [j - 2, SKIP]] as const) {
        if (pj < 0 || dp[i - 1][pj] >= INF) continue;
        const c = dp[i - 1][pj] + cost + extra;
        if (c < dp[i][j]) { dp[i][j] = c; from[i][j] = pj; }
      }
    }
  }
  let j = dp[n - 1].indexOf(Math.min(...dp[n - 1]));
  const assigned = new Array(n);
  for (let i = n - 1; i >= 0; i--) { assigned[i] = chart[j]; j = from[i][j]; }
  const spans = detected.map((c, i) => ({ start_ms: c.start_ms, end_ms: c.end_ms, label: assigned[i] as string }));
  return {
    spans,
    mode: "chords-only",
    chartLines: m,
    matchedLines: new Set(assigned).size,
    unmatched: [],
    unknownChords: unknown,
  };
}
