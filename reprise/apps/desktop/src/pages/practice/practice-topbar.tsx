import type { UseLinePlayerReturn } from "../../hooks/use-line-player";

interface Props {
  player: UseLinePlayerReturn;
  activeTrack: string;
  onTrackChange: (track: "vocals" | "instrumental" | "reference") => void;
  onClearRange?: () => void;
}

export function PracticeTopbar({ player, activeTrack, onTrackChange, onClearRange }: Props) {
  return (
    <div className="h-12 px-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)] flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* Loop toggle */}
        <button
          onClick={player.toggleLoop}
          className={`text-[11px] font-medium px-[10px] py-[3px] rounded-[20px] inline-flex items-center gap-1 cursor-pointer border-none transition-all ${
            player.loopEnabled
              ? "text-[var(--theme-text)] bg-[var(--theme-light)]"
              : "text-[var(--text-muted)] bg-[var(--accent-light)]"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 014-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          {player.loopEnabled
            ? player.loopRange
              ? `Lines ${player.loopRange[0] + 1}–${player.loopRange[1] + 1} ${player.loopCount}/${player.maxLoops}`
              : `Loop ${player.loopCount}/${player.maxLoops}`
            : "Loop off"}
        </button>

        {/* Clear range button */}
        {player.loopRange && (
          <button
            onClick={onClearRange}
            className="text-[10px] font-medium px-[8px] py-[2px] rounded-[12px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            title="Clear line selection"
          >
            ✕
          </button>
        )}

        {/* Max loops adjuster (only when loop enabled) */}
        {player.loopEnabled && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => player.setMaxLoops(Math.max(1, player.maxLoops - 1))}
              className="w-5 h-5 rounded-[4px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center text-[9px] font-semibold hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            >
              −
            </button>
            <button
              onClick={() => player.setMaxLoops(Math.min(10, player.maxLoops + 1))}
              className="w-5 h-5 rounded-[4px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center text-[9px] font-semibold hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            >
              +
            </button>
          </div>
        )}

        {/* Speed control */}
        <div className="flex items-center gap-[6px] text-[11.5px] text-[var(--text-secondary)]">
          <button
            onClick={player.decrementSpeed}
            className="w-6 h-6 rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center text-[10px] font-semibold hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
          >
            −
          </button>
          <span className="text-[12px] font-medium text-[var(--text-primary)] min-w-[32px] text-center tabular-nums">
            {player.speed.toFixed(2)}x
          </span>
          <button
            onClick={player.incrementSpeed}
            className="w-6 h-6 rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center text-[10px] font-semibold hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
          >
            +
          </button>
        </div>
      </div>

      {/* Track toggles */}
      <div className="flex items-center gap-2">
        <TrackButton
          label="Vocals"
          active={activeTrack === "vocals"}
          onClick={() => onTrackChange("vocals")}
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
            </svg>
          }
        />
        <TrackButton
          label="Instrumental"
          active={activeTrack === "instrumental"}
          onClick={() => onTrackChange("instrumental")}
          disabled
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          }
        />
        <TrackButton
          label="Reference"
          active={activeTrack === "reference"}
          onClick={() => onTrackChange("reference")}
          icon={
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function TrackButton({
  label,
  active,
  onClick,
  icon,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      className={`py-[5px] px-3 rounded-[6px] border text-[11.5px] font-medium cursor-pointer flex items-center gap-1 transition-all ${
        active
          ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-[#BFDBFE]"
          : "bg-transparent text-[var(--text-secondary)] border-[var(--border)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}
