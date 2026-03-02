import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Sidebar } from "../components/sidebar";
import { FullWaveform } from "../components/full-waveform";
import { useSongStore } from "../stores/song-store";
import { useWaveformData } from "../hooks/use-waveform-data";
import { formatMs } from "../lib/status-config";

/** Local working copy of a line's timestamps (before saving) */
interface TimestampEntry {
  lineId: string;
  start_ms: number | undefined;
  end_ms: number | undefined;
}

/** Undo stack entry */
interface UndoAction {
  /** Index of the line that was just marked */
  lineIndex: number;
  /** Previous timestamps for the marked line */
  prev: { start_ms: number | undefined; end_ms: number | undefined };
  /** Previous end_ms of the line before it (if we updated it) */
  prevEndMs: number | undefined;
  /** Index of the previous line (-1 if none) */
  prevLineIndex: number;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseMsInput(value: string): number | undefined {
  // Accept formats: "1:23", "1:23.456", "83", "83.456", "83456" (raw ms)
  const colonMatch = value.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (colonMatch) {
    const mins = parseInt(colonMatch[1], 10);
    const secs = parseInt(colonMatch[2], 10);
    const ms = colonMatch[3] ? parseInt(colonMatch[3].padEnd(3, "0"), 10) : 0;
    if (secs >= 60) return undefined;
    return mins * 60000 + secs * 1000 + ms;
  }
  const dotMatch = value.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (dotMatch) {
    const secs = parseInt(dotMatch[1], 10);
    const ms = dotMatch[2] ? parseInt(dotMatch[2].padEnd(3, "0"), 10) : 0;
    return secs * 1000 + ms;
  }
  return undefined;
}

function formatMsForInput(ms: number | undefined): string {
  if (ms == null) return "";
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const remainder = ms % 1000;
  if (remainder === 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}.${remainder.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

export function TimestampPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));
  const updateLine = useSongStore((s) => s.updateLine);
  const lines = useMemo(
    () => (rawLines ? [...rawLines].sort((a, b) => a.order - b.order) : []),
    [rawLines],
  );

  // Audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioSrc = song?.audio_path ? convertFileSrc(song.audio_path) : "";
  const durationMs = song?.duration_ms ?? 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Local timestamps (working copy — saved on "Save")
  const [timestamps, setTimestamps] = useState<TimestampEntry[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [dirty, setDirty] = useState(false);

  const tapLinesRef = useRef<HTMLDivElement>(null);

  // Initialize timestamps from existing line data
  useEffect(() => {
    if (lines.length === 0) return;
    const entries: TimestampEntry[] = lines.map((l) => ({
      lineId: l.id,
      start_ms: l.start_ms,
      end_ms: l.end_ms,
    }));
    setTimestamps(entries);
    // Find the first line without a start timestamp
    const firstUnmarked = entries.findIndex((e) => e.start_ms == null);
    setCurrentIdx(firstUnmarked === -1 ? entries.length : firstUnmarked);
  }, [lines.length]); // Only re-init when line count changes

  // RAF for currentTime
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Waveform data
  const { peaks } = useWaveformData(audioSrc, 0, durationMs, 300);

  // Build regions for waveform
  const regions = useMemo(() => {
    if (durationMs <= 0) return [];
    return timestamps
      .filter((t) => t.start_ms != null)
      .map((t, i) => ({
        start: (t.start_ms ?? 0) / durationMs,
        end: (t.end_ms ?? durationMs) / durationMs,
        label: `${i + 1}`,
        isCurrent: i === currentIdx - 1,
      }));
  }, [timestamps, durationMs, currentIdx]);

  // Play / Pause
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !durationMs) return;
    audio.currentTime = fraction * (durationMs / 1000);
    setCurrentTime(audio.currentTime);
  }, [durationMs]);

  const skipBy = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, audio.currentTime + seconds);
    setCurrentTime(audio.currentTime);
  }, []);

  // Tap to mark
  const doTap = useCallback(() => {
    if (currentIdx >= timestamps.length) return;
    const audio = audioRef.current;
    if (!audio) return;

    const timeMs = Math.round(audio.currentTime * 1000);

    setTimestamps((prev) => {
      const next = [...prev];
      const undoEntry: UndoAction = {
        lineIndex: currentIdx,
        prev: { start_ms: next[currentIdx].start_ms, end_ms: next[currentIdx].end_ms },
        prevEndMs: currentIdx > 0 ? next[currentIdx - 1].end_ms : undefined,
        prevLineIndex: currentIdx > 0 ? currentIdx - 1 : -1,
      };

      // Set start_ms for current line
      next[currentIdx] = { ...next[currentIdx], start_ms: timeMs };

      // Set end_ms for previous line (if exists and was already marked)
      if (currentIdx > 0 && next[currentIdx - 1].start_ms != null) {
        next[currentIdx - 1] = { ...next[currentIdx - 1], end_ms: timeMs };
      }

      setUndoStack((s) => [...s, undoEntry]);
      return next;
    });

    setCurrentIdx((i) => i + 1);
    setDirty(true);
  }, [currentIdx, timestamps.length]);

  // Undo
  const doUndo = useCallback(() => {
    if (undoStack.length === 0) return;

    setUndoStack((s) => {
      const stack = [...s];
      const action = stack.pop()!;

      setTimestamps((prev) => {
        const next = [...prev];
        // Restore the marked line
        next[action.lineIndex] = {
          ...next[action.lineIndex],
          start_ms: action.prev.start_ms,
          end_ms: action.prev.end_ms,
        };
        // Restore previous line's end_ms
        if (action.prevLineIndex >= 0) {
          next[action.prevLineIndex] = {
            ...next[action.prevLineIndex],
            end_ms: action.prevEndMs,
          };
        }
        return next;
      });

      setCurrentIdx(action.lineIndex);
      return stack;
    });
  }, [undoStack.length]);

  // Keyboard: Space to tap, Ctrl+Z to undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when editing an input
      if (editingLine) return;
      if (e.code === "Space") {
        e.preventDefault();
        doTap();
      }
      if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        doUndo();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [doTap, doUndo, editingLine]);

  // Auto-scroll current line into view
  useEffect(() => {
    const container = tapLinesRef.current;
    if (!container) return;
    const el = container.querySelector(".tap-line-current");
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentIdx]);

  // Save all timestamps to store
  const handleSave = useCallback(() => {
    if (!id) return;
    // Set end_ms for the last marked line if not set
    const final = [...timestamps];
    for (let i = 0; i < final.length; i++) {
      if (final[i].start_ms != null && final[i].end_ms == null) {
        // Use next line's start_ms or song duration
        const nextStart = i + 1 < final.length ? final[i + 1].start_ms : undefined;
        final[i] = { ...final[i], end_ms: nextStart ?? durationMs };
      }
    }

    for (const entry of final) {
      updateLine(id, entry.lineId, {
        start_ms: entry.start_ms,
        end_ms: entry.end_ms,
      });
    }
    navigate(`/song/${id}`);
  }, [id, timestamps, durationMs, updateLine, navigate]);

  // Start editing a line's timestamps
  const startEdit = useCallback((lineId: string, startMs: number | undefined, endMs: number | undefined) => {
    setEditingLine(lineId);
    setEditStart(formatMsForInput(startMs));
    setEditEnd(formatMsForInput(endMs));
  }, []);

  // Confirm edit
  const confirmEdit = useCallback(() => {
    if (!editingLine) return;
    const newStart = parseMsInput(editStart);
    const newEnd = parseMsInput(editEnd);

    setTimestamps((prev) => {
      const next = [...prev];
      const idx = next.findIndex((t) => t.lineId === editingLine);
      if (idx === -1) return prev;
      next[idx] = { ...next[idx], start_ms: newStart, end_ms: newEnd };
      return next;
    });

    setEditingLine(null);
    setDirty(true);
  }, [editingLine, editStart, editEnd]);

  // Cancel edit
  const cancelEdit = useCallback(() => {
    setEditingLine(null);
  }, []);

  // Handle audio ended
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, []);

  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  const progress = durationMs > 0 ? currentTime / (durationMs / 1000) : 0;
  const allDone = currentIdx >= timestamps.length;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />
      <audio ref={audioRef} src={audioSrc} preload="auto" />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-[10px]">
            <button
              onClick={() => navigate(`/song/${id}`)}
              className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Song Detail
            </button>
            <span className="text-[10.5px] font-semibold text-[#D97706] bg-[#FFFBEB] border border-[#FDE68A] px-[10px] py-[3px] rounded-[20px] uppercase tracking-[0.04em]">
              Tap-to-mark mode
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] border-none bg-[var(--accent)] text-white text-[13px] font-medium cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Save timestamps
            </button>
          </div>
        </header>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Waveform Section */}
          <div className="px-7 pt-5 pb-4 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-[20px] font-light tabular-nums tracking-[0.02em] text-[var(--text-primary)]">
                  {formatSeconds(currentTime)}
                </span>
                <span className="text-[13px] text-[var(--text-muted)] font-normal ml-1">
                  / {durationMs > 0 ? formatMs(durationMs) : "--:--"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => skipBy(-5)}
                  className="w-8 h-8 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all"
                  title="Rewind 5s"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  className="w-[38px] h-[38px] rounded-full bg-[var(--accent)] text-white border-none cursor-pointer flex items-center justify-center hover:opacity-85 hover:scale-105 transition-all"
                >
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}>
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => skipBy(5)}
                  className="w-8 h-8 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all"
                  title="Forward 5s"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
                  </svg>
                </button>
              </div>
            </div>

            <FullWaveform
              peaks={peaks}
              progress={Math.max(0, Math.min(1, progress))}
              regions={regions}
              onSeek={seek}
            />

            {/* Time markers */}
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] tabular-nums mt-1">
              <span>0:00</span>
              {durationMs > 60000 && <span>1:00</span>}
              {durationMs > 120000 && <span>2:00</span>}
              {durationMs > 180000 && <span>3:00</span>}
              <span>{formatMs(durationMs)}</span>
            </div>
          </div>

          {/* Instructions */}
          <div className="px-7 py-3.5 bg-[#FFFBEB] border-b border-[#FDE68A] flex items-center gap-[10px] flex-shrink-0">
            <div className="text-[#D97706] flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="text-[12.5px] text-[#92400E] leading-relaxed">
              <strong className="font-semibold">Play audio and tap</strong> the button (or press{" "}
              <span className="inline-flex items-center px-[6px] py-[1px] rounded bg-[#FEF3C7] border border-[#FDE68A] text-[11px] font-semibold text-[#92400E]">
                Space
              </span>
              ) each time a new line begins. Click the edit icon to manually adjust timestamps.
            </div>
          </div>

          {/* Line list */}
          <div ref={tapLinesRef} className="flex-1 overflow-y-auto px-7 py-4">
            {lines.map((line, i) => {
              const ts = timestamps[i];
              const isDone = ts?.start_ms != null && i < currentIdx;
              const isCurrent = i === currentIdx;
              const isPending = i > currentIdx;
              const isEditing = editingLine === line.id;

              return (
                <div
                  key={line.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-[9px] mb-1 transition-colors ${
                    isCurrent
                      ? "tap-line-current bg-[var(--theme-light)] border-[1.5px] border-[#BFDBFE]"
                      : isDone
                        ? "bg-[var(--surface)] border border-[var(--border-subtle)]"
                        : "opacity-50"
                  }`}
                >
                  {/* Line number */}
                  <span
                    className={`w-[22px] text-center text-[11px] font-medium flex-shrink-0 tabular-nums ${
                      isCurrent ? "text-[var(--theme-text)] font-semibold" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {i + 1}
                  </span>

                  {/* Status icon */}
                  <div
                    className={`w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center ${
                      isDone
                        ? "bg-[#22C55E] text-white"
                        : isCurrent
                          ? "bg-[var(--theme)] text-white animate-pulse"
                          : "border-[1.5px] border-[var(--border)]"
                    }`}
                  >
                    {isDone && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {isCurrent && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                    )}
                  </div>

                  {/* Line text */}
                  <span
                    className={`flex-1 text-[14px] leading-relaxed min-w-0 ${
                      isCurrent
                        ? "font-medium text-[var(--theme-text)]"
                        : isPending
                          ? "text-[var(--text-muted)]"
                          : "text-[var(--text-primary)]"
                    }`}
                  >
                    {line.text}
                  </span>

                  {/* Timestamps display / edit */}
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <input
                        type="text"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        placeholder="0:00"
                        className="w-[60px] px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[11px] tabular-nums text-center outline-none focus:border-[var(--theme)]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">—</span>
                      <input
                        type="text"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                        placeholder="0:00"
                        className="w-[60px] px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[11px] tabular-nums text-center outline-none focus:border-[var(--theme)]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        onClick={confirmEdit}
                        className="w-6 h-6 rounded bg-[var(--theme)] text-white border-none cursor-pointer flex items-center justify-center"
                        title="Confirm"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="w-6 h-6 rounded bg-transparent border border-[var(--border)] text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-[var(--text-primary)]"
                        title="Cancel"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`text-[11px] tabular-nums flex-shrink-0 min-w-[80px] text-right ${
                        isCurrent ? "text-[var(--theme-text)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {ts?.start_ms != null
                        ? `${formatMsForInput(ts.start_ms)} — ${ts.end_ms != null ? formatMsForInput(ts.end_ms) : "..."}`
                        : isCurrent
                          ? "Waiting..."
                          : "—"}
                    </span>
                  )}

                  {/* Edit button (only for done lines) */}
                  {isDone && !isEditing && (
                    <button
                      onClick={() => startEdit(line.id, ts?.start_ms, ts?.end_ms)}
                      className="w-6 h-6 rounded-[5px] border-none bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-colors flex-shrink-0"
                      title="Edit timestamp"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}

            {/* All done message */}
            {allDone && timestamps.length > 0 && (
              <div className="text-center py-6 text-[13px] text-[var(--text-muted)]">
                All lines marked. Click <strong>Save timestamps</strong> to finish.
              </div>
            )}
          </div>

          {/* Tap bar */}
          <div className="px-7 py-4 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-center gap-4 flex-shrink-0">
            <button
              onClick={doUndo}
              disabled={undoStack.length === 0}
              className="flex items-center gap-1 px-3.5 py-2 rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-secondary)] text-[12px] font-medium cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
              Undo
            </button>

            <button
              onClick={doTap}
              disabled={allDone || !audioSrc}
              className="flex items-center gap-2 px-12 py-3.5 rounded-[12px] border-none bg-[var(--theme)] text-white text-[15px] font-medium cursor-pointer hover:opacity-90 active:scale-[0.97] transition-all select-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {allDone ? "All lines marked" : "Tap to mark line start"}
            </button>

            <div className="text-[12px] text-[var(--text-muted)] flex items-center gap-1">
              <span className="inline-flex items-center px-[6px] py-[1px] rounded bg-[var(--accent-light)] border border-[var(--border)] text-[11px] font-semibold text-[var(--text-secondary)]">
                Space
              </span>
              or click
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
