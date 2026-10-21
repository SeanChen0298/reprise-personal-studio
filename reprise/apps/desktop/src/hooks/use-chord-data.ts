import { useCallback, useEffect, useState } from "react";
import { readChordAnalysis, type ChordAnalysis, type ChordSegment } from "../lib/chord-analysis";
import {
  applyChordEdits, chordEditsPath, readChordEdits, restoreDetectedSpan, saveChordSpan, undoLastChordEdit,
} from "../lib/chord-edits";

/** How long a chord should last: a number of beats, or to the end of its bar. */
export type ChordLength = number | "bar";

interface UseChordDataReturn {
  /** The analysis with the user's chord corrections applied. */
  analysis: ChordAnalysis | null;
  isLoading: boolean;
  error: string | null;
  /** Rename one chord (keeps its length). */
  editChord: (segment: ChordSegment, label: string) => Promise<void>;
  /** Make a chord last `length` beats (or to the end of its bar). Longer
   *  overwrites the following chords; shorter hands the freed beats to the next chord. */
  setChordLength: (segment: ChordSegment, length: ChordLength) => Promise<void>;
  /** Remove a chord: "next" = the following chord starts here instead;
   *  "previous" = the previous chord carries on through its beats. */
  removeChord: (segment: ChordSegment, fill: "next" | "previous") => Promise<void>;
  /** Put the detected chords back on this chord's beats (one undoable step). */
  resetChord: (segment: ChordSegment) => Promise<void>;
  /** How many corrections this song has. */
  editCount: number;
  /** Undo the most recent correction. */
  undoLastEdit: () => Promise<void>;
}

const TOLERANCE_MS = 80;

/**
 * Load a song's chords.json plus chord_edits.json. `reloadKey` should change
 * whenever the analysis may have been rewritten (e.g. pass the song's
 * chord_status + updated_at), so a re-analysis shows up without leaving the page.
 */
export function useChordData(
  chordDataPath: string | undefined,
  reloadKey?: string,
): UseChordDataReturn {
  const [analysis, setAnalysis] = useState<ChordAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editsVersion, setEditsVersion] = useState(0);
  const [editCount, setEditCount] = useState(0);

  useEffect(() => {
    if (!chordDataPath) {
      setAnalysis(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const [data, edits] = await Promise.all([
          readChordAnalysis(chordDataPath),
          readChordEdits(chordEditsPath(chordDataPath)),
        ]);
        if (cancelled) return;
        setEditCount(edits.length);
        setAnalysis(data.status === "ok" ? applyChordEdits(data, edits) : null);
        setError(data.status === "error" ? data.message ?? "Chord analysis failed" : null);
      } catch (err) {
        if (cancelled) return;
        console.error("[useChordData] Failed to load chord data:", err);
        setAnalysis(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [chordDataPath, reloadKey, editsVersion]);

  const span = useCallback(
    async (start: number, end: number, label: string, detected: string) => {
      if (!chordDataPath || end <= start) return;
      await saveChordSpan(chordEditsPath(chordDataPath), start, end, label, detected);
      setEditsVersion((v) => v + 1);
    },
    [chordDataPath],
  );

  const editChord = useCallback(
    (segment: ChordSegment, label: string) =>
      span(segment.start_ms, segment.end_ms, label, segment.detected_label ?? segment.label),
    [span],
  );

  // Neighbours by time, so these also work on part of a chord (e.g. just
  // the part inside one bar of a chord that carries over from the bar before).
  const chordAfter = useCallback(
    (t: number) => (analysis?.chords ?? []).find((c) => c.start_ms >= t - TOLERANCE_MS),
    [analysis],
  );
  const chordBefore = useCallback(
    (t: number) => {
      const before = (analysis?.chords ?? []).filter((c) => c.start_ms < t - TOLERANCE_MS);
      return before[before.length - 1];
    },
    [analysis],
  );

  const setChordLength = useCallback(
    async (segment: ChordSegment, length: ChordLength) => {
      const beats = analysis?.beats_ms ?? [];
      const chords = analysis?.chords ?? [];
      const at = beats.findIndex((t) => Math.abs(t - segment.start_ms) <= TOLERANCE_MS);
      if (at < 0) return;
      let end: number;
      if (length === "bar") {
        const bar = analysis?.bars?.find((b) => b.start_ms <= segment.start_ms + TOLERANCE_MS && segment.start_ms < b.end_ms);
        end = bar?.end_ms ?? segment.end_ms;
      } else {
        end = beats[at + length] ?? analysis?.duration_ms ?? segment.end_ms;
      }
      const detected = segment.detected_label ?? segment.label;
      if (end >= segment.end_ms - TOLERANCE_MS) {
        await span(segment.start_ms, end, segment.label, detected);
      } else {
        // Shorter: the next chord starts earlier and takes the freed beats.
        const next = chordAfter(segment.end_ms);
        await span(end, segment.end_ms, next ? next.label : "N", detected);
      }
      void chords;
    },
    [analysis, span, chordAfter],
  );

  const removeChord = useCallback(
    async (segment: ChordSegment, fill: "next" | "previous") => {
      const next = chordAfter(segment.end_ms);
      const prev = chordBefore(segment.start_ms);
      const neighbour = fill === "next" ? next ?? prev : prev ?? next;
      await span(segment.start_ms, segment.end_ms, neighbour ? neighbour.label : "N", segment.detected_label ?? segment.label);
    },
    [span, chordAfter, chordBefore],
  );

  const undoLastEdit = useCallback(async () => {
    if (!chordDataPath) return;
    if (await undoLastChordEdit(chordEditsPath(chordDataPath))) setEditsVersion((v) => v + 1);
  }, [chordDataPath]);

  const resetChord = useCallback(
    async (segment: ChordSegment) => {
      if (!chordDataPath) return;
      await restoreDetectedSpan(chordEditsPath(chordDataPath), segment.start_ms, segment.end_ms);
      setEditsVersion((v) => v + 1);
    },
    [chordDataPath],
  );

  return { analysis, isLoading, error, editChord, setChordLength, removeChord, resetChord, editCount, undoLastEdit };
}
