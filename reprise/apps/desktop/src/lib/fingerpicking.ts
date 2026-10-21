/**
 * fingerpicking.ts
 *
 * A fingerpicked accompaniment built from the chords: the thumb plays the
 * bass, the fingers pick the treble strings, on an eighth-note grid, using
 * whichever fingering (voicing) is chosen for each chord. Computed in the app
 * so it follows chord edits and voicing choices immediately.
 */

import type { ChordAnalysis } from "./chord-analysis";
import { STANDARD_TUNING, type ChordShape } from "./chord-shapes";

export type PickPattern = "travis" | "arpeggio" | "simple" | "pinch" | "bossa" | "ballad";

/**
 * One symbol per eighth note:
 *   B = bass (root string)   A = alternate bass   1 / 2 / 3 = treble strings (1 = high E)
 *   C = chord pluck (strings 3+2+1 together)     X+Y = both at once (a "pinch")
 *   - = rest
 */
const PATTERNS: Record<PickPattern, { 4: string[]; 3: string[] }> = {
  travis:   { 4: ["B", "2", "A", "1", "B", "2", "A", "1"], 3: ["B", "2", "A", "1", "A", "2"] },
  arpeggio: { 4: ["B", "3", "2", "1", "2", "3", "2", "3"], 3: ["B", "3", "2", "1", "2", "3"] },
  simple:   { 4: ["B", "3", "2", "3", "A", "3", "2", "3"], 3: ["B", "3", "2", "3", "2", "3"] },
  pinch:    { 4: ["B+1", "3", "2", "3", "A+1", "3", "2", "3"], 3: ["B+1", "3", "2", "A+1", "3", "2"] },
  bossa:    { 4: ["B", "C", "-", "C", "A", "-", "C", "-"], 3: ["B", "C", "-", "C", "A", "-"] },
  ballad:   { 4: ["B", "3", "2", "3", "1", "3", "2", "3"], 3: ["B", "3", "2", "1", "2", "3"] },
};

export const PICK_PATTERNS: { value: PickPattern; label: string; hint: string }[] = [
  { value: "travis", label: "Travis", hint: "Thumb alternates two bass notes on the beat, fingers pick in between (Merle Travis style)" },
  { value: "arpeggio", label: "Arpeggio", hint: "Roll up through the chord and back down (p-i-m-a-m-i)" },
  { value: "simple", label: "Simple", hint: "Bass, then the middle strings — the easiest to start with" },
  { value: "pinch", label: "Pinch", hint: "Thumb and ring finger together on the beat, then the middle strings" },
  { value: "bossa", label: "Bossa nova", hint: "Bass on 1 and 3, syncopated chord plucks — suits jazzy songs" },
  { value: "ballad", label: "Ballad", hint: "Slow rolling pattern that reaches the top string mid-bar" },
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

/** Strings that ring in a voicing, low to high (6 … 1). */
function soundingStrings(shape: ChordShape): number[] {
  return [6, 5, 4, 3, 2, 1].filter((s) => shape.frets[6 - s] != null);
}

/** Strings to play for one pattern part (B, A, 1, 2, 3 or C), given the voicing. */
function stringsFor(part: string, shape: ChordShape): number[] {
  const sounding = soundingStrings(shape);
  if (sounding.length === 0) return [];
  const bass = sounding[0];
  if (part === "B") return [bass];
  if (part === "A") {
    // Standard alternating bass: low E root → D string; A root → D string;
    // D root → G string. Fall back to the next string up, then the root.
    const preferred = bass === 6 ? [4, 5] : [bass - 1, bass - 2];
    for (const s of preferred) if (sounding.includes(s)) return [s];
    return [bass];
  }
  const treble = sounding.filter((s) => s < bass);
  if (treble.length === 0) return [bass];
  const nearest = (target: number) =>
    treble.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), treble[0]);
  if (part === "C") return Array.from(new Set([3, 2, 1].map(nearest)));
  return [nearest(Number(part))];
}

/**
 * Build the picking part for the whole song.
 * `voicingFor` returns the fingering to use for a chord label (already the
 * capo shape when the capo is shown); `capo` raises the sounding pitch.
 * When the chord changes mid-bar the pattern restarts from its beginning,
 * so the new chord starts on its bass note and keeps the pattern's shape.
 */
export function buildPicking(
  analysis: ChordAnalysis,
  pattern: PickPattern,
  voicingFor: (label: string, atMs?: number) => ChordShape | null,
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
    let patternStart = 0;   // slot where the current chord's pattern began in this bar
    let lastChord = -1;
    for (let k = 0; k < bar.beats; k++) {
      const b = bar.first_beat + k;
      const t0 = beats[b];
      if (t0 == null) continue;
      const t1 = beats[b + 1] ?? bar.end_ms;
      for (let half = 0; half < 2; half++) {
        const slot = k * 2 + half;
        const t = half === 0 ? t0 : (t0 + t1) / 2;
        while (ci + 1 < chords.length && chords[ci + 1].start_ms <= t) ci++;
        if (lastChord !== -1 && ci !== lastChord) patternStart = slot;
        lastChord = ci;

        const chord = chords[ci];
        if (!chord || chord.label === "N") continue;
        const shape = voicingFor(chord.label, t);   // fingering chosen for this bar
        if (!shape) continue;

        const symbol = symbols[(slot - patternStart) % symbols.length];
        if (symbol === "-") continue;
        const notes: PickNote[] = [];
        for (const part of symbol.split("+")) {
          for (const string of stringsFor(part, shape)) {
            if (notes.some((n) => n.string === string)) continue;
            const fret = shape.frets[6 - string] as number;
            notes.push({
              string,
              fret,
              midi: STANDARD_TUNING[6 - string] + fret + capo,
              role: part === "B" || part === "A" ? "bass" : "treble",
            });
          }
        }
        if (notes.length) events.push({ t, bar: bar.index, slot, chord: ci, notes });
      }
    }
  }
  return events;
}
