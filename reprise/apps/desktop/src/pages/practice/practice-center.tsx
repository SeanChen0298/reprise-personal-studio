import type { Line } from "../../types/song";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import { STATUS_CONFIG, formatMs, nextStatus } from "../../lib/status-config";
import { useSongStore } from "../../stores/song-store";

interface Props {
  lines: Line[];
  activeLineIndex: number;
  player: UseLinePlayerReturn;
  songId: string;
}

export function PracticeCenter({ lines, activeLineIndex, player, songId }: Props) {
  const updateLineStatus = useSongStore((s) => s.updateLineStatus);
  const currentLine = lines[activeLineIndex];
  const prevLine = lines[activeLineIndex - 1];
  const nextLine = lines[activeLineIndex + 1];
  const hasTimestamps = currentLine?.start_ms != null && currentLine?.end_ms != null;

  const handleStatusClick = () => {
    if (!currentLine) return;
    const next = nextStatus(currentLine.status);
    updateLineStatus(songId, currentLine.id, next);
  };

  if (!currentLine) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-muted)] text-[14px]">No lines to practice.</p>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[currentLine.status];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8 relative overflow-hidden">
      {/* Previous context line */}
      <div className="text-[15px] text-[var(--text-muted)] font-light text-center max-w-[600px] leading-relaxed opacity-35 my-[6px]">
        {prevLine?.text ?? "\u00A0"}
      </div>

      {/* Current line hero */}
      <div key={activeLineIndex} className="text-center my-5 animate-fade-up">
        <div className="font-serif text-[32px] tracking-[-0.5px] leading-[1.35] text-[var(--text-primary)] max-w-[640px]">
          {currentLine.text}
        </div>
        <div className="flex items-center justify-center gap-3 mt-[10px]">
          {hasTimestamps && (
            <span className="text-[11.5px] text-[var(--text-muted)] flex items-center gap-1 tabular-nums">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatMs(currentLine.start_ms!)} — {formatMs(currentLine.end_ms!)}
            </span>
          )}
          <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
            Line {activeLineIndex + 1} of {lines.length}
          </span>
          <button
            onClick={handleStatusClick}
            className="text-[10.5px] font-medium px-[9px] py-[2px] rounded-[20px] cursor-pointer border-none transition-colors"
            style={{ background: cfg.tagBg, color: cfg.tagColor }}
          >
            {cfg.label}
          </button>
        </div>
      </div>

      {/* Next context line */}
      <div className="text-[15px] text-[var(--text-muted)] font-light text-center max-w-[600px] leading-relaxed opacity-50 my-[6px]">
        {nextLine?.text ?? "\u00A0"}
      </div>

      {/* Progress bar (waveform placeholder) */}
      {hasTimestamps && (
        <div className="w-full max-w-[560px] mt-6">
          <div
            className="h-[56px] bg-[var(--border-subtle)] rounded-[4px] relative cursor-pointer overflow-hidden"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientX - rect.left) / rect.width;
              player.seekWithinLine(fraction);
            }}
          >
            <div
              className="absolute inset-y-0 left-0 bg-[var(--theme)] opacity-20 transition-[width] duration-100"
              style={{ width: `${player.lineProgress * 100}%` }}
            />
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[var(--theme)] transition-[left] duration-100"
              style={{ left: `${player.lineProgress * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] tabular-nums mt-1">
            <span>{formatMs(currentLine.start_ms!)}</span>
            <span>{formatMs(currentLine.end_ms!)}</span>
          </div>
        </div>
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-3 mt-7">
        {/* Prev */}
        <button
          onClick={player.prevLine}
          disabled={activeLineIndex === 0}
          className="w-10 h-10 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="19 20 9 12 19 4 19 20" />
            <line x1="5" y1="19" x2="5" y2="5" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={player.togglePlay}
          className="w-14 h-14 rounded-full bg-[var(--accent)] text-white cursor-pointer flex items-center justify-center hover:opacity-85 hover:scale-105 transition-all border-none"
        >
          {player.isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}>
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Record (disabled) */}
        <button
          disabled
          title="Recording coming soon"
          className="w-14 h-14 rounded-full bg-[#DC2626] text-white flex items-center justify-center border-none opacity-50 cursor-not-allowed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="6" fill="#fff" stroke="none" />
          </svg>
        </button>

        {/* Next */}
        <button
          onClick={player.nextLine}
          disabled={activeLineIndex === lines.length - 1}
          className="w-10 h-10 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 4 15 12 5 20 5 4" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
      </div>
    </div>
  );
}
