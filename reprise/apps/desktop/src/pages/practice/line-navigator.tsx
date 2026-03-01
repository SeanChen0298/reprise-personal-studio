import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Song, Line, Section } from "../../types/song";
import { STATUS_CONFIG } from "../../lib/status-config";

interface Props {
  song: Song;
  lines: Line[];
  activeLineIndex: number;
  loopRange: [number, number] | null;
  sections: Section[];
  activeSection: Section | null;
  autoPlayOnClick: boolean;
  onAutoPlayToggle: () => void;
  onLineClick: (index: number) => void;
  onShiftClick: (index: number) => void;
  onSectionClick: (section: Section) => void;
  onRecordSection: (section: Section) => void;
}

export function LineNavigator({
  song, lines, activeLineIndex, loopRange, sections, activeSection,
  autoPlayOnClick, onAutoPlayToggle,
  onLineClick, onShiftClick, onSectionClick, onRecordSection,
}: Props) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const masteredCount = lines.filter((l) => l.status === "mastered").length;
  const masteryPct = lines.length > 0 ? Math.round((masteredCount / lines.length) * 100) : 0;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLineIndex]);

  // Build a map of line order -> section for headers
  const sectionByStartOrder = useMemo(() => {
    const map = new Map<number, Section>();
    for (const sec of sections) {
      map.set(sec.start_line_order, sec);
    }
    return map;
  }, [sections]);

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

      {/* Auto-play toggle */}
      <div className="px-3 pt-2 pb-1 flex flex-col gap-1">
        <button
          onClick={onAutoPlayToggle}
          title={autoPlayOnClick ? "Auto-play on click: ON" : "Auto-play on click: OFF"}
          className={`w-full text-[10.5px] font-medium px-2 py-[4px] rounded-[5px] border bg-transparent cursor-pointer transition-all flex items-center justify-center gap-1 ${
            autoPlayOnClick
              ? "border-[var(--theme)] text-[var(--theme-text)] bg-[var(--theme-light)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)]"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Auto-play on click
        </button>
      </div>

      {/* Line list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 select-none">
        {lines.map((line, i) => {
          const isActive = i === activeLineIndex;
          const inRange = loopRange != null && i >= loopRange[0] && i <= loopRange[1];
          const cfg = STATUS_CONFIG[line.status];
          const section = sectionByStartOrder.get(line.order);

          return (
            <div key={line.id}>
              {/* Section header (display-only + clickable for navigation) */}
              {section && (
                <div
                  onClick={() => onSectionClick(section)}
                  className={`flex items-center gap-1 px-[10px] py-[5px] mb-[2px] mt-1 rounded-[5px] cursor-pointer transition-colors ${
                    activeSection?.id === section.id
                      ? "bg-[var(--theme-light)]"
                      : "hover:bg-[var(--bg)]"
                  }`}
                >
                  <span className={`text-[10.5px] font-semibold uppercase tracking-[0.06em] flex-1 truncate ${
                    activeSection?.id === section.id ? "text-[var(--theme-text)]" : "text-[var(--theme-text)]"
                  }`}>
                    {section.name}
                  </span>
                  {/* Record section */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRecordSection(section); }}
                    title={`Record ${section.name}`}
                    className="w-5 h-5 rounded-full bg-[#DC2626] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
                  >
                    <svg width="7" height="7" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="6" fill="#fff" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Line row */}
              <div
                ref={isActive ? activeRef : undefined}
                onClick={(e) => {
                  if (e.shiftKey) {
                    e.preventDefault();
                    onShiftClick(i);
                  } else {
                    onLineClick(i);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.shiftKey) e.preventDefault();
                }}
                className={`group flex items-center gap-2 px-[10px] py-2 rounded-[7px] cursor-pointer mb-[2px] transition-colors ${
                  isActive
                    ? "bg-[var(--theme-light)]"
                    : inRange
                      ? "bg-[var(--theme-light)] opacity-60"
                      : "hover:bg-[var(--bg)]"
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
