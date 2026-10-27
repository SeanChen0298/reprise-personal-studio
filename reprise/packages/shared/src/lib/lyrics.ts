// Lyric helpers shared by the desktop and the phone.
import type { Line } from "../types/song";

/**
 * Small translation models can loop ("please please please please …") —
 * keep at most 3 repeats of any 1–4 word run.
 */
export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  for (let n = 1; n <= 4; n++) {
    const out: string[] = [];
    for (let i = 0; i < words.length; ) {
      const gram = words.slice(i, i + n).map(norm).join(" ");
      let reps = 1;
      while (
        i + (reps + 1) * n <= words.length &&
        words.slice(i + reps * n, i + (reps + 1) * n).map(norm).join(" ") === gram
      )
        reps++;
      const keep = gram && reps > 3 ? 3 : reps;
      out.push(...words.slice(i, i + keep * n));
      i += reps * n;
    }
    // Finish a collapsed run cleanly ("please, please, please," → "please, please, please").
    words.splice(0, words.length, ...out);
  }
  return words.join(" ").replace(/[,;]\s*$/, "");
}

/** A song's lyric lines and its translation lines, each in order. */
export function splitLines(all: Line[], translationLanguage?: string | null): { lines: Line[]; translations: Line[] } {
  const t = translationLanguage || null;
  const byOrder = (a: Line, b: Line) => a.order - b.order;
  return {
    lines: all.filter((l) => !t || l.language !== t).sort(byOrder),
    translations: t ? all.filter((l) => l.language === t).sort(byOrder) : [],
  };
}

/**
 * Translation per lyric line. Match by time first — translations fetched from
 * captions are split differently from the lyrics, so their numbering doesn't
 * line up — and fall back to the line number.
 */
export function translationsByLine(lines: Line[], translations: Line[]): Map<string, string> {
  const m = new Map<string, string>();
  if (translations.length === 0) return m;
  const byOrder = new Map(translations.map((l) => [l.order, l.text]));
  // A line-by-line translation (one line for each lyric line — what the app's translators make)
  // is matched by position: its times may lag behind when the lyrics were retimed.
  const oneToOne = sameShape(lines, translations);
  const timed = oneToOne ? [] : translations.filter((t) => t.start_ms != null);
  for (const line of lines) {
    let text: string | undefined;
    if (line.start_ms != null && line.end_ms != null && timed.length) {
      const parts = timed
        .filter((t) => {
          const mid = (t.start_ms! + (t.end_ms ?? t.start_ms!)) / 2;
          return mid >= line.start_ms! - 150 && mid < line.end_ms!;
        })
        .map((t) => t.text.trim())
        .filter(Boolean);
      if (parts.length) text = parts.join(" ");
    }
    text ??= byOrder.get(line.order);
    // Older machine translations can contain runaway repeats — tidy them for display.
    if (text) m.set(line.id, collapseRepeats(text));
  }
  return m;
}

/** One translation line per lyric line, with the same orders. */
function sameShape(lines: Line[], translations: Line[]): boolean {
  if (lines.length !== translations.length) return false;
  const orders = new Set(translations.map((t) => t.order));
  return lines.every((l) => orders.has(l.order));
}

/**
 * When lyric lines are retimed, the translation lines that go with them move by the same amount
 * (matched by position for a line-by-line translation, else by time). Returns the extra changes.
 */
export function followTranslations(
  lines: Line[],
  translations: Line[],
  changes: { lineId: string; start_ms?: number; end_ms?: number }[],
): { lineId: string; start_ms?: number; end_ms?: number }[] {
  if (!translations.length || !changes.length) return [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const oneToOne = sameShape(lines, translations);
  const trByOrder = new Map(translations.map((t) => [t.order, t]));
  const moved = new Set(changes.map((c) => c.lineId));
  const out: { lineId: string; start_ms?: number; end_ms?: number }[] = [];
  for (const c of changes) {
    const line = byId.get(c.lineId);
    if (!line || line.start_ms == null || c.start_ms == null) continue;
    const delta = c.start_ms - line.start_ms;
    if (!delta) continue;
    const mates = oneToOne
      ? [trByOrder.get(line.order)].filter((t): t is Line => !!t)
      : translations.filter((t) => {
          if (t.start_ms == null || line.end_ms == null) return false;
          const mid = (t.start_ms + (t.end_ms ?? t.start_ms)) / 2;
          return mid >= line.start_ms! - 150 && mid < line.end_ms;
        });
    for (const t of mates) {
      if (moved.has(t.id) || t.start_ms == null) continue;
      moved.add(t.id);
      out.push({ lineId: t.id, start_ms: Math.max(0, t.start_ms + delta), end_ms: t.end_ms != null ? Math.max(0, t.end_ms + delta) : undefined });
    }
  }
  return out;
}
