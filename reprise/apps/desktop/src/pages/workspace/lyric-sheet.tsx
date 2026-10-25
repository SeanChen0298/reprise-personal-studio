import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnnotatedText, NON_TEXT_ATTR } from "../../components/annotated-text";
import { LONG_PHRASE_MS, lineVocalInfo, semitoneToNoteName, type LineVocalInfo, type VocalMap } from "../../lib/vocal-map";
import { ISSUE_LABEL, isBreathIssue } from "../../lib/take-review";
import { displayText } from "./use-workspace-edits";
import type { VocalSymbol } from "../../lib/symbol-config";
import type { SongCard } from "../../lib/coach/knowledge";
import type { LyricsCheck, LyricsGap } from "../../lib/lyrics-check";
import type { HighlightType } from "../../lib/highlight-config";
import type { Line, Section, TakeIssue } from "../../types/song";

export interface Cursor {
  lineId: string;
  /** Selection anchor / focus (caret) as character offsets in the displayed text. */
  anchor: number;
  focus: number;
}

export type SectionEdit =
  | { mode: "new"; lineId: string }
  | { mode: "rename"; sectionId: string };

/** Character offset of a DOM position inside `root`, ignoring furigana readings and decorations. */
function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  const frag = range.cloneContents();
  let count = 0;
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    let skip = false;
    for (let el = t.parentElement; el; el = el.parentElement) {
      if (el.tagName === "RT" || el.tagName === "RP" || el.hasAttribute(NON_TEXT_ATTR)) {
        skip = true;
        break;
      }
    }
    if (!skip) count += t.textContent?.length ?? 0;
  }
  return count;
}

/** m:ss.cc — timing needs hundredths to be useful. */
export function fmtTiming(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

const TIMING_HELP =
  "Line timing. ◀ ▶ (or Alt+A / Alt+D) shift the start by 50 ms; Alt+Shift+A / D shifts the end. " +
  "T sets the start to where the song is now. The line replays after each change so you can hear it. Ctrl+Z undoes.";

function InlineInput({
  initial,
  placeholder,
  className,
  onCommit,
  onCancel,
  symbols,
}: {
  initial: string;
  placeholder?: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  /** Vocal symbols to offer under the box (Alt+1…9 inserts them at the cursor). */
  symbols?: VocalSymbol[];
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const insert = (char: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    setValue(value.slice(0, start) + char + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + char.length, start + char.length);
    });
  };
  const input = (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        const n = symbols && e.altKey && /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
        if (n && symbols![n - 1]) {
          e.preventDefault();
          insert(symbols![n - 1].char);
        } else if (e.key === "Enter") {
          done.current = true;
          onCommit(value);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => !done.current && onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      className={className}
    />
  );
  if (!symbols?.length) return input;
  return (
    <div>
      {input}
      <div className="flex flex-wrap items-center gap-1 mt-[5px] select-none">
        {symbols.slice(0, 9).map((sym, i) => (
          <button
            key={sym.id}
            // Keep focus (and the cursor position) in the text box.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              insert(sym.char);
            }}
            title={`${sym.label} (Alt+${i + 1})`}
            className="flex items-center gap-[5px] px-[7px] py-[2px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--theme)] cursor-pointer"
          >
            <span className="text-[14px] leading-none text-[var(--text-primary)]">{sym.char}</span>
            {sym.label}
          </button>
        ))}
        <span className="text-[10.5px] text-[var(--text-muted)] ml-1">Alt+1…{Math.min(9, symbols.length)} · Enter save · Esc cancel</span>
      </div>
    </div>
  );
}

/** Quick symbol picker under the selected line (S): number keys insert at the caret. */
function SymbolPicker({ symbols, onPick, onClose }: { symbols: VocalSymbol[]; onPick: (char: string) => void; onClose: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 mt-[5px] px-2 py-[5px] rounded-[9px] border border-[var(--border)] bg-[var(--surface)] shadow-sm select-none"
      onMouseUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10.5px] text-[var(--text-muted)] mr-1">Insert at the caret:</span>
      {symbols.slice(0, 9).map((sym, i) => (
        <button
          key={sym.id}
          onClick={() => onPick(sym.char)}
          title={sym.label}
          className="flex items-center gap-[5px] px-[7px] py-[2px] rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--theme)] cursor-pointer"
        >
          <kbd className="font-sans text-[10px] text-[var(--text-muted)]">{i + 1}</kbd>
          <span className="text-[14px] leading-none text-[var(--text-primary)]">{sym.char}</span>
          {sym.label}
        </button>
      ))}
      <button onClick={onClose} className="ml-auto text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer">
        Esc
      </button>
    </div>
  );
}

