import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Song, Line, Section } from "../../types/song";
import { STATUS_CONFIG } from "../../lib/status-config";
import { useSongStore } from "../../stores/song-store";

interface Props {
  song: Song;
  lines: Line[];
  activeLineIndex: number;
  loopRange: [number, number] | null;
  sections: Section[];
  onLineClick: (index: number) => void;
  onShiftClick: (index: number) => void;
  onRecordSection: (section: Section) => void;
}

export function LineNavigator({
  song, lines, activeLineIndex, loopRange, sections,
  onLineClick, onShiftClick, onRecordSection,
}: Props) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const addSection = useSongStore((s) => s.addSection);
  const removeSection = useSongStore((s) => s.removeSection);
  const updateSection = useSongStore((s) => s.updateSection);

  const [creatingSection, setCreatingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const masteredCount = lines.filter((l) => l.status === "mastered").length;
  const masteryPct = lines.length > 0 ? Math.round((masteredCount / lines.length) * 100) : 0;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLineIndex]);

  // Build a map of line order -> section for headers
  const sectionByStartOrder = new Map<number, Section>();
  const sectionEndOrders = new Set<number>();
  for (const sec of sections) {
    sectionByStartOrder.set(sec.start_line_order, sec);
    sectionEndOrders.add(sec.end_line_order);
  }

  const handleCreateSection = useCallback(() => {
    if (!newSectionName.trim() || !loopRange) return;
    const startOrder = lines[loopRange[0]]?.order;
    const endOrder = lines[loopRange[1]]?.order;
    if (startOrder == null || endOrder == null) return;

    const now = new Date().toISOString();
    addSection(song.id, {
      id: crypto.randomUUID(),
      song_id: song.id,
      name: newSectionName.trim(),
      start_line_order: startOrder,
      end_line_order: endOrder,
      created_at: now,
      updated_at: now,
    });
    setNewSectionName("");
    setCreatingSection(false);
  }, [newSectionName, loopRange, lines, song.id, addSection]);

  const handleRenameSection = useCallback((sectionId: string) => {
    if (!editName.trim()) return;
    updateSection(song.id, sectionId, { name: editName.trim() });
    setEditingSectionId(null);
    setEditName("");
  }, [editName, song.id, updateSection]);

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

      {/* Create section button */}
      <div className="px-3 pt-2 pb-1">
        {creatingSection ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateSection(); if (e.key === "Escape") setCreatingSection(false); }}
              placeholder="Section name..."
              autoFocus
              className="flex-1 text-[11px] px-2 py-[3px] rounded-[5px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] outline-none"
            />
            <button
              onClick={handleCreateSection}
              disabled={!newSectionName.trim() || !loopRange}
              className="text-[10px] px-2 py-[3px] rounded-[5px] bg-[var(--accent)] text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
            <button
              onClick={() => setCreatingSection(false)}
              className="text-[10px] px-1 py-[3px] text-[var(--text-muted)] bg-transparent border-none cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingSection(true)}
            disabled={!loopRange}
            title={loopRange ? "Create section from selected lines" : "Select a line range first (Shift+click)"}
            className="w-full text-[10.5px] font-medium px-2 py-[4px] rounded-[5px] border border-dashed border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Section
          </button>
        )}
      </div>

      {/* Line list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2">
        {lines.map((line, i) => {
          const isActive = i === activeLineIndex;
          const inRange = loopRange != null && i >= loopRange[0] && i <= loopRange[1];
          const cfg = STATUS_CONFIG[line.status];
          const section = sectionByStartOrder.get(line.order);

          return (
            <div key={line.id}>
              {/* Section header */}
              {section && (
                <div className="flex items-center gap-1 px-[10px] py-[5px] mb-[2px] mt-1">
                  {editingSectionId === section.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameSection(section.id); if (e.key === "Escape") setEditingSectionId(null); }}
                      onBlur={() => handleRenameSection(section.id)}
                      autoFocus
                      className="flex-1 text-[10.5px] font-semibold px-1 py-0 rounded-[3px] border border-[var(--theme)] bg-[var(--bg)] text-[var(--text-primary)] outline-none uppercase tracking-[0.06em]"
                    />
                  ) : (
                    <>
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--theme-text)] flex-1 truncate">
                        {section.name}
                      </span>
                      {/* Record section */}
                      <button
                        onClick={() => onRecordSection(section)}
                        title={`Record ${section.name}`}
                        className="w-5 h-5 rounded-full bg-[#DC2626] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0"
                      >
                        <svg width="7" height="7" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="6" fill="#fff" />
                        </svg>
                      </button>
                      {/* Edit */}
                      <button
                        onClick={() => { setEditingSectionId(section.id); setEditName(section.name); }}
                        className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        title="Rename section"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => removeSection(song.id, section.id)}
                        className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!text-red-500 transition-all"
                        title="Delete section"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Line row */}
              <div
                ref={isActive ? activeRef : undefined}
                onClick={(e) => {
                  if (e.shiftKey) {
                    onShiftClick(i);
                  } else {
                    onLineClick(i);
                  }
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
