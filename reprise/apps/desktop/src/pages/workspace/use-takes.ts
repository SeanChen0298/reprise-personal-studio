// Takes: sung-along recording (lead-in, count-in, section auto-stop), saving,
// breath / high-note review, and short A/B snippets — on the workspace's player.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { remove } from "@tauri-apps/plugin-fs";
import { useRecorder } from "../../hooks/use-recorder";
import { useSongStore } from "../../stores/song-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { analyzeRecording, canReview, issueSongStartMs, needsAnalysis } from "../../lib/take-review";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import type { Line, Recording, Section, Song, TakeIssue } from "../../types/song";

/** Music played before the start line so there's something to come in on. */
const LEAD_IN_MS = 2000;
/** A section take keeps recording this long after the section's last line. */
const STOP_TAIL_MS = 1500;

export type Backing = NonNullable<Recording["backing"]>;

interface Options {
  song: Song;
  lines: Line[];
  sections: Section[];
  player: UseLinePlayerReturn;
  backing: Backing;
  /** Track path playing for "Original" snippets. */
  originalPath: string | undefined;
  /** Microphone chosen in Settings (empty = system default). */
  inputDeviceId?: string;
}

export function useTakes({ song, lines, sections, player, backing, originalPath, inputDeviceId }: Options) {
  const recorder = useRecorder();
  const addRecording = useSongStore((s) => s.addRecording);
  const updateRecording = useSongStore((s) => s.updateRecording);
  const recordings = useSongStore((s) => s.recordings[song.id]);
  const takes = useMemo(
    () => [...(recordings ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [recordings],
  );

  const recordCountIn = usePreferencesStore((s) => s.recordCountIn);
  const [singAlong, setSingAlong] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const cancelCountdownRef = useRef(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stopAtMs, setStopAtMs] = useState<number | null>(null);
  const [takeSection, setTakeSection] = useState<Section | null>(null);
  const [pending, setPending] = useState<{
    filePath: string;
    durationMs: number;
    songStartMs?: number;
    backing?: Backing;
  } | null>(null);
  const syncRef = useRef<{ songStartMs: number; backing: Backing } | null>(null);
  const restoreRef = useRef<{ speed: number; loop: boolean } | null>(null);

  const recording = recorder.isRecording && countdown == null;
  const busy = recorder.isRecording || countdown != null;

  /** Section end (+ tail) for a section take. */
  const sectionEndMs = useCallback(
    (sec: Section) => {
      const ends = lines
        .filter((l) => l.order >= sec.start_line_order && l.order <= sec.end_line_order && l.end_ms != null)
        .map((l) => l.end_ms!);
      return ends.length ? Math.max(...ends) + STOP_TAIL_MS : null;
    },
    [lines],
  );

  const start = useCallback(
    async (fromLine: Line | null, section: Section | null = null) => {
      if (!song.audio_folder || busy || pending) return;
      stopSnippet();
      const audio = player.audioRef.current;
      const withSong = singAlong && !!audio && !!song.audio_path;
      player.pause();
      // The review lines the take up with the song at normal speed, without loops.
      restoreRef.current = { speed: player.speed, loop: player.loopEnabled };
      if (withSong) {
        if (player.speed !== 1) player.setSpeed(1);
        if (player.loopEnabled) player.toggleLoop();
        player.setLoopRange(null);
      }
      const lineStart = fromLine?.start_ms;
      if (withSong && lineStart != null) player.seekTo(Math.max(0, lineStart - LEAD_IN_MS));
      setTakeSection(section);
      setStopAtMs(section ? sectionEndMs(section) : null);
      setElapsedSec(0);
      syncRef.current = null;

      // The mic opens now; the count-in gives you (and it) a moment to settle.
      if (!(await recorder.startRecording("free", song.audio_folder, inputDeviceId || undefined))) {
        // No mic — don't count in and play the song as if recording.
        restorePlayer();
        return;
      }
      cancelCountdownRef.current = false;
      for (let n = recordCountIn; n > 0; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 1000));
        if (cancelCountdownRef.current) {
          setCountdown(null);
          const discarded = await recorder.stopRecording();
          if (discarded) remove(discarded.filePath).catch(() => {});
          restorePlayer();
          return;
        }
      }
      setCountdown(null);
      timerRef.current = setInterval(() => setElapsedSec((t) => t + 1), 1000);

      if (withSong && audio) {
        const songPosMs = audio.currentTime * 1000;
        try {
          await audio.play();
          player.play(); // syncs the player's isPlaying state
          // Take time 0 ↔ song position: the song started (now − recorder start) ms into the take.
          const intoTakeMs = performance.now() - recorder.getStartedAt();
          syncRef.current = { songStartMs: Math.round(songPosMs - intoTakeMs), backing };
        } catch {
          // Couldn't start the song — it's just a free take then.
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song, busy, pending, singAlong, player, recorder, recordCountIn, sectionEndMs, backing, inputDeviceId],
  );

  const restorePlayer = useCallback(() => {
    const r = restoreRef.current;
    restoreRef.current = null;
    if (!r) return;
    if (r.speed !== 1) player.setSpeed(r.speed);
    if (r.loop && !player.loopEnabled) player.toggleLoop();
  }, [player]);

  const stop = useCallback(async () => {
    if (countdown != null) {
      cancelCountdownRef.current = true;
      return;
    }
    if (!recorder.isRecording) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    player.pause();
    const result = await recorder.stopRecording();
    restorePlayer();
    if (result) {
      setPending({
        filePath: result.filePath,
        durationMs: result.durationMs,
        songStartMs: syncRef.current?.songStartMs,
        backing: syncRef.current?.backing,
      });
    }
  }, [countdown, recorder, player, restorePlayer]);

  // A section take ends with the section; any take ends with the song.
  const nowMs = player.currentTime * 1000;
  useEffect(() => {
    if (recording && player.isPlaying && stopAtMs != null && nowMs >= stopAtMs) stop();
  }, [recording, player.isPlaying, stopAtMs, nowMs, stop]);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  useEffect(() => {
    const audio = player.audioRef.current;
    if (!audio) return;
    const onEnded = () => recordingRef.current && stopRef.current();
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [player.audioRef]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // ── Review ───────────────────────────────────────────────────────────────
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Record<string, number>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});

  const runAnalysis = useCallback(
    async (rec: Recording) => {
      setAnalyzing((m) => ({ ...m, [rec.id]: 0 }));
      setAnalysisErrors(({ [rec.id]: _, ...rest }) => rest);
      try {
        const analysis = await analyzeRecording(rec, song, lines, (f) =>
          setAnalyzing((m) => (rec.id in m ? { ...m, [rec.id]: f } : m)),
        );
        await updateRecording(song.id, rec.id, { analysis });
      } catch (err) {
        console.error("[takes] analysis failed:", err);
        setAnalysisErrors((m) => ({ ...m, [rec.id]: err instanceof Error ? err.message : String(err) }));
      } finally {
        setAnalyzing(({ [rec.id]: _, ...rest }) => rest);
      }
    },
    [song, lines, updateRecording],
  );

  const openReview = useCallback(
    (recId: string) => {
      setReviewId((cur) => (cur === recId ? null : recId));
      const rec = takes.find((r) => r.id === recId);
      if (rec && needsAnalysis(rec) && !(rec.id in analyzing)) runAnalysis(rec);
    },
    [takes, analyzing, runAnalysis],
  );

  const save = useCallback(
    async (note: string) => {
      if (!pending) return;
      const now = new Date().toISOString();
      const rec: Recording = {
        id: crypto.randomUUID(),
        song_id: song.id,
        line_id: null,
        section_id: takeSection?.id,
        file_path: pending.filePath,
        duration_ms: pending.durationMs,
        is_master_take: false,
        is_best_take: false,
        note: note.trim() || undefined,
        song_start_ms: pending.songStartMs,
        backing: pending.backing,
        created_at: now,
        updated_at: now,
      };
      await addRecording(song.id, rec);
      setPending(null);
      if (canReview(rec, song)) {
        setReviewId(rec.id);
        runAnalysis(rec);
      }
    },
    [pending, song, takeSection, addRecording, runAnalysis],
  );

  const discard = useCallback(() => {
    if (pending) remove(pending.filePath).catch(() => {});
    setPending(null);
  }, [pending]);

  // ── Snippets: ~8 s of your take vs the original around a spot ────────────
  const snippetRef = useRef<HTMLAudioElement | null>(null);
  const [snippetKey, setSnippetKey] = useState<string | null>(null);
  const stopSnippet = useCallback(() => {
    snippetRef.current?.pause();
    snippetRef.current = null;
    setSnippetKey(null);
  }, []);
  useEffect(() => () => stopSnippet(), [stopSnippet]);

  const playSnippet = useCallback(
    (key: string, path: string, fromMs: number, volume: number) => {
      if (snippetKey === key) return stopSnippet();
      stopSnippet();
      mixRef.current?.take.pause();
      mixRef.current?.backing.pause();
      mixRef.current = null;
      setMixId(null);
      player.pause();
      const el = new Audio(convertFileSrc(path));
      el.volume = volume;
      el.currentTime = Math.max(0, fromMs / 1000);
      const stopAt = fromMs / 1000 + 8;
      el.ontimeupdate = () => el.currentTime >= stopAt && stopSnippet();
      el.onended = () => stopSnippet();
      snippetRef.current = el;
      setSnippetKey(key);
      el.play().catch(() => stopSnippet());
    },
    [snippetKey, stopSnippet, player],
  );

  const reviewRec = reviewId ? takes.find((r) => r.id === reviewId) ?? null : null;

  // ── Your take over the backing, lined up with the song ───────────────────
  const mixRef = useRef<{ take: HTMLAudioElement; backing: HTMLAudioElement } | null>(null);
  const [mixId, setMixId] = useState<string | null>(null);
  const backingPath = song.instrumental_path || song.audio_path || null;
  const stopMix = useCallback(() => {
    const m = mixRef.current;
    mixRef.current = null;
    if (m) {
      m.take.pause();
      m.backing.pause();
    }
    setMixId(null);
  }, []);
  useEffect(() => () => stopMix(), [stopMix]);
  const canPlayMix = (rec: Recording) => rec.song_start_ms != null && !!backingPath;

  /** Play a sung-along take with the instrumental (or the song) under it, from `fromTakeMs`. */
  const playMix = useCallback(
    async (rec: Recording, fromTakeMs = 0) => {
      if (mixId === rec.id) return stopMix();
      stopMix();
      stopSnippet();
      player.pause();
      if (rec.song_start_ms == null || !backingPath) return;
      const take = new Audio(convertFileSrc(rec.file_path));
      const backing = new Audio(convertFileSrc(backingPath));
      backing.volume = Math.min(1, player.volume * 0.8);
      // take time t ↔ song time t + song_start_ms − lag (the measured mic/output delay)
      const songMs = fromTakeMs + rec.song_start_ms - (rec.analysis?.lag_ms ?? 0);
      take.currentTime = Math.max(0, fromTakeMs / 1000);
      backing.currentTime = Math.max(0, songMs / 1000);
      take.onended = () => stopMix();
      backing.onended = () => stopMix();
      mixRef.current = { take, backing };
      setMixId(rec.id);
      try {
        await Promise.all([take.play(), backing.play()]);
        // Starting two elements is never perfectly simultaneous — line them up once more.
        const drift = take.currentTime * 1000 - fromTakeMs - (backing.currentTime * 1000 - songMs);
        if (Math.abs(drift) > 30) backing.currentTime += drift / 1000;
      } catch {
        stopMix();
      }
    },
    [mixId, stopMix, stopSnippet, player, backingPath],
  );

  const playIssueYou = useCallback(
    (issue: TakeIssue, key: string) => {
      if (!reviewRec?.analysis || reviewRec.song_start_ms == null) return;
      const takeMs = issueSongStartMs(issue) - reviewRec.song_start_ms + reviewRec.analysis.lag_ms;
      playSnippet(`you:${key}`, reviewRec.file_path, takeMs, 1);
    },
    [reviewRec, playSnippet],
  );

  const playIssueOriginal = useCallback(
    (issue: TakeIssue, key: string) => {
      if (originalPath) playSnippet(`orig:${key}`, originalPath, issueSongStartMs(issue), player.volume);
    },
    [originalPath, playSnippet, player.volume],
  );

  /** Problems of the reviewed take, by line, for the lyric sheet. */
  const issuesByLine = useMemo(() => {
    const m = new Map<string, { issue: TakeIssue; key: string }[]>();
    (reviewRec?.analysis?.issues ?? []).forEach((issue, i) => {
      if (!issue.line_id) return;
      const arr = m.get(issue.line_id) ?? [];
      arr.push({ issue, key: `${reviewRec!.id}:${i}` });
      m.set(issue.line_id, arr);
    });
    return m;
  }, [reviewRec]);

  // Sections can be deleted while a take referenced them — drop stale state.
  useEffect(() => {
    if (takeSection && !sections.some((s) => s.id === takeSection.id)) setTakeSection(null);
  }, [sections, takeSection]);

  return {
    recorder,
    takes,
    singAlong,
    setSingAlong,
    countdown,
    recording,
    busy,
    elapsedSec,
    stopAtMs,
    takeSection,
    pending,
    start,
    stop,
    save,
    discard,
    reviewRec,
    reviewId,
    setReviewId,
    openReview,
    runAnalysis,
    analyzing,
    analysisErrors,
    snippetKey,
    stopSnippet,
    playIssueYou,
    playIssueOriginal,
    issuesByLine,
    mixId,
    playMix,
    stopMix,
    canPlayMix,
    backingIsInstrumental: !!song.instrumental_path,
  };
}

export type TakesState = ReturnType<typeof useTakes>;
