import { useCallback, useEffect, useRef, useState } from "react";
import type { Line, Annotation } from "../../types/song";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import { STATUS_CONFIG, formatMs, nextStatus } from "../../lib/status-config";
import { useSongStore } from "../../stores/song-store";
import { useHighlightStore } from "../../lib/highlight-config";
import { useSymbolStore } from "../../lib/symbol-config";
import { AnnotatedText } from "../../components/annotated-text";

interface Props {
  lines: Line[];
  activeLineIndex: number;
  player: UseLinePlayerReturn;
  songId: string;
  onEditModeChange?: (editing: boolean) => void;
}

export function PracticeCenter({ lines, activeLineIndex, player, songId, onEditModeChange }: Props) {
  const updateLineStatus = useSongStore((s) => s.updateLineStatus);
  const updateLineCustomText = useSongStore((s) => s.updateLineCustomText);
  const updateLineAnnotations = useSongStore((s) => s.updateLineAnnotations);
  const highlights = useHighlightStore((s) => s.highlights);
  const symbols = useSymbolStore((s) => s.symbols);

  const currentLine = lines[activeLineIndex];
  const prevLine = lines[activeLineIndex - 1];
  const nextLineData = lines[activeLineIndex + 1];
  const hasTimestamps = currentLine?.start_ms != null && currentLine?.end_ms != null;

  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [editAnnotations, setEditAnnotations] = useState<Annotation[]>([]);
  const editableRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When active line changes during edit mode, save current edits and load new line
  const prevLineIndexRef = useRef(activeLineIndex);
  useEffect(() => {
    if (prevLineIndexRef.current !== activeLineIndex && editMode) {
      // Save edits for the previous line
      const prevLine2 = lines[prevLineIndexRef.current];
      if (prevLine2) {
        updateLineCustomText(songId, prevLine2.id, editText);
        updateLineAnnotations(songId, prevLine2.id, editAnnotations);
      }
      // Load the new line's data
      if (currentLine) {
        setEditText(currentLine.custom_text ?? currentLine.text);
        setEditAnnotations(currentLine.annotations ?? []);
      }
    }
    prevLineIndexRef.current = activeLineIndex;
  }, [activeLineIndex, editMode, currentLine, lines, songId, editText, editAnnotations, updateLineCustomText, updateLineAnnotations]);

  const enterEditMode = useCallback(() => {
    if (!currentLine) return;
    player.pause();
    setEditText(currentLine.custom_text ?? currentLine.text);
    setEditAnnotations(currentLine.annotations ?? []);
    setEditMode(true);
    onEditModeChange?.(true);
  }, [currentLine, player, onEditModeChange]);

  const exitEditMode = useCallback(() => {
    if (!currentLine) return;
    // Save custom text and annotations
    updateLineCustomText(songId, currentLine.id, editText);
    updateLineAnnotations(songId, currentLine.id, editAnnotations);
    setEditMode(false);
    onEditModeChange?.(false);
  }, [currentLine, songId, editText, editAnnotations, updateLineCustomText, updateLineAnnotations, onEditModeChange]);

  const handleApplyHighlight = useCallback(
    (typeId: string) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editableRef.current) return;

      // Get selection offsets relative to the text content
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(editableRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;

      if (start === end || start < 0 || end > editText.length) return;

      // Remove any overlapping annotations
      const filtered = editAnnotations.filter(
        (a) => a.end <= start || a.start >= end
      );

      // Add new annotation
      const newAnnotation: Annotation = { start, end, type: typeId };
      const updated = [...filtered, newAnnotation].sort((a, b) => a.start - b.start);
      setEditAnnotations(updated);
      sel.removeAllRanges();
    },
    [editText, editAnnotations]
  );

  const handleRemoveAnnotation = useCallback(
    (annotationIndex: number) => {
      setEditAnnotations((prev) => prev.filter((_, i) => i !== annotationIndex));
    },
    []
  );

  const handleEditTextChange = useCallback((newText: string) => {
    setEditText(newText);
    // Clear annotations when text changes since char indices become invalid
    setEditAnnotations([]);
  }, []);

  const handleInsertSymbol = useCallback((char: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? editText.length;
    const end = input.selectionEnd ?? start;
    const newText = editText.slice(0, start) + char + editText.slice(end);
    handleEditTextChange(newText);
    // Restore cursor position after the inserted char
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + char.length;
      input.setSelectionRange(pos, pos);
    });
  }, [editText, handleEditTextChange]);

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
  const displayText = currentLine.custom_text ?? currentLine.text;
  const hasCustomText = currentLine.custom_text != null && currentLine.custom_text !== currentLine.text;

  if (editMode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8 relative overflow-hidden">
        {/* Highlight toolbar */}
        <div className="flex items-center gap-2 mb-6 flex-wrap justify-center">
          {highlights.map((hl) => (
            <button
              key={hl.id}
              onClick={() => handleApplyHighlight(hl.id)}
              className="text-[11.5px] font-medium px-3 py-[5px] rounded-[6px] border cursor-pointer flex items-center gap-[6px] transition-all hover:scale-105"
              style={{
                backgroundColor: hl.bg,
                color: hl.color,
                borderColor: hl.color + "40",
              }}
            >
              <span
                className="w-[8px] h-[8px] rounded-full flex-shrink-0"
                style={{ backgroundColor: hl.color }}
              />
              {hl.name}
            </button>
          ))}
        </div>

        {/* Editable custom text */}
        <div className="w-full max-w-[640px] mb-4">
          {/* Original line label */}
          <div className="text-[11px] text-[var(--text-muted)] opacity-50 text-center mb-3">
            Original: {currentLine.text}
          </div>

          {/* Text input for editing notation */}
          <input
            ref={inputRef}
            type="text"
            value={editText}
            onChange={(e) => handleEditTextChange(e.target.value)}
            className="w-full px-4 py-3 text-[18px] font-serif rounded-[8px] border-2 border-[var(--theme)] bg-[var(--surface)] text-[var(--text-primary)] outline-none shadow-[0_0_0_3px_rgba(37,99,235,0.1)] transition-colors text-center"
            placeholder="Edit lyrics notation..."
          />

          {/* Symbol insert buttons */}
          <div className="flex items-center gap-[6px] mt-2 justify-center">
            <span className="text-[10px] text-[var(--text-muted)] opacity-60 mr-1">Insert:</span>
            {symbols.map((sym) => (
              <button
                key={sym.id}
                onClick={() => handleInsertSymbol(sym.char)}
                title={sym.label}
                className="text-[16px] w-8 h-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[var(--theme)] hover:text-[var(--theme)] transition-all"
              >
                {sym.char}
              </button>
            ))}
          </div>

          {/* Annotated preview (select text here to highlight) */}
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] opacity-60 mt-4 mb-1 text-center">
            Preview — select text below, then click a highlight
          </div>
          <div
            ref={editableRef}
            className="font-serif text-[26px] tracking-[-0.5px] leading-[1.4] text-[var(--text-secondary)] text-center p-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg)] min-h-[50px] select-text cursor-text"
          >
            <AnnotatedText
              text={editText}
              annotations={editAnnotations}
              highlights={highlights}
              onClickAnnotation={handleRemoveAnnotation}
            />
          </div>
        </div>

        {/* Done button */}
        <button
          onClick={exitEditMode}
          className="px-5 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-85 transition-opacity border-none cursor-pointer"
        >
          Done editing
        </button>
      </div>
    );
  }

  // Playback mode
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8 relative overflow-hidden">
      {/* Previous context line */}
      <div className="text-[15px] text-[var(--text-muted)] font-light text-center max-w-[600px] leading-relaxed opacity-35 my-[6px]">
        {prevLine?.text ?? "\u00A0"}
      </div>

      {/* Current line hero */}
      <div key={activeLineIndex} className="text-center my-5 animate-fade-up">
        {/* Show original text above if custom_text differs */}
        {hasCustomText && (
          <div className="text-[14px] text-[var(--text-muted)] mb-2 opacity-50">
            {currentLine.text}
          </div>
        )}
        <div className="font-serif text-[32px] tracking-[-0.5px] leading-[1.35] text-[var(--text-primary)] max-w-[640px]">
          <AnnotatedText
            text={displayText}
            annotations={currentLine.annotations}
            highlights={highlights}
          />
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
          {/* Edit button */}
          <button
            onClick={enterEditMode}
            className="w-6 h-6 rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            title="Edit annotations"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Next context line */}
      <div className="text-[15px] text-[var(--text-muted)] font-light text-center max-w-[600px] leading-relaxed opacity-50 my-[6px]">
        {nextLineData?.text ?? "\u00A0"}
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
