import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Song, Line } from "../../types/song";
import { STATUS_CONFIG } from "../../lib/status-config";

interface Props {
  song: Song;
  lines: Line[];
  activeLineIndex: number;
  onLineClick: (index: number) => void;
}

export function LineNavigator({ song, lines, activeLineIndex, onLineClick }: Props) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const masteredCount = lines.filter((l) => l.status === "mastered").length;
  const masteryPct = lines.length > 0 ? Math.round((masteredCount / lines.length) * 100) : 0;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLineIndex]);

  return (
    <aside className="w-[260px] h-screen bg-[var(--surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-[14px] border-b border-[var(--border-subtle)] flex items-center gap-[10px]">
        <button
          onClick={() => navigate(`/song/${song.id}`)}
          className="flex items-center justify-center w-7 h-7 rounded-[6px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{song.title}</div>
          <div className="text-[11px] text-[var(--text-muted)]">{song.artist}</div>
        </div>
      </div>

      {/* Line list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2">
        {lines.map((line, i) => {
          const isActive = i === activeLineIndex;
          const cfg = STATUS_CONFIG[line.status];
          return (
            <div
              key={line.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onLineClick(i)}
              className={`flex items-center gap-2 px-[10px] py-2 rounded-[7px] cursor-pointer mb-[2px] transition-colors ${
                isActive ? "bg-[var(--theme-light)]" : "hover:bg-[var(--bg)]"
              }`}
            >
              <span
                className={`w-5 text-center text-[10.5px] font-medium tabular-nums flex-shrink-0 ${
                  isActive ? "text-[var(--theme-text)]" : "text-[var(--text-muted)]"
                }`}
              >
                {i + 1}
              </span>
              <span
                className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                style={{ background: cfg.dot }}
              />
              <span
                className={`text-[12.5px] flex-1 min-w-0 truncate ${
                  isActive ? "text-[var(--theme-text)] font-medium" : "text-[var(--text-secondary)]"
                }`}
              >
                {line.text}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer - mastery progress */}
      <div className="px-4 py-[10px] border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-muted)]">Mastery</span>
          <span className="text-[12px] font-medium text-[var(--theme-text)]">{masteryPct}%</span>
        </div>
        <div className="w-full h-[3px] rounded-[2px] bg-[var(--border-subtle)] mt-[6px] overflow-hidden">
          <div
            className="h-full rounded-[2px] bg-[var(--theme)] transition-[width] duration-300"
            style={{ width: `${masteryPct}%` }}
          />
        </div>
      </div>
    </aside>
  );
}