interface LineRowProps {
  line: Line;
  info: LineVocalInfo | null;
  translation?: string;
  highlights: HighlightType[];
  isCursor: boolean;
  anchor: number;
  focus: number;
  isPlaying: boolean;
  inLoop: boolean;
  editing: boolean;
  /** Draw the caret (only once you're working inside the line). */
  showCaret: boolean;
  issues?: { issue: TakeIssue; key: string }[];
  onSelect: (lineId: string, anchor: number, focus: number) => void;
  onStartEdit: (lineId: string) => void;
  onCommitEdit: (lineId: string, text: string) => void;
  onCancelEdit: () => void;
  onPlay: (lineId: string) => void;
  onIssueClick: (issue: TakeIssue, key: string) => void;
  onNudge: (field: "start_ms" | "end_ms", deltaMs: number) => void;
  symbols: VocalSymbol[];
  /** Notes pinned to this line in your takes. */
  takeNotes?: { key: string; text: string; when: string }[];
  editingNote: boolean;
  onStartNote: (lineId: string) => void;
  onCommitNote: (lineId: string, text: string) => void;
  onCancelNote: () => void;
  /** Symbol picker open under this line. */
  pickingSymbol: boolean;
  onPickSymbol: (char: string) => void;
  onCloseSymbols: () => void;
  /** Lyrics check: the line has no singing under it, or its timing is unsure. */
  checkFlag?: "silent" | "unsure";
  onCheckOk: (lineId: string, flag: "silent" | "unsure") => void;
}

