// Take review — breath control and high notes for a take sung along with the song.
//
// The take is decoded, then reduced to two 10 ms tracks: loudness (dB) and the
// singer's pitch (YIN). The take is lined up with the song using song_start_ms
// plus a measured latency offset, then compared phrase by phrase against the
// reference vocal map (vocal-map.ts):
//   breath — did the voice stop before the phrase ended, fade out, take an
//            extra breath mid-phrase, or come in late after a quick breath?
//   high   — on the song's high notes: dropped, cracked/flipped, flat/sharp,
//            wobbling, or much louder than usual (pushing)?
// Pitch accuracy elsewhere is deliberately not scored.

import { convertFileSrc } from "@tauri-apps/api/core";
import {
  HOP_MS,
  cleanMask,
  medianFilter,
  semitoneToNoteName,
  type VocalMap,
} from "./vocal-map";
import type { Line, TakeAnalysis, TakeHalfStats, TakeIssue } from "../types/song";

export const ANALYSIS_VERSION = 1;

const SAMPLE_RATE = 24000; // 240 samples per 10 ms frame
const YIN_WINDOW_MS = 25;
const PITCH_HOP_FRAMES = 2; // pitch every 20 ms, held for both 10 ms frames
const MIN_F0 = 80;
const MAX_F0 = 1100;
const YIN_THRESHOLD = 0.15;
const MAX_APERIODICITY = 0.4; // breathy singing still tracks; an inhale (~0.5+) doesn't
/**
 * The reference pitch comes from a stem with reverb and harmonies, so trackers
 * can disagree by ~50 cents on wide-vibrato high notes. Only flag clear misses.
 */
const FLAT_SHARP_CENTS = 65;

/** Lag search window: the voice usually lands late in the recording (output + input latency). */
const LAG_MIN_MS = -300;
const LAG_MAX_MS = 800;

export interface TakeFeatures {
  /** Loudness per 10 ms frame, dBFS. */
  db: Float32Array;
  /** Sung pitch per 10 ms frame as MIDI semitone, NaN when not pitched. */
  semis: Float32Array;
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

export async function decodeToMono(filePath: string): Promise<Float32Array> {
  const buf = await (await fetch(convertFileSrc(filePath))).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(buf);
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  const out = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / decoded.numberOfChannels;
  }
  return out;
}

/** YIN pitch estimate for the window starting at `start`; NaN when unpitched. */
function yin(x: Float32Array, start: number, w: number, tauMin: number, tauMax: number, d: Float32Array): number {
  if (start + w + tauMax >= x.length) return NaN;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const diff = x[start + j] - x[start + j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < min) {
        min = d[tau];
        best = tau;
      }
    }
    if (min > MAX_APERIODICITY) return NaN;
  }
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  let tau = best;
  if (best > tauMin && best < tauMax) {
    const a = d[best - 1];
    const b = d[best];
    const c = d[best + 1];
    const denom = a + c - 2 * b;
    if (denom !== 0) tau = best + (a - c) / (2 * denom);
  }
  return SAMPLE_RATE / tau;
}

