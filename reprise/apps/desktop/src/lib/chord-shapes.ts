/**
 * chord-shapes.ts
 *
 * Guitar voicings for the chord vocabulary the analysis produces
 * (maj, m, 7, m7, maj7, m7b5, dim, sus4). Each chord has several ways to
 * play it: the open-position shape (from a table, where one exists) plus
 * movable shapes rooted on string 6 ("E shape"), string 5 ("A shape") and
 * string 4 ("D shape"). getChordVoicings lists them, lowest position first.
 *
 * Arrays run string 6 (low E) → string 1 (high E). `null` = muted string,
 * 0 = open string. Finger numbers: 1 index … 4 pinky, 0 = none.
 */

export type Fret = number | null;

export interface ChordShape {
  name: string;
  /** Which family of shape, e.g. "Open", "E shape". */
  kind: string;
  /** Root position on the neck (0 = open position). */
  position: number;
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

export type Quality =
  | "" | "m" | "7" | "m7" | "maj7" | "m7b5" | "dim" | "sus4"
  | "maj9" | "9" | "m9" | "add9" | "6" | "m6" | "sus2" | "7sus4" | "aug" | "dim7";

/** Suffixes in display order, for pickers. "" = major. The first eight can be detected. */
export const QUALITY_SUFFIXES: Quality[] = [
  "", "m", "7", "m7", "maj7", "m7b5", "dim", "sus4",
  "maj9", "9", "m9", "add9", "6", "m6", "sus2", "7sus4", "aug", "dim7",
];

/** Matches a canonical chord label: root, then an optional quality (longest suffixes first). */
export const CHORD_LABEL_RE =
  /^([A-G][#b]?)(m7b5|maj9|maj7|7sus4|add9|sus4|sus2|dim7|dim|aug|m9|m7|m6|m|9|7|6)?$/;

/** Semitones above the root for each quality. */
export const QUALITY_INTERVALS: Record<Quality, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], m7b5: [0, 3, 6, 10], dim: [0, 3, 6], sus4: [0, 5, 7],
  maj9: [0, 4, 7, 11, 2], "9": [0, 4, 7, 10, 2], m9: [0, 3, 7, 10, 2], add9: [0, 4, 7, 2],
  "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], sus2: [0, 2, 7], "7sus4": [0, 5, 7, 10],
  aug: [0, 4, 8], dim7: [0, 3, 6, 9],
};

export type ChordNotation = "standard" | "jpop";

// J-pop chart spellings (e.g. U-Fret style) <-> canonical suffixes.
const JPOP_SUFFIX: Partial<Record<Quality, string>> = {
  maj7: "M7", maj9: "M7(9)", "9": "7(9)", m9: "m7(9)", m7b5: "m7(♭5)",
};

/**
 * Accept common spellings and return the canonical label used internally:
 * DM7(9) / Dmaj7(9) -> Dmaj9, D7(9) -> D9, Dm7(9) -> Dm9, DM7 / DΔ7 -> Dmaj7,
 * Dm7(b5) / Dø -> Dm7b5, Dadd2 -> Dadd9, D° -> Ddim.
 */
export function canonicalChord(label: string): string {
  const m = /^([A-G][#b♯♭]?)(.*)$/.exec(label.trim());
  if (!m) return label;
  const root = m[1].replace("♯", "#").replace("♭", "b");
  let q = m[2].replace(/♭/g, "b").replace(/♯/g, "#").replace(/\s+/g, "");
  const table: [RegExp, string][] = [
    [/^(M7|maj7|Δ7|Δ)\(9\)$|^(maj9|M9|Δ9)$/, "maj9"],
    [/^m7\(9\)$|^m9$/, "m9"],
    [/^7\(9\)$|^9$/, "9"],
    [/^(M7|Δ7|Δ|maj)$/, "maj7"],
    [/^(m7\(b5\)|m7b5|ø|ø7)$/, "m7b5"],
    [/^(add2|\(9\)|add9)$/, "add9"],
    [/^(°7|o7|dim7)$/, "dim7"],
    [/^(°|o|dim)$/, "dim"],
    [/^(\+|aug)$/, "aug"],
    [/^(min|-)$/, "m"],
  ];
  for (const [re, canonical] of table) {
    if (re.test(q)) { q = canonical; break; }
  }
  return root + q;
}

/** Show a canonical label in the chosen notation (J-pop: DM7(9), D7(9), Dm7(♭5) …). */
export function formatChord(label: string, notation: ChordNotation): string {
  if (notation !== "jpop") return label;
  const parsed = CHORD_LABEL_RE.exec(label);
  if (!parsed) return label;
  const suffix = (parsed[2] ?? "") as Quality;
  return parsed[1] + (JPOP_SUFFIX[suffix] ?? suffix);
}

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
const A_SHAPE: Partial<Record<Quality, Movable>> = {
  "":   { frets: [null, 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1], barre: true },
  m:    { frets: [null, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1], barre: true },
  "7":  { frets: [null, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1], barre: true },
  m7:   { frets: [null, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1], barre: true },
  maj7: { frets: [null, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1], barre: true },
  m7b5: { frets: [null, 0, 1, 0, 1, null], fingers: [0, 1, 3, 2, 4, 0], barre: false },
  dim:  { frets: [null, 0, 1, 2, 1, null], fingers: [0, 1, 2, 4, 3, 0], barre: false },
  sus4: { frets: [null, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1], barre: true },
};

// Root on string 4; at position 0 these are the open D-family chords.
const D_SHAPE: Partial<Record<Quality, Movable>> = {
  "":   { frets: [null, null, 0, 2, 3, 2], fingers: [0, 0, 1, 2, 4, 3], barre: false },
  m:    { frets: [null, null, 0, 2, 3, 1], fingers: [0, 0, 1, 3, 4, 2], barre: false },
  "7":  { frets: [null, null, 0, 2, 1, 2], fingers: [0, 0, 1, 3, 2, 4], barre: false },
  m7:   { frets: [null, null, 0, 2, 1, 1], fingers: [0, 0, 1, 3, 2, 2], barre: false },
  maj7: { frets: [null, null, 0, 2, 2, 2], fingers: [0, 0, 1, 3, 3, 3], barre: false },
  sus4: { frets: [null, null, 0, 2, 3, 3], fingers: [0, 0, 1, 2, 3, 4], barre: false },
};

/** Split "F#m7" into root pitch class and quality. Returns null for "N" or unknown labels. */
export function parseChordLabel(label: string): { pc: number; quality: Quality } | null {
  const m = CHORD_LABEL_RE.exec(canonicalChord(label));
  if (!m || PITCH_CLASS[m[1]] === undefined) return null;
  return { pc: PITCH_CLASS[m[1]], quality: (m[2] ?? "") as Quality };
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const STRING_OPEN_PC = [4, 9, 2, 7, 11, 4]; // string 6 … 1 open notes as pitch classes

/**
 * Search the neck for playable voicings of any chord: root as the lowest note
 * on string 6, 5 or 4; every chord tone except (optionally) the 5th present;
 * within a 4-fret span using at most four fingers (a barre on the lowest
 * fret counts as one). Returns the best voicing for each root string and
 * octave, best first.
 */
function searchVoicings(label: string, pc: number, quality: Quality): ChordShape[] {
  const intervals = QUALITY_INTERVALS[quality];
  const tones = intervals.map((iv) => (pc + iv) % 12);
  const fifth = (pc + 7) % 12;
  const required = tones.filter((t) => t !== fifth || !intervals.includes(7) || tones.length <= 3);
  const found: { shape: ChordShape; score: number }[] = [];

  for (const rootIdx of [0, 1, 2]) {                       // string 6, 5, 4
    const baseFret = (pc - STRING_OPEN_PC[rootIdx] + 12) % 12;
    for (const rootFret of [baseFret, baseFret + 12]) {
      if (rootFret > 14) continue;
      const lo = Math.max(0, rootFret - 2), hi = rootFret + 3;
      // Options per higher string: muted, or any fret in the window (or open) that's a chord tone.
      const options: (number | null)[][] = [];
      for (let i = rootIdx + 1; i < 6; i++) {
        const opts: (number | null)[] = [null];
        for (let f = lo; f <= hi; f++) {
          if (tones.includes((STRING_OPEN_PC[i] + f) % 12)) opts.push(f);
        }
        if (lo > 0 && tones.includes(STRING_OPEN_PC[i])) opts.push(0);
        options.push(opts);
      }
      const walk = (i: number, acc: (number | null)[]) => {
        if (i === options.length) {
          const frets: Fret[] = [...Array(rootIdx).fill(null), rootFret, ...acc];
          const sounding = frets.filter((f): f is number => f != null);
          if (sounding.length < 4 && tones.length > 3) return;
          if (sounding.length < 3) return;
          const pcs = frets.map((f, k) => (f == null ? null : (STRING_OPEN_PC[k] + f) % 12));
          if (!required.every((t) => pcs.includes(t))) return;
          const fretted = sounding.filter((f) => f > 0);
          if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return;
          const minF = fretted.length ? Math.min(...fretted) : 0;
          const minIdx = frets.map((f, k) => (f === minF && minF > 0 ? k : -1)).filter((k) => k >= 0);
          // A barre lies flat across every string between its ends, so it can
          // only replace separate fingers if none of those strings is open or muted.
          const barreOk = minIdx.length > 1 && frets
            .slice(minIdx[0], minIdx[minIdx.length - 1] + 1)
            .every((f) => f != null && f >= minF);
          const fingersNeeded = fretted.length - (barreOk ? minIdx.length - 1 : 0);
          if (fingersNeeded > 4) return;
          // Muted strings between sounding ones are hard to play cleanly.
          const firstIdx = frets.findIndex((f) => f != null);
          const inner = frets.slice(firstIdx).reduceRight<number>(
            (n, f, k, arr) => (f == null && arr.slice(0, k).some((x) => x != null) && arr.slice(k + 1).some((x) => x != null) ? n + 1 : n), 0);
          if (inner > 1) return;
          const score = sounding.length * 2 - inner * 3 - (Math.max(...sounding) - Math.min(...sounding)) * 0.2
            - (rootFret > 9 ? 1 : 0);
          // Fingers: barre (1) on the lowest fret if several strings share it, then 2-4 by fret.
          const order = [...new Set(fretted)].sort((a, b) => a - b);
          let next = 1;
          const fingerForFret = new Map<number, number[]>();
          const fingers = frets.map(() => 0);
          frets.forEach((f, k) => {
            if (f == null || f === 0) return;
            if (!fingerForFret.has(f)) fingerForFret.set(f, []);
            fingerForFret.get(f)!.push(k);
          });
          for (const f of order) {
            const strings = fingerForFret.get(f)!;
            if (f === minF && barreOk) {
              strings.forEach((k) => { fingers[k] = 1; });
              next = 2;
            } else {
              strings.forEach((k) => { fingers[k] = Math.min(4, next++); });
            }
          }
          const barreStrings = barreOk ? minIdx : [];
          found.push({
            score,
            shape: {
              name: label,
              kind: `Root on ${6 - rootIdx}th`,
              position: minF || rootFret,
              frets,
              fingers,
              barre: barreStrings.length > 1
                ? { fret: minF, fromString: 6 - Math.min(...barreStrings), toString: 6 - Math.max(...barreStrings) }
                : undefined,
            },
          });
          return;
        }
        for (const o of options[i]) walk(i + 1, [...acc, o]);
      };
      walk(0, []);
    }
  }
  // Best per root string + octave, best first.
  const best = new Map<string, { shape: ChordShape; score: number }>();
  for (const f of found) {
    const key = `${f.shape.kind}@${f.shape.frets.find((x) => x != null)! >= 12 ? "hi" : "lo"}`;
    if (!best.has(key) || best.get(key)!.score < f.score) best.set(key, f);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((f) => f.shape);
}

/** Place a movable template with its root at `base` on `rootString` (6, 5 or 4). */
function placeMovable(label: string, kind: string, template: Movable, base: number, rootString: number): ChordShape {
  const frets = template.frets.map((f) => (f == null ? null : f + base));
  // An open string needs no finger.
  const fingers = template.fingers.map((finger, i) => (frets[i] === 0 ? 0 : finger));
  // The barre runs from the root string to the highest string that sounds.
  const mutedOnTop = [...frets].reverse().findIndex((f) => f != null);
  return {
    name: label,
    kind,
    position: base,
    frets,
    fingers,
    barre: template.barre && base > 0
      ? { fret: base, fromString: rootString, toString: 1 + Math.max(0, mutedOnTop) }
      : undefined,
  };
}

/**
 * Every way we know to play a chord: open position first (if any), then the
 * movable shapes from lowest to highest on the neck. Empty for "N" / unknown.
 */
export function getChordVoicings(label: string): ChordShape[] {
  const parsed = parseChordLabel(label);
  if (!parsed) return [];
  label = canonicalChord(label);
  const { pc, quality } = parsed;
  const out: ChordShape[] = [];

  const open = OPEN_SHAPES[SHARP_NAMES[pc] + quality];
  if (open) {
    const fretted = open.frets.filter((f): f is number => f != null && f > 0);
    out.push({ name: label, kind: "Open", position: fretted.length ? Math.min(...fretted) : 0, ...open });
  }

  const movable: ShapeCandidate[] = [];
  const eShape = E_SHAPE[quality];
  if (eShape) movable.push({ kind: "E shape", template: eShape, string: 6, base: (pc - 4 + 12) % 12 });
  const aShape = A_SHAPE[quality];
  if (aShape) movable.push({ kind: "A shape", template: aShape, string: 5, base: (pc - 9 + 12) % 12 });
  const dShape = D_SHAPE[quality];
  if (dShape) movable.push({ kind: "D shape", template: dShape, string: 4, base: (pc - 2 + 12) % 12 });

  for (const c of movable) {
    // A barre can't sit at fret 0, so it moves up an octave there.
    const base = c.base === 0 && c.template.barre ? 12 : c.base;
    out.push(placeMovable(label, base === 0 ? "Open" : c.kind, c.template, base, c.string));
  }

  // Chords without hand-made shapes (9ths, 6ths, sus2 …) get searched voicings;
  // others get them too as extra options after their standard shapes.
  out.push(...searchVoicings(label, pc, quality).slice(0, out.length ? 2 : 6));

  // Drop duplicates (e.g. the open D shape is also the table's open D).
  const seen = new Set<string>();
  const unique = out.filter((v) => {
    const key = JSON.stringify(v.frets);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const [first, ...rest] = unique;
  return first?.kind === "Open"
    ? [first, ...rest.sort((a, b) => a.position - b.position)]
    : unique.sort((a, b) => a.position - b.position);
}

interface ShapeCandidate { kind: string; template: Movable; string: number; base: number }

/** The default voicing for a chord label, or null if it has none (e.g. "N"). */
export function getChordShape(label: string): ChordShape | null {
  return getChordVoicings(label)[0] ?? null;
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
