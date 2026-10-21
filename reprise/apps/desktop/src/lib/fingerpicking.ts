/**
 * fingerpicking.ts
 *
 * A fingerpicked accompaniment built from the chords: the thumb plays the
 * bass, the fingers pick the treble strings, one note per eighth note, using
 * whichever fingering (voicing) is chosen for each chord. Computed in the app
 * so it follows chord edits and voicing choices immediately.
 */

import type { ChordAnalysis } from "./chord-analysis";
import { STANDARD_TUNING, type ChordShape } from "./chord-shapes";

export type PickPattern = "travis" | "arpeggio" | "simple";

/**
 * One symbol per eighth note. B = bass (root string), A = alternate bass,
 * 1 / 2 / 3 = treble strings (1 = high E).
 */
const PATTERNS: Record<PickPattern, { 4: string[]; 3: string[] }> = {
  travis:   { 4: ["B", "2", "A", "1", "B", "2", "A", "1"], 3: ["B", "2", "A", "1", "A", "2"] },
  arpeggio: { 4: ["B", "3", "2", "1", "2", "3", "2", "3"], 3: ["B", "3", "2", "1", "2", "3"] },
  simple:   { 4: ["B", "3", "2", "3", "A", "3", "2", "3"], 3: ["B", "3", "2", "3", "2", "3"] },
};

export const PICK_PATTERNS: { value: PickPattern; label: string; hint: string }[] = [
  { value: "travis", label: "Travis", hint: "Thumb alternates bass notes on the beat, fingers pick in between" },
  { value: "arpeggio", label: "Arpeggio", hint: "Roll up and back down through the chord" },
  { value: "simple", label: "Simple", hint: "Bass, then the middle strings — easiest to start with" },
];

export interface PickNote {
  string: number;   // 1 = high E … 6 = low E
  fret: number;     // as fingered (relative to the capo when one is used)
  midi: number;     // sounding pitch
  role: "bass" | "treble";
}

export interface PickEvent {
  t: number;        // song time, ms
  bar: number;      // index into bars
  slot: number;     // eighth-note slot within the bar
  chord: number;    // index into chords
  notes: PickNote[];
}

/** The string to play for a pattern symbol, given which strings ring in the voicing. */
function stringFor(symbol: string, shape: ChordShape): number | null {
  // frets[0] is string 6 … frets[5] is string 1.
  const sounding = [6, 5, 4, 3, 2, 1].filter((s) => shape.frets[6 - s] != null);
  if (sounding.length === 0) return null;
  const bass = sounding[0];
  if (symbol === "B") return bass;
  if (symbol === "A") {
    // Standard alternating bass: low E root → D string; A root → D string;
    // D root → G string. Fall back to the next string up, then the root.
    const preferred = bass === 6 ? [4, 5] : [bass - 1, bass - 2];
    for (const s of preferred) if (sounding.includes(s)) return s;
    return bass;
  }
  const target = Number(symbol);
  const treble = sounding.filter((s) => s < bass);
  if (treble.length === 0) return bass;
  return treble.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), treble[0]);
}

/**
 * Build the picking part for the whole song.
 * `voicingFor` returns the fingering to use for a chord label (already the
 * capo shape when the capo is shown); `capo` raises the sounding pitch.
 */
export function buildPicking(
  analysis: ChordAnalysis,
  pattern: PickPattern,
  voicingFor: (label: string) => ChordShape | null,
  capo: number,
): PickEvent[] {
  const bars = analysis.bars ?? [];
  const beats = analysis.beats_ms ?? [];
  const chords = analysis.chords ?? [];
  const meter = analysis.time_signature?.beats_per_bar === 3 ? 3 : 4;
  const symbols = PATTERNS[pattern][meter];
  const events: PickEvent[] = [];
  let ci = 0;

  for (const bar of bars) {
    if (bar.pickup || bar.beats !== meter) continue;
    for (let k = 0; k < bar.beats; k++) {
      const b = bar.first_beat + k;
      const t0 = beats[b];
      if (t0 == null) continue;
      const t1 = beats[b + 1] ?? bar.end_ms;
      for (let half = 0; half < 2; half++) {
        const slot = k * 2 + half;
        const t = half === 0 ? t0 : (t0 + t1) / 2;
        while (ci + 1 < chords.length && chords[ci + 1].start_ms <= t) ci++;
        const chord = chords[ci];
        if (!chord || chord.label === "N") continue;
        const shape = voicingFor(chord.label);
        if (!shape) continue;
        // A chord that changes mid-bar restarts on its bass note.
        const changed = ci > 0 && chords[ci].start_ms > bar.start_ms && Math.abs(chords[ci].start_ms - t) < 1;
        const symbol = changed ? "B" : symbols[slot];
        const string = stringFor(symbol, shape);
        if (string == null) continue;
        const fret = shape.frets[6 - string] as number;
        events.push({
          t,
          bar: bar.index,
          slot,
          chord: ci,
          notes: [{
            string,
            fret,
            midi: STANDARD_TUNING[6 - string] + fret + capo,
            role: symbol === "B" || symbol === "A" ? "bass" : "treble",
          }],
        });
      }
    }
  }
  return events;
}
