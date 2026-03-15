import { useCallback, useEffect, useRef, useState } from "react";
import { Audio, type AVPlaybackStatus } from "expo-av";
import type { Line } from "@reprise/shared";

const MAX_LOOPS_CYCLE = [1, 2, 3, 5, 0] as const; // 0 = ∞

export interface UseLinePlayerReturn {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  lineProgress: number; // 0–1 within current line

  currentLineIndex: number;
  setCurrentLineIndex: (i: number) => void;

  loopEnabled: boolean;
  toggleLoop: () => void;
  loopCount: number;
  maxLoops: number;
  cycleMaxLoops: () => void;

  speed: number;
  setSpeed: (s: number) => void;
  incrementSpeed: () => void;
  decrementSpeed: () => void;

  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlay: () => Promise<void>;
  goToLine: (index: number, autoPlay?: boolean) => Promise<void>;
  nextLine: () => Promise<void>;
  prevLine: () => Promise<void>;

  audioReady: boolean;
  audioError: string | null;
}

interface Options {
  audioPath: string | undefined;
  lines: Line[];
  initialLineIndex?: number;
  onLineChange?: (index: number) => void;
}

export function useLinePlayer({
  audioPath,
  lines,
  initialLineIndex = 0,
  onLineChange,
}: Options): UseLinePlayerReturn {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [currentLineIndex, setCurrentLineIndex] = useState(initialLineIndex);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopCount, setLoopCount] = useState(1);
  const [maxLoops, setMaxLoops] = useState(3);
  const [speed, setSpeedState] = useState(1.0);

  // Refs for interval callback to avoid stale closures
  const stateRef = useRef({
    positionMs: 0,
    isPlaying: false,
    currentLineIndex,
    loopEnabled,
    loopCount,
    maxLoops,
    lines,
    onLineChange,
    speed,
  });
  stateRef.current = {
    positionMs,
    isPlaying,
    currentLineIndex,
    loopEnabled,
    loopCount,
    maxLoops,
    lines,
    onLineChange,
    speed,
  };

  // Whether the last line change was user-initiated (needs seek to start_ms)
  const userNavigatedRef = useRef(false);
  // Backup timeout for catching line end between 100ms intervals
  const backupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Audio loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!audioPath) return;

    let sound: Audio.Sound | null = null;
    let cancelled = false;

    setAudioReady(false);
    setAudioError(null);
    setIsPlaying(false);

    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        });

        const { sound: s } = await Audio.Sound.createAsync(
          { uri: audioPath },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          (status: AVPlaybackStatus) => {
            if (!status.isLoaded) return;
            setPositionMs(status.positionMillis);
            setDurationMs(status.durationMillis ?? 0);
            setIsPlaying(status.isPlaying);
            if (status.didJustFinish) setIsPlaying(false);
          }
        );

        if (cancelled) {
          await s.unloadAsync();
          return;
        }

        sound = s;
        soundRef.current = s;
        setAudioReady(true);
      } catch (err) {
        if (!cancelled) {
          setAudioError(err instanceof Error ? err.message : "Failed to load audio");
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      sound?.unloadAsync();
      soundRef.current = null;
      setAudioReady(false);
    };
  }, [audioPath]);

  // ── Apply speed changes ───────────────────────────────────────────────────

  useEffect(() => {
    if (!audioReady || !soundRef.current) return;
    soundRef.current.setRateAsync(speed, true).catch(() => {});
  }, [speed, audioReady]);

  // ── Seek to line start when line index changes via loop-mode advancement ──
  // goToLine handles its own seeking; only the interval sets this flag.

  useEffect(() => {
    if (!userNavigatedRef.current) return;
    userNavigatedRef.current = false;
    const sound = soundRef.current;
    if (!sound || !audioReady) return;
    const line = lines[currentLineIndex];
    if (line?.start_ms != null) {
      sound.setPositionAsync(line.start_ms).catch(() => {});
    }
  }, [currentLineIndex, audioReady, lines]);

  // ── Polling interval: loop/advance logic ─────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const st = stateRef.current;
      if (!st.isPlaying) return;

      const line = st.lines[st.currentLineIndex];
      const hasTs = line?.start_ms != null && line?.end_ms != null;
      if (!hasTs) return;

      const pos = st.positionMs;
      if (pos < line.end_ms!) return; // not at end yet

      if (st.loopEnabled) {
        const infinite = st.maxLoops === 0;
        if (infinite || st.loopCount < st.maxLoops) {
          // Replay same line
          setLoopCount((c) => c + 1);
          soundRef.current?.setPositionAsync(line.start_ms!).catch(() => {});
        } else {
          // Advance to next line
          const nextIdx = st.currentLineIndex + 1;
          setLoopCount(1);
          if (nextIdx < st.lines.length) {
            userNavigatedRef.current = true; // trigger seek in the effect
            setCurrentLineIndex(nextIdx);
            st.onLineChange?.(nextIdx);
          } else {
            soundRef.current?.pauseAsync().catch(() => {});
          }
        }
      } else {
        // Follow-along: advance without seeking
        const nextIdx = st.currentLineIndex + 1;
        if (nextIdx < st.lines.length) {
          setCurrentLineIndex(nextIdx);
          st.onLineChange?.(nextIdx);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // ── Backup timeout: force-trigger interval logic at exact end_ms boundary ─
  // Compensates for 100ms polling lag — seeks line start when within 50ms of end.

  useEffect(() => {
    if (backupTimerRef.current) {
      clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
    }
    if (!isPlaying) return;
    const line = lines[currentLineIndex];
    if (line?.end_ms == null || line.start_ms == null) return;
    const remaining = line.end_ms - positionMs - 50;
    if (remaining <= 0) return;
    const { start_ms } = line;
    backupTimerRef.current = setTimeout(() => {
      const st = stateRef.current;
      if (!st.isPlaying) return;
      if (st.loopEnabled) {
        const infinite = st.maxLoops === 0;
        if (infinite || st.loopCount < st.maxLoops) {
          setLoopCount((c) => c + 1);
          soundRef.current?.setPositionAsync(start_ms).catch(() => {});
        } else {
          const nextIdx = st.currentLineIndex + 1;
          setLoopCount(1);
          if (nextIdx < st.lines.length) {
            userNavigatedRef.current = true;
            setCurrentLineIndex(nextIdx);
            st.onLineChange?.(nextIdx);
          } else {
            soundRef.current?.pauseAsync().catch(() => {});
          }
        }
      } else {
        const nextIdx = st.currentLineIndex + 1;
        if (nextIdx < st.lines.length) {
          setCurrentLineIndex(nextIdx);
          st.onLineChange?.(nextIdx);
        }
      }
    }, remaining);
    return () => {
      if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentLineIndex, lines]);

  // ── Computed lineProgress ─────────────────────────────────────────────────

  const line = lines[currentLineIndex] as Line | undefined;
  const lineStartMs = line?.start_ms ?? 0;
  const lineEndMs = line?.end_ms ?? 0;
  const lineDurationMs = lineEndMs - lineStartMs;
  const lineProgress =
    lineDurationMs > 0
      ? Math.min(1, Math.max(0, (positionMs - lineStartMs) / lineDurationMs))
      : 0;

  // ── Controls ──────────────────────────────────────────────────────────────

  const play = useCallback(async () => {
    await soundRef.current?.playAsync();
  }, []);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
  }, []);

  const togglePlay = useCallback(async () => {
    if (stateRef.current.isPlaying) await pause();
    else await play();
  }, [play, pause]);

  const goToLine = useCallback(
    async (index: number, autoPlay = true) => {
      if (index < 0 || index >= lines.length) return;
      // Do NOT set userNavigatedRef — we seek directly below; the effect skips.
      setCurrentLineIndex(index);
      setLoopCount(1);
      onLineChange?.(index);
      const targetLine = lines[index];
      if (soundRef.current && targetLine?.start_ms != null) {
        await soundRef.current.setPositionAsync(targetLine.start_ms);
        if (autoPlay) await soundRef.current.playAsync();
      }
    },
    [lines, onLineChange]
  );

  const nextLine = useCallback(async () => {
    await goToLine(stateRef.current.currentLineIndex + 1);
  }, [goToLine]);

  const prevLine = useCallback(async () => {
    await goToLine(stateRef.current.currentLineIndex - 1);
  }, [goToLine]);

  const toggleLoop = useCallback(() => {
    setLoopEnabled((v) => !v);
    setLoopCount(1);
  }, []);

  const cycleMaxLoops = useCallback(() => {
    setMaxLoops((current) => {
      const idx = MAX_LOOPS_CYCLE.indexOf(current as (typeof MAX_LOOPS_CYCLE)[number]);
      const next = idx === -1 || idx === MAX_LOOPS_CYCLE.length - 1 ? 0 : idx + 1;
      return MAX_LOOPS_CYCLE[next];
    });
  }, []);

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
    positionMs,
    durationMs,
    isPlaying,
    lineProgress,
    currentLineIndex,
    setCurrentLineIndex,
    loopEnabled,
    toggleLoop,
    loopCount,
    maxLoops,
    cycleMaxLoops,
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
    audioReady,
    audioError,
  };
}
