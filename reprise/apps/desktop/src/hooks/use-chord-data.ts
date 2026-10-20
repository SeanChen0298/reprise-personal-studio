import { useEffect, useState } from "react";
import { readChordAnalysis, type ChordAnalysis } from "../lib/chord-analysis";

interface UseChordDataReturn {
  analysis: ChordAnalysis | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Load a song's chords.json. `reloadKey` should change whenever the file may
 * have been rewritten (e.g. pass the song's chord_status + updated_at), so a
 * re-analysis shows up without leaving the page.
 */
export function useChordData(
  chordDataPath: string | undefined,
  reloadKey?: string,
): UseChordDataReturn {
  const [analysis, setAnalysis] = useState<ChordAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const data = await readChordAnalysis(chordDataPath);
        if (cancelled) return;
        setAnalysis(data.status === "ok" ? data : null);
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
  }, [chordDataPath, reloadKey]);

  return { analysis, isLoading, error };
}
