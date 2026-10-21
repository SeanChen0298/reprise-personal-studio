/**
 * chord-edits.ts
 *
 * User corrections to the detected chords, stored next to the analysis as
 * chord_edits.json and applied on load. Each edit assigns a chord to a span
 * of beats ([start_ms, end_ms)), which covers renaming a chord, removing it
 * (the previous chord carries on), and changing how many beats it lasts.
 * Spans are snapped to the beat grid, which comes out the same on every
 * re-analysis, so edits survive re-analysing a song.
 *
 * Older edits without end_ms rename the detected chord starting at start_ms.
 */

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChordAnalysis, ChordSegment } from "./chord-analysis";
import { CHORD_LABEL_RE, canonicalChord, parseChordLabel } from "./chord-shapes";

export interface ChordEdit {
  start_ms: number;   // first beat the chord covers
  end_ms?: number;    // end of the span (exclusive); absent = the whole detected chord at start_ms
  label: string;      // chord for the span, e.g. "Bb7" or "N"
  detected: string;   // what the analysis said at start_ms, for reference
  edited_at: string;
  /** "restore" = put the detected chords back on this span (an undoable step itself). */
  kind?: "set" | "restore";
}

interface ChordEditsFile {
  version: 2;
  edits: ChordEdit[];
}

/** How close (ms) a time must be to a beat / chord start to count as on it. */
const TOLERANCE_MS = 80;

export function chordEditsPath(chordDataPath: string): string {
  return chordDataPath.replace(/[\\/][^\\/]*$/, "") + "/chord_edits.json";
}

export async function readChordEdits(path: string): Promise<ChordEdit[]> {
  if (!(await exists(path))) return [];
  try {
    const data = JSON.parse(await readTextFile(path)) as { edits?: ChordEdit[] };
    return Array.isArray(data.edits) ? data.edits : [];
  } catch (err) {
    console.error("[chordEdits] unreadable chord_edits.json:", err);
    return [];
  }
}

async function writeChordEdits(path: string, edits: ChordEdit[]): Promise<void> {
  // Kept in the order they were made: that order is the undo history.
  const file: ChordEditsFile = { version: 2, edits: [...edits].sort((a, b) => a.edited_at.localeCompare(b.edited_at)) };
  await writeTextFile(path, JSON.stringify(file, null, 2));
}

/**
 * Assign `label` to the beats in [start_ms, end_ms). Edits are an
 * append-only history (later ones win), so Undo can step back one at a time.
 */
export async function saveChordSpan(
  path: string,
  start_ms: number,
  end_ms: number,
  label: string,
  detected: string,
): Promise<void> {
  const edits = await readChordEdits(path);
  edits.push({ start_ms, end_ms, label: label === "N" ? "N" : canonicalChord(label), detected, edited_at: new Date().toISOString() });
  await writeChordEdits(path, edits);
}

/** Put the detected chords back on [start_ms, end_ms) — recorded as a step, so it can be undone too. */
export async function restoreDetectedSpan(path: string, start_ms: number, end_ms: number): Promise<void> {
  const edits = await readChordEdits(path);
  edits.push({ start_ms, end_ms, label: "", detected: "", kind: "restore", edited_at: new Date().toISOString() });
  await writeChordEdits(path, edits);
}

/** Remove every edit touching this chord's span (back to what was detected there). */
export async function clearChordEdits(path: string, segment: ChordSegment): Promise<void> {
  const edits = await readChordEdits(path);
  const kept = edits.filter((e) => {
    const eEnd = e.end_ms ?? e.start_ms + 1;
    return eEnd <= segment.start_ms + TOLERANCE_MS || e.start_ms >= segment.end_ms - TOLERANCE_MS;
  });
  await writeChordEdits(path, kept);
}

