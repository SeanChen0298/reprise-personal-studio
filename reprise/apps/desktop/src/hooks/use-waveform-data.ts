import { useEffect, useRef, useState } from "react";

interface WaveformResult {
  /** Normalized amplitude peaks (0–1) for the requested time range */
  peaks: number[];
  loading: boolean;
}

// Cache decoded audio buffers by src URL to avoid re-decoding
const bufferCache = new Map<string, AudioBuffer>();

/**
 * Decodes audio from `audioSrc`, extracts waveform peaks for the
 * `startMs`–`endMs` segment, and returns normalized amplitude bars.
 */
export function useWaveformData(
  audioSrc: string | undefined,
  startMs: number | undefined,
  endMs: number | undefined,
  /** Number of bars to return (default 120) */
  samples = 120,
  /** If true, ignore startMs/endMs and use the full audio buffer */
  fullFile = false,
): WaveformResult {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!audioSrc) { setPeaks([]); return; }
    if (!fullFile && (startMs == null || endMs == null || endMs <= startMs)) {
      setPeaks([]);
      return;
    }

    // Abort any in-flight decode and clear stale peaks immediately
    abortRef.current?.abort();
    setPeaks([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let cancelled = false;

    async function decode() {
      setLoading(true);
      try {
        let audioBuffer = bufferCache.get(audioSrc!);

        if (!audioBuffer) {
          const response = await fetch(audioSrc!);
          if (cancelled) return;
          const arrayBuffer = await response.arrayBuffer();
          if (cancelled) return;
          const ctx = new AudioContext();
          audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          if (cancelled) return;
          bufferCache.set(audioSrc!, audioBuffer);
        }

        // Extract segment
        const sampleRate = audioBuffer.sampleRate;
        const startSample = fullFile ? 0 : Math.floor((startMs! / 1000) * sampleRate);
        const endSample = fullFile
          ? audioBuffer.length
          : Math.min(Math.floor((endMs! / 1000) * sampleRate), audioBuffer.length);
        const segmentLength = endSample - startSample;
        if (segmentLength <= 0) {
          setPeaks([]);
          return;
        }

        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(segmentLength / samples));
        const result: number[] = [];

        for (let i = 0; i < samples; i++) {
          const blockStart = startSample + blockSize * i;
          if (blockStart >= endSample) break;
          let sum = 0;
          const count = Math.min(blockSize, endSample - blockStart);
          for (let j = 0; j < count; j++) {
            sum += Math.abs(rawData[blockStart + j]);
          }
          result.push(sum / count);
        }

        // Normalize with sqrt to compress dynamic range — quiet-but-audible
        // parts remain visible even when one loud peak dominates the segment
        const max = Math.max(...result, 0.001);
        const normalized = result.map((v) => Math.sqrt(v / max));

        if (!cancelled) {
          setPeaks(normalized);
        }
      } catch {
        if (!cancelled) setPeaks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    decode();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [audioSrc, startMs, endMs, samples, fullFile]);

  return { peaks, loading };
}
