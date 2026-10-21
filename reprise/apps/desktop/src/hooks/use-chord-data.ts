import { useCallback, useEffect, useState } from "react";
import { readChordAnalysis, type ChordAnalysis, type ChordSegment } from "../lib/chord-analysis";
import {
  applyChordEdits, chordEditsPath, clearChordEdits, readChordEdits, saveChordSpan,
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
  /** Remove a chord: the previous chord carries on through its beats. */
  removeChord: (segment: ChordSegment) => Promise<void>;
  /** Drop every correction touching this chord. */
  resetChord: (segment: ChordSegment) => Promise<void>;
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
        const idx = chords.findIndex((c) => Math.abs(c.start_ms - segment.start_ms) <= TOLERANCE_MS);
        const next = chords[idx + 1];
        await span(end, segment.end_ms, next ? next.label : "N", detected);
      }
    },
    [analysis, span],
  );

  const removeChord = useCallback(
    async (segment: ChordSegment) => {
      const chords = analysis?.chords ?? [];
      const idx = chords.findIndex((c) => Math.abs(c.start_ms - segment.start_ms) <= TOLERANCE_MS);
      const neighbour = chords[idx - 1] ?? chords[idx + 1];
      await span(segment.start_ms, segment.end_ms, neighbour ? neighbour.label : "N", segment.detected_label ?? segment.label);
    },
    [analysis, span],
  );

  const resetChord = useCallback(
    async (segment: ChordSegment) => {
      if (!chordDataPath) return;
      await clearChordEdits(chordEditsPath(chordDataPath), segment);
      setEditsVersion((v) => v + 1);
    },
    [chordDataPath],
  );

  return { analysis, isLoading, error, editChord, setChordLength, removeChord, resetChord };
}
