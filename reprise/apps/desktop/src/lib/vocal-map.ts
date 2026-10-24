// Vocal map — where the original singer sings, breathes and goes high.
//
// Built from the reference vocal's torchcrepe pitch data (10 ms frames). A run
// of confidently-pitched frames is a sung phrase; a gap long enough to inhale
// in is a breath point. Frames near the top of the song's range are "high
// moments". Everything here is reference-only; take-analysis.ts compares a
// user's take against it.

import { freqToSemitone, type PitchPoint } from "./audio-analysis";
import { characterTimes } from "./lyric-timing";
import type { Line } from "../types/song";

export const HOP_MS = 10;

const MIN_CONFIDENCE = 0.6;
const MIN_FREQ = 65; // C2
const MAX_FREQ = 1100; // ~C6
/** Unvoiced gaps shorter than this are consonants, not breaths. */
const CONSONANT_GAP_MS = 120;
/** Voiced blips shorter than this are noise. */
const MIN_VOICED_MS = 80;
/** A breath point shorter than this is a "catch breath" — easy to miss. */
const QUICK_BREATH_MS = 450;
/** Phrases at least this long need planned breath support. */
export const LONG_PHRASE_MS = 6000;
/** Longer "phrases" are backing vocals / reverb joining several lines — not something to warn about. */
const MAX_PLAUSIBLE_PHRASE_MS = 15000;
/** A gap inside a line has to be this long to be a breath (shorter ones are consonants and note gaps). */
const MID_LINE_BREATH_MS = 280;
const MAX_MID_LINE_BREATHS = 2;
/** High moments shorter than this are passing notes. */
const MIN_HIGH_MS = 150;

export interface Phrase {
  startMs: number;
  endMs: number;
}

export interface BreathPoint {
  /** Where the singer stops (gap start) and comes back in (gap end). */
  startMs: number;
  endMs: number;
  quick: boolean;
  /** Found from a loudness dip in the stem rather than a gap in the singing. */
  inferred?: boolean;
}

export interface HighMoment {
  startMs: number;
  endMs: number;
  /** Highest (median-smoothed) semitone in the moment, MIDI numbering. */
  peakSemitone: number;
}

export interface VocalMap {
  /** Per-frame reference semitone, NaN where the singer isn't singing. */
  semitones: Float32Array;
  /** Vocal stem loudness per frame (dB), when the stem was available. */
  stemDb?: Float32Array;
  /** Median stem loudness while singing. */
  stemTypicalDb?: number;
  phrases: Phrase[];
  breaths: BreathPoint[];
  highMoments: HighMoment[];
  /** Semitone at/above which a note counts as high for this song. */
  highThreshold: number;
  lowSemitone: number;
  topSemitone: number;
}

