// Playback for the song screen: one track at a time (original / instrumental /
// vocals), follows the lyrics by position, loops a line or a section, speed
// 0.5–1.0× in 0.05 steps with pitch kept.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS, type AVPlaybackStatus } from "expo-av";
import type { Line } from "@reprise/shared/core";

export type LoopMode = "off" | "line" | "section";

interface Options {
  uri: string | null;
  lines: Line[];
  /** [startMs, endMs] of the current section, for section loops. */
  sectionRange: (lineIndex: number) => [number, number] | null;
  onLinePlayed?: (index: number) => void;
  /** Start here (opened from Play all at this point of the song). */
  initialMs?: number;
  /** …and keep playing. */
  initialPlay?: boolean;
}

/** Index of the line playing at `ms` (the last line that has started), or -1. */
export function lineAt(lines: Line[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = lines[mid].start_ms;
    if (s == null) {
      // Untimed lines: fall back to a scan.
      return lines.reduce((f, l, i) => (l.start_ms != null && l.start_ms <= ms ? i : f), -1);
    }
    if (s <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function useLinePlayer({ uri, lines, sectionRange, onLinePlayed, initialMs = 0, initialPlay = false }: Options) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(initialMs);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoopState] = useState<LoopMode>("off");
  const loopModeRef = useRef<LoopMode>("off");
  loopModeRef.current = loop;
  /** The loop's span, fixed when the loop starts (so it doesn't drift with the playhead). */
  const loopRangeRef = useRef<[number, number] | null>(null);
  const [cursor, setCursor] = useState(() => Math.max(0, lineAt(lines, initialMs)));
  const posRef = useRef(initialMs);
  const playingRef = useRef(initialPlay);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const playedRef = useRef(onLinePlayed);
  playedRef.current = onLinePlayed;
  const lastLineRef = useRef(-1);
  /** Stop when reaching this position (one-shot "play this line"). */
  const stopAtRef = useRef<number | null>(null);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  }, []);

  const onStatus = useCallback((st: AVPlaybackStatus) => {
    if (!st.isLoaded) {
      if (st.error) setError(st.error);
      return;
    }
    const pos = st.positionMillis;
    posRef.current = pos;
    playingRef.current = st.isPlaying;
    setPositionMs(pos);
    setIsPlaying(st.isPlaying);
    if (st.durationMillis) setDurationMs(st.durationMillis);

    // Loop first, so the cursor never runs past the looped line / section.
    const range = loopRangeRef.current;
    if (st.isPlaying && range && pos >= range[1]) {
      void soundRef.current?.setPositionAsync(range[0]);
      return;
    }
    if (st.isPlaying && stopAtRef.current != null && pos >= stopAtRef.current) {
      stopAtRef.current = null;
      void soundRef.current?.pauseAsync();
    }
    const idx = lineAt(linesRef.current, pos);
    if (idx !== lastLineRef.current) {
      if (st.isPlaying && lastLineRef.current >= 0 && idx === lastLineRef.current + 1) playedRef.current?.(lastLineRef.current);
      lastLineRef.current = idx;
      // Inside a loop the cursor stays put (a section loop crosses lines; its range is fixed).
      if (idx >= 0 && st.isPlaying && !range) setCursor(idx);
    }
  }, []);

  // Load (or switch) the track, keeping the position and play state.
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    const keep = { pos: posRef.current, play: playingRef.current };
    setReady(false);
    setError(null);
    (async () => {
      try {
        const old = soundRef.current;
        soundRef.current = null;
        if (old) await old.unloadAsync().catch(() => {});
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, progressUpdateIntervalMillis: 50, positionMillis: keep.pos, rate: speed, shouldCorrectPitch: true },
          onStatus,
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        setReady(true);
        if (keep.play) await sound.playAsync();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  useEffect(
    () => () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    },
    [],
  );

  const setSpeed = useCallback((v: number) => {
    const s = Math.round(Math.min(1, Math.max(0.5, v)) * 20) / 20;
    setSpeedState(s);
    void soundRef.current?.setRateAsync(s, true);
  }, []);

  const seek = useCallback(async (ms: number) => {
    posRef.current = Math.max(0, ms);
    setPositionMs(posRef.current);
    await soundRef.current?.setPositionAsync(posRef.current);
  }, []);

  const play = useCallback(async () => {
    stopAtRef.current = null;
    await soundRef.current?.playAsync();
  }, []);
  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
  }, []);
  const toggle = useCallback(async () => (playingRef.current ? pause() : play()), [play, pause]);

  const rangeFor = useCallback(
    (mode: LoopMode, idx: number): [number, number] | null => {
      if (mode === "line") {
        const l = linesRef.current[idx];
        if (l?.start_ms == null) return null;
        const next = linesRef.current[idx + 1]?.start_ms;
        return [l.start_ms, l.end_ms ?? next ?? l.start_ms + 4000];
      }
      if (mode === "section") return sectionRange(idx);
      return null;
    },
    [sectionRange],
  );

  /** Move the cursor to a line and play from its start (with a short lead-in). */
  const playLine = useCallback(
    async (idx: number, leadInMs = 300) => {
      const l = linesRef.current[idx];
      setCursor(idx);
      if (l?.start_ms == null) return;
      // A running loop moves to the new line before seeking (or it would pull the playhead back).
      if (loopModeRef.current !== "off") loopRangeRef.current = rangeFor(loopModeRef.current, idx);
      stopAtRef.current = null;
      await seek(Math.max(0, l.start_ms - leadInMs));
      await soundRef.current?.playAsync();
    },
    [seek, rangeFor],
  );

  const setLoop = useCallback(
    (mode: LoopMode, at?: number) => {
      const idx = at ?? cursor;
      if (at != null) setCursor(at);
      const range = mode === "off" ? null : rangeFor(mode, idx);
      loopRangeRef.current = range;
      const next = range || mode === "off" ? mode : "off";
      loopModeRef.current = next;
      setLoopState(next);
    },
    [cursor, rangeFor],
  );

  // The cursor moved to another line (tap / next): a running loop follows it.
  useEffect(() => {
    if (loop !== "off") loopRangeRef.current = rangeFor(loop, cursor);
  }, [cursor, loop, rangeFor]);

  const step = useCallback(
    async (delta: number) => {
      const idx = Math.min(linesRef.current.length - 1, Math.max(0, cursor + delta));
      if (playingRef.current) await playLine(idx);
      else {
        setCursor(idx);
        const s = linesRef.current[idx]?.start_ms;
        if (s != null) await seek(s);
      }
    },
    [cursor, playLine, seek],
  );

  /** The line under the playhead (follows a section loop too). */
  const playingIndex = useMemo(() => lineAt(lines, positionMs), [lines, positionMs]);
  /** The line to highlight: the playing one while playing, else the cursor. */
  const activeIndex = isPlaying && playingIndex >= 0 ? playingIndex : cursor;

  /** The current line's progress 0–1 (for the bar under it). */
  const lineProgress = useMemo(() => {
    const l = lines[activeIndex];
    if (l?.start_ms == null) return 0;
    const end = l.end_ms ?? lines[activeIndex + 1]?.start_ms ?? l.start_ms + 4000;
    return Math.min(1, Math.max(0, (positionMs - l.start_ms) / Math.max(1, end - l.start_ms)));
  }, [lines, activeIndex, positionMs]);

  return {
    soundRef,
    ready,
    error,
    positionMs,
    durationMs,
    isPlaying,
    speed,
    setSpeed,
    loop,
    setLoop,
    cursor,
    setCursor,
    playingIndex,
    activeIndex,
    lineProgress,
    play,
    pause,
    toggle,
    seek,
    playLine,
    step,
    /** The live position (state can lag a render behind). */
    getPositionMs: () => posRef.current,
    isPlayingNow: () => playingRef.current,
    /** Stop at this song position (used to stop a section take). */
    stopAt: (ms: number | null) => {
      stopAtRef.current = ms;
    },
  };
}

export type LinePlayer = ReturnType<typeof useLinePlayer>;
