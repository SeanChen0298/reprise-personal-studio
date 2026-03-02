import { useRef, useState } from "react";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import type { AudioDevice } from "../../hooks/use-audio-devices";
import { SettingsPopover } from "../../components/settings-popover";

interface Props {
  player: UseLinePlayerReturn;
  activeTrack: string;
  onTrackChange: (track: "vocals" | "instrumental" | "reference") => void;
  onClearRange?: () => void;
  hasStemSeparation?: boolean;
  inputDevices?: AudioDevice[];
  outputDevices?: AudioDevice[];
  selectedInputId?: string;
  selectedOutputId?: string;
  onInputChange?: (id: string) => void;
  onOutputChange?: (id: string) => void;
  skipCountdown?: boolean;
  onSkipCountdownToggle?: () => void;
  recordThrough?: boolean;
  onRecordThroughToggle?: () => void;
  volume?: number;
  onVolumeChange?: (v: number) => void;
}

export function PracticeTopbar({
  player, activeTrack, onTrackChange, onClearRange, hasStemSeparation,
  inputDevices, outputDevices, selectedInputId, selectedOutputId, onInputChange, onOutputChange,
  skipCountdown, onSkipCountdownToggle, recordThrough, onRecordThroughToggle,
  volume, onVolumeChange,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="h-12 px-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface)] flex-shrink-0">
      {/* Left: Loop + Speed */}
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

      {/* Center: Volume */}
      <div className="flex items-center gap-[6px]">
        <button
          onClick={() => onVolumeChange?.(volume ? 0 : 1)}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer bg-transparent border-none p-0 flex items-center"
          title={volume ? "Mute" : "Unmute"}
        >
          {(volume ?? 1) === 0 ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (volume ?? 1) < 0.5 ? (
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
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume ?? 1}
          onChange={(e) => onVolumeChange?.(parseFloat(e.target.value))}
          className="w-[70px] h-[3px] accent-[var(--theme)] cursor-pointer"
          title={`Volume: ${Math.round((volume ?? 1) * 100)}%`}
        />
        <span className="text-[10px] text-[var(--text-muted)] tabular-nums min-w-[26px]">
          {Math.round((volume ?? 1) * 100)}
        </span>
      </div>

      {/* Right: Track toggles + Settings gear */}
      <div className="flex items-center gap-2">
        <TrackButton
          label="Vocals"
          active={activeTrack === "vocals"}
          onClick={() => onTrackChange("vocals")}
          disabled={!hasStemSeparation}
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
          disabled={!hasStemSeparation}
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

        {/* Settings gear */}
        <button
          ref={gearRef}
          onClick={() => setSettingsOpen((v) => !v)}
          className={`w-8 h-8 rounded-[6px] border border-[var(--border)] flex items-center justify-center cursor-pointer transition-all ${
            settingsOpen
              ? "bg-[var(--theme-light)] text-[var(--theme)] border-[var(--theme)]"
              : "bg-transparent text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)]"
          }`}
          title="Practice settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        <SettingsPopover
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          anchorRef={gearRef}
          skipCountdown={skipCountdown}
          onSkipCountdownToggle={onSkipCountdownToggle}
          recordThrough={recordThrough}
          onRecordThroughToggle={onRecordThroughToggle}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          selectedInputId={selectedInputId}
          selectedOutputId={selectedOutputId}
          onInputChange={onInputChange}
          onOutputChange={onOutputChange}
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
      title={disabled ? "Separate tracks in Audio Setup first" : undefined}
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