export interface LineVocalInfo {
  /** Longest reference phrase that overlaps the line. */
  longestPhraseMs: number;
  /** The breath right before the line starts, if the singer takes one. */
  breathBefore: BreathPoint | null;
  /** Breaths inside the line: `pos` = character index in the display text the breath comes before. */
  midBreaths: { pos: number; breath: BreathPoint }[];
  highMoments: HighMoment[];
  peakSemitone: number | null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function semitoneToNoteName(semitone: number): string {
  const n = Math.round(semitone);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Runs of `true` in a mask as [startFrame, endFrame) pairs. */
export function runs(mask: ArrayLike<boolean | number>): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && !!mask[i];
    if (on && start < 0) start = i;
    else if (!on && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

/** Fill short gaps, then drop short runs — turns a noisy voiced mask into phrases. */
export function cleanMask(mask: Uint8Array, maxGapFrames: number, minRunFrames: number): Uint8Array {
  const out = mask.slice();
  const on = runs(out);
  for (let i = 1; i < on.length; i++) {
    const gap = on[i][0] - on[i - 1][1];
    if (gap < maxGapFrames) out.fill(1, on[i - 1][1], on[i][0]);
  }
  for (const [s, e] of runs(out)) if (e - s < minRunFrames) out.fill(0, s, e);
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * @param stemDb Optional loudness of the vocal stem per 10 ms frame. Reverb keeps
 *   the pitch tracker confident after the singer has stopped; with the stem's
 *   loudness we trim those tails so phrase ends land where the voice really stops.
 */
export function buildVocalMap(points: PitchPoint[], stemDb?: Float32Array): VocalMap {
  const n = points.length;
  const semitones = new Float32Array(n).fill(NaN);
  const voiced = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (p.confidence >= MIN_CONFIDENCE && p.freq_hz >= MIN_FREQ && p.freq_hz <= MAX_FREQ) {
      voiced[i] = 1;
      semitones[i] = freqToSemitone(p.freq_hz);
    }
  }

  let stemTypicalDb: number | undefined;
  if (stemDb) {
    // torchcrepe normalises each frame, so it stays "confident" on near-silent
    // residue in the stem. Frames far below the singer's typical level aren't singing.
    const levels: number[] = [];
    for (let i = 0; i < n && i < stemDb.length; i++) if (voiced[i]) levels.push(stemDb[i]);
    levels.sort((a, b) => a - b);
    stemTypicalDb = percentile(levels, 0.5);
    const gate = stemTypicalDb - 30;
    for (let i = 0; i < n; i++) {
      if (voiced[i] && !(stemDb[i] >= gate)) {
        voiced[i] = 0;
        semitones[i] = NaN;
      }
    }
  }

  const phraseMask = cleanMask(voiced, CONSONANT_GAP_MS / HOP_MS, MIN_VOICED_MS / HOP_MS);
  if (stemDb) trimTails(phraseMask, stemDb);
  const phrases = runs(phraseMask).map(([s, e]) => ({ startMs: s * HOP_MS, endMs: e * HOP_MS }));

  const breaths: BreathPoint[] = [];
  for (let i = 1; i < phrases.length; i++) {
    const startMs = phrases[i - 1].endMs;
    const endMs = phrases[i].startMs;
    breaths.push({ startMs, endMs, quick: endMs - startMs < QUICK_BREATH_MS });
  }

  // Range from frames inside phrases only (drops stray octave errors in gaps).
  const sung: number[] = [];
  for (let i = 0; i < n; i++) if (phraseMask[i] && voiced[i]) sung.push(semitones[i]);
  sung.sort((a, b) => a - b);
  const lowSemitone = percentile(sung, 0.02);
  const topSemitone = percentile(sung, 0.995);
  // "High" = the top ~10% of what's sung, but never more than 5 semitones below the top note.
  const highThreshold = Math.max(percentile(sung, 0.9), topSemitone - 5);

  // Median-smooth before thresholding so vibrato / scoops don't fragment moments.
  const smooth = medianFilter(semitones, 7);
  const highMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (phraseMask[i] && smooth[i] >= highThreshold) highMask[i] = 1;
  const highMoments: HighMoment[] = [];
  for (const [s, e] of runs(cleanMask(highMask, 10, MIN_HIGH_MS / HOP_MS))) {
    let peak = -Infinity;
    for (let i = s; i < e; i++) if (smooth[i] > peak) peak = smooth[i];
    highMoments.push({ startMs: s * HOP_MS, endMs: e * HOP_MS, peakSemitone: peak });
  }

  return { semitones, stemDb, stemTypicalDb, phrases, breaths, highMoments, highThreshold, lowSemitone, topSemitone };
}

/** Within each phrase, drop leading/trailing frames far quieter than the phrase body. */
function trimTails(mask: Uint8Array, db: Float32Array) {
  for (const [s, e] of runs(mask)) {
    const body: number[] = [];
    for (let i = s; i < e && i < db.length; i++) body.push(db[i]);
    if (body.length < 10) continue;
    body.sort((a, b) => a - b);
    const cut = body[body.length >> 1] - 12;
    let a = s;
    let b = Math.min(e, db.length);
    while (b - a > 8 && db[b - 1] < cut) b--;
    while (b - a > 8 && db[a] < cut) a++;
    mask.fill(0, s, a);
    mask.fill(0, b, e);
  }
}

/** Running median over `width` frames, ignoring NaN. */
export function medianFilter(values: Float32Array, width: number): Float32Array {
  const out = new Float32Array(values.length).fill(NaN);
  const half = Math.floor(width / 2);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    buf.length = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (!Number.isNaN(values[j])) buf.push(values[j]);
    }
    buf.sort((a, b) => a - b);
    out[i] = buf[buf.length >> 1];
  }
  return out;
}

/** The deepest loudness dip in [fromMs, toMs] if it's ≥ 8 dB below its surroundings. */
function loudnessDip(db: Float32Array, fromMs: number, toMs: number): BreathPoint | null {
  const a = Math.max(0, Math.round(fromMs / HOP_MS));
  const b = Math.min(db.length, Math.round(toMs / HOP_MS));
  if (b - a < 10) return null;
  // Smooth over 50 ms so a single quiet frame doesn't count.
  const smooth = (i: number) => {
    let sum = 0;
    let n = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < db.length) (sum += db[k]), n++;
    return sum / n;
  };
  let minAt = a;
  let min = Infinity;
  for (let i = a; i < b; i++) {
    const v = smooth(i);
    if (v < min) {
      min = v;
      minAt = i;
    }
  }
  const around: number[] = [];
  for (let i = Math.max(0, minAt - 100); i < Math.min(db.length, minAt + 100); i++) {
    if (Math.abs(i - minAt) > 15) around.push(db[i]);
  }
  around.sort((x, y) => x - y);
  const level = around[Math.floor(around.length * 0.6)];
  if (!(level - min >= 8)) return null;
  return { startMs: (minAt - 5) * HOP_MS, endMs: (minAt + 5) * HOP_MS, quick: true, inferred: true };
}

