import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  run: () => void;
  disabled?: boolean;
  /** Shown before you type anything. */
  featured?: boolean;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = commands.filter((c) => !c.disabled);
    if (!q) return list.filter((c) => c.featured);
    const words = q.split(/\s+/);
    return list.filter((c) => {
      const hay = `${c.group} ${c.label}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette unmount (and focus return) before the command runs.
    setTimeout(c.run, 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[14vh] bg-black/30" onMouseDown={onClose}>
      <div
        className="w-full max-w-[520px] h-fit max-h-[60vh] flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden animate-fade-up"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") run(filtered[active]);
          }}
          placeholder="Type a command — e.g. “falsetto”, “section”, “record”…"
          className="px-4 py-3 text-[14px] bg-transparent border-none border-b border-[var(--border-subtle)] outline-none"
        />
        {!query.trim() && (
          <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
            Most useful — type to search all {commands.filter((c) => !c.disabled).length}
          </div>
        )}
        <div className="overflow-y-auto py-1 border-t border-[var(--border-subtle)]">
          {filtered.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--text-muted)]">No matching command.</p>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              className={`w-full flex items-center gap-3 px-4 py-[7px] text-left border-none cursor-pointer ${
                i === active ? "bg-[var(--theme-light)]" : "bg-transparent"
              }`}
            >
              <span className="text-[10.5px] text-[var(--text-muted)] w-[78px] flex-shrink-0">{c.group}</span>
              <span className="text-[13px] text-[var(--text-primary)] flex-1 truncate">{c.label}</span>
              {c.shortcut && <kbd className="text-[10.5px] text-[var(--text-muted)] font-sans">{c.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Left hand on the keys, right hand on the mouse. Arrows / Enter / L / [ ] / Delete / F2 also work. */
const SHORTCUTS: [string, [string, string][]][] = [
  ["Move", [
    ["W / S", "Previous / next line"],
    ["Shift+W / S", "Previous / next section"],
    ["A / D", "Move the caret in the line"],
    ["Shift+A / D", "Select text (or drag with the mouse)"],
    ["Ctrl+A", "Select the whole line"],
  ]],
  ["Play", [
    ["Space", "Play / pause"],
    ["Ctrl+Enter / double-click", "Play from the line"],
    ["Q / Shift+Q", "Loop the line / the section"],
    ["Alt+W / Alt+S", "Faster / slower (0.5–1.0×)"],
    ["Esc", "Clear selection, close panel, pause"],
  ]],
  ["Mark", [
    ["1 – 9", "Mark the selection (falsetto, …); again to remove — Breath mark works at the caret"],
    ["X", "Remove marks in the selection (or under the caret)"],
    ["C, then 1–9", "Insert a symbol (⤴ ⤵ ~ /) at the caret"],
    ["F", "Edit the line's text (Alt+1…9 inserts symbols)"],
    ["N", "Note on this line — or, with a take open, on that moment of the take"],
    ["#", "Start a section here (or rename it)"],
  ]],
  ["Timing", [
    ["T", "Line starts at the playhead, move to the next line"],
    ["Alt+A / D", "Shift the line's start ±50 ms"],
    ["Alt+Shift+A / D", "Shift the line's end ±50 ms"],
    ["Alt+F", "Next lyrics check (singing with no line, a line with no singing, unsure timing)"],
  ]],
  ["Record", [
    ["R", "Record from the selected line / stop"],
    ["Shift+R", "Record just this section"],
    ["Alt+R", "Repeat section takes on / off"],
    ["E", "Play the open take with the instrumental"],
  ]],
  ["General", [
    ["Tab / Shift+Tab", "Takes / line details panel"],
    ["G", "Coach"],
    ["Shift+G", "Song card: next page"],
    ["V", "Focus on the lyrics (hide hints and coach notes)"],
    ["B / Shift+B", "Voice mark on the line: placement / register"],
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
    ["Ctrl+E", "Command palette"],
    ["F1", "This list"],
  ]],
];

export function ShortcutSheet({ onClose, highlightNames }: { onClose: () => void; highlightNames: string[] }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?" || e.key === "F1") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        className="w-full max-w-[680px] max-h-[80vh] overflow-y-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 animate-fade-up"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-medium mb-4">Keyboard shortcuts</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {SHORTCUTS.map(([group, rows]) => (
            <div key={group}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-2">{group}</div>
              {rows.map(([k, d]) => (
                <div key={k} className="flex gap-3 py-[3px] text-[12px]">
                  <kbd className="w-[130px] flex-shrink-0 font-sans text-[var(--text-primary)]">{k}</kbd>
                  <span className="text-[var(--text-secondary)]">{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {highlightNames.length > 0 && (
          <p className="mt-5 text-[11.5px] text-[var(--text-muted)]">
            Number keys: {highlightNames.slice(0, 9).map((n, i) => `${i + 1} ${n}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
