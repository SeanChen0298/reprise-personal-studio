import { useEffect, useMemo, useRef, useState } from "react";
import { parsePitchData, freqToSemitone, type PitchPoint } from "../lib/audio-analysis";

export interface PitchDisplayPoint {
  time_ms: number;
  semitone: number;
  confidence: number;
}

interface UsePitchDataReturn {
  points: PitchDisplayPoint[];
  isLoading: boolean;
}

/**
 * Load and slice pitch data for the current line.
 * Caches the full parsed dataset and re-slices when the line window changes.
 */
export function usePitchData(
  pitchDataPath: string | undefined,
  startMs: number | undefined,
  endMs: number | undefined,
): UsePitchDataReturn {
  const [isLoading, setIsLoading] = useState(false);
  const allPointsRef = useRef<PitchPoint[]>([]);
  const loadedPathRef = useRef<string | null>(null);

  // Load and parse the full CSV when path changes
  useEffect(() => {
    if (!pitchDataPath || pitchDataPath === loadedPathRef.current) return;

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const content = await readTextFile(pitchDataPath);
        if (cancelled) return;
        allPointsRef.current = parsePitchData(content);
        loadedPathRef.current = pitchDataPath;
      } catch (err) {
        console.error("[usePitchData] Failed to load pitch data:", err);
        allPointsRef.current = [];
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pitchDataPath]);

  // Slice and convert for the current line
  const points = useMemo<PitchDisplayPoint[]>(() => {
    if (startMs == null || endMs == null || allPointsRef.current.length === 0) {
      return [];
    }

    return allPointsRef.current
      .filter((p) => p.time_ms >= startMs && p.time_ms <= endMs)
      .map((p) => ({
        time_ms: p.time_ms,
        semitone: freqToSemitone(p.freq_hz),
        confidence: p.confidence,
      }));
  }, [startMs, endMs, isLoading]);

  return { points, isLoading };
}
