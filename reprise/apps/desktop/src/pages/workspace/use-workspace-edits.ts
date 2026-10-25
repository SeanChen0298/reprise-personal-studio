import { useCallback, useMemo } from "react";
import { useSongStore } from "../../stores/song-store";
import { useHistoryStore } from "../../stores/history-store";
import { applyAnnotation, planNewSection, remapAnnotations, removeAnnotations } from "../../lib/lyric-edits";
import type { Annotation, Line, Section } from "../../types/song";

/** Fresh copy of a line from the store (edits can be queued after earlier ones). */
function getLine(songId: string, lineId: string): Line | undefined {
  return useSongStore.getState().lines[songId]?.find((l) => l.id === lineId);
}

export const displayText = (line: Line) => line.custom_text ?? line.text;

/**
 * Every lyric edit in the workspace goes through here, so it can be undone.
 * Each action applies the change, then pushes how to reverse it.
 */
export function useWorkspaceEdits(songId: string) {
  const push = useHistoryStore((s) => s.push);

  const setAnnotations = useCallback(
    async (lineId: string, next: Annotation[], label: string) => {
      const line = getLine(songId, lineId);
      if (!line) return;
      const prev = line.annotations ?? [];
      const store = useSongStore.getState();
      await store.updateLineAnnotations(songId, lineId, next);
      push({
        label,
        undo: () => useSongStore.getState().updateLine(songId, lineId, { annotations: prev }),
        redo: () => useSongStore.getState().updateLineAnnotations(songId, lineId, next),
      });
    },
    [songId, push],
  );

  const annotate = useCallback(
    async (lineId: string, start: number, end: number, type: string, typeName: string) => {
      const line = getLine(songId, lineId);
      if (!line || end <= start) return;
      await setAnnotations(lineId, applyAnnotation(line.annotations ?? [], start, end, type), `Mark ${typeName}`);
    },
    [songId, setAnnotations],
  );

  const clearAnnotations = useCallback(
    async (lineId: string, start: number, end: number) => {
      const line = getLine(songId, lineId);
      if (!line) return false;
      const prev = line.annotations ?? [];
      const next = removeAnnotations(prev, start, end);
      if (next.length === prev.length && next.every((a, i) => a === prev[i])) return false;
      await setAnnotations(lineId, next, "Remove annotation");
      return true;
    },
    [songId, setAnnotations],
  );

  const editText = useCallback(
    async (lineId: string, newText: string) => {
      const line = getLine(songId, lineId);
      if (!line) return;
      const oldText = displayText(line);
      if (newText === oldText) return;
      const prev = {
        custom_text: line.custom_text,
        custom_furigana_html: line.custom_furigana_html,
        annotations: line.annotations ?? [],
      };
      const nextAnns = remapAnnotations(prev.annotations, oldText, newText);
      const apply = async () => {
        const store = useSongStore.getState();
        await store.updateLineCustomText(songId, lineId, newText);
        await store.updateLine(songId, lineId, { annotations: nextAnns });
      };
      await apply();
      push({
        label: "Edit line",
        undo: () => useSongStore.getState().updateLine(songId, lineId, prev),
        redo: apply,
      });
    },
    [songId, push],
  );

  /** Change a line's start/end (ms). Optionally moves the previous line's end along. */
  const setTiming = useCallback(
    async (changes: { lineId: string; start_ms?: number; end_ms?: number }[], label: string) => {
      const before = changes
        .map((c) => getLine(songId, c.lineId))
        .filter((l): l is Line => !!l)
        .map((l) => ({ lineId: l.id, start_ms: l.start_ms, end_ms: l.end_ms, align_confidence: l.align_confidence }));
      // Timing you set yourself is no longer "unsure".
      const after = changes.map((c) => ({ ...c, align_confidence: undefined }));
      const apply = async (list: { lineId: string; start_ms?: number; end_ms?: number; align_confidence?: number }[]) => {
        const store = useSongStore.getState();
        for (const { lineId, ...data } of list) await store.updateLine(songId, lineId, data);
      };
      await apply(after);
      push({ label, undo: () => apply(before), redo: () => apply(after) });
    },
    [songId, push],
  );

  const createSection = useCallback(
    async (sections: Section[], lines: Line[], startOrder: number, name: string) => {
      const plan = planNewSection(sections, lines, startOrder, name, songId);
      const prevEnds = plan.shorten.map((s) => ({
        id: s.id,
        end_line_order: sections.find((x) => x.id === s.id)!.end_line_order,
      }));
      const apply = async () => {
        const store = useSongStore.getState();
        for (const s of plan.shorten) await store.updateSection(songId, s.id, { end_line_order: s.end_line_order });
        if (plan.create) await store.addSection(songId, plan.create);
      };
      await apply();
      push({
        label: `New section “${name}”`,
        undo: async () => {
          const store = useSongStore.getState();
          if (plan.create) await store.removeSection(songId, plan.create.id);
          for (const s of prevEnds) await store.updateSection(songId, s.id, { end_line_order: s.end_line_order });
        },
        redo: apply,
      });
    },
    [songId, push],
  );

  const renameSection = useCallback(
    async (section: Section, name: string) => {
      const prev = section.name;
      if (prev === name) return;
      await useSongStore.getState().updateSection(songId, section.id, { name });
      push({
        label: "Rename section",
        undo: () => useSongStore.getState().updateSection(songId, section.id, { name: prev }),
        redo: () => useSongStore.getState().updateSection(songId, section.id, { name }),
      });
    },
    [songId, push],
  );

  /** Add several sections at once (e.g. the coach's split) — one undo step. */
  const addSections = useCallback(
    async (list: Section[]) => {
      if (!list.length) return;
      const add = async () => {
        for (const s of list) await useSongStore.getState().addSection(songId, s);
      };
      await add();
      push({
        label: `Add ${list.length} sections`,
        undo: async () => {
          for (const s of list) await useSongStore.getState().removeSection(songId, s.id);
        },
        redo: add,
      });
    },
    [songId, push],
  );

  /** Remove a section; its lines become ungrouped. */
  const removeSection = useCallback(
    async (section: Section) => {
      await useSongStore.getState().removeSection(songId, section.id);
      push({
        label: `Remove section “${section.name}”`,
        undo: () => useSongStore.getState().addSection(songId, section),
        redo: () => useSongStore.getState().removeSection(songId, section.id),
      });
    },
    [songId, push],
  );

  const setLineNote = useCallback(
    async (lineId: string, note: string) => {
      const line = getLine(songId, lineId);
      if (!line) return;
      const prev = line.note;
      const next = note.trim() || undefined;
      if ((prev ?? "") === (next ?? "")) return;
      await useSongStore.getState().updateLine(songId, lineId, { note: next });
      push({
        label: next ? "Line note" : "Remove line note",
        undo: () => useSongStore.getState().updateLine(songId, lineId, { note: prev }),
        redo: () => useSongStore.getState().updateLine(songId, lineId, { note: next }),
      });
    },
    [songId, push],
  );

  /** The line's voice mark (register / placement); empty string clears it. */
  const setLineVoice = useCallback(
    async (lineId: string, field: "register" | "placement", value: string) => {
      const line = getLine(songId, lineId);
      if (!line) return;
      const prev = line[field];
      const next = value || undefined;
      if ((prev ?? "") === (next ?? "")) return;
      await useSongStore.getState().updateLine(songId, lineId, { [field]: next });
      push({
        label: next ? `Mark ${next}` : `Clear ${field}`,
        undo: () => useSongStore.getState().updateLine(songId, lineId, { [field]: prev }),
        redo: () => useSongStore.getState().updateLine(songId, lineId, { [field]: next }),
      });
    },
    [songId, push],
  );

  /** Confirm a line's timing is fine (clears the "unsure" flag from alignment). */
  const confirmTiming = useCallback(
    async (lineId: string) => {
      const line = getLine(songId, lineId);
      if (!line || line.align_confidence == null) return;
      const prev = line.align_confidence;
      await useSongStore.getState().updateLine(songId, lineId, { align_confidence: undefined });
      push({
        label: "Timing looks right",
        undo: () => useSongStore.getState().updateLine(songId, lineId, { align_confidence: prev }),
        redo: () => useSongStore.getState().updateLine(songId, lineId, { align_confidence: undefined }),
      });
    },
    [songId, push],
  );

  /**
   * Insert a new primary line after `afterLineId` (null = before the first line).
   * Later lines move down one; a section that holds the line before grows to
   * hold the new one. Returns the new line's id.
   */
  const insertLine = useCallback(
    async (afterLineId: string | null, text: string, start_ms?: number, end_ms?: number) => {
      const store = useSongStore.getState();
      const transLang = store.songs.find((x) => x.id === songId)?.translation_language;
      const all = (store.lines[songId] ?? []).filter((l) => !transLang || l.language !== transLang).sort((a, b) => a.order - b.order);
      const after = afterLineId ? all.find((l) => l.id === afterLineId) : undefined;
      const prevOrder = after ? after.order : -1;
      const newOrder = prevOrder + 1;
      const now = new Date().toISOString();
      const line: Line = {
        id: crypto.randomUUID(),
        song_id: songId,
        text,
        order: newOrder,
        start_ms,
        end_ms,
        annotations: [],
        status: "new",
        play_count: 0,
        created_at: now,
        updated_at: now,
      };
      const moved = all.filter((l) => l.order > prevOrder).map((l) => ({ id: l.id, order: l.order }));
      const sections = (store.sections[songId] ?? []).map((s) => ({ id: s.id, start: s.start_line_order, end: s.end_line_order }));
      const apply = async () => {
        const st = useSongStore.getState();
        for (const m of moved) await st.updateLine(songId, m.id, { order: m.order + 1 });
        for (const s of sections) {
          const start = s.start > prevOrder ? s.start + 1 : s.start;
          const end = s.end >= prevOrder && s.end >= s.start ? s.end + 1 : s.end;
          if (start !== s.start || end !== s.end) await st.updateSection(songId, s.id, { start_line_order: start, end_line_order: end });
        }
        await st.insertLine(songId, { ...line, updated_at: new Date().toISOString() });
      };
      const revert = async () => {
        const st = useSongStore.getState();
        await st.removeLine(songId, line.id);
        for (const m of moved) await st.updateLine(songId, m.id, { order: m.order });
        for (const s of sections) await st.updateSection(songId, s.id, { start_line_order: s.start, end_line_order: s.end });
      };
      await apply();
      push({ label: "Add a line", undo: revert, redo: apply });
      return line.id;
    },
    [songId, push],
  );

  return useMemo(
    () => ({ annotate, clearAnnotations, editText, setTiming, confirmTiming, insertLine, createSection, addSections, renameSection, removeSection, setLineNote, setLineVoice }),
    [annotate, clearAnnotations, editText, setTiming, confirmTiming, insertLine, createSection, addSections, renameSection, removeSection, setLineNote, setLineVoice],
  );
}
