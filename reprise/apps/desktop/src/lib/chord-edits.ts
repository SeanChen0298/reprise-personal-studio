/**
 * chord-edits.ts
 *
 * User corrections to individual detected chords. Stored next to the
 * analysis as chord_edits.json, keyed by the chord's start time, so they
 * survive re-analysis (the beat grid — and so the chord boundaries — come
 * out the same each run) and are applied on load.
 */

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ChordAnalysis, ChordSegment } from "./chord-analysis";
import { CHORD_LABEL_RE, canonicalChord, parseChordLabel } from "./chord-shapes";

export interface ChordEdit {
  start_ms: number;   // start of the chord segment being corrected
  label: string;      // corrected label, e.g. "Bb7" or "N"
  detected: string;   // what the analysis said, for "reset"
  edited_at: string;
}

interface ChordEditsFile {
  version: 1;
  edits: ChordEdit[];
}

/** How close (ms) an edit's start must be to a segment's start to apply. */
const MATCH_TOLERANCE_MS = 80;

export function chordEditsPath(chordDataPath: string): string {
  return chordDataPath.replace(/[\\/][^\\/]*$/, "") + "/chord_edits.json";
}

export async function readChordEdits(path: string): Promise<ChordEdit[]> {
  if (!(await exists(path))) return [];
  try {
    const data = JSON.parse(await readTextFile(path)) as ChordEditsFile;
    return Array.isArray(data.edits) ? data.edits : [];
  } catch (err) {
    console.error("[chordEdits] unreadable chord_edits.json:", err);
    return [];
  }
}

/** Set (or clear, when `label` equals the detected chord) the correction for one segment. */
export async function saveChordEdit(
  path: string,
  segment: ChordSegment,
  label: string,
): Promise<void> {
  const edits = await readChordEdits(path);
  const detected = segment.detected_label ?? segment.label;
  const rest = edits.filter((e) => Math.abs(e.start_ms - segment.start_ms) > MATCH_TOLERANCE_MS);
  if (label !== detected) {
    rest.push({ start_ms: segment.start_ms, label, detected, edited_at: new Date().toISOString() });
  }
  rest.sort((a, b) => a.start_ms - b.start_ms);
  const file: ChordEditsFile = { version: 1, edits: rest };
  await writeTextFile(path, JSON.stringify(file, null, 2));
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
  if (edits.length === 0 || !analysis.chords) return analysis;
  const chords = analysis.chords.map((segment) => {
    const edit = edits.find((e) => Math.abs(e.start_ms - segment.start_ms) <= MATCH_TOLERANCE_MS);
    if (!edit) return segment;
    return { ...relabel(segment, edit.label), edited: true, detected_label: segment.label };
  });
  return { ...analysis, chords };
}
