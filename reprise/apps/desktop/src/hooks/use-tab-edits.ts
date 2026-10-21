import { useCallback, useEffect, useState } from "react";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { TabEdit } from "../lib/fingerpicking";

/**
 * Hand edits to single notes of the fingerpicked tab, saved per song in
 * fingerstyle_tab_edits.json. An append-only history (later edits win), so
 * Undo steps back one note at a time; "reset" puts a whole bar back to the
 * generated pattern (and is itself one undoable step). Only fingerpicking
 * reads this file.
 */
interface TabEditsFile {
  version: 1;
  edits: TabEdit[];
}

export interface TabEdits {
  edits: TabEdit[];
  /** Set one cell: a fret, or null for a rest. `capo` = the capo the fret is relative to. */
  setNote: (bar: number, slot: number, string: number, fret: number | null, capo: number) => void;
  /** Put a bar back to the generated pattern. */
  resetBar: (bar: number) => void;
  undo: () => void;
}

export function useTabEdits(songFolder: string | undefined): TabEdits {
  const [edits, setEdits] = useState<TabEdit[]>([]);
  const path = songFolder ? `${songFolder}/fingerstyle_tab_edits.json` : undefined;

  useEffect(() => {
    if (!path) { setEdits([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const raw = (await exists(path)) ? (JSON.parse(await readTextFile(path)) as Partial<TabEditsFile>) : {};
        if (!cancelled) setEdits(Array.isArray(raw.edits) ? raw.edits : []);
      } catch (err) {
        console.error("[tabEdits] unreadable fingerstyle_tab_edits.json:", err);
        if (!cancelled) setEdits([]);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const update = useCallback(
    (change: (prev: TabEdit[]) => TabEdit[]) => {
      setEdits((prev) => {
        const next = change(prev);
        if (path) {
          const file: TabEditsFile = { version: 1, edits: next };
          writeTextFile(path, JSON.stringify(file, null, 2)).catch((err) =>
            console.error("[tabEdits] could not save:", err),
          );
        }
        return next;
      });
    },
    [path],
  );

  const setNote = useCallback(
    (bar: number, slot: number, string: number, fret: number | null, capo: number) =>
      update((prev) => [...prev, { kind: "note", bar, slot, string, fret, capo, edited_at: new Date().toISOString() }]),
    [update],
  );
  const resetBar = useCallback(
    (bar: number) => update((prev) => [...prev, { kind: "reset", bar, edited_at: new Date().toISOString() }]),
    [update],
  );
  const undo = useCallback(() => update((prev) => prev.slice(0, -1)), [update]);

  return { edits, setNote, resetBar, undo };
}
