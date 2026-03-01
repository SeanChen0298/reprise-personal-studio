import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Line } from "../types/song";

export interface UseLinePlayerReturn {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  audioSrc: string;

  currentLineIndex: number;
  isPlaying: boolean;
  currentTime: number;
  lineProgress: number;

  loopEnabled: boolean;
  toggleLoop: () => void;
  loopCount: number;
  maxLoops: number;
  setMaxLoops: (n: number) => void;

  speed: number;
  setSpeed: (s: number) => void;
  incrementSpeed: () => void;
  decrementSpeed: () => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  goToLine: (index: number) => void;
  nextLine: () => void;
  prevLine: () => void;
  seekWithinLine: (fraction: number) => void;
}

interface Options {
  audioPath: string;
  lines: Line[];
  initialLineIndex?: number;
  initialSpeed?: number;
  maxLoops?: number;
  onLineChange?: (index: number) => void;
}

export function useLinePlayer(opts: Options): UseLinePlayerReturn {
  const { audioPath, lines, onLineChange } = opts;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSrc = audioPath ? convertFileSrc(audioPath) : "";

  const [currentLineIndex, setCurrentLineIndex] = useState(opts.initialLineIndex ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopCount, setLoopCount] = useState(1);
  const [maxLoops, setMaxLoops] = useState(opts.maxLoops ?? 3);
  const [speed, setSpeedState] = useState(opts.initialSpeed ?? 1.0);

  const currentLine = lines[currentLineIndex] as Line | undefined;
  const lineStartSec = (currentLine?.start_ms ?? 0) / 1000;
  const lineEndSec = (currentLine?.end_ms ?? 0) / 1000;
  const hasTimestamps = currentLine?.start_ms != null && currentLine?.end_ms != null;
  const lineDuration = hasTimestamps ? lineEndSec - lineStartSec : 0;
  const lineProgress = lineDuration > 0 ? Math.min(1, Math.max(0, (currentTime - lineStartSec) / lineDuration)) : 0;

  // Refs for RAF loop to avoid stale closures
  const stateRef = useRef({
    currentLineIndex,
    isPlaying,
    loopEnabled,
    loopCount,
    maxLoops,
    lines,
    onLineChange,
  });
  stateRef.current = { currentLineIndex, isPlaying, loopEnabled, loopCount, maxLoops, lines, onLineChange };

  const rafRef = useRef<number>(0);

  // Track whether the line change was user-initiated (click/prev/next) vs auto-advance
  const userNavigatedRef = useRef(false);

  // Seek to line start when line changes (only in loop mode or user-initiated)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasTimestamps) return;
    // In follow-along mode, only seek if user clicked a specific line
    if (!loopEnabled && !userNavigatedRef.current) return;
    userNavigatedRef.current = false;
    audio.currentTime = lineStartSec;
    setCurrentTime(lineStartSec);
    setLoopCount(1);
  }, [currentLineIndex, lineStartSec, hasTimestamps, loopEnabled]);

  // Apply speed changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  // RAF polling for precise segment boundary detection
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      const st = stateRef.current;
      if (audio && st.isPlaying) {
        const t = audio.currentTime;
        setCurrentTime(t);

        const line = st.lines[st.currentLineIndex];
        const hasTs = line?.start_ms != null && line?.end_ms != null;

        if (st.loopEnabled) {
          // Loop mode: replay line N times, then advance
          if (hasTs && t >= (line.end_ms! / 1000)) {
            if (st.loopCount < st.maxLoops) {
              audio.currentTime = line.start_ms! / 1000;
              setLoopCount((c) => c + 1);
            } else {
              const nextIdx = st.currentLineIndex + 1;
              if (nextIdx < st.lines.length) {
                setCurrentLineIndex(nextIdx);
                setLoopCount(1);
                st.onLineChange?.(nextIdx);
              } else {
                audio.pause();
                setIsPlaying(false);
              }
            }
          }
        } else {
          // Follow-along mode: advance active line as audio plays through
          if (hasTs && t >= (line.end_ms! / 1000)) {
            const nextIdx = st.currentLineIndex + 1;
            if (nextIdx < st.lines.length) {
              setCurrentLineIndex(nextIdx);
              st.onLineChange?.(nextIdx);
              // Don't seek — let audio continue naturally
            } else {
              audio.pause();
              setIsPlaying(false);
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
  }, []);

  const toggleLoop = useCallback(() => {
    setLoopEnabled((v) => !v);
    setLoopCount(1);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const goToLine = useCallback(
    (index: number) => {
      if (index < 0 || index >= lines.length) return;
      userNavigatedRef.current = true;
      setCurrentLineIndex(index);
      setLoopCount(1);
      onLineChange?.(index);
      // Seek to line start and always start playback
      const audio = audioRef.current;
      const line = lines[index];
      if (audio && line?.start_ms != null) {
        audio.currentTime = line.start_ms / 1000;
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    },
    [lines, onLineChange, isPlaying]
  );

  const nextLine = useCallback(() => {
    goToLine(currentLineIndex + 1);
  }, [currentLineIndex, goToLine]);

  const prevLine = useCallback(() => {
    goToLine(currentLineIndex - 1);
  }, [currentLineIndex, goToLine]);

  const seekWithinLine = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || !hasTimestamps) return;
      const targetTime = lineStartSec + fraction * lineDuration;
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
    },
    [hasTimestamps, lineStartSec, lineDuration]
  );

  const setSpeed = useCallback((s: number) => {
    setSpeedState(Math.round(Math.min(1.0, Math.max(0.5, s)) * 100) / 100);
  }, []);

  const incrementSpeed = useCallback(() => {
    setSpeedState((s) => Math.round(Math.min(1.0, s + 0.05) * 100) / 100);
  }, []);

  const decrementSpeed = useCallback(() => {
    setSpeedState((s) => Math.round(Math.max(0.5, s - 0.05) * 100) / 100);
  }, []);

  return {
    audioRef,
    audioSrc,
    currentLineIndex,
    isPlaying,
    currentTime,
    lineProgress,
    loopEnabled,
    toggleLoop,
    loopCount,
    maxLoops,
    setMaxLoops,
    speed,
    setSpeed,
    incrementSpeed,
    decrementSpeed,
    play,
    pause,
    togglePlay,
    goToLine,
    nextLine,
    prevLine,
    seekWithinLine,
  };
}