function relabel(segment: ChordSegment, label: string): ChordSegment {
  if (label === "N") {
    return { ...segment, label: "N", root: null, root_pc: null, quality: "N" };
  }
  label = canonicalChord(label);
  const parsed = parseChordLabel(label);
  if (!parsed) return segment;
  const root = CHORD_LABEL_RE.exec(label)?.[1] ?? label;
  return {
    ...segment,
    label,
    root,
    root_pc: parsed.pc,
    quality: parsed.quality === "" ? "maj" : parsed.quality,
  };
}

/** Return a copy of the analysis with the user's corrections applied. */
export function applyChordEdits(analysis: ChordAnalysis, edits: ChordEdit[]): ChordAnalysis {
  const detected = analysis.chords;
  const beats = analysis.beats_ms;
  if (edits.length === 0 || !detected?.length || !beats?.length) return analysis;

  // One slot per beat: which detected chord covers it, and the label to use.
  const segAt = beats.map((t) => {
    let k = 0;
    while (k + 1 < detected.length && detected[k + 1].start_ms <= t + TOLERANCE_MS / 2) k++;
    return k;
  });
  const labels = segAt.map((k) => detected[k].label);
  const edited = beats.map(() => false);

  const ordered = [...edits].sort((a, b) => a.edited_at.localeCompare(b.edited_at));
  for (const e of ordered) {
    let from = e.start_ms;
    let to = e.end_ms;
    if (to == null) {
      // Older rename-only edit: the detected chord starting here.
      const seg = detected.find((c) => Math.abs(c.start_ms - e.start_ms) <= TOLERANCE_MS);
      if (!seg) continue;
      from = seg.start_ms;
      to = seg.end_ms;
    }
    beats.forEach((t, i) => {
      if (t >= from - TOLERANCE_MS && t < to! - TOLERANCE_MS) {
        if (e.kind === "restore") {
          labels[i] = detected[segAt[i]].label;
          edited[i] = false;
        } else {
          labels[i] = e.label;
          edited[i] = true;
        }
      }
    });
  }

  // Rebuild chord segments from consecutive beats with the same chord.
  const chords: ChordSegment[] = [];
  let i = 0;
  while (i < beats.length) {
    let j = i + 1;
    while (j < beats.length && labels[j] === labels[i]) j++;
    const base = detected[segAt[i]];
    const start = i === 0 ? Math.min(beats[0], detected[0].start_ms) : beats[i];
    const end = j < beats.length ? beats[j] : detected[detected.length - 1].end_ms;
    const anyEdited = edited.slice(i, j).some(Boolean);
    const seg: ChordSegment = { ...base, start_ms: start, end_ms: end, beats: j - i };
    chords.push(
      anyEdited && labels[i] !== base.label
        ? { ...relabel(seg, labels[i]), edited: true, detected_label: base.label }
        : anyEdited
          ? { ...seg, edited: true, detected_label: base.label }
          : seg,
    );
    i = j;
  }
  return { ...analysis, chords };
}

/** Remove the most recent step (undo). A step is every edit saved at the same moment,
 *  e.g. a whole chart import. Returns false when there was nothing to undo. */
export async function undoLastChordEdit(path: string): Promise<boolean> {
  const edits = await readChordEdits(path);
  if (edits.length === 0) return false;
  const latest = edits.reduce((a, b) => (a.edited_at >= b.edited_at ? a : b)).edited_at;
  await writeChordEdits(path, edits.filter((e) => e.edited_at !== latest));
  return true;
}

/** Save several spans as one step (one Undo removes them all), e.g. an imported chart. */
export async function saveChordSpans(
  path: string,
  spans: { start_ms: number; end_ms: number; label: string }[],
): Promise<void> {
  const edits = await readChordEdits(path);
  const at = new Date().toISOString();
  for (const s of spans) {
    if (s.end_ms <= s.start_ms) continue;
    edits.push({ start_ms: s.start_ms, end_ms: s.end_ms, label: s.label === "N" ? "N" : canonicalChord(s.label), detected: "", edited_at: at });
  }
  await writeChordEdits(path, edits);
}
