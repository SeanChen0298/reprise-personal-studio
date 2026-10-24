import { useMemo } from "react";
import { FullWaveform } from "../../components/full-waveform";
import { formatMs } from "../../lib/status-config";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import type { Line, Section } from "../../types/song";
import type { Backing } from "./use-takes";

/** Every control in the bar shares this height so the row reads as one strip. */
const ctl = "h-[30px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] text-[11.5px] text-[var(--text-secondary)]";
const iconBtn = `${ctl} w-[30px] flex items-center justify-center cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-default`;

const SPEEDS = Array.from({ length: 11 }, (_, i) => Math.round((0.5 + i * 0.05) * 100) / 100);

export function TransportBar({
  player,
  durationMs,
  peaks,
  lines,
  sections,
  cursorLineId,
  tracks,
  track,
  onTrack,
  loopLabel,
  onClearLoopRange,
  disabled,
}: {
  player: UseLinePlayerReturn;
  durationMs: number;
  peaks: number[];
  lines: Line[];
  sections: Section[];
  cursorLineId: string | null;
  tracks: { key: Backing; label: string }[];
  track: Backing;
  onTrack: (t: Backing) => void;
  loopLabel: string | null;
  onClearLoopRange: () => void;
  /** Locked while a take is recording (seeking would break its alignment). */
  disabled: boolean;
}) {
  const nowMs = player.currentTime * 1000;

  // Sections as labelled bands on the waveform; the selected line highlighted.
  const bands = useMemo(() => {
    if (durationMs <= 0) return [];
    return sections.flatMap((s) => {
      const secLines = lines.filter(
        (l) => l.order >= s.start_line_order && l.order <= s.end_line_order && l.start_ms != null,
      );
      if (!secLines.length) return [];
      const start = Math.min(...secLines.map((l) => l.start_ms!));
      const end = Math.max(...secLines.map((l) => l.end_ms ?? l.start_ms!));
      return [{ start: start / durationMs, end: end / durationMs, label: s.name }];
    });
  }, [sections, lines, durationMs]);
  const cursorLine = lines.find((l) => l.id === cursorLineId);
  const highlight = useMemo(
    () =>
      cursorLine?.start_ms != null && cursorLine.end_ms != null && durationMs > 0
        ? { start: cursorLine.start_ms / durationMs, end: cursorLine.end_ms / durationMs }
        : null,
    [cursorLine?.start_ms, cursorLine?.end_ms, durationMs],
  );

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-[9px] border-b border-[var(--border)] bg-[var(--surface)]">
      {/* Transport */}
      <div className="flex items-center gap-[6px] flex-shrink-0">
        <button onClick={player.prevLine} disabled={disabled} title="Previous line" className={iconBtn}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
        </button>
        <button
          onClick={player.togglePlay}
          disabled={disabled}
          title="Play / pause (Space)"
          className="w-[36px] h-[36px] rounded-full bg-[var(--theme)] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-85 disabled:opacity-40"
        >
          {player.isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}><polygon points="5,3 19,12 5,21" /></svg>
          )}
        </button>
        <button onClick={player.nextLine} disabled={disabled} title="Next line" className={iconBtn}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
        </button>
      </div>

      <span className="flex-shrink-0 w-[74px] text-[11.5px] tabular-nums text-[var(--text-primary)]">
        {formatMs(nowMs)}
        <span className="text-[var(--text-muted)]"> / {formatMs(durationMs)}</span>
      </span>

      {/* Waveform — sections as bands, the selected line highlighted */}
      <div className={`flex-1 min-w-[200px] ${disabled ? "pointer-events-none opacity-70" : ""}`}>
        {peaks.length > 0 && durationMs > 0 ? (
          <FullWaveform
            peaks={peaks}
            progress={Math.min(1, nowMs / durationMs)}
            bands={bands}
            highlight={highlight}
            onSeek={(f) => player.seekTo(f * durationMs)}
            heightClass="h-[40px]"
          />
        ) : (
          <div className="h-[40px] rounded-[6px] bg-[var(--bg)]" />
        )}
      </div>

      {/* Track */}
      <div className={`${ctl} flex-shrink-0 flex items-center p-[2px] bg-[var(--bg)]`}>
        {tracks.map((t) => (
          <button
            key={t.key}
            onClick={() => onTrack(t.key)}
            disabled={disabled}
            title={t.key === "original" ? "Full mix" : t.key === "vocal" ? "Vocal only" : "Instrumental (no vocals)"}
            className={`h-full px-[9px] rounded-[5px] text-[11px] font-medium border-none cursor-pointer ${
              track === t.key ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Speed */}
      <select
        value={player.speed}
        onChange={(e) => player.setSpeed(Number(e.target.value))}
        disabled={disabled}
        title="Speed (Alt+S slower, Alt+W faster)"
        className={`${ctl} flex-shrink-0 px-2 outline-none cursor-pointer tabular-nums ${player.speed < 1 ? "text-[var(--theme-text)] font-medium" : ""}`}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s.toFixed(2)}×</option>
        ))}
      </select>

      {/* Loop */}
      <div className="flex-shrink-0 flex items-center gap-[4px]">
        <button
          onClick={player.toggleLoop}
          disabled={disabled}
          title="Loop the line (Q), or the section (Shift+Q)"
          className={`${ctl} px-[9px] flex items-center gap-[5px] cursor-pointer ${
            player.loopEnabled ? "!bg-[var(--theme)] !border-[var(--theme)] !text-white" : "hover:border-[#888] hover:text-[var(--text-primary)]"
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" />
          </svg>
          {player.loopEnabled ? (loopLabel ?? "Line") : "Loop"}
          {player.loopRange && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearLoopRange();
              }}
              title="Back to looping one line"
              className="ml-[2px] opacity-80 hover:opacity-100"
            >
              ×
            </span>
          )}
        </button>
        {player.loopEnabled && (
          <select
            value={player.maxLoops}
            onChange={(e) => player.setMaxLoops(Number(e.target.value))}
            title="Times to repeat"
            className={`${ctl} px-1 outline-none cursor-pointer`}
          >
            {[1, 2, 3, 5, 10, 99].map((n) => (
              <option key={n} value={n}>{n === 99 ? "∞" : `×${n}`}</option>
            ))}
          </select>
        )}
      </div>

      {/* Volume */}
      <div className="flex-shrink-0 flex items-center gap-[6px]" title={`Volume ${Math.round(player.volume * 100)}%`}>
        <button
          onClick={() => player.setVolume(player.volume > 0 ? 0 : 1)}
          className="bg-transparent border-none p-0 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] flex"
          title={player.volume > 0 ? "Mute" : "Unmute"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {player.volume > 0 ? <path d="M15.54 8.46a5 5 0 010 7.07" /> : <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>}
          </svg>
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={player.volume}
          onChange={(e) => player.setVolume(parseFloat(e.target.value))}
          className="w-[64px] h-[3px] accent-[var(--theme)] cursor-pointer"
        />
      </div>
    </div>
  );
}
