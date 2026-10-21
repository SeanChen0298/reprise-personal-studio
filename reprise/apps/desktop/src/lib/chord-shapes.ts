/**
 * chord-shapes.ts
 *
 * Guitar voicings for the chord vocabulary the analysis produces
 * (major, m, 7, m7). Common open-position shapes come from a table; every
 * other chord uses a movable barre shape (E-shape rooted on string 6, or
 * A-shape rooted on string 5 — whichever sits lower on the neck).
 *
 * Arrays run string 6 (low E) → string 1 (high E). `null` = muted string,
 * 0 = open string. Finger numbers: 1 index … 4 pinky, 0 = none.
 */

export type Fret = number | null;

export interface ChordShape {
  name: string;
  frets: Fret[];       // absolute frets, string 6 → 1
  fingers: number[];   // string 6 → 1
  barre?: { fret: number; fromString: number; toString: number }; // strings numbered 6..1
}

/** Standard tuning as MIDI note numbers, string 6 → 1. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

type Quality = "" | "m" | "7" | "m7";

const OPEN_SHAPES: Record<string, { frets: Fret[]; fingers: number[] }> = {
  C:   { frets: [null, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  A:   { frets: [null, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  G:   { frets: [3, 2, 0, 0, 0, 3],    fingers: [2, 1, 0, 0, 0, 3] },
  E:   { frets: [0, 2, 2, 1, 0, 0],    fingers: [0, 2, 3, 1, 0, 0] },
  D:   { frets: [null, null, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Am:  { frets: [null, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  Em:  { frets: [0, 2, 2, 0, 0, 0],    fingers: [0, 2, 3, 0, 0, 0] },
  Dm:  { frets: [null, null, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  C7:  { frets: [null, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  A7:  { frets: [null, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  G7:  { frets: [3, 2, 0, 0, 0, 1],    fingers: [3, 2, 0, 0, 0, 1] },
  E7:  { frets: [0, 2, 0, 1, 0, 0],    fingers: [0, 2, 0, 1, 0, 0] },
  D7:  { frets: [null, null, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  B7:  { frets: [null, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  Am7: { frets: [null, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Em7: { frets: [0, 2, 0, 0, 0, 0],    fingers: [0, 2, 0, 0, 0, 0] },
  Dm7: { frets: [null, null, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
};

// Movable shapes, frets relative to the barre fret.
const E_SHAPE: Record<Quality, { frets: Fret[]; fingers: number[] }> = {
  "":  { frets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
  m:   { frets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
  "7": { frets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
  m7:  { frets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
};
const A_SHAPE: Record<Quality, { frets: Fret[]; fingers: number[] }> = {
  "":  { frets: [null, 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1] },
  m:   { frets: [null, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
  "7": { frets: [null, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
  m7:  { frets: [null, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
};

/** Split "F#m7" into root pitch class and quality. Returns null for "N" or unknown labels. */
export function parseChordLabel(label: string): { pc: number; quality: Quality } | null {
  const m = /^([A-G][#b]?)(m7|m|7)?$/.exec(label);
  if (!m || PITCH_CLASS[m[1]] === undefined) return null;
  return { pc: PITCH_CLASS[m[1]], quality: (m[2] ?? "") as Quality };
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The voicing to show and play for a chord label, or null if it has none (e.g. "N"). */
export function getChordShape(label: string): ChordShape | null {
  const parsed = parseChordLabel(label);
  if (!parsed) return null;
  const { pc, quality } = parsed;

  const open = OPEN_SHAPES[SHARP_NAMES[pc] + quality];
  if (open) return { name: label, ...open };

  // Root fret on string 6 (E-shape) and on string 5 (A-shape); use the lower one.
  const eFret = (pc - 4 + 12) % 12 || 12;
  const aFret = (pc - 9 + 12) % 12 || 12;
  const useE = eFret <= aFret;
  const base = useE ? eFret : aFret;
  const template = (useE ? E_SHAPE : A_SHAPE)[quality];
  return {
    name: label,
    frets: template.frets.map((f) => (f == null ? null : f + base)),
    fingers: template.fingers,
    barre: { fret: base, fromString: useE ? 6 : 5, toString: 1 },
  };
}

/** Sounding MIDI notes of a shape, low string first. `capo` raises every string. */
export function shapeMidiNotes(shape: ChordShape, capo = 0): number[] {
  const notes: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f != null) notes.push(STANDARD_TUNING[i] + f + capo);
  });
  return notes;
}
