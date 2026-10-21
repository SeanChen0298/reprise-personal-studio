/**
 * chord-relations.ts
 *
 * Chords that share most of their notes and are easy to confuse by ear or
 * by analysis — e.g. Dmaj7 (D F# A C#) and F#m7 (F# A C# E) share three
 * notes; only the bass decides between them. Used to offer one-click
 * alternatives when correcting a chord.
 */

import { parseChordLabel, QUALITY_INTERVALS as INTERVALS, QUALITY_SUFFIXES } from "./chord-shapes";
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Pitch classes (0–11) in a chord, or [] for "N" / unknown. */
export function chordPitchClasses(label: string): number[] {
  const parsed = parseChordLabel(label);
  if (!parsed) return [];
  return INTERVALS[parsed.quality].map((iv) => (parsed.pc + iv) % 12);
}

export function noteNames(pcs: number[]): string[] {
  return pcs.map((pc) => NAMES[pc]);
}

export interface RelatedChord {
  label: string;
  /** Notes both chords contain. */
  shared: string[];
  /** Short reason, e.g. "same notes, A in the bass". */
  why: string;
}

/**
 * Chords sharing at least all-but-one of the smaller chord's notes with
 * `label`, best matches first. Same-root variants (D vs Dmaj7) come first,
 * then different-root relatives (Dmaj7 vs F#m7).
 */
export function relatedChords(label: string, limit = 8): RelatedChord[] {
  const parsed = parseChordLabel(label);
  if (!parsed) return [];
  const mine = chordPitchClasses(label);
  const out: (RelatedChord & { score: number })[] = [];

  for (let root = 0; root < 12; root++) {
    for (const q of QUALITY_SUFFIXES) {
      const candidate = NAMES[root] + q;
      if (root === parsed.pc && q === parsed.quality) continue;
      const theirs = INTERVALS[q].map((iv) => (root + iv) % 12);
      const shared = mine.filter((pc) => theirs.includes(pc));
      const smaller = Math.min(mine.length, theirs.length);
      if (shared.length < Math.max(2, smaller - 1)) continue;

      const sameRoot = root === parsed.pc;
      const why = sameRoot
        ? `same root, ${shared.length} shared notes`
        : shared.length === theirs.length
          ? `every ${candidate} note is in ${label}`
          : shared.length === mine.length
            ? `every ${label} note is in ${candidate}`
            : `${shared.length} shared notes, ${NAMES[root]} in the bass`;
      // Prefer more shared notes and few added ones, then same root, then
      // common chord types over colour chords.
      const added = theirs.length - shared.length;
      const colour = ["dim", "m7b5", "sus4", "sus2", "aug", "dim7", "7sus4", "6", "m6"].includes(q) ? 2 : 0;
      const extended = ["maj9", "9", "m9", "add9"].includes(q) ? 2 : 0;
      const score = shared.length * 10 - added * 4 + (sameRoot ? 3 : 0) - colour - extended;
      out.push({ label: candidate, shared: noteNames(shared), why, score });
    }
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}
