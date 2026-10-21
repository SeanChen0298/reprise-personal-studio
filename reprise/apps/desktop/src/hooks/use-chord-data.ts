import { useCallback, useEffect, useState } from "react";
import { readChordAnalysis, type ChordAnalysis, type ChordSegment } from "../lib/chord-analysis";
import { applyChordEdits, chordEditsPath, readChordEdits, saveChordEdit } from "../lib/chord-edits";

interface UseChordDataReturn {
  /** The analysis with the user's chord corrections applied. */
  analysis: ChordAnalysis | null;
  isLoading: boolean;
  error: string | null;
  /** Correct one chord (pass its detected label to undo the correction). */
  editChord: (segment: ChordSegment, label: string) => Promise<void>;
}

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

  const editChord = useCallback(
    async (segment: ChordSegment, label: string) => {
      if (!chordDataPath) return;
      await saveChordEdit(chordEditsPath(chordDataPath), segment, label);
      setEditsVersion((v) => v + 1);
    },
    [chordDataPath],
  );

  return { analysis, isLoading, error, editChord };
}
