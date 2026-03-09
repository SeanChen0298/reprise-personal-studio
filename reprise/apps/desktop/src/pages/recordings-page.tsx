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
import { playRecordingWithGain, type RecordingPlaybackHandle } from "../lib/play-recording";
import { formatMs } from "../lib/status-config";
import type { Recording, Line } from "../types/song";

// ---------------------------------------------------------------------------
// WaveSurfer thumbnail (renders peaks from the recording file, display-only)
// ---------------------------------------------------------------------------

function RecordingWaveform({ filePath }: { filePath: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

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
      interact: false,
      normalize: true,
    });

    wsRef.current = ws;
    ws.load(convertFileSrc(filePath)).catch(() => {});

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [filePath]);

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
  onCompare: (rec: Recording) => void;
  playingId: string | null;
  comparingId: string | null;
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
  onCompare,
  playingId,
  comparingId,
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
      <RecordingWaveform filePath={rec.file_path} />

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

  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));
  const rawSections = useSongStore((s) => (id ? s.sections[id] : undefined));
  const allRecordings = useSongStore((s) => (id ? s.recordings[id] : undefined));
  const addRecording = useSongStore((s) => s.addRecording);
  const removeRecording = useSongStore((s) => s.removeRecording);
  const updateRecording = useSongStore((s) => s.updateRecording);
  const highlights = useHighlightStore((s) => s.highlights);

  // Main lines: exclude translation lines from the lyric list
  const lines = useMemo(() => {
    if (!rawLines) return [];
    const mainLang = song?.language;
    const transLang = song?.translation_language;
    return [...rawLines]
      .filter((l) => {
        if (transLang && l.language === transLang) return false;
        return !mainLang || !l.language || l.language === mainLang;
      })
      .sort((a, b) => a.order - b.order);
  }, [rawLines, song?.language, song?.translation_language]);

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

  const startFreeRecording = useCallback(async () => {
    if (!song?.audio_folder) return;
    setRecordingTimer(0);
    await recorder.startRecording("free", song.audio_folder);
    timerRef.current = setInterval(() => setRecordingTimer((t) => t + 1), 1000);
  }, [recorder, song?.audio_folder]);

  const stopFreeRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const result = await recorder.stopRecording();
    if (result) {
      setPendingRec({ filePath: result.filePath, durationMs: result.durationMs });
      setPendingNote("");
      setTimeout(() => noteInputRef.current?.focus(), 50);
    }
  }, [recorder]);

  const discardPendingRec = useCallback(async () => {
    if (pendingRec) {
      remove(pendingRec.filePath).catch(() => {});
    }
    setPendingRec(null);
    setPendingNote("");
  }, [pendingRec]);

  const saveFreeRecording = useCallback(async () => {
    if (!pendingRec || !id) return;
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await addRecording(id, newRec);
    setPendingRec(null);
    setPendingNote("");
  }, [pendingRec, pendingNote, id, addRecording]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Playback ─────────────────────────────────────────────────────────────
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const playHandleRef = useRef<RecordingPlaybackHandle | null>(null);
  const compareLineAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopAllPlayback = useCallback(() => {
    playHandleRef.current?.stop();
    playHandleRef.current = null;
    compareLineAudioRef.current?.pause();
    compareLineAudioRef.current = null;
    setPlayingId(null);
    setComparingId(null);
  }, []);

  const handlePlay = useCallback((rec: Recording) => {
    if (playingId === rec.id) {
      stopAllPlayback();
      return;
    }
    stopAllPlayback();
    setPlayingId(rec.id);
    playRecordingWithGain(rec.file_path, () => {
      setPlayingId((prev) => (prev === rec.id ? null : prev));
      playHandleRef.current = null;
    })
      .then((handle) => {
        playHandleRef.current = handle;
      })
      .catch(() => setPlayingId((prev) => (prev === rec.id ? null : prev)));
  }, [playingId, stopAllPlayback]);

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
          playHandleRef.current = null;
        })
          .then((handle) => { playHandleRef.current = handle; })
          .catch(() => setComparingId((prev) => (prev === rec.id ? null : prev)));
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

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => navigate(`/song/${id}`)}
            className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {song.title}
          </button>

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
        <div className="flex flex-1 min-h-0">
          {/* Left panel — lyrics (read-only) */}
          <div className="w-[42%] flex-shrink-0 border-r border-[var(--border)] flex flex-col min-h-0">
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex-shrink-0">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
                Lyrics
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {lines.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] text-center py-8">
                  No lyrics added yet.
                </p>
              ) : (
                <div className="flex flex-col gap-[6px]">
                  {lines.map((line, i) => {
                    const translation = translationByOrder.get(line.order);
                    return (
                      <div key={line.id} className="flex items-start gap-3 py-[5px]">
                        <span className="text-[10.5px] text-[var(--text-muted)] tabular-nums w-5 text-right flex-shrink-0 mt-[2px]">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] leading-[1.6] text-[var(--text-primary)]">
                            {!line.custom_text && line.furigana_html ? (
                              <span dangerouslySetInnerHTML={{ __html: line.furigana_html }} />
                            ) : (
                              <AnnotatedText
                                text={line.custom_text ?? line.text}
                                annotations={line.annotations}
                                highlights={highlights}
                              />
                            )}
                          </div>
                          {translation && (
                            <div className="text-[12px] leading-snug text-[var(--text-muted)] mt-0.5">
                              {translation}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right panel — recordings */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {/* Free recording section */}
            <div className="flex-shrink-0 px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
                  Free recording
                </span>
                <span className="text-[10.5px] text-[var(--text-muted)]">
                  not tied to any line
                </span>
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
              ) : recorder.isRecording ? (
                /* Recording in progress */
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <span className="text-[13px] font-medium text-[var(--text-primary)] tabular-nums">
                    {String(Math.floor(recordingTimer / 60)).padStart(2, "0")}:
                    {String(recordingTimer % 60).padStart(2, "0")}
                  </span>
                  <button
                    onClick={stopFreeRecording}
                    className="flex items-center gap-[5px] px-4 py-[6px] rounded-[7px] bg-red-600 text-white text-[12.5px] font-medium hover:bg-red-700 transition-colors cursor-pointer border-none"
                  >
                    Stop
                  </button>
                </div>
              ) : (
                /* Idle: record button */
                <button
                  onClick={startFreeRecording}
                  disabled={!song.audio_folder}
                  className="flex items-center gap-[6px] px-4 py-2 rounded-[8px] bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 transition-colors cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                  Record
                </button>
              )}
            </div>

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
                          songId={id!}
                          songAudioPath={song.audio_path}
                          selectMode={selectMode}
                          selected={selected.has(rec.id)}
                          onToggleSelect={toggleSelect}
                          onToggleBestTake={(recId) => updateRecording(id!, recId, { is_best_take: !rec.is_best_take })}
                          onDelete={setDeleteTarget}
                          onPlay={handlePlay}
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
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
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
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
                          onCompare={handleCompare}
                          playingId={playingId}
                          comparingId={comparingId}
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
