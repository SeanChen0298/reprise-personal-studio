import type { Annotation } from "../types/song";
import type { HighlightType } from "../lib/highlight-config";

interface Props {
  text: string;
  annotations?: Annotation[];
  highlights: HighlightType[];
  onClickAnnotation?: (index: number) => void;
  className?: string;
  /** Full-line ruby HTML for `text`. Used to show furigana on non-annotated segments. */
  lineFuriganaHtml?: string;
}

interface Segment {
  text: string;
  charStart: number;
  annotationIndex: number | null; // index into annotations array, or null for plain text
  type: string | null;
  furigana_html: string | null;
}

/**
 * Extracts ruby HTML covering characters [start, end) of the original base text.
 * Ruby groups spanning a segment boundary have their reading dropped (base text kept).
 * Returns null if the slice contains no ruby annotations.
 */
function sliceFuriganaHtml(html: string, start: number, end: number): string | null {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const parts: { base: string; rt?: string }[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) parts.push({ base: cleaned.slice(last, m.index) });
    parts.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) parts.push({ base: cleaned.slice(last) });

  const out: string[] = [];
  let pos = 0;
  for (const part of parts) {
    const partEnd = pos + part.base.length;
    if (partEnd > start && pos < end) {
      const s = Math.max(0, start - pos);
      const e = Math.min(part.base.length, end - pos);
      const sliced = part.base.slice(s, e);
      // Keep reading only when the entire ruby group falls within [start, end)
      if (part.rt && pos >= start && partEnd <= end) {
        out.push(`<ruby>${sliced}<rt>${part.rt}</rt></ruby>`);
      } else {
        out.push(sliced);
      }
    }
    pos = partEnd;
    if (pos >= end) break;
  }

  if (out.length === 0) return null;
  const result = out.join("");
  return result.includes("<ruby>") ? result : null;
}

function buildSegments(text: string, annotations?: Annotation[]): Segment[] {
  if (!annotations || annotations.length === 0) {
    return [{ text, charStart: 0, annotationIndex: null, type: null, furigana_html: null }];
  }

  // Sort by start position
  const sorted = annotations
    .map((a, i) => ({ ...a, originalIndex: i }))
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const ann of sorted) {
    const start = Math.max(0, Math.min(ann.start, text.length));
    const end = Math.max(start, Math.min(ann.end, text.length));

    // Plain text before this annotation
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), charStart: cursor, annotationIndex: null, type: null, furigana_html: null });
    }

    // Annotated segment
    if (start < end) {
      segments.push({
        text: text.slice(start, end),
        charStart: start,
        annotationIndex: ann.originalIndex,
        type: ann.type,
        furigana_html: ann.furigana_html ?? null,
      });
    }

    cursor = Math.max(cursor, end);
  }

  // Trailing plain text
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), charStart: cursor, annotationIndex: null, type: null, furigana_html: null });
  }

  return segments;
}

export function AnnotatedText({ text, annotations, highlights, onClickAnnotation, className, lineFuriganaHtml }: Props) {
  const segments = buildSegments(text, annotations);
  const hlMap = new Map(highlights.map((h) => [h.id, h]));

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        // Prefer annotation's own furigana; fall back to slicing the full-line furigana
        const segFurigana = seg.furigana_html
          ?? (lineFuriganaHtml ? sliceFuriganaHtml(lineFuriganaHtml, seg.charStart, seg.charStart + seg.text.length) : null);

        if (seg.annotationIndex == null || !seg.type) {
          return segFurigana
            ? <span key={i} dangerouslySetInnerHTML={{ __html: segFurigana }} />
            : <span key={i}>{seg.text}</span>;
        }

        const hl = hlMap.get(seg.type);
        if (!hl) {
          return segFurigana
            ? <span key={i} dangerouslySetInnerHTML={{ __html: segFurigana }} />
            : <span key={i}>{seg.text}</span>;
        }

        return (
          <span
            key={i}
            onClick={onClickAnnotation ? (e) => { e.stopPropagation(); onClickAnnotation(seg.annotationIndex!); } : undefined}
            className={onClickAnnotation ? "cursor-pointer hover:opacity-70 transition-opacity" : ""}
            style={{
              backgroundColor: hl.bg,
              color: hl.color,
              borderRadius: "3px",
              padding: "1px 2px",
            }}
          >
            {segFurigana
              ? <span dangerouslySetInnerHTML={{ __html: segFurigana }} />
              : seg.text}
          </span>
        );
      })}
    </span>
  );
}
