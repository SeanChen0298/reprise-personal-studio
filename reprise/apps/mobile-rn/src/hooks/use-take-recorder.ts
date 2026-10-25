// Sung-along takes on the phone: rewind to the line minus a lead-in, count in,
// play the song and record; a section take stops at the section's end. The take
// remembers where in the song it started (song_start_ms) so the computer can
// line it up and review breath / high notes.
import { useCallback, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import type { Line, Section } from "@reprise/shared/core";
import type { LinePlayer } from "./use-line-player";
import type { TrackKind } from "../stores/library-store";

const LEAD_IN_MS = 2000;
const STOP_TAIL_MS = 1500;

const BACKING: Record<TrackKind, "original" | "vocal" | "instrumental"> = {
  audio: "original",
  vocals: "vocal",
  instrumental: "instrumental",
};

export interface PendingTake {
  uri: string;
  durationMs: number;
  songStartMs?: number;
  backing: "original" | "vocal" | "instrumental";
  sectionId?: string;
}

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 160000,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 160000,
  },
};

export function useTakeRecorder(
  player: LinePlayer,
  lines: Line[],
  countIn: number,
  track: TrackKind,
  /** Called when the screen closes with a take in progress or unsaved — keep it rather than lose it. */
  onKeep: (take: PendingTake) => void,
) {
  const keepRef = useRef(onKeep);
  keepRef.current = onKeep;
  const recRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef(0);
  const syncRef = useRef<number | undefined>(undefined);
  const sectionRef = useRef<Section | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const cancelRef = useRef(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pending, setPending] = useState<PendingTake | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sectionEnd = useCallback(
    (sec: Section) => {
      const ends = lines
        .filter((l) => l.order >= sec.start_line_order && l.order <= sec.end_line_order && l.end_ms != null)
        .map((l) => l.end_ms!);
      return ends.length ? Math.max(...ends) + STOP_TAIL_MS : null;
    },
    [lines],
  );

  const start = useCallback(
    async (fromLine: Line | null, section: Section | null) => {
      if (recRef.current || countdown != null || pending) return;
      setError(null);
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setError("Reprise needs the microphone to record. Allow it in the phone's settings.");
        return;
      }
      await player.pause();
      if (fromLine?.start_ms != null) await player.seek(Math.max(0, fromLine.start_ms - LEAD_IN_MS));
      sectionRef.current = section;
      stopAtRef.current = section ? sectionEnd(section) : null;
      syncRef.current = undefined;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: true });
        const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
        recRef.current = recording;
        startedAtRef.current = Date.now();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't start recording.");
        return;
      }
      cancelRef.current = false;
      for (let n = countIn; n > 0; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelRef.current) {
          setCountdown(null);
          const r = recRef.current;
          recRef.current = null;
          if (r) {
            await r.stopAndUnloadAsync().catch(() => {});
            const uri = r.getURI();
            if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
          }
          return;
        }
      }
      setCountdown(null);
      setRecording(true);
      const songPos = player.getPositionMs();
      await player.play();
      // Take time 0 ↔ song position: the song started (now − recording start) ms into the take.
      syncRef.current = Math.round(songPos - (Date.now() - startedAtRef.current));
    },
    [countdown, pending, player, sectionEnd, countIn],
  );

  const stop = useCallback(async () => {
    if (countdown != null) {
      cancelRef.current = true;
      return;
    }
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    setRecording(false);
    await player.pause();
    try {
      await r.stopAndUnloadAsync();
    } catch {
      /* already stopped */
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true }).catch(() => {});
    const uri = r.getURI();
    const status = await r.getStatusAsync().catch(() => null);
    if (!uri) return;
    setPending({
      uri,
      durationMs: status?.durationMillis || Date.now() - startedAtRef.current,
      songStartMs: syncRef.current,
      backing: BACKING[track],
      sectionId: sectionRef.current?.id,
    });
  }, [countdown, player, track]);

  // Section takes stop with the section; any take stops with the song.
  useEffect(() => {
    if (!recording) return;
    const end = stopAtRef.current;
    if ((end != null && player.positionMs >= end) || (player.durationMs > 0 && player.positionMs >= player.durationMs - 50)) void stop();
  }, [recording, player.positionMs, player.durationMs, stop]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(t);
  }, [recording]);

  // Leaving the screen mid-take: close the mic and keep what was sung (it can be deleted later).
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const trackRef = useRef(track);
  trackRef.current = track;
  useEffect(
    () => () => {
      cancelRef.current = true;
      const r = recRef.current;
      recRef.current = null;
      if (pendingRef.current) keepRef.current(pendingRef.current);
      if (!r) return;
      const startedAt = startedAtRef.current;
      const songStartMs = syncRef.current;
      const sectionId = sectionRef.current?.id;
      void r
        .stopAndUnloadAsync()
        .catch(() => {})
        .then(() => {
          const uri = r.getURI();
          if (uri && songStartMs != null) {
            keepRef.current({ uri, durationMs: Date.now() - startedAt, songStartMs, backing: BACKING[trackRef.current], sectionId });
          }
        });
    },
    [],
  );

  const discard = useCallback(async () => {
    if (pending) await FileSystem.deleteAsync(pending.uri, { idempotent: true });
    setPending(null);
  }, [pending]);

  return { start, stop, countdown, recording, busy: recording || countdown != null, elapsedMs, pending, setPending, discard, error };
}
