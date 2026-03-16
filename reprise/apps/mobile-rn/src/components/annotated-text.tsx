import { useMemo } from "react";
import { Text } from "react-native";
import type { Annotation, HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";

interface Segment {
  text: string;
  type: string | null;
  furigana_html: string | null;
}

function buildSegments(text: string, annotations?: Annotation[]): Segment[] {
  if (!annotations || annotations.length === 0) {
    return [{ text, type: null, furigana_html: null }];
  }

  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const ann of sorted) {
    const start = Math.max(0, Math.min(ann.start, text.length));
    const end = Math.max(start, Math.min(ann.end, text.length));
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), type: null, furigana_html: null });
    }
    if (start < end) {
      segments.push({ text: text.slice(start, end), type: ann.type, furigana_html: ann.furigana_html ?? null });
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: null, furigana_html: null });
  }

  return segments;
}

interface Props {
  text: string;
  annotations?: Annotation[];
  highlights?: HighlightType[];
  fontSize?: number;
  color?: string;
  bold?: boolean;
}

export function AnnotatedText({ text, annotations, highlights = DEFAULT_HIGHLIGHTS, fontSize = 18, color = "#1C1C1E", bold = false }: Props) {
  const segments = buildSegments(text, annotations);
  const weight = bold ? "600" : "400";

  const hlMap = useMemo(
    () => new Map(highlights.map((h) => [h.id, { bg: h.bg, color: h.color }])),
    [highlights]
  );

  return (
    <Text style={{ fontSize, color, lineHeight: fontSize * 1.4, textAlign: "center", flexWrap: "wrap", fontFamily: "serif", fontWeight: weight }}>
      {segments.map((seg, i) => {
        const hl = seg.type ? hlMap.get(seg.type) : null;
        if (hl) {
          return (
            <Text
              key={i}
              style={{ backgroundColor: hl.bg, color: hl.color, fontSize, borderRadius: 3, fontFamily: "serif", fontWeight: weight }}
            >
              {seg.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={{ fontSize, color, fontFamily: "serif", fontWeight: weight }}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}