const LineRow = memo(function LineRow({
  line, info, translation, highlights, isCursor, anchor, focus, isPlaying, inLoop, editing, showCaret,
  issues, onSelect, onStartEdit, onCommitEdit, onCancelEdit, onPlay, onIssueClick, onNudge,
  symbols, pickingSymbol, onPickSymbol, onCloseSymbols,
  takeNotes, editingNote, onStartNote, onCommitNote, onCancelNote, checkFlag, onCheckOk,
}: LineRowProps) {
  const text = displayText(line);
  const textRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Keep the cursor line visible when moving with the keyboard.
  useEffect(() => {
    if (isCursor) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isCursor]);

  const handleMouseUp = (e: React.MouseEvent) => {
    if (editing || e.button !== 0) return;
    const root = textRef.current;
    const sel = window.getSelection();
    if (!root) return;
    let a = text.length;
    let f = text.length;
    if (sel && sel.anchorNode && root.contains(sel.anchorNode) && sel.focusNode && root.contains(sel.focusNode)) {
      a = Math.min(text.length, textOffset(root, sel.anchorNode, sel.anchorOffset));
      f = Math.min(text.length, textOffset(root, sel.focusNode, sel.focusOffset));
      sel.removeAllRanges();
    }
    onSelect(line.id, a, f);
  };

  const selection: [number, number] | undefined =
    isCursor && anchor !== focus ? [Math.min(anchor, focus), Math.max(anchor, focus)] : undefined;

  return (
    <div
      ref={rowRef}
      data-line-id={line.id}
      className={`group relative flex flex-col pl-8 pr-2 py-[5px] rounded-[8px] transition-colors ${
        isCursor ? "bg-[var(--theme-light)]" : inLoop ? "bg-[var(--theme-light)]/40" : "hover:bg-[var(--surface)]"
      }`}
      onMouseUp={handleMouseUp}
      onDoubleClick={() => {
        window.getSelection()?.removeAllRanges();
        onPlay(line.id);
      }}
      title={line.start_ms != null ? "Double-click (or Ctrl+Enter) to play from this line · F to edit the text" : "F to edit the text"}
    >
      {/* Being sung: a small level-meter icon; otherwise ▶ on hover */}
      {isPlaying ? (
        <span className="absolute left-[9px] top-[13px] flex items-end gap-[2px] h-[11px]" title="Playing">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-[2px] rounded-full bg-[var(--theme)] animate-pulse"
              style={{ height: `${[60, 100, 75][i]}%`, animationDelay: `${i * 150}ms`, animationDuration: "0.9s" }}
            />
          ))}
        </span>
      ) : line.start_ms != null && (
        <button
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPlay(line.id);
          }}
          title="Play from this line (Ctrl+Enter)"
          className="absolute left-[5px] top-[9px] w-[18px] h-[18px] rounded-full flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--surface)] text-[var(--text-secondary)] shadow-sm"
        >
          <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </button>
      )}

      <div className="flex items-start">
        <div ref={textRef} className="flex-1 min-w-0 select-text">
          {editing ? (
            <InlineInput
              initial={text}
              className="w-full px-2 py-[2px] -mx-2 rounded-[5px] border border-[var(--theme)] bg-[var(--surface)] text-[15px] leading-[1.6] outline-none"
              onCommit={(v) => onCommitEdit(line.id, v)}
              onCancel={onCancelEdit}
              symbols={symbols}
            />
          ) : (
            <div className={`text-[15px] leading-[1.65] transition-colors ${isPlaying ? "text-[var(--theme-text)] font-medium" : "text-[var(--text-primary)]"}`}>
              <AnnotatedText
                text={text}
                annotations={line.annotations}
                highlights={highlights}
                lineFuriganaHtml={line.custom_text ? line.custom_furigana_html : line.furigana_html}
                selection={selection}
                caret={isCursor && showCaret && anchor === focus ? focus : undefined}
              />
              {text.length === 0 && <span className="text-[var(--text-muted)] italic text-[13px]">(empty line)</span>}
            </div>
          )}
          {translation && <div className="text-[12px] leading-snug text-[var(--text-muted)] mt-0.5 select-none">{translation}</div>}
          {pickingSymbol && !editing && <SymbolPicker symbols={symbols} onPick={onPickSymbol} onClose={onCloseSymbols} />}
          {editingNote ? (
            <div className="mt-[5px]" onMouseUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <InlineInput
                initial={line.note ?? ""}
                placeholder="Your note for this line — Enter saves, empty removes"
                className="w-full px-2 py-[3px] rounded-[6px] border border-[var(--theme)] bg-[var(--surface)] text-[12.5px] outline-none"
                onCommit={(v) => onCommitNote(line.id, v)}
                onCancel={onCancelNote}
              />
            </div>
          ) : null}
        </div>

        {!editing && (
          <button
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit(line.id);
            }}
            title="Edit the text (F)"
            className="flex-shrink-0 ml-2 mt-[3px] w-[22px] h-[22px] rounded-[6px] flex items-center justify-center border-none bg-transparent cursor-pointer text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface)] hover:text-[var(--text-primary)] transition-opacity select-none"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>
        )}
        {isCursor && !editing && line.start_ms != null && (
          <div
            className="flex-shrink-0 flex items-center gap-[1px] ml-2 mt-[3px] px-[2px] h-[22px] rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[10.5px] tabular-nums select-none"
            title={TIMING_HELP}
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onNudge("start_ms", -50)}
              title="Start 50 ms earlier (Alt+A)"
              className="w-[18px] h-[18px] rounded-[4px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              ◀
            </button>
            <span className="px-[3px] text-[var(--text-primary)]">{fmtTiming(line.start_ms)}</span>
            <button
              onClick={() => onNudge("start_ms", 50)}
              title="Start 50 ms later (Alt+D)"
              className="w-[18px] h-[18px] rounded-[4px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              ▶
            </button>
            {line.end_ms != null && <span className="pl-[2px] pr-[5px] text-[var(--text-muted)]">– {fmtTiming(line.end_ms)}</span>}
          </div>
        )}
        {checkFlag && !editing && (
          <div className="flex-shrink-0 pl-2 pt-[3px] select-none">
            <button
              onMouseUp={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCheckOk(line.id, checkFlag);
              }}
              title={
                checkFlag === "unsure"
                  ? "Lyrics check: the alignment wasn't sure where this line is. Double-click the line to listen; fix it with T (tap the start) or Alt+A/D. Click here if it's right."
                  : "Lyrics check: no singing heard under this line — an extra line, or its timing is off. Double-click to listen. Click here if it's fine."
              }
              className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] border border-dashed border-amber-500/50 bg-transparent text-amber-700 cursor-pointer hover:bg-amber-500/10"
            >
              {checkFlag === "unsure" ? "timing?" : "no singing?"}
            </button>
          </div>
        )}
        {(line.register || line.placement) && (
          <div className="flex-shrink-0 pl-2 pt-[4px] select-none">
            <span
              className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] bg-violet-500/10 text-violet-700"
              title="Your voice mark — B cycles placement, Shift+B register"
            >
              {[line.register, line.placement].filter(Boolean).join(" · ")}
            </span>
          </div>
        )}
        {info && (info.longestPhraseMs >= LONG_PHRASE_MS || info.peakSemitone != null) && (
          <div className="flex-shrink-0 flex flex-col items-end gap-[2px] pl-2 pt-[4px] select-none">
            {info.longestPhraseMs >= LONG_PHRASE_MS && (
              <span className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] bg-sky-500/10 text-sky-700" title="A long phrase without a breath in the original — fill up before it">
                long · {(info.longestPhraseMs / 1000).toFixed(1)} s
              </span>
            )}
            {info.peakSemitone != null && (
              <span className="text-[9.5px] px-[5px] py-[1px] rounded-[3px] bg-amber-500/10 text-amber-700" title="One of the highest notes in the song">
                high · {semitoneToNoteName(info.peakSemitone)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Notes: a small marker; hovering the line shows them beside the lyrics */}
      {!editing && !editingNote && (line.note || (takeNotes && takeNotes.length > 0)) && (
        <>
          <span
            className="absolute right-[6px] bottom-[4px] text-[10px] text-amber-700/80 select-none pointer-events-none"
            aria-hidden
          >
            💬{(line.note ? 1 : 0) + (takeNotes?.length ?? 0) > 1 ? ` ${(line.note ? 1 : 0) + (takeNotes?.length ?? 0)}` : ""}
          </span>
          <div
            className="hidden group-hover:flex absolute left-full top-0 ml-3 z-30 w-[260px] flex-col gap-[6px] p-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-lg select-none"
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {line.note && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartNote(line.id);
                }}
                title="Edit (N)"
                className="text-left text-[12.5px] leading-snug text-amber-900 bg-amber-50 rounded-[6px] px-2 py-[4px] border-none cursor-pointer"
              >
                {line.note}
              </button>
            )}
            {takeNotes?.map((n) => (
              <div key={n.key} className="text-[12px] leading-snug text-[var(--text-secondary)]">
                <span className="text-[10.5px] text-[var(--text-muted)]">Take {n.when} · </span>
                {n.text}
              </div>
            ))}
            {!line.note && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartNote(line.id);
                }}
                className="text-left text-[11px] text-[var(--theme)] bg-transparent border-none p-0 cursor-pointer hover:underline"
              >
                + note on this line (N)
              </button>
            )}
          </div>
        </>
      )}
      {issues && issues.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-[3px] select-none">
          {issues.map(({ issue, key }) => (
            <button
              key={key}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onIssueClick(issue, key);
              }}
              title={`${issue.detail} — click to hear your take here`}
              className={`text-[9.5px] font-medium px-[5px] py-[1px] rounded-[3px] border-none cursor-pointer ${
                isBreathIssue(issue.kind) ? "bg-sky-500/15 text-sky-800 hover:bg-sky-500/25" : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25"
              }`}
            >
              {ISSUE_LABEL[issue.kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function SectionHeading({
  section,
  intent,
  active,
  renaming,
  onClick,
  onRename,
  onCommitRename,
  onCancel,
  onRemove,
}: {
  section: Section;
  /** From the song card: how this section should feel. */
  intent?: { mood: string; intent: string; voice?: { register: string; placement: string; image: string } };
  active: boolean;
  renaming: boolean;
  onClick: () => void;
  onRename: () => void;
  onCommitRename: (name: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex flex-wrap items-center gap-x-2 mt-5 mb-1 pl-7 pr-2">
      {renaming ? (
        <InlineInput
          initial={section.name}
          placeholder="Section name — empty removes it"
          className="px-2 py-[1px] rounded-[5px] border border-[var(--theme)] bg-[var(--surface)] text-[11px] font-semibold uppercase tracking-[0.08em] outline-none w-[220px]"
          onCommit={onCommitRename}
          onCancel={onCancel}
        />
      ) : (
        <button
          onClick={onClick}
          onDoubleClick={onRename}
          title="Select this section · double-click to rename (#)"
          className={`text-[10.5px] font-semibold uppercase tracking-[0.1em] bg-transparent border-none cursor-pointer p-0 ${
            active ? "text-[var(--theme-text)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          {section.name}
        </button>
      )}
      <div className="flex-1 h-px bg-[var(--border-subtle)]" />
      {!renaming && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onRename} title="Rename" className="text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer">
            Rename
          </button>
          <button onClick={onRemove} title="Remove section (lines stay)" className="text-[10.5px] text-[var(--text-muted)] hover:text-red-600 bg-transparent border-none cursor-pointer">
            Remove
          </button>
        </div>
      )}
      {intent && !renaming && (
        <div
          className="basis-full flex flex-wrap items-center gap-x-[6px] gap-y-[2px] text-[11px] leading-snug text-[var(--text-muted)] -mt-[1px]"
          title={intent.voice?.image ? `Imagine: ${intent.voice.image}` : "From the song card"}
        >
          {intent.mood && <span>{intent.mood}</span>}
          {intent.voice?.register && <span className="px-[5px] rounded-[3px] bg-[var(--bg)] border border-[var(--border-subtle)]">{intent.voice.register}</span>}
          {intent.voice?.placement && <span className="px-[5px] rounded-[3px] bg-[var(--bg)] border border-[var(--border-subtle)]">{intent.voice.placement}</span>}
          {intent.intent && <span className="italic">— {intent.intent}</span>}
        </div>
      )}
    </div>
  );
}

const ABOUT_OPEN_KEY = "reprise-song-about-open";

/** One quiet line above the lyrics; the summary only when you open it (remembered). */
function SongAbout({ summary, mood, onOpenCoach }: { summary: string; mood: string; onOpenCoach: () => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ABOUT_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((v) => {
      try {
        localStorage.setItem(ABOUT_OPEN_KEY, v ? "0" : "1");
      } catch {
        /* per-machine convenience only */
      }
      return !v;
    });
  };
  return (
    <div className="mx-7 mb-3">
      <button
        onClick={toggle}
        className="flex items-center gap-[6px] text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none p-0 cursor-pointer"
      >
        <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${open ? "rotate-90" : ""}`}><polygon points="6,3 20,12 6,21" /></svg>
        About this song{mood && <span className="text-[var(--text-secondary)]"> · {mood}</span>}
      </button>
      {open && (
        <div className="mt-[6px] pl-[13px] border-l-2 border-[var(--border-subtle)] text-[12.5px] leading-snug text-[var(--text-secondary)]">
          {summary}{" "}
          <button onClick={onOpenCoach} className="text-[11.5px] text-[var(--theme)] bg-transparent border-none p-0 cursor-pointer hover:underline">
            full card (G)
          </button>
        </div>
      )}
    </div>
  );
}

export interface LyricSheetProps {
  lines: Line[];
  sections: Section[];
  /** Translation text per lyric line id. */
  translationById: Map<string, string>;
  highlights: HighlightType[];
  vocalMap: VocalMap | null;
  showHints: boolean;
  cursor: Cursor | null;
  editingLineId: string | null;
  sectionEdit: SectionEdit | null;
  playingLineId: string | null;
  loopLineIds: Set<string>;
  showCaret: boolean;
  issuesByLine: Map<string, { issue: TakeIssue; key: string }[]>;
  onSelect: (lineId: string, anchor: number, focus: number) => void;
  onStartEdit: (lineId: string) => void;
  onCommitEdit: (lineId: string, text: string) => void;
  onCancelEdit: () => void;
  onPlay: (lineId: string) => void;
  onIssueClick: (issue: TakeIssue, key: string) => void;
  onNudge: (field: "start_ms" | "end_ms", deltaMs: number) => void;
  symbols: VocalSymbol[];
  takeNotesByLine: Map<string, { key: string; text: string; when: string }[]>;
  songCard: SongCard | null;
  onOpenCoach: () => void;
  noteLineId: string | null;
  onStartNote: (lineId: string) => void;
  onCommitNote: (lineId: string, text: string) => void;
  onCancelNote: () => void;
  symbolPickerOpen: boolean;
  onPickSymbol: (char: string) => void;
  onCloseSymbols: () => void;
  onSectionClick: (section: Section) => void;
  onSectionEdit: (edit: SectionEdit | null) => void;
  onCommitNewSection: (lineId: string, name: string) => void;
  onCommitRename: (section: Section, name: string) => void;
  onRemoveSection: (section: Section) => void;
  /** Lyrics check against the song (null = off). */
  check: LyricsCheck | null;
  onGap: (gap: LyricsGap, action: "listen" | "add" | "dismiss") => void;
  onCheckOk: (lineId: string, flag: "silent" | "unsure") => void;
  onOffset: (action: "apply" | "dismiss") => void;
}

export function LyricSheet(p: LyricSheetProps) {
  const sectionAt = useMemo(() => new Map(p.sections.map((s) => [s.start_line_order, s])), [p.sections]);
  const sectionOf = (order: number) =>
    p.sections.find((s) => order >= s.start_line_order && order <= s.end_line_order) ?? null;
  const cursorLine = p.cursor ? p.lines.find((l) => l.id === p.cursor!.lineId) : undefined;
  const cursorSection = cursorLine ? sectionOf(cursorLine.order) : null;

  // Vocal info only changes with the map or the lines — not on every playback frame.
  const infos = useMemo(() => {
    const m = new Map<string, LineVocalInfo | null>();
    if (p.vocalMap && p.showHints) for (const l of p.lines) m.set(l.id, lineVocalInfo(p.vocalMap, l));
    return m;
  }, [p.vocalMap, p.showHints, p.lines]);

  const intents = new Map((p.songCard?.sections ?? []).map((s) => [s.name.trim().toLowerCase(), s]));
  const gapsAfter = useMemo(() => {
    const m = new Map<string | null, LyricsGap[]>();
    for (const g of p.check?.gaps ?? []) m.set(g.afterLineId, [...(m.get(g.afterLineId) ?? []), g]);
    return m;
  }, [p.check]);

  return (
    <div className="flex flex-col pb-[40vh]">
      {p.showHints && p.songCard?.summary && <SongAbout summary={p.songCard.summary} mood={p.songCard.mood} onOpenCoach={p.onOpenCoach} />}
      {p.check?.offset && (
        <div className="mx-2 mb-3 px-3 py-[8px] rounded-[8px] border border-dashed border-amber-500/40 flex items-center gap-2 flex-wrap select-none">
          <span className="text-[12px] text-amber-700">
            The lyrics' timing looks {(Math.abs(p.check.offset.ms) / 1000).toFixed(1)} s {p.check.offset.ms > 0 ? "early" : "late"} for this audio
            {p.check.offset.ms > 0 ? " (an intro in this version?)" : ""}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => p.onOffset("apply")}
            title={`Moves every line ${(Math.abs(p.check.offset.ms) / 1000).toFixed(1)} s ${p.check.offset.ms > 0 ? "later" : "earlier"} — lines then sit over singing ${Math.round(p.check.offset.fitBefore * 100)}% → ${Math.round(p.check.offset.fitAfter * 100)}% of the time (Ctrl+Z undoes)`}
            className="text-[11px] px-[8px] py-[2px] rounded-[5px] bg-[var(--theme)] text-white border-none cursor-pointer"
          >
            Shift all lines {(Math.abs(p.check.offset.ms) / 1000).toFixed(1)} s {p.check.offset.ms > 0 ? "later" : "earlier"}
          </button>
          <button
            onClick={() => p.onOffset("dismiss")}
            className="text-[11px] px-[7px] py-[1px] rounded-[5px] bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-secondary)]"
          >
            Keep as is
          </button>
        </div>
      )}
      {gapsAfter.get(null)?.map((g) => <GapMarker key={g.key} gap={g} onAction={p.onGap} />)}
      {p.lines.map((line) => {
        const sec = sectionAt.get(line.order);
        const isCursor = p.cursor?.lineId === line.id;
        const newSectionHere = p.sectionEdit?.mode === "new" && p.sectionEdit.lineId === line.id;
        return (
          <div key={line.id}>
            {newSectionHere && (
              <div className="flex items-center gap-2 mt-5 mb-1 pl-7 pr-2">
                <InlineInput
                  initial=""
                  placeholder="New section name (e.g. Chorus) — Enter"
                  className="px-2 py-[1px] rounded-[5px] border border-[var(--theme)] bg-[var(--surface)] text-[11px] font-semibold uppercase tracking-[0.08em] outline-none w-[260px]"
                  onCommit={(name) => p.onCommitNewSection(line.id, name)}
                  onCancel={() => p.onSectionEdit(null)}
                />
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>
            )}
            {sec && (
              <SectionHeading
                section={sec}
                intent={p.showHints ? intents.get(sec.name.trim().toLowerCase()) : undefined}
                active={cursorSection?.id === sec.id}
                renaming={p.sectionEdit?.mode === "rename" && p.sectionEdit.sectionId === sec.id}
                onClick={() => p.onSectionClick(sec)}
                onRename={() => p.onSectionEdit({ mode: "rename", sectionId: sec.id })}
                onCommitRename={(name) => p.onCommitRename(sec, name)}
                onCancel={() => p.onSectionEdit(null)}
                onRemove={() => p.onRemoveSection(sec)}
              />
            )}
            <LineRow
              line={line}
              info={infos.get(line.id) ?? null}
              translation={p.translationById.get(line.id)}
              highlights={p.highlights}
              isCursor={isCursor}
              anchor={isCursor ? p.cursor!.anchor : 0}
              focus={isCursor ? p.cursor!.focus : 0}
              isPlaying={p.playingLineId === line.id}
              inLoop={p.loopLineIds.has(line.id)}
              editing={p.editingLineId === line.id}
              showCaret={isCursor && p.showCaret}
              issues={p.issuesByLine.get(line.id)}
              onSelect={p.onSelect}
              onStartEdit={p.onStartEdit}
              onCommitEdit={p.onCommitEdit}
              onCancelEdit={p.onCancelEdit}
              onPlay={p.onPlay}
              onIssueClick={p.onIssueClick}
              onNudge={p.onNudge}
              symbols={p.symbols}
              takeNotes={p.takeNotesByLine.get(line.id)}
              editingNote={p.noteLineId === line.id}
              onStartNote={p.onStartNote}
              onCommitNote={p.onCommitNote}
              onCancelNote={p.onCancelNote}
              pickingSymbol={isCursor && p.symbolPickerOpen}
              onPickSymbol={p.onPickSymbol}
              onCloseSymbols={p.onCloseSymbols}
              checkFlag={p.check?.lines.get(line.id)}
              onCheckOk={p.onCheckOk}
            />
            {gapsAfter.get(line.id)?.map((g) => <GapMarker key={g.key} gap={g} onAction={p.onGap} />)}
          </div>
        );
      })}
    </div>
  );
}

const fmtClock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** Singing in the song that no lyric line covers. */
function GapMarker({ gap, onAction }: { gap: LyricsGap; onAction: (gap: LyricsGap, action: "listen" | "add" | "dismiss") => void }) {
  const btn =
    "text-[11px] px-[7px] py-[1px] rounded-[5px] bg-transparent border border-[var(--border)] cursor-pointer text-[var(--text-secondary)] hover:border-amber-500/60 hover:text-[var(--text-primary)]";
  return (
    <div
      data-gap-key={gap.key}
      className="ml-8 mr-2 my-[3px] px-3 py-[6px] rounded-[8px] border border-dashed border-amber-500/40 select-none"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-amber-700">
          ♪ {Math.round(gap.singingMs / 1000)} s of singing with no lyric line · {fmtClock(gap.startMs)}
        </span>
        <span className="flex-1" />
        <button className={btn} onClick={() => onAction(gap, "listen")} title="Play this part">
          ▶ Listen
        </button>
        <button
          className={btn}
          onClick={() => onAction(gap, "add")}
          title={gap.heard ? "Add what was heard as a line here, timed to this part (Ctrl+Z undoes)" : "Add an empty line here, timed to this part, and type it (Ctrl+Z undoes)"}
        >
          + Add line
        </button>
        <button className={btn} onClick={() => onAction(gap, "dismiss")} title="It's not lyrics (backing vocals, humming…) — don't flag it again">
          Not lyrics
        </button>
      </div>
      {gap.heard && <div className="mt-[3px] text-[12.5px] text-[var(--text-secondary)] italic truncate" title={gap.heard}>heard: “{gap.heard}”</div>}
    </div>
  );
}
