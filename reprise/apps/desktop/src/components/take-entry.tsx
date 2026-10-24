import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import { usePreferencesStore } from "../stores/preferences-store";
import { formatMs } from "../lib/status-config";
import { isBreathIssue } from "../lib/take-review";
import type { Recording, Line } from "../types/song";

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

export interface RecordingEntryProps {
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

export function RecordingEntry({
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