/** Summarise the vocal map for one timed line (`text` = the text as displayed). */
export function lineVocalInfo(map: VocalMap, line: Line, text: string): LineVocalInfo | null {
  if (line.start_ms == null || line.end_ms == null || line.end_ms <= line.start_ms) return null;
  const s = line.start_ms;
  const e = line.end_ms;
  let longestPhraseMs = 0;
  for (const p of map.phrases) {
    const len = p.endMs - p.startMs;
    if (p.endMs > s && p.startMs < e && len <= MAX_PLAUSIBLE_PHRASE_MS) longestPhraseMs = Math.max(longestPhraseMs, len);
  }

  // The breath nearest the line's start — lyric timing is approximate, so allow
  // the gap to sit a little either side of it.
  let breathBefore: BreathPoint | null = null;
  let bestDist = Infinity;
  for (const b of map.breaths) {
    if (b.endMs < s - 800 || b.startMs > s + 400) continue;
    const dist = Math.abs(b.endMs - s);
    if (dist < bestDist) {
      bestDist = dist;
      breathBefore = b;
    }
  }

  // No clear gap (lines sung legato, or reverb / backing vocals filling it): a
  // sharp dip in the stem's loudness near the start is almost always a catch-breath.
  if (!breathBefore && map.stemDb) breathBefore = loudnessDip(map.stemDb, s - 700, s + 300);

  // Breaths taken inside the line, placed between the characters around them.
  const chars = Array.from(text);
  const times = chars.length ? characterTimes(line, chars.length) : [];
  const midBreaths: { pos: number; breath: BreathPoint }[] = [];
  for (const b of map.breaths) {
    if (b === breathBefore || b.startMs <= s + 300 || b.startMs >= e - 150) continue;
    if (b.endMs - b.startMs < MID_LINE_BREATH_MS || midBreaths.length >= MAX_MID_LINE_BREATHS) continue;
    let pos = times.findIndex((t) => t >= b.startMs);
    if (pos <= 0 || pos >= chars.length) continue;
    // Prefer a word boundary within a couple of characters.
    for (const d of [0, -1, 1, -2, 2]) {
      const k = pos + d;
      if (k > 0 && k < chars.length && /[\s、。,.!?！？]/.test(chars[k - 1])) {
        pos = k;
        break;
      }
    }
    // Back to a UTF-16 index for slicing the string.
    midBreaths.push({ pos: chars.slice(0, pos).join("").length, breath: b });
  }

  const highMoments = map.highMoments.filter((h) => h.endMs > s && h.startMs < e);
  const peakSemitone = highMoments.length ? Math.max(...highMoments.map((h) => h.peakSemitone)) : null;
  return { longestPhraseMs, breathBefore, midBreaths, highMoments, peakSemitone };
}
