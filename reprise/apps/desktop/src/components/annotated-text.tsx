import type { Annotation } from "../types/song";
import type { HighlightType } from "../lib/highlight-config";

interface Props {
  text: string;
  annotations?: Annotation[];
  highlights: HighlightType[];
  onClickAnnotation?: (index: number) => void;
  className?: string;
}

interface Segment {
  text: string;
  annotationIndex: number | null; // index into annotations array, or null for plain text
  type: string | null;
}

function buildSegments(text: string, annotations?: Annotation[]): Segment[] {
  if (!annotations || annotations.length === 0) {
    return [{ text, annotationIndex: null, type: null }];
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
      segments.push({ text: text.slice(cursor, start), annotationIndex: null, type: null });
    }

    // Annotated segment
    if (start < end) {
      segments.push({
        text: text.slice(start, end),
        annotationIndex: ann.originalIndex,
        type: ann.type,
      });
    }

    cursor = Math.max(cursor, end);
  }

  // Trailing plain text
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), annotationIndex: null, type: null });
  }

  return segments;
}

export function AnnotatedText({ text, annotations, highlights, onClickAnnotation, className }: Props) {
  const segments = buildSegments(text, annotations);
  const hlMap = new Map(highlights.map((h) => [h.id, h]));

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.annotationIndex == null || !seg.type) {
          return <span key={i}>{seg.text}</span>;
        }

        const hl = hlMap.get(seg.type);
        if (!hl) {
          return <span key={i}>{seg.text}</span>;
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
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}
