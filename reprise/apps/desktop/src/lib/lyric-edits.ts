// Pure helpers for editing lyrics in the song workspace: annotation ranges,
// keeping annotations attached when a line's text changes, and section splits.

import type { Annotation, Line, Section } from "../types/song";

const byStart = (a: Annotation, b: Annotation) => a.start - b.start || a.end - b.end;

/** Cut [start, end) out of every annotation, keeping the parts outside it. */
function carve(anns: Annotation[], start: number, end: number): Annotation[] {
  const out: Annotation[] = [];
  for (const a of anns) {
    if (a.end <= start || a.start >= end) {
      out.push(a);
      continue;
    }
    // Trimmed pieces lose their cached furigana (it covered the old range).
    if (a.start < start) out.push({ start: a.start, end: start, type: a.type });
    if (a.end > end) out.push({ start: end, end: a.end, type: a.type });
  }
  return out;
}

/**
 * Mark [start, end) with `type`. Applying the same type to exactly the same
 * range again removes it (toggle). Other annotations under the range are trimmed.
 */
export function applyAnnotation(anns: Annotation[], start: number, end: number, type: string): Annotation[] {
  if (end <= start) return anns;
  if (anns.some((a) => a.start === start && a.end === end && a.type === type)) {
    return anns.filter((a) => !(a.start === start && a.end === end && a.type === type));
  }
  return [...carve(anns, start, end), { start, end, type }].sort(byStart);
}

/** Remove annotations in [start, end); with an empty range, the ones under the caret. */
export function removeAnnotations(anns: Annotation[], start: number, end: number): Annotation[] {
  if (end > start) return carve(anns, start, end);
  return anns.filter((a) => !(a.start <= start && start < a.end) && !(a.end === start && start > 0 && a.start < start));
}

/**
 * Keep annotations attached to the same words after the text is edited: the
 * unchanged prefix keeps its positions, the unchanged suffix shifts, and
 * annotations touching the edited stretch are dropped.
 */
export function remapAnnotations(anns: Annotation[], oldText: string, newText: string): Annotation[] {
  if (oldText === newText) return anns;
  let pre = 0;
  while (pre < oldText.length && pre < newText.length && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  while (
    suf < oldText.length - pre &&
    suf < newText.length - pre &&
    oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]
  ) suf++;
  const oldChangedEnd = oldText.length - suf;
  const delta = newText.length - oldText.length;
  const out: Annotation[] = [];
  for (const a of anns) {
    if (a.end <= pre) out.push(a);
    else if (a.start >= oldChangedEnd) out.push({ ...a, start: a.start + delta, end: a.end + delta });
  }
  return out;
}

/** Word boundaries for Ctrl+←/→: spaces and punctuation; Japanese text moves by script runs. */
export function nextWordBoundary(text: string, pos: number, dir: 1 | -1): number {
  const kind = (ch: string | undefined) => {
    if (ch == null) return "end";
    if (/\s/.test(ch)) return "space";
    if (/[\p{P}\p{S}]/u.test(ch)) return "punct";
    if (/[぀-ゟ]/.test(ch)) return "hira";
    if (/[゠-ヿ]/.test(ch)) return "kata";
    if (/[一-鿿㐀-䶿]/.test(ch)) return "kanji";
    return "word";
  };
  let i = pos;
  if (dir > 0) {
    while (i < text.length && kind(text[i]) === "space") i++;
    const k = kind(text[i]);
    while (i < text.length && kind(text[i]) === k) i++;
  } else {
    while (i > 0 && kind(text[i - 1]) === "space") i--;
    const k = kind(text[i - 1]);
    while (i > 0 && kind(text[i - 1]) === k) i--;
  }
  return i;
}

export interface SectionPlan {
  create?: Section;
  /** Existing sections to shorten (their end moves before the new one). */
  shorten: { id: string; end_line_order: number }[];
}

/**
 * Start a new section at the line with order `startOrder`. If the line is inside
 * an existing section, that section is split there; otherwise the new section
 * runs until the next section (or the last line).
 */
export function planNewSection(
  sections: Section[],
  lines: Line[],
  startOrder: number,
  name: string,
  songId: string,
): SectionPlan {
  const orders = lines.map((l) => l.order).sort((a, b) => a - b);
  const prevOrder = [...orders].reverse().find((o) => o < startOrder);
  const sorted = [...sections].sort((a, b) => a.start_line_order - b.start_line_order);
  const containing = sorted.find((s) => s.start_line_order < startOrder && s.end_line_order >= startOrder);
  const next = sorted.find((s) => s.start_line_order > startOrder);
  const lastOrder = orders[orders.length - 1] ?? startOrder;
  const beforeNext = next ? [...orders].reverse().find((o) => o < next.start_line_order) ?? startOrder : lastOrder;
  const end = containing ? containing.end_line_order : beforeNext;
  const now = new Date().toISOString();
  return {
    create: {
      id: crypto.randomUUID(),
      song_id: songId,
      name,
      start_line_order: startOrder,
      end_line_order: Math.max(startOrder, end),
      created_at: now,
      updated_at: now,
    },
    shorten: containing && prevOrder != null ? [{ id: containing.id, end_line_order: prevOrder }] : [],
  };
}
