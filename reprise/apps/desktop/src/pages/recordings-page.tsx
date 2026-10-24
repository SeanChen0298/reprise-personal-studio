import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { remove } from "@tauri-apps/plugin-fs";
import WaveSurfer from "wavesurfer.js";
import { Sidebar } from "../components/sidebar";
import { AnnotatedText } from "../components/annotated-text";
import { ConfirmDialog } from "../components/confirm-dialog";
import { useSongStore } from "../stores/song-store";
import { useHighlightStore } from "../lib/highlight-config";
import { useRecorder } from "../hooks/use-recorder";
import { playRecordingWithGain } from "../lib/play-recording";
import { usePreferencesStore } from "../stores/preferences-store";
import { formatMs } from "../lib/status-config";
import { TakeReviewPanel } from "../components/take-review-panel";
import {
  ISSUE_LABEL,
  analyzeRecording,
  canReview,
  isBreathIssue,
  issueSongStartMs,
  loadVocalMap,
  needsAnalysis,
} from "../lib/take-review";
import { LONG_PHRASE_MS, lineVocalInfo, semitoneToNoteName, type VocalMap } from "../lib/vocal-map";
import type { Recording, Line, Section, TakeIssue } from "../types/song";

/** Music played before the start line so there's something to come in on. */
const LEAD_IN_MS = 2000;
/** A section take keeps recording this long after the section's last line. */
const STOP_TAIL_MS = 1500;

