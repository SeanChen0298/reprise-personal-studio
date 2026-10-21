/**
 * chord-shapes.ts
 *
 * Guitar voicings for the chord vocabulary the analysis produces
 * (maj, m, 7, m7, maj7, m7b5, dim, sus4). Common open-position shapes come
 * from a table; every other chord uses a movable shape (E-shape rooted on
 * string 6, or A-shape rooted on string 5 — whichever sits lower on the neck).
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

export type Quality = "" | "m" | "7" | "m7" | "maj7" | "m7b5" | "dim" | "sus4";

/** Suffixes in display order, for pickers. "" = major. */
export const QUALITY_SUFFIXES: Quality[] = ["", "m", "7", "m7", "maj7", "m7b5", "dim", "sus4"];

/** Matches a chord label: root, then an optional quality (longest suffixes first). */
export const CHORD_LABEL_RE = /^([A-G][#b]?)(m7b5|maj7|m7|m|7|dim|sus4)?$/;

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
  Cmaj7: { frets: [null, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  Amaj7: { frets: [null, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2],    fingers: [3, 2, 0, 0, 0, 1] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0],    fingers: [0, 3, 1, 2, 0, 0] },
  Dmaj7: { frets: [null, null, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1] },
  Fmaj7: { frets: [null, null, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  Asus4: { frets: [null, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Dsus4: { frets: [null, null, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0],    fingers: [0, 2, 3, 4, 0, 0] },
  Bm7b5: { frets: [null, 2, 3, 2, 3, null], fingers: [0, 1, 3, 2, 4, 0] },
  Bdim:  { frets: [null, 2, 3, 4, 3, null], fingers: [0, 1, 2, 4, 3, 0] },
};

// Movable shapes, frets relative to the root fret. `barre` = whether the
// index finger lies across the strings at the root fret.
interface Movable { frets: Fret[]; fingers: number[]; barre: boolean }

const E_SHAPE: Partial<Record<Quality, Movable>> = {
  "":   { frets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], barre: true },
  m:    { frets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1], barre: true },
  "7":  { frets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1], barre: true },
  m7:   { frets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1], barre: true },
  maj7: { frets: [0, null, 1, 1, 0, null], fingers: [1, 0, 3, 4, 2, 0], barre: false },
  sus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1], barre: true },
};
const A_SHAPE: Record<Quality, Movable> = {
  "":   { frets: [null, 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1], barre: true },
  m:    { frets: [null, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1], barre: true },
  "7":  { frets: [null, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1], barre: true },
  m7:   { frets: [null, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1], barre: true },
  maj7: { frets: [null, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1], barre: true },
  m7b5: { frets: [null, 0, 1, 0, 1, null], fingers: [0, 1, 3, 2, 4, 0], barre: false },
  dim:  { frets: [null, 0, 1, 2, 1, null], fingers: [0, 1, 2, 4, 3, 0], barre: false },
  sus4: { frets: [null, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1], barre: true },
};

/** Split "F#m7" into root pitch class and quality. Returns null for "N" or unknown labels. */
export function parseChordLabel(label: string): { pc: number; quality: Quality } | null {
  const m = CHORD_LABEL_RE.exec(label);
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

  // Root fret on string 6 (E-shape) and on string 5 (A-shape); use the lower
  // one. Qualities without a good E-shape always use the A-shape.
  const eShape = E_SHAPE[quality];
  const aShape = A_SHAPE[quality];
  // A barre shape can't sit at fret 0, so move it up an octave; open-capable
  // shapes (no barre) may use the open position.
  const eFret = (pc - 4 + 12) % 12 || 12;
  const aFret = (pc - 9 + 12) % 12 || (aShape.barre ? 12 : 0);
  const useE = !!eShape && eFret <= aFret;
  const base = useE ? eFret : aFret;
  const template = useE ? eShape! : aShape;
  const frets = template.frets.map((f) => (f == null ? null : f + base));
  // The barre runs from the root string to the highest string that sounds.
  const mutedOnTop = [...frets].reverse().findIndex((f) => f != null);
  return {
    name: label,
    frets,
    fingers: template.fingers,
    barre: template.barre && base > 0
      ? { fret: base, fromString: useE ? 6 : 5, toString: 1 + Math.max(0, mutedOnTop) }
      : undefined,
  };
}

const SHAPE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * The chord shape to finger with a capo on `capo`: the chord moved down by
 * that many semitones, spelled the way chord charts name shapes.
 */
export function capoShapeLabel(label: string, capo: number): string {
  const parsed = parseChordLabel(label);
  if (!parsed || capo <= 0) return label;
  return SHAPE_NAMES[(parsed.pc - capo + 12) % 12] + parsed.quality;
}

/** The sounding chord for a shape played with a capo on `capo` (inverse of capoShapeLabel). */
export function soundingLabel(shapeLabel: string, capo: number): string {
  const parsed = parseChordLabel(shapeLabel);
  if (!parsed || capo <= 0) return shapeLabel;
  return SHAPE_NAMES[(parsed.pc + capo) % 12] + parsed.quality;
}

/** Sounding MIDI notes of a shape, low string first. `capo` raises every string. */
export function shapeMidiNotes(shape: ChordShape, capo = 0): number[] {
  const notes: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f != null) notes.push(STANDARD_TUNING[i] + f + capo);
  });
  return notes;
}
