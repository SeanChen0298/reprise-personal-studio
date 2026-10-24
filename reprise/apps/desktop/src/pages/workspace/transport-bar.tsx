import { FullWaveform } from "../../components/full-waveform";
import { formatMs } from "../../lib/status-config";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import type { Line } from "../../types/song";
import type { Backing } from "./use-takes";

const btn =
  "h-[28px] min-w-[28px] px-[7px] rounded-[6px] flex items-center justify-center gap-[4px] text-[11.5px] border cursor-pointer transition-colors";
const idle = "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)]";
const on = "bg-[var(--theme)] border-[var(--theme)] text-white";

export function TransportBar({
  player,
  durationMs,
  peaks,
  lines,
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
  const regions =
    durationMs > 0
      ? lines
          .filter((l) => l.start_ms != null && l.end_ms != null)
          .map((l) => ({
            start: l.start_ms! / durationMs,
            end: l.end_ms! / durationMs,
            label: "",
            isCurrent: l.id === cursorLineId,
          }))
      : [];

  return (
    <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-3 px-5 pt-[10px]">
        <button
          onClick={player.prevLine}
          disabled={disabled}
          title="Previous line"
          className={`${btn} ${idle} disabled:opacity-40`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
        </button>
        <button
          onClick={player.togglePlay}
          disabled={disabled}
          title="Play / pause (Space)"
          className="w-[34px] h-[34px] rounded-full bg-[var(--theme)] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-85 disabled:opacity-40"
        >
          {player.isPlaying ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}><polygon points="5,3 19,12 5,21" /></svg>
          )}
        </button>
        <button onClick={player.nextLine} disabled={disabled} title="Next line" className={`${btn} ${idle} disabled:opacity-40`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
        </button>
        <span className="text-[11.5px] tabular-nums text-[var(--text-secondary)] w-[78px]">
          {formatMs(nowMs)} <span className="text-[var(--text-muted)]">/ {formatMs(durationMs)}</span>
        </span>

        <div className="flex p-[2px] rounded-[7px] bg-[var(--bg)] border border-[var(--border)]">
          {tracks.map((t) => (
            <button
              key={t.key}
              onClick={() => onTrack(t.key)}
              disabled={disabled}
              className={`px-[8px] py-[3px] rounded-[5px] text-[11px] font-medium border-none cursor-pointer ${
                track === t.key ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-[3px]" title="Speed ([ and ])">
          <button onClick={player.decrementSpeed} disabled={disabled || player.speed <= 0.5} className={`${btn} ${idle} disabled:opacity-40`}>−</button>
          <span className={`text-[11.5px] tabular-nums w-[38px] text-center ${player.speed < 1 ? "text-[var(--theme-text)] font-medium" : "text-[var(--text-secondary)]"}`}>
            {player.speed.toFixed(2)}×
          </span>
          <button onClick={player.incrementSpeed} disabled={disabled || player.speed >= 1} className={`${btn} ${idle} disabled:opacity-40`}>+</button>
        </div>

        <div className="flex items-center gap-[4px]">
          <button
            onClick={player.toggleLoop}
            disabled={disabled}
            title="Loop the playing line, or the selected range (L)"
            className={`${btn} ${player.loopEnabled ? on : idle}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" />
            </svg>
            {player.loopEnabled ? (loopLabel ?? "Line") : "Loop"}
          </button>
          {player.loopEnabled && (
            <select
              value={player.maxLoops}
              onChange={(e) => player.setMaxLoops(Number(e.target.value))}
              title="Times to repeat"
              className="h-[28px] px-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[11px] outline-none cursor-pointer"
            >
              {[1, 2, 3, 5, 10, 99].map((n) => (
                <option key={n} value={n}>{n === 99 ? "∞" : `×${n}`}</option>
              ))}
            </select>
          )}
          {player.loopRange && (
            <button onClick={onClearLoopRange} title="Back to single-line loop" className={`${btn} ${idle}`}>×</button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-[6px]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 010 7.07" />
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={player.volume}
            onChange={(e) => player.setVolume(parseFloat(e.target.value))}
            className="w-[70px] h-[3px] accent-[var(--theme)] cursor-pointer"
            title={`Volume ${Math.round(player.volume * 100)}%`}
          />
        </div>
      </div>
      <div className={`px-5 pb-[8px] pt-[8px] ${disabled ? "pointer-events-none opacity-70" : ""}`}>
        {peaks.length > 0 && durationMs > 0 ? (
          <FullWaveform
            peaks={peaks}
            progress={Math.min(1, nowMs / durationMs)}
            regions={regions}
            onSeek={(f) => player.seekTo(f * durationMs)}
            heightClass="h-[36px]"
          />
        ) : (
          <div className="h-[36px] rounded-[6px] bg-[var(--bg)]" />
        )}
      </div>
    </div>
  );
}
