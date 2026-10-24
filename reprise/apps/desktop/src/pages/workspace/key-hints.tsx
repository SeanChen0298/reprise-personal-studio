import type { HighlightType } from "../../lib/highlight-config";

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-[5px] rounded-[4px] border border-[var(--border)] bg-[var(--surface)] text-[10.5px] font-sans font-medium text-[var(--text-primary)] shadow-[0_1px_0_var(--border)]">
    {children}
  </kbd>
);

const Hint = ({ k, label }: { k: React.ReactNode; label: string }) => (
  <span className="inline-flex items-center gap-[5px] whitespace-nowrap">
    {k}
    <span>{label}</span>
  </span>
);

/**
 * The few keys that matter right now, at the bottom of the lyric sheet —
 * changes with what you're doing, so you never need the full list to start.
 */
export function KeyHints({
  mode,
  highlights,
  breathKey,
  onMark,
  onShowAll,
}: {
  mode: "idle" | "selection" | "editing" | "recording" | "lead";
  highlights: HighlightType[];
  /** Number key of the "Breath mark" type — works at the caret, no selection needed. */
  breathKey: number | null;
  /** Mark the selection with highlight #n (1-based) — the chips are clickable too. */
  onMark: (n: number) => void;
  onShowAll: () => void;
}) {
  let hints: React.ReactNode;
  if (mode === "editing") {
    hints = (
      <>
        <Hint k={<Key>Enter</Key>} label="save" />
        <Hint k={<Key>Esc</Key>} label="cancel" />
      </>
    );
  } else if (mode === "recording") {
    hints = (
      <>
        <Hint k={<Key>R</Key>} label="stop recording" />
        <Hint k={<Key>Esc</Key>} label="cancel count-in" />
      </>
    );
  } else if (mode === "selection") {
    hints = (
      <>
        {highlights.map((h, i) => (
          <button
            key={h.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMark(i + 1)}
            title={`Mark the selection as ${h.name}`}
            className="inline-flex items-center gap-[5px] whitespace-nowrap bg-transparent border-none p-0 cursor-pointer text-[11px] text-[var(--text-muted)] hover:opacity-80"
          >
            {i < 9 && <Key>{i + 1}</Key>}
            <span className="px-[5px] rounded-[3px]" style={{ backgroundColor: h.bg, color: h.color }}>
              {h.name}
            </span>
          </button>
        ))}
        <Hint k={<Key>0</Key>} label="remove" />
        <Hint k={<><Key>Ctrl</Key><Key>Z</Key></>} label="undo" />
      </>
    );
  } else if (mode === "lead") {
    hints = (
      <>
        <Hint k={<Key>Space</Key>} label="play" />
        <Hint k={<Key>R</Key>} label="record" />
        <Hint k={<><Key>Ctrl</Key><Key>K</Key></>} label="commands" />
      </>
    );
  } else {
    hints = (
      <>
        <Hint k={<Key>Space</Key>} label="play" />
        <Hint k={<Key>Enter</Key>} label="play this line" />
        <Hint k={<Key>L</Key>} label="loop" />
        <Hint k={<Key>R</Key>} label="record" />
        <Hint k={<><Key>Shift</Key><Key>→</Key></>} label="select words to mark" />
        {breathKey != null && <Hint k={<Key>{breathKey}</Key>} label="breath mark here" />}
        <Hint k={<><Key>Alt</Key><Key>←</Key><Key>→</Key></>} label="shift line start" />
        <Hint k={<Key>T</Key>} label="start = now" />
        <Hint k={<Key>#</Key>} label="new section" />
      </>
    );
  }
  return (
    <div className="flex-shrink-0 flex items-center gap-x-4 gap-y-1 flex-wrap px-5 py-[7px] border-t border-[var(--border)] bg-[var(--bg)] text-[11px] text-[var(--text-muted)]">
      {hints}
      <button
        onClick={onShowAll}
        className="ml-auto inline-flex items-center gap-[5px] bg-transparent border-none cursor-pointer text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <Key>?</Key> all keys
      </button>
    </div>
  );
}
