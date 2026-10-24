import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnnotatedText, NON_TEXT_ATTR } from "../../components/annotated-text";
import { LONG_PHRASE_MS, lineVocalInfo, semitoneToNoteName, type LineVocalInfo, type VocalMap } from "../../lib/vocal-map";
import { ISSUE_LABEL, isBreathIssue } from "../../lib/take-review";
import { displayText } from "./use-workspace-edits";
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
  "Line timing. ◀ ▶ (or Alt+← / Alt+→) shift the start by 50 ms; Alt+Shift+← / → shifts the end. " +
  "T sets the start to where the song is now. The line replays after each change so you can hear it. Ctrl+Z undoes.";

function InlineInput({
  initial,
  placeholder,
  className,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  className: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
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
}

const LineRow = memo(function LineRow({
  line, info, translation, highlights, isCursor, anchor, focus, isPlaying, inLoop, editing, showCaret,
  issues, onSelect, onStartEdit, onCommitEdit, onCancelEdit, onPlay, onIssueClick, onNudge,
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
      onDoubleClick={() => onStartEdit(line.id)}
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
          title="Play from this line (Enter)"
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
        </div>

        {isCursor && !editing && line.start_ms != null && (
          <div
            className="flex-shrink-0 flex items-center gap-[1px] ml-2 mt-[3px] px-[2px] h-[22px] rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[10.5px] tabular-nums select-none"
            title={TIMING_HELP}
            onMouseUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onNudge("start_ms", -50)}
              title="Start 50 ms earlier (Alt+←)"
              className="w-[18px] h-[18px] rounded-[4px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              ◀
            </button>
            <span className="px-[3px] text-[var(--text-primary)]">{fmtTiming(line.start_ms)}</span>
            <button
              onClick={() => onNudge("start_ms", 50)}
              title="Start 50 ms later (Alt+→)"
              className="w-[18px] h-[18px] rounded-[4px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
            >
              ▶
            </button>
            {line.end_ms != null && <span className="pl-[2px] pr-[5px] text-[var(--text-muted)]">– {fmtTiming(line.end_ms)}</span>}
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
  active,
  renaming,
  onClick,
  onRename,
  onCommitRename,
  onCancel,
  onRemove,
}: {
  section: Section;
  active: boolean;
  renaming: boolean;
  onClick: () => void;
  onRename: () => void;
  onCommitRename: (name: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 mt-5 mb-1 pl-7 pr-2">
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
    </div>
  );
}

export interface LyricSheetProps {
  lines: Line[];
  sections: Section[];
  translationByOrder: Map<number, string>;
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
  onSectionClick: (section: Section) => void;
  onSectionEdit: (edit: SectionEdit | null) => void;
  onCommitNewSection: (lineId: string, name: string) => void;
  onCommitRename: (section: Section, name: string) => void;
  onRemoveSection: (section: Section) => void;
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

  return (
    <div className="flex flex-col pb-[40vh]">
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
              translation={p.translationByOrder.get(line.order)}
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
            />
          </div>
        );
      })}
    </div>
  );
}