/** Live mic level while recording — confirms the mic is picking you up. */
function MicMeter({ getLevel }: { getLevel: () => number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const level = Math.min(1, getLevel() * 3);
      if (barRef.current) barRef.current.style.width = `${Math.round(level * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);
  return (
    <div className="w-[70px] h-[5px] rounded-full bg-[var(--bg)] overflow-hidden" title="Mic level">
      <div ref={barRef} className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: 0 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WaveSurfer thumbnail (renders peaks from the recording file, display-only)
// ---------------------------------------------------------------------------

function RecordingWaveform({
  filePath,
  isPlaying,
  onEnded,
  volume = 1,
}: {
  filePath: string;
  isPlaying: boolean;
  onEnded: () => void;
  volume?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const gain = usePreferencesStore((s) => s.recordingPlaybackGain);
  const gainRef = useRef(gain);
  gainRef.current = gain;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ws = WaveSurfer.create({
      container: el,
      waveColor: "var(--border)",
      progressColor: "var(--theme)",
      height: 28,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      interact: true,
      normalize: true,
    });

    wsRef.current = ws;
    ws.load(convertFileSrc(filePath)).catch(() => {});
    ws.on("finish", () => onEndedRef.current());

    // Route audio through Web Audio GainNode so gain can exceed 1.0
    ws.on("ready", () => {
      try {
        const mediaEl = ws.getMediaElement();
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(mediaEl);
        const gainNode = ctx.createGain();
        gainNode.gain.value = gainRef.current;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        gainNodeRef.current = gainNode;
        audioCtxRef.current = ctx;
      } catch {
        // fallback: no amplification beyond 1.0
      }
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
      gainNodeRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync gain when preference changes
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain;
  }, [gain]);

  // Sync volume
  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  // Sync play/pause from parent
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (isPlaying) {
      audioCtxRef.current?.resume().catch(() => {});
      ws.play().catch(() => {});
    } else {
      ws.pause();
    }
  }, [isPlaying]);

  return <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden" />;
}

// ---------------------------------------------------------------------------
// Single recording row
// ---------------------------------------------------------------------------

interface RecordingEntryProps {
  rec: Recording;
  line: Line | null;
  sectionName: string | null;
  songId: string;
  songAudioPath: string | undefined;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleBestTake: (id: string) => void;
  onDelete: (id: string) => void;
  onPlay: (rec: Recording) => void;
  onPlayEnded: (id: string) => void;
  onCompare: (rec: Recording) => void;
  playingId: string | null;
  comparingId: string | null;
  volume: number;
  /** Set for sung-along takes that can be reviewed. */
  review?: {
    active: boolean;
    analyzing: boolean;
    onOpen: (id: string) => void;
  };
}

function RecordingEntry({
  rec,
  line,
  sectionName,
  selectMode,
  selected,
  onToggleSelect,
  onToggleBestTake,
  onDelete,
  onPlay,
  onPlayEnded,
  onCompare,
  playingId,
  comparingId,
  volume,
  review,
}: RecordingEntryProps) {
  const isPlaying = playingId === rec.id;
  const isComparing = comparingId === rec.id;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-[8px] transition-colors ${
        isPlaying || isComparing ? "bg-[var(--theme-light)]" : "hover:bg-[var(--bg)]"
      } ${selected ? "ring-1 ring-[var(--theme)]" : ""}`}
    >
      {/* Checkbox (select mode) */}
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(rec.id)}
          className="flex-shrink-0 w-4 h-4 accent-[var(--theme)] cursor-pointer"
        />
      )}

      {/* Play / Pause */}
      <button
        onClick={() => onPlay(rec)}
        title={isPlaying ? "Pause" : "Play"}
        className="w-7 h-7 flex-shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center justify-center cursor-pointer"
      >
        {isPlaying ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Waveform */}
      <RecordingWaveform
        filePath={rec.file_path}
        isPlaying={isPlaying}
        onEnded={() => onPlayEnded(rec.id)}
        volume={volume}
      />

      {/* Meta */}
      <div className="flex-shrink-0 flex flex-col items-end gap-[2px] min-w-[80px]">
        <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
          {formatMs(rec.duration_ms)}
        </span>
        <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
          {formatDate(rec.created_at)}
        </span>
      </div>

      {/* Label chips */}
      <div className="flex-shrink-0 flex flex-col items-start gap-[2px] min-w-[80px]">
        {sectionName && (
          <span className="text-[9.5px] font-medium px-[5px] py-[1px] rounded-[3px] bg-[var(--theme-light)] text-[var(--theme-text)]">
            {sectionName}
          </span>
        )}
        {rec.note && (
          <span
            className="text-[10px] text-[var(--text-muted)] truncate max-w-[120px]"
            title={rec.note}
          >
            {rec.note}
          </span>
        )}
        {review && (
          <button
            onClick={() => review.onOpen(rec.id)}
            title="Breath & high-note review"
            className={`text-[9.5px] font-medium px-[5px] py-[1px] rounded-[3px] border cursor-pointer transition-colors ${
              review.active
                ? "bg-[var(--theme)] text-white border-[var(--theme)]"
                : "bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--theme)] hover:text-[var(--theme)]"
            }`}
          >
            {review.analyzing
              ? "Analyzing…"
              : rec.analysis
                ? `Review · ${rec.analysis.issues.filter((i) => isBreathIssue(i.kind)).length} breath · ${rec.analysis.issues.filter((i) => !isBreathIssue(i.kind)).length} high`
                : "Review"}
          </button>
        )}
      </div>

      {/* Actions (hidden until hover, always visible when active) */}
      <div className={`flex-shrink-0 flex items-center gap-1 transition-opacity ${isPlaying || isComparing || rec.is_best_take ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {/* Compare */}
        {line?.start_ms != null && line?.end_ms != null && (
          <button
            onClick={() => onCompare(rec)}
            title={isComparing ? "Stop compare" : "Quick compare: original → recording"}
            className={`flex items-center gap-[3px] text-[9px] font-bold px-[5px] py-[2px] rounded-[4px] border cursor-pointer transition-all ${
              isComparing
                ? "bg-[var(--theme)] text-white border-[var(--theme)]"
                : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--theme)] hover:text-[var(--theme)]"
            }`}
          >
            A→B
          </button>
        )}

        {/* Best take star */}
        <button
          onClick={() => onToggleBestTake(rec.id)}
          title={rec.is_best_take ? "Remove best take" : "Mark as best take"}
          className={`w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent transition-colors ${
            rec.is_best_take ? "text-amber-400" : "text-[var(--text-muted)] hover:text-amber-400"
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={rec.is_best_take ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        {/* Delete */}
        {!selectMode && (
          <button
            onClick={() => onDelete(rec.id)}
            title="Delete recording"
            className="w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent text-[var(--text-muted)] hover:text-red-500 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group header
// ---------------------------------------------------------------------------

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-1 mt-4 first:mt-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
        {label}
      </span>
      <span className="text-[10px] text-[var(--text-muted)]">
        {count} take{count !== 1 ? "s" : ""}
      </span>
      <div className="flex-1 h-px bg-[var(--border-subtle)]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function RecordingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ── Resizable split panel ─────────────────────────────────────────────────
  const [splitPct, setSplitPct] = useState(50);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const onSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = splitContainerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(75, Math.max(25, pct)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));
  const rawSections = useSongStore((s) => (id ? s.sections[id] : undefined));
  const allRecordings = useSongStore((s) => (id ? s.recordings[id] : undefined));
  const addRecording = useSongStore((s) => s.addRecording);
  const removeRecording = useSongStore((s) => s.removeRecording);
  const updateRecording = useSongStore((s) => s.updateRecording);
  const highlights = useHighlightStore((s) => s.highlights);
  const playbackVolume = usePreferencesStore((s) => s.playbackVolume);
  const setPlaybackVolume = usePreferencesStore((s) => s.setPlaybackVolume);

  // Main lines: exclude translation lines from the lyric list
  const lines = useMemo(() => {
    if (!rawLines) return [];
    const transLang = song?.translation_language;
    return [...rawLines]
      .filter((l) => !transLang || l.language !== transLang)
      .sort((a, b) => a.order - b.order);
  }, [rawLines, song?.translation_language]);

  // Translation subtext by line order
  const translationByOrder = useMemo(() => {
    const transLang = song?.translation_language;
    if (!transLang || !rawLines) return new Map<number, string>();
    return new Map(
      rawLines.filter((l) => l.language === transLang).map((l) => [l.order, l.text])
    );
  }, [rawLines, song?.translation_language]);

  // Full line lookup (all languages) so recording entries always resolve their line
  const lineById = useMemo(
    () => new Map((rawLines ?? []).map((l) => [l.id, l])),
    [rawLines],
  );
  const sections = useMemo(() => rawSections ?? [], [rawSections]);
  const recordings = useMemo(() => allRecordings ?? [], [allRecordings]);

  // ── Free recording ───────────────────────────────────────────────────────
  const recorder = useRecorder();
  const [recordingTimer, setRecordingTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pendingRec, setPendingRec] = useState<{ filePath: string; durationMs: number } | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const noteInputRef = useRef<HTMLInputElement>(null);

  const [pendingSync, setPendingSync] = useState<{ songStartMs: number; backing: Recording["backing"] } | null>(null);
  /** Sing along: the take starts the song and is lined up with it for review. */
  const [singAlong, setSingAlong] = useState(true);

  const discardPendingRec = useCallback(async () => {
    if (pendingRec) {
      remove(pendingRec.filePath).catch(() => {});
    }
    setPendingRec(null);
    setPendingNote("");
    setPendingSync(null);
  }, [pendingRec]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Playback ─────────────────────────────────────────────────────────────
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const compareLineAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopAllPlayback = useCallback(() => {
    compareLineAudioRef.current?.pause();
    compareLineAudioRef.current = null;
    setPlayingId(null);
    setComparingId(null);
  }, []);

  // WaveSurfer handles actual playback — just toggle the ID
  const handlePlay = useCallback((rec: Recording) => {
    if (playingId === rec.id) {
      setPlayingId(null);
      return;
    }
    stopAllPlayback();
    setPlayingId(rec.id);
  }, [playingId, stopAllPlayback]);

  const handlePlayEnded = useCallback((id: string) => {
    setPlayingId((prev) => (prev === id ? null : prev));
  }, []);

  const handleCompare = useCallback((rec: Recording) => {
    if (comparingId === rec.id) {
      stopAllPlayback();
      return;
    }
    stopAllPlayback();

    const line = rec.line_id ? lines.find((l) => l.id === rec.line_id) : null;
    const hasTimestamps = line && line.start_ms != null && line.end_ms != null && song?.audio_path;

    if (!hasTimestamps) {
      // No line timestamps — just play the recording directly
      handlePlay(rec);
      return;
    }

    setComparingId(rec.id);

    // Play original line segment first
    const lineAudio = new Audio(convertFileSrc(song!.audio_path!));
    lineAudio.currentTime = line!.start_ms! / 1000;
    compareLineAudioRef.current = lineAudio;

    const endSec = line!.end_ms! / 1000;

    const checkEnd = () => {
      if (lineAudio.currentTime >= endSec) {
        lineAudio.pause();
        lineAudio.removeEventListener("timeupdate", checkEnd);
        compareLineAudioRef.current = null;
        // Then play the recording
        playRecordingWithGain(rec.file_path, () => {
          setComparingId((prev) => (prev === rec.id ? null : prev));
        }).catch(() => setComparingId((prev) => (prev === rec.id ? null : prev)));
      }
    };

    lineAudio.addEventListener("timeupdate", checkEnd);
    lineAudio.onended = () => {
      lineAudio.removeEventListener("timeupdate", checkEnd);
      setComparingId((prev) => (prev === rec.id ? null : prev));
    };
    lineAudio.play().catch(() => setComparingId((prev) => (prev === rec.id ? null : prev)));
  }, [comparingId, lines, song, stopAllPlayback, handlePlay]);

  // Stop playback on unmount
  useEffect(() => () => stopAllPlayback(), [stopAllPlayback]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !id) return;
    const rec = recordings.find((r) => r.id === deleteTarget);
    if (rec) {
      if (playingId === rec.id || comparingId === rec.id) stopAllPlayback();
      remove(rec.file_path).catch(() => {});
      removeRecording(id, rec.id);
    }
    setDeleteTarget(null);
  }, [deleteTarget, id, recordings, playingId, comparingId, stopAllPlayback, removeRecording]);

  // ── Select mode + bulk delete ────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  const toggleSelect = useCallback((recId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recId)) next.delete(recId);
      else next.add(recId);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!id) return;
    for (const recId of selected) {
      const rec = recordings.find((r) => r.id === recId);
      if (rec) {
        if (playingId === rec.id || comparingId === rec.id) stopAllPlayback();
        remove(rec.file_path).catch(() => {});
        removeRecording(id, rec.id);
      }
    }
    exitSelectMode();
    setShowBulkConfirm(false);
  }, [id, selected, recordings, playingId, comparingId, stopAllPlayback, removeRecording, exitSelectMode]);

  // ── Grouping ─────────────────────────────────────────────────────────────
  const freeRecordings = useMemo(
    () => recordings.filter((r) => r.line_id === null),
    [recordings],
  );

  const sectionGroups = useMemo(() => {
    return sections
      .map((sec) => ({
        section: sec,
        recordings: recordings.filter((r) => r.section_id === sec.id),
      }))
      .filter((g) => g.recordings.length > 0);
  }, [sections, recordings]);

  const lineGroups = useMemo(() => {
    return lines
      .map((line) => ({
        line,
        recordings: recordings.filter((r) => r.line_id === line.id && !r.section_id),
      }))
      .filter((g) => g.recordings.length > 0);
  }, [lines, recordings]);

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  // ── Song playback (lyrics panel) ─────────────────────────────────────────
  const songAudioRef = useRef<HTMLAudioElement | null>(null);
  const songRafRef = useRef<number>(0);
  const [songSrcKey, setSongSrcKey] = useState<"original" | "vocal" | "instrumental">("original");
  const [songPlaying, setSongPlaying] = useState(false);
  const [songCurrentMs, setSongCurrentMs] = useState(0);

  const songAudioSources = useMemo(() => {
    const srcs: Array<{ key: "original" | "vocal" | "instrumental"; label: string; path: string }> = [];
    if (song?.audio_path) srcs.push({ key: "original", label: "Original", path: song.audio_path });
    if (song?.vocals_path) srcs.push({ key: "vocal", label: "Vocal", path: song.vocals_path });
    if (song?.instrumental_path) srcs.push({ key: "instrumental", label: "Inst.", path: song.instrumental_path });
    return srcs;
  }, [song?.audio_path, song?.vocals_path, song?.instrumental_path]);

  const currentSongPath = useMemo(() => {
    const src = songAudioSources.find((s) => s.key === songSrcKey) ?? songAudioSources[0];
    return src?.path;
  }, [songSrcKey, songAudioSources]);

  // Build flat lyric items: section headers interleaved before their first line
  const lyricItems = useMemo(() => {
    const sorted = [...sections].sort((a, b) => a.start_line_order - b.start_line_order);
    type Item = { kind: "section"; section: Section } | { kind: "line"; line: Line };
    const items: Item[] = [];
    const sectionAtOrder = new Map(sorted.map((s) => [s.start_line_order, s]));
    for (const line of lines) {
      const sec = sectionAtOrder.get(line.order);
      if (sec) items.push({ kind: "section", section: sec });
      items.push({ kind: "line", line });
    }
    return items;
  }, [lines, sections]);

  // Which line is currently playing
  const playingLineId = useMemo(() => {
    if (!songPlaying) return null;
    return lines.find(
      (l) => l.start_ms != null && l.end_ms != null && songCurrentMs >= l.start_ms && songCurrentMs < l.end_ms
    )?.id ?? null;
  }, [songPlaying, songCurrentMs, lines]);

  // RAF loop — track song position
  useEffect(() => {
    const tick = () => {
      const audio = songAudioRef.current;
      if (audio && !audio.paused) setSongCurrentMs(audio.currentTime * 1000);
      songRafRef.current = requestAnimationFrame(tick);
    };
    songRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(songRafRef.current);
  }, []);

  // Load new source when key changes
  useEffect(() => {
    const audio = songAudioRef.current;
    if (!audio) return;
    if (currentSongPath) {
      audio.pause();
      audio.src = convertFileSrc(currentSongPath);
      setSongPlaying(false);
      setSongCurrentMs(0);
    }
  }, [currentSongPath]);

  // Sync playback volume to song audio element
  useEffect(() => {
    const audio = songAudioRef.current;
    if (audio) audio.volume = playbackVolume;
  }, [playbackVolume]);

  // Track ended
  useEffect(() => {
    const audio = songAudioRef.current;
    if (!audio) return;
    const onEnded = () => setSongPlaying(false);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(songRafRef.current);
    songAudioRef.current?.pause();
  }, []);

  const toggleSongPlay = useCallback(() => {
    const audio = songAudioRef.current;
    if (!audio || !currentSongPath) return;
    if (audio.paused) {
      audio.play().then(() => setSongPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setSongPlaying(false);
    }
  }, [currentSongPath]);

  /** Where the next take starts: a line (and the section it was picked from, to stop at its end). */
  const [cue, setCue] = useState<{ lineId: string; sectionId?: string } | null>(null);

  const seekToLine = useCallback((line: Line, sectionId?: string) => {
    const audio = songAudioRef.current;
    if (!audio || !currentSongPath || line.start_ms == null) return;
    setCue({ lineId: line.id, sectionId });
    audio.currentTime = line.start_ms / 1000;
    // Don't call setSongCurrentMs here — the RAF loop reads audio.currentTime
    // which is synchronously updated by the seek. Two competing state setters
    // were causing the highlight to flicker between lines.
    if (audio.paused) audio.play().then(() => setSongPlaying(true)).catch(() => {});
  }, [currentSongPath]);

  const seekToSection = useCallback((section: Section) => {
    const first = lines.find((l) => l.order >= section.start_line_order && l.start_ms != null);
    if (first) seekToLine(first, section.id);
  }, [lines, seekToLine]);

  // ── Free recording (start / stop / save) ─────────────────────────────────
  const recordCountIn = usePreferencesStore((s) => s.recordCountIn);
  const setRecordCountIn = usePreferencesStore((s) => s.setRecordCountIn);
  const [countdown, setCountdown] = useState<number | null>(null);
  const cancelCountdownRef = useRef(false);

  /** The line a take will start from: the cued line, else the one at (or next after) the playhead. */
  const startLine = useMemo(() => {
    const timed = lines.filter((l) => l.start_ms != null);
    if (cue) {
      const l = timed.find((x) => x.id === cue.lineId);
      if (l) return l;
    }
    return (
      timed.find((l) => songCurrentMs >= l.start_ms! && (l.end_ms == null || songCurrentMs < l.end_ms)) ??
      timed.find((l) => l.start_ms! >= songCurrentMs) ??
      null
    );
  }, [cue, lines, songCurrentMs]);

  /** When a section was picked, the take stops shortly after its last line. */
  const stopAtMs = useMemo(() => {
    if (!cue?.sectionId) return null;
    const sec = sections.find((x) => x.id === cue.sectionId);
    if (!sec) return null;
    const secLines = lines.filter(
      (l) => l.order >= sec.start_line_order && l.order <= sec.end_line_order && l.end_ms != null,
    );
    return secLines.length ? Math.max(...secLines.map((l) => l.end_ms!)) + STOP_TAIL_MS : null;
  }, [cue, sections, lines]);
  const cueSection = cue?.sectionId ? sections.find((x) => x.id === cue.sectionId) ?? null : null;

  const startFreeRecording = useCallback(async () => {
    if (!song?.audio_folder || countdown != null) return;
    stopAllPlayback();
    setRecordingTimer(0);
    setPendingSync(null);
    const audio = songAudioRef.current;
    const withSong = singAlong && !!audio && !!currentSongPath;
    if (audio && !audio.paused) {
      audio.pause();
      setSongPlaying(false);
    }
    // Rewind to the start of the line, with a little music before it to come in on.
    if (withSong && audio && startLine?.start_ms != null) {
      const fromMs = Math.max(0, startLine.start_ms - LEAD_IN_MS);
      audio.currentTime = fromMs / 1000;
      setSongCurrentMs(fromMs);
    }

    // The mic opens now; the countdown gives you (and it) a moment to settle.
    await recorder.startRecording("free", song.audio_folder);
    cancelCountdownRef.current = false;
    for (let n = recordCountIn; n > 0; n--) {
      setCountdown(n);
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelCountdownRef.current) {
        setCountdown(null);
        const discarded = await recorder.stopRecording();
        if (discarded) remove(discarded.filePath).catch(() => {});
        return;
      }
    }
    setCountdown(null);

    timerRef.current = setInterval(() => setRecordingTimer((t) => t + 1), 1000);
    if (withSong && audio) {
      const songPosMs = audio.currentTime * 1000;
      try {
        await audio.play();
        setSongPlaying(true);
        // Take time 0 ↔ song position: the song started (now − recorder start) ms into the take.
        const intoTakeMs = performance.now() - recorder.getStartedAt();
        setPendingSync({ songStartMs: Math.round(songPosMs - intoTakeMs), backing: songSrcKey });
      } catch {
        // Couldn't start the song — it's just a free take then.
      }
    }
  }, [recorder, song?.audio_folder, singAlong, currentSongPath, songSrcKey, stopAllPlayback, startLine, recordCountIn, countdown]);

  const stopFreeRecording = useCallback(async () => {
    if (countdown != null) {
      cancelCountdownRef.current = true;
      return;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const audio = songAudioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      setSongPlaying(false);
    }
    const result = await recorder.stopRecording();
    if (result) {
      setPendingRec({ filePath: result.filePath, durationMs: result.durationMs });
      setPendingNote("");
      setTimeout(() => noteInputRef.current?.focus(), 50);
    }
  }, [recorder, countdown]);

  // A take started from a section ends with the section.
  useEffect(() => {
    if (recorder.isRecording && countdown == null && songPlaying && stopAtMs != null && songCurrentMs >= stopAtMs) {
      stopFreeRecording();
    }
  }, [recorder.isRecording, countdown, songPlaying, stopAtMs, songCurrentMs, stopFreeRecording]);

  // Keyboard: R starts/stops a take, Space plays/pauses the song (not while typing).
  const startRef = useRef(startFreeRecording);
  startRef.current = startFreeRecording;
  const stopRef = useRef(stopFreeRecording);
  stopRef.current = stopFreeRecording;
  const toggleRef = useRef(toggleSongPlay);
  toggleRef.current = toggleSongPlay;
  const keyStateRef = useRef({ recording: false, counting: false, pending: false });
  keyStateRef.current = { recording: recorder.isRecording, counting: countdown != null, pending: pendingRec != null };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]")) return;
      const st = keyStateRef.current;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (st.recording || st.counting) stopRef.current();
        else if (!st.pending) startRef.current();
      } else if (e.key === " " && !st.recording && !st.counting) {
        e.preventDefault();
        toggleRef.current();
      } else if (e.key === "Escape" && st.counting) {
        stopRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Follow the song: keep the line being sung in view.
  const lineElRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!playingLineId) return;
    lineElRefs.current.get(playingLineId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [playingLineId]);

  // The song ending ends a sung-along take.
  const stopFreeRecordingRef = useRef(stopFreeRecording);
  stopFreeRecordingRef.current = stopFreeRecording;
  const isRecordingRef = useRef(false);
  isRecordingRef.current = recorder.isRecording;
  useEffect(() => {
    const audio = songAudioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (isRecordingRef.current) stopFreeRecordingRef.current();
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  // ── Take review ──────────────────────────────────────────────────────────
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Record<string, number>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});

  const runAnalysis = useCallback(async (rec: Recording) => {
    if (!song || !id) return;
    setAnalyzing((m) => ({ ...m, [rec.id]: 0 }));
    setAnalysisErrors(({ [rec.id]: _, ...rest }) => rest);
    try {
      const analysis = await analyzeRecording(rec, song, lines, (f) =>
        setAnalyzing((m) => (rec.id in m ? { ...m, [rec.id]: f } : m)),
      );
      await updateRecording(id, rec.id, { analysis });
    } catch (err) {
      console.error("[review] analysis failed:", err);
      setAnalysisErrors((m) => ({ ...m, [rec.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAnalyzing(({ [rec.id]: _, ...rest }) => rest);
    }
  }, [song, id, lines, updateRecording]);

  const openReview = useCallback((recId: string) => {
    setReviewId((cur) => (cur === recId ? null : recId));
    const rec = recordings.find((r) => r.id === recId);
    if (rec && needsAnalysis(rec) && !(rec.id in analyzing)) runAnalysis(rec);
  }, [recordings, analyzing, runAnalysis]);

  const saveFreeRecording = useCallback(async () => {
    if (!pendingRec || !id) return;
    const now = new Date().toISOString();
    const newRec: Recording = {
      id: crypto.randomUUID(),
      song_id: id,
      line_id: null,
      section_id: undefined,
      file_path: pendingRec.filePath,
      duration_ms: pendingRec.durationMs,
      is_master_take: false,
      is_best_take: false,
      note: pendingNote.trim() || undefined,
      song_start_ms: pendingSync?.songStartMs,
      backing: pendingSync?.backing,
      created_at: now,
      updated_at: now,
    };
    await addRecording(id, newRec);
    setPendingRec(null);
    setPendingNote("");
    setPendingSync(null);
    if (song && canReview(newRec, song)) {
      setReviewId(newRec.id);
      runAnalysis(newRec);
    }
  }, [pendingRec, pendingNote, pendingSync, id, addRecording, song, runAnalysis]);

  // Short A/B snippets from the review: your take vs. the song at the same spot.
  const snippetRef = useRef<HTMLAudioElement | null>(null);
  const [snippetKey, setSnippetKey] = useState<string | null>(null);
  const stopSnippet = useCallback(() => {
    snippetRef.current?.pause();
    snippetRef.current = null;
    setSnippetKey(null);
  }, []);
  useEffect(() => () => stopSnippet(), [stopSnippet]);

  const playSnippet = useCallback((key: string, path: string, fromMs: number) => {
    if (snippetKey === key) {
      stopSnippet();
      return;
    }
    stopSnippet();
    stopAllPlayback();
    const audio = songAudioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      setSongPlaying(false);
    }
    const el = new Audio(convertFileSrc(path));
    el.volume = path === currentSongPath || path === song?.audio_path ? playbackVolume : 1;
    el.currentTime = Math.max(0, fromMs / 1000);
    // Play ~8 s around the problem, then stop.
    const stopAt = fromMs / 1000 + 8;
    el.ontimeupdate = () => {
      if (el.currentTime >= stopAt) stopSnippet();
    };
    el.onended = () => stopSnippet();
    snippetRef.current = el;
    setSnippetKey(key);
    el.play().catch(() => stopSnippet());
  }, [snippetKey, stopSnippet, stopAllPlayback, currentSongPath, song?.audio_path, playbackVolume]);

  const reviewRec = reviewId ? recordings.find((r) => r.id === reviewId) ?? null : null;

  const playIssueYou = useCallback((issue: TakeIssue, key: string) => {
    if (!reviewRec?.analysis || reviewRec.song_start_ms == null) return;
    const takeMs = issueSongStartMs(issue) - reviewRec.song_start_ms + reviewRec.analysis.lag_ms;
    playSnippet(`you:${key}`, reviewRec.file_path, takeMs);
  }, [reviewRec, playSnippet]);

  const playIssueOriginal = useCallback((issue: TakeIssue, key: string) => {
    const path = song?.audio_path ?? currentSongPath;
    if (!path) return;
    playSnippet(`orig:${key}`, path, issueSongStartMs(issue));
  }, [song?.audio_path, currentSongPath, playSnippet]);

  // Issues of the reviewed take, by line, for the lyrics panel.
  const reviewIssuesByLine = useMemo(() => {
    const m = new Map<string, TakeIssue[]>();
    for (const issue of reviewRec?.analysis?.issues ?? []) {
      if (!issue.line_id) continue;
      const arr = m.get(issue.line_id) ?? [];
      arr.push(issue);
      m.set(issue.line_id, arr);
    }
    return m;
  }, [reviewRec]);

  // ── Breath map: where the original singer breathes / goes high ─────────
  const [showBreathMap, setShowBreathMap] = useState(true);
  const [vocalMap, setVocalMap] = useState<VocalMap | null>(null);
  useEffect(() => {
    setVocalMap(null);
    if (!song) return;
    let cancelled = false;
    loadVocalMap(song)
      ?.then((m) => !cancelled && setVocalMap(m))
      .catch((err) => console.warn("[recordings] vocal map unavailable:", err));
    return () => {
      cancelled = true;
    };
  }, [song?.pitch_data_path, song?.vocals_path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Early return ─────────────────────────────────────────────────────────
  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  const totalRecordings = recordings.length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <audio ref={songAudioRef} preload="metadata" />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/song/${id}`)}
              className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              {song.title}
            </button>
            <button
              onClick={() => navigate(`/song/${id}/practice`)}
              className="flex items-center gap-[5px] px-3 py-[5px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12px] text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all cursor-pointer"
              title="Go to practice"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Practice
            </button>
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-[6px]">
            <button
              onClick={() => setPlaybackVolume(playbackVolume > 0 ? 0 : 1)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer bg-transparent border-none p-0 flex items-center"
              title={playbackVolume > 0 ? "Mute" : "Unmute"}
            >
              {playbackVolume === 0 ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : playbackVolume < 0.5 ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 010 7.07" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                </svg>
              )}
            </button>
            <input
              type="range" min="0" max="1" step="0.01"
              value={playbackVolume}
              onChange={(e) => setPlaybackVolume(parseFloat(e.target.value))}
              className="w-[70px] h-[3px] accent-[var(--theme)] cursor-pointer"
              title={`Volume: ${Math.round(playbackVolume * 100)}%`}
            />
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums min-w-[26px]">
              {Math.round(playbackVolume * 100)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <span className="text-[12px] text-[var(--text-muted)]">
                  {selected.size} selected
                </span>
                <button
                  onClick={() => setShowBulkConfirm(true)}
                  disabled={selected.size === 0}
                  className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-red-200 bg-transparent text-[12.5px] font-medium text-red-600 hover:border-red-400 hover:bg-red-50 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  Delete {selected.size > 0 ? selected.size : ""} selected
                </button>
                <button
                  onClick={exitSelectMode}
                  className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-[12px] text-[var(--text-muted)]">
                  {totalRecordings} recording{totalRecordings !== 1 ? "s" : ""}
                </span>
                {totalRecordings > 0 && (
                  <button
                    onClick={() => setSelectMode(true)}
                    className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                  >
                    Select
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        {/* Body: split panels */}
        <div ref={splitContainerRef} className="flex flex-1 min-h-0">
          {/* Left panel — lyrics with playback */}
          <div className="flex-shrink-0 flex flex-col min-h-0" style={{ width: `${splitPct}%` }}>
            {/* Header + player */}
            <div className="px-5 pt-4 pb-3 border-b border-[var(--border-subtle)] flex-shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
                    Lyrics
                  </span>
                  {vocalMap && (
                    <button
                      onClick={() => setShowBreathMap((v) => !v)}
                      title="Where the original singer breathes (’ blue = breath, amber = quick breath), long phrases and the highest notes"
                      className={`px-[7px] py-[2px] text-[9.5px] font-medium rounded-[4px] border cursor-pointer transition-colors ${
                        showBreathMap
                          ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-transparent"
                          : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[#888]"
                      }`}
                    >
                      Breath map
                    </button>
                  )}
                </div>
                {songAudioSources.length > 0 && (
                  <div className="flex items-center gap-1">
                    {songAudioSources.map((src) => (
                      <button
                        key={src.key}
                        onClick={() => setSongSrcKey(src.key)}
                        className={`px-[7px] py-[2px] text-[9.5px] font-medium rounded-[4px] border cursor-pointer transition-colors ${
                          songSrcKey === src.key
                            ? "bg-[var(--theme)] text-white border-[var(--theme)]"
                            : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[#888]"
                        }`}
                      >
                        {src.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {songAudioSources.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleSongPlay}
                    disabled={!currentSongPath || recorder.isRecording || countdown != null}
                    className="w-7 h-7 rounded-full bg-[var(--theme)] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {songPlaying ? (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff">
                        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                      </svg>
                    ) : (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 1 }}>
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                    {formatMs(Math.round(songCurrentMs))}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] opacity-50">
                    Click a line to play from it · Space play/pause · R record
                  </span>
                </div>
              )}
            </div>

            {/* Lines */}
            <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
              {lines.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] text-center py-8">
                  No lyrics added yet.
                </p>
              ) : (
                <div className="flex flex-col">
                  {lyricItems.map((item) => {
                    if (item.kind === "section") {
                      return (
                        <button
                          key={`sec-${item.section.id}`}
                          onClick={() => !recorder.isRecording && countdown == null && seekToSection(item.section)}
                          title="Play from here — the next take records just this section"
                          className="flex items-center gap-2 mt-3 mb-1 w-full text-left cursor-pointer bg-transparent border-none group"
                        >
                          <span
                            className={`text-[9.5px] font-semibold uppercase tracking-[0.09em] group-hover:text-[var(--theme-text)] transition-colors flex-shrink-0 ${
                              cue?.sectionId === item.section.id ? "text-red-600" : "text-[var(--text-muted)]"
                            }`}
                          >
                            {item.section.name}
                          </span>
                          <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                        </button>
                      );
                    }
                    const { line } = item;
                    const isPlaying = playingLineId === line.id;
                    const translation = translationByOrder.get(line.order);
                    // Seeking mid-take would break the take's alignment with the song.
                    const canSeek = line.start_ms != null && currentSongPath && !recorder.isRecording && countdown == null;
                    const displayText = line.custom_text ?? line.text;
                    const info = vocalMap && showBreathMap ? lineVocalInfo(vocalMap, line, displayText) : null;
                    const isStart = !recorder.isRecording && !pendingRec && startLine?.id === line.id;
                    const lineIssues = reviewIssuesByLine.get(line.id) ?? [];
                    return (
                      <div
                        key={line.id}
                        ref={(el) => {
                          if (el) lineElRefs.current.set(line.id, el);
                          else lineElRefs.current.delete(line.id);
                        }}
                        onClick={() => canSeek && seekToLine(line)}
                        className={`relative flex flex-col px-2 py-[5px] rounded-[6px] transition-colors ${
                          isPlaying ? "bg-[var(--theme-light)]" : canSeek ? "hover:bg-[var(--bg)]" : ""
                        } ${canSeek ? "cursor-pointer" : ""}`}
                      >
                        {isStart && (
                          <span
                            className="absolute -left-[10px] top-[11px] w-[6px] h-[6px] rounded-full bg-red-500"
                            title="The next take starts from this line"
                          />
                        )}
                        <div className="flex items-start">
                        <div className="flex-1 min-w-0">
                          <div className={`text-[14px] leading-[1.6] transition-all ${isPlaying ? "font-medium text-[var(--theme-text)]" : "font-normal text-[var(--text-primary)]"}`}>
                            {info?.breathBefore && (
                              <span
                                className={`inline-block mr-[5px] font-bold leading-none align-[0.35em] select-none ${
                                  info.breathBefore.quick ? "text-amber-600" : "text-sky-600"
                                }`}
                                title={
                                  info.breathBefore.quick
                                    ? `Quick breath — the original singer has only ${((info.breathBefore.endMs - info.breathBefore.startMs) / 1000).toFixed(1)} s here`
                                    : `Breathe before this line (${((info.breathBefore.endMs - info.breathBefore.startMs) / 1000).toFixed(1)} s gap)`
                                }
                              >
                                ’
                              </span>
                            )}
                            <AnnotatedText
                              text={displayText}
                              annotations={line.annotations}
                              highlights={highlights}
                              lineFuriganaHtml={line.custom_text ? line.custom_furigana_html : line.furigana_html}
                              breathMarks={info?.midBreaths.map((m) => ({
                                pos: m.pos,
                                title: `${m.breath.quick ? "Quick breath" : "Breath"} inside the line (${((m.breath.endMs - m.breath.startMs) / 1000).toFixed(1)} s)`,
                              }))}
                            />
                          </div>
                          {translation && (
                            <div className="text-[12px] leading-snug text-[var(--text-muted)] mt-0.5">
                              {translation}
                            </div>
                          )}
                        </div>
                        {info && (info.longestPhraseMs >= LONG_PHRASE_MS || info.peakSemitone != null) && (
                          <div className="flex-shrink-0 flex flex-col items-end gap-[2px] pl-2 pt-[3px]">
                            {info.longestPhraseMs >= LONG_PHRASE_MS && (
                              <span
                                className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] bg-sky-500/10 text-sky-700"
                                title="A long phrase without a breath in the original — fill up before it"
                              >
                                long · {(info.longestPhraseMs / 1000).toFixed(1)} s
                              </span>
                            )}
                            {info.peakSemitone != null && (
                              <span
                                className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] bg-amber-500/10 text-amber-700"
                                title="One of the highest notes in the song"
                              >
                                high · {semitoneToNoteName(info.peakSemitone)}
                              </span>
                            )}
                          </div>
                        )}
                        </div>
                        {lineIssues.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-[3px]">
                            {lineIssues.map((issue, i) => (
                              <button
                                key={i}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const idx = reviewRec?.analysis?.issues.indexOf(issue) ?? -1;
                                  playIssueYou(issue, `${reviewRec?.id}:${idx}`);
                                }}
                                title={`${issue.detail} — click to hear your take here`}
                                className={`text-[9.5px] font-medium px-[5px] py-[1px] rounded-[3px] border-none cursor-pointer ${
                                  isBreathIssue(issue.kind)
                                    ? "bg-sky-500/15 text-sky-800 hover:bg-sky-500/25"
                                    : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25"
                                }`}
                              >
                                {ISSUE_LABEL[issue.kind]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Drag handle */}
          <div
            onMouseDown={onSplitterMouseDown}
            className="w-[5px] flex-shrink-0 relative cursor-col-resize group"
            title="Drag to resize"
          >
            <div className="absolute inset-y-0 left-[2px] w-px bg-[var(--border)] group-hover:bg-[var(--theme)] transition-colors" />
          </div>

          {/* Right panel — recordings */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Free recording section */}
            <div className="flex-shrink-0 px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
                  Free recording
                </span>
                <span className="text-[10.5px] text-[var(--text-muted)] truncate">
                  {!singAlong || !currentSongPath
                    ? "not tied to any line"
                    : recorder.isRecording || countdown != null
                      ? cueSection && stopAtMs != null
                        ? `${cueSection.name} — stops at ${formatMs(stopAtMs)}`
                        : "to the end of the song"
                      : startLine
                        ? `starts at “${(startLine.custom_text ?? startLine.text).slice(0, 24)}${(startLine.custom_text ?? startLine.text).length > 24 ? "…" : ""}” (${formatMs(startLine.start_ms!)})${
                            cueSection ? ` · ${cueSection.name} only` : ""
                          } — click a line or section to change`
                        : "click a line or section to choose where to start"}
                </span>
                {cueSection && !recorder.isRecording && countdown == null && (
                  <button
                    onClick={() => setCue(cue ? { lineId: cue.lineId } : null)}
                    title="Keep recording to the end of the song"
                    className="text-[10.5px] text-[var(--theme)] bg-transparent border-none cursor-pointer hover:underline flex-shrink-0"
                  >
                    whole song
                  </button>
                )}
              </div>

              {pendingRec ? (
                /* Note prompt after recording */
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--text-secondary)]">
                      {formatMs(pendingRec.durationMs)} recorded.
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">Add a note (optional):</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={noteInputRef}
                      type="text"
                      value={pendingNote}
                      onChange={(e) => setPendingNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveFreeRecording(); if (e.key === "Escape") discardPendingRec(); }}
                      placeholder="e.g. full run-through, bridge attempt…"
                      maxLength={100}
                      className="flex-1 px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--theme)] transition-colors"
                    />
                    <button
                      onClick={saveFreeRecording}
                      className="px-4 py-[6px] rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none"
                    >
                      Save
                    </button>
                    <button
                      onClick={discardPendingRec}
                      className="px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12.5px] text-[var(--text-secondary)] hover:border-[#888] transition-all cursor-pointer"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ) : countdown != null ? (
                /* Count-in before the song starts */
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-red-600 text-white text-[18px] font-semibold flex items-center justify-center tabular-nums animate-pulse">
                    {countdown}
                  </span>
                  <span className="text-[12.5px] text-[var(--text-secondary)]">Get ready…</span>
                  <MicMeter getLevel={recorder.getInputLevel} />
                  <button
                    onClick={stopFreeRecording}
                    className="px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12.5px] text-[var(--text-secondary)] hover:border-[#888] transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : recorder.isRecording ? (
                /* Recording in progress */
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <span className="text-[13px] font-medium text-[var(--text-primary)] tabular-nums">
                    {String(Math.floor(recordingTimer / 60)).padStart(2, "0")}:
                    {String(recordingTimer % 60).padStart(2, "0")}
                  </span>
                  <MicMeter getLevel={recorder.getInputLevel} />
                  <button
                    onClick={stopFreeRecording}
                    title="Stop (R)"
                    className="flex items-center gap-[5px] px-4 py-[6px] rounded-[7px] bg-red-600 text-white text-[12.5px] font-medium hover:bg-red-700 transition-colors cursor-pointer border-none"
                  >
                    Stop
                  </button>
                </div>
              ) : (
                /* Idle: record button */
                <div className="flex items-center gap-4">
                  <button
                    onClick={startFreeRecording}
                    disabled={!song.audio_folder}
                    title="Record (R)"
                    className="flex items-center gap-[6px] px-4 py-2 rounded-[8px] bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                    Record
                  </button>
                  {currentSongPath && (
                    <label
                      className="flex items-center gap-[6px] text-[12px] text-[var(--text-secondary)] cursor-pointer select-none"
                      title="Plays the selected track while you sing, so the take can be reviewed for breath and high notes. Use headphones."
                    >
                      <input
                        type="checkbox"
                        checked={singAlong}
                        onChange={(e) => setSingAlong(e.target.checked)}
                        className="w-[14px] h-[14px] accent-[var(--theme)] cursor-pointer"
                      />
                      Sing along ({songAudioSources.find((s) => s.key === songSrcKey)?.label ?? "Original"}) — headphones on
                    </label>
                  )}
                  <label className="flex items-center gap-[6px] text-[12px] text-[var(--text-secondary)] select-none">
                    Count-in
                    <select
                      value={recordCountIn}
                      onChange={(e) => setRecordCountIn(Number(e.target.value))}
                      className="px-1 py-[2px] rounded-[5px] border border-[var(--border)] bg-[var(--surface)] text-[12px] text-[var(--text-primary)] outline-none cursor-pointer"
                    >
                      <option value={0}>off</option>
                      <option value={3}>3 s</option>
                      <option value={5}>5 s</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            {reviewRec && (
              <TakeReviewPanel
                rec={reviewRec}
                lines={lines}
                analyzing={reviewRec.id in analyzing ? analyzing[reviewRec.id] : null}
                error={analysisErrors[reviewRec.id] ?? null}
                playingKey={snippetKey}
                onPlayYou={playIssueYou}
                onPlayOriginal={playIssueOriginal}
                onReanalyze={() => runAnalysis(reviewRec)}
                onClose={() => {
                  stopSnippet();
                  setReviewId(null);
                }}
              />
            )}

            {/* Recording list */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {totalRecordings === 0 ? (
                <div className="text-center py-16">
                  <div className="text-[var(--text-muted)] mb-2">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mx-auto">
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </div>
                  <p className="text-[13px] text-[var(--text-muted)]">No recordings yet.</p>
                  <p className="text-[12px] text-[var(--text-muted)] mt-1">Record freely above, or use the Practice page to record line by line.</p>
                </div>
              ) : (
                <>
                  {/* Free recordings group */}
                  {freeRecordings.length > 0 && (
                    <div className="mb-2">
                      <GroupHeader label="Free recordings" count={freeRecordings.length} />
                      {freeRecordings.map((rec) => (
                        <RecordingEntry
                          key={rec.id}
                          rec={rec}
                          line={null}
                          sectionName={null}
                          review={
                            canReview(rec, song)
                              ? { active: reviewId === rec.id, analyzing: rec.id in analyzing, onOpen: openReview }
                              : undefined
                          }
                          songId={id!}
                          songAudioPath={song.audio_path}
                          selectMode={selectMode}
                          selected={selected.has(rec.id)}
                          onToggleSelect={toggleSelect}
                          onToggleBestTake={(recId) => updateRecording(id!, recId, { is_best_take: !rec.is_best_take })}
                          onDelete={setDeleteTarget}
                          onPlay={handlePlay}
                          onPlayEnded={handlePlayEnded}
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
                          volume={playbackVolume}
                        />
                      ))}
                    </div>
                  )}

                  {/* Section groups */}
                  {sectionGroups.map(({ section, recordings: recs }) => (
                    <div key={section.id} className="mb-2">
                      <GroupHeader label={section.name} count={recs.length} />
                      {recs.map((rec) => (
                        <RecordingEntry
                          key={rec.id}
                          rec={rec}
                          line={rec.line_id ? lineById.get(rec.line_id) ?? null : null}
                          sectionName={section.name}
                          songId={id!}
                          songAudioPath={song.audio_path}
                          selectMode={selectMode}
                          selected={selected.has(rec.id)}
                          onToggleSelect={toggleSelect}
                          onToggleBestTake={(recId) => updateRecording(id!, recId, { is_best_take: !rec.is_best_take })}
                          onDelete={setDeleteTarget}
                          onPlay={handlePlay}
                          onPlayEnded={handlePlayEnded}
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
                          volume={playbackVolume}
                        />
                      ))}
                    </div>
                  ))}

                  {/* Line groups */}
                  {lineGroups.map(({ line, recordings: recs }) => (
                    <div key={line.id} className="mb-2">
                      <GroupHeader
                        label={`Line ${lines.indexOf(line) + 1}`}
                        count={recs.length}
                      />
                      <div className="mb-1 px-2">
                        <span className="text-[12px] text-[var(--text-secondary)] leading-[1.5] line-clamp-1">
                          {line.custom_text ?? line.text}
                        </span>
                      </div>
                      {recs.map((rec) => (
                        <RecordingEntry
                          key={rec.id}
                          rec={rec}
                          line={line}
                          sectionName={rec.section_id ? (sectionById.get(rec.section_id)?.name ?? null) : null}
                          songId={id!}
                          songAudioPath={song.audio_path}
                          selectMode={selectMode}
                          selected={selected.has(rec.id)}
                          onToggleSelect={toggleSelect}
                          onToggleBestTake={(recId) => updateRecording(id!, recId, { is_best_take: !rec.is_best_take })}
                          onDelete={setDeleteTarget}
                          onPlay={handlePlay}
                          onPlayEnded={handlePlayEnded}
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
                          volume={playbackVolume}
                        />
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Single delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete recording?"
        message="This recording will be permanently removed from disk."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={showBulkConfirm}
        title={`Delete ${selected.size} recording${selected.size !== 1 ? "s" : ""}?`}
        message="The selected recordings will be permanently removed from disk."
        confirmLabel="Delete all"
        destructive
        onConfirm={handleBulkDelete}
        onCancel={() => setShowBulkConfirm(false)}
      />
    </div>
  );
}