export async function extractFeatures(
  samples: Float32Array,
  onProgress?: (fraction: number) => void,
  opts: { pitch?: boolean } = {},
): Promise<TakeFeatures> {
  const hop = (SAMPLE_RATE * HOP_MS) / 1000; // integer at 24 kHz
  const frames = Math.floor(samples.length / hop);
  const db = new Float32Array(frames);
  const win = hop * 2;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const s = f * hop;
    const e = Math.min(samples.length, s + win);
    for (let i = s; i < e; i++) sum += samples[i] * samples[i];
    db[f] = 10 * Math.log10(sum / Math.max(1, e - s) + 1e-12);
  }

  // Only look for pitch where there's clearly sound above the room noise.
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? -20;
  const gate = Math.max(floor + 12, loud - 35);

  const semis = new Float32Array(frames).fill(NaN);
  if (opts.pitch === false) return { db, semis };
  const w = Math.round((SAMPLE_RATE * YIN_WINDOW_MS) / 1000);
  const tauMin = Math.floor(SAMPLE_RATE / MAX_F0);
  const tauMax = Math.ceil(SAMPLE_RATE / MIN_F0);
  const scratch = new Float32Array(tauMax + 2);
  for (let f = 0; f < frames; f += PITCH_HOP_FRAMES) {
    if (db[f] < gate) continue;
    const f0 = yin(samples, f * hop, w, tauMin, tauMax, scratch);
    if (!Number.isNaN(f0)) {
      const semi = 69 + 12 * Math.log2(f0 / 440);
      for (let k = 0; k < PITCH_HOP_FRAMES && f + k < frames; k++) semis[f + k] = semi;
    }
    // Yield to the UI now and then — a full take is ~15k pitch frames.
    if (f % 400 === 0) {
      onProgress?.(f / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  return { db, semis };
}

// ---------------------------------------------------------------------------
// Comparison (pure — no I/O)
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function lineAt(lines: Line[], songMs: number): Line | undefined {
  let best: Line | undefined;
  for (const l of lines) {
    if (l.start_ms == null) continue;
    if (l.start_ms <= songMs + 200 && (l.end_ms == null || songMs < l.end_ms)) return l;
    if (l.start_ms <= songMs && (!best || l.start_ms > best.start_ms!)) best = l;
  }
  return best;
}

export function analyzeTake(
  features: TakeFeatures,
  map: VocalMap,
  songStartMs: number,
  lines: Line[],
): TakeAnalysis {
  const { db, semis } = features;
  const takeFrames = db.length;
  const songFrames = map.semitones.length;
  const startFrame = Math.round(songStartMs / HOP_MS);

  // Masks: where the reference sings (phrases) and where the user sings.
  const refMask = new Uint8Array(songFrames);
  for (const p of map.phrases) refMask.fill(1, p.startMs / HOP_MS, p.endMs / HOP_MS);
  // "Singing" = pitched, or nearly as loud as pitched singing (breathy / soft
  // notes where YIN loses the pitch). An inhale is far quieter than either.
  const pitchedDb: number[] = [];
  for (let i = 0; i < takeFrames; i++) if (!Number.isNaN(semis[i])) pitchedDb.push(db[i]);
  const typicalDb = median(pitchedDb);
  const userRaw = new Uint8Array(takeFrames);
  for (let i = 0; i < takeFrames; i++) {
    if (!Number.isNaN(semis[i]) || db[i] >= typicalDb - 18) userRaw[i] = 1;
  }
  const userOn = cleanMask(userRaw, 120 / HOP_MS, 80 / HOP_MS);

  // Latency: shift that best overlaps the user's pitched singing with the reference
  // phrases (pitched frames only — loudness alone smears phrase edges).
  const userPitched = cleanMask(
    Uint8Array.from(semis, (v) => (Number.isNaN(v) ? 0 : 1)),
    120 / HOP_MS,
    80 / HOP_MS,
  );
  let lagFrames = 0;
  let bestScore = -1;
  for (let lag = LAG_MIN_MS / HOP_MS; lag <= LAG_MAX_MS / HOP_MS; lag++) {
    let both = 0;
    let either = 0;
    for (let t = 0; t < takeFrames; t += 2) {
      const f = startFrame + t - lag;
      if (f < 0 || f >= songFrames) continue;
      const u = userPitched[t];
      const r = refMask[f];
      if (u && r) both++;
      if (u || r) either++;
    }
    const score = either ? both / either : 0;
    if (score > bestScore) {
      bestScore = score;
      lagFrames = lag;
    }
  }
  /** Song frame → take frame. */
  const toTake = (f: number) => f - startFrame + lagFrames;
  const songFrom = Math.max(0, startFrame - lagFrames);
  const songTo = Math.min(songFrames, startFrame - lagFrames + takeFrames);

  // Octave: singing a song an octave down is fine — compare pitch classes then.
  const diffs: number[] = [];
  for (let f = songFrom; f < songTo; f += 3) {
    const r = map.semitones[f];
    const u = semis[toTake(f)];
    if (!Number.isNaN(r) && !Number.isNaN(u)) diffs.push(u - r);
  }
  const octaveShift = diffs.length ? Math.round(median(diffs) / 12) * 12 : 0;

  const issues: TakeIssue[] = [];
  const midFrame = (songFrom + songTo) / 2;
  const halves: [TakeHalfStats, TakeHalfStats] = [
    { phrases: 0, breath_issues: 0, high_notes: 0, high_issues: 0 },
    { phrases: 0, breath_issues: 0, high_notes: 0, high_issues: 0 },
  ];
  const half = (songFrame: number) => halves[songFrame < midFrame ? 0 : 1];
  const add = (kind: TakeIssue["kind"], songFrame: number, detail: string) => {
    const songMs = songFrame * HOP_MS;
    issues.push({ kind, song_ms: songMs, line_id: lineAt(lines, songMs)?.id, detail });
  };

  // ── Breath: phrase by phrase ────────────────────────────────────────────
  const margin = 300 / HOP_MS;
  map.phrases.forEach((p, pi) => {
    const ps = p.startMs / HOP_MS;
    const pe = p.endMs / HOP_MS;
    const len = pe - ps;
    if (ps < songFrom + margin || pe > songTo - margin || len * HOP_MS < 1000) return;

    let on = 0;
    let first = -1;
    let last = -1;
    for (let f = ps; f < pe; f++) {
      if (userOn[toTake(f)]) {
        on++;
        if (first < 0) first = f;
        last = f;
      }
    }
    if (on / len < 0.3) return; // not really sung (skipped / talking) — don't judge
    const h = half(ps);
    h.phrases++;
    let flagged = false;
    let ranOut = false;

    const earlyMs = (pe - 1 - last) * HOP_MS;
    if (len * HOP_MS >= 1500 && earlyMs >= 400) {
      add("ran_out", last, `voice stopped ${(earlyMs / 1000).toFixed(1)} s before the phrase ended`);
      flagged = true;
      ranOut = true;
    }

    // Gaps in the user's voice where the reference keeps singing. A gap near the
    // end of the phrase is running out (then coming in early for the next one);
    // earlier, it's an extra breath. Stop at a run-out point already reported.
    const gapEnd = ranOut ? last : pe;
    for (let f = ps + 200 / HOP_MS; f < gapEnd; f++) {
      if (userOn[toTake(f)]) continue;
      let g = f;
      while (g < gapEnd && !userOn[toTake(g)]) g++;
      if ((g - f) * HOP_MS >= 300) {
        const fromEndMs = (pe - f) * HOP_MS;
        if (fromEndMs <= 1500 && len * HOP_MS >= 1500) {
          add("ran_out", f, `voice cut out ${(fromEndMs / 1000).toFixed(1)} s before the phrase ended`);
        } else if (fromEndMs > margin * HOP_MS) {
          add("extra_breath", f, `stopped for ${((g - f) / 100).toFixed(1)} s mid-phrase (${fmtTime(f * HOP_MS)})`);
        } else {
          f = g;
          continue;
        }
        flagged = true;
        break;
      }
      f = g;
    }

    if (!flagged && len * HOP_MS >= 3000) {
      const head: number[] = [];
      const tail: number[] = [];
      const refHead: number[] = [];
      const refTail: number[] = [];
      for (let f = ps; f < pe; f++) {
        const pos = (f - ps) / len;
        if (map.stemDb) {
          if (pos < 0.5) refHead.push(map.stemDb[f]);
          else if (pos > 0.7) refTail.push(map.stemDb[f]);
        }
        const t = toTake(f);
        if (!userOn[t] || Number.isNaN(semis[t])) continue;
        if (pos < 0.5) head.push(db[t]);
        else if (pos > 0.7) tail.push(db[t]);
      }
      // A written decrescendo isn't a support problem: measure beyond the original's own fade.
      const refDrop = refHead.length && refTail.length ? Math.max(0, median(refHead) - median(refTail)) : 0;
      const drop = median(head) - median(tail) - refDrop;
      if (head.length > 20 && tail.length > 10 && drop >= 10) {
        add("fading", pe - Math.round(len * 0.3), `${Math.round(drop)} dB quieter by the end of the phrase than the original`);
        flagged = true;
      }
    }

    const prevBreath = pi > 0 ? map.breaths[pi - 1] : null;
    const lateMs = (first - ps) * HOP_MS;
    if (prevBreath?.quick && lateMs >= 300) {
      add("late_entry", first, `came in ${(lateMs / 1000).toFixed(1)} s late after a quick breath`);
      flagged = true;
    }

    if (flagged) h.breath_issues++;
  });

  // ── High notes ──────────────────────────────────────────────────────────
  const userSmooth = medianFilter(semis, 5);
  const refSmooth = medianFilter(map.semitones, 7);
  for (const m of map.highMoments) {
    const ms = m.startMs / HOP_MS;
    const me = m.endMs / HOP_MS;
    if (ms < songFrom || me > songTo) continue;
    // Judge only high notes in a stretch the user actually sang: of the
    // reference's singing in the 3 s around the note, the user covered most.
    let refAround = 0;
    let userAround = 0;
    const a0 = Math.max(songFrom, ms - 300);
    const a1 = Math.min(songTo, me + 300);
    for (let f = a0; f < a1; f++) {
      if ((f >= ms && f < me) || !refMask[f]) continue;
      refAround++;
      if (userOn[toTake(f)]) userAround++;
    }
    if (refAround < 30 || userAround / refAround < 0.5) continue;

    const h = half(ms);
    h.high_notes++;
    const note = semitoneToNoteName(m.peakSemitone);
    const cents: number[] = [];
    const refCents: number[] = [];
    const loudness: number[] = [];
    const refLoudness: number[] = [];
    let sounding = 0;
    let pitched = 0;
    let jumps = 0;
    let prev = NaN;
    for (let f = ms; f < me; f++) {
      const t = toTake(f);
      if (userOn[t]) sounding++;
      if (map.stemDb) refLoudness.push(map.stemDb[f]);
      const u = semis[t];
      const r = refSmooth[f];
      if (Number.isNaN(u)) continue;
      pitched++;
      loudness.push(db[t]);
      const us = userSmooth[t];
      // A crack/flip is a sudden jump the reference doesn't make. ~Octave jumps
      // are tracker errors; jumps where the melody itself leaps don't count.
      if (!Number.isNaN(prev) && !Number.isNaN(us)) {
        const jump = Math.abs(us - prev);
        const octaveSlip = Math.abs(jump - 12) < 1.5;
        const refJump = Math.abs((refSmooth[f] ?? NaN) - (refSmooth[f - 3] ?? NaN));
        if (jump > 2.5 && !octaveSlip && !(refJump > 1.5)) jumps++;
      }
      prev = us;
      if (Number.isNaN(r) || Number.isNaN(us)) continue;
      // > 3 semitones apart is a tracking slip (harmony, octave error), not singing.
      const c = (us - octaveShift - r) * 100;
      if (Math.abs(c) <= 300) {
        cents.push(c);
        refCents.push(r * 100);
      }
    }
    let flagged = true;
    if (sounding / (me - ms) < 0.4) {
      add("high_dropped", ms, `${note} — voice mostly dropped out`);
    } else if (pitched < 8 || cents.length < 8) {
      flagged = false; // sound but no trackable pitch (very breathy, or noisy) — don't guess
    } else if (jumps >= 3) {
      add("high_cracked", ms, `${note} — voice broke or flipped`);
    } else {
      const med = median(cents);
      const spread = median(cents.map((c) => Math.abs(c - med))) * 1.4826;
      // Vibrato is fine: only wobble well beyond the original singer's own counts.
      const refMed = median(refCents);
      const refSpread = median(refCents.map((c) => Math.abs(c - refMed))) * 1.4826;
      if (med <= -FLAT_SHARP_CENTS) add("high_flat", ms, `${note} — ${Math.round(-med)} cents flat`);
      else if (med >= FLAT_SHARP_CENTS) add("high_sharp", ms, `${note} — ${Math.round(med)} cents sharp`);
      else if (spread > 60 && spread > refSpread + 35 && cents.length >= 10) add("high_unsteady", ms, `${note} — pitch wobbling (±${Math.round(spread)} cents)`);
      else flagged = false;
    }
    // How much louder than the rest of the take, beyond how much the original gets louder here.
    const refLift =
      map.stemDb && map.stemTypicalDb != null ? median(refLoudness) - map.stemTypicalDb : 0;
    const louder = median(loudness) - typicalDb - refLift;
    if (louder >= 9) {
      add("high_pushed", ms, `${note} — ${Math.round(louder)} dB louder than the original gets here`);
      flagged = true;
    }
    if (flagged) h.high_issues++;
  }

  issues.sort((a, b) => a.song_ms - b.song_ms);
  return {
    version: ANALYSIS_VERSION,
    analyzed_at: new Date().toISOString(),
    lag_ms: lagFrames * HOP_MS,
    octave_shift: octaveShift,
    song_from_ms: songFrom * HOP_MS,
    song_to_ms: songTo * HOP_MS,
    phrases_checked: halves[0].phrases + halves[1].phrases,
    high_notes_checked: halves[0].high_notes + halves[1].high_notes,
    issues,
    halves,
  };
}

export const BREATH_KINDS = new Set(["ran_out", "fading", "extra_breath", "late_entry"]);
