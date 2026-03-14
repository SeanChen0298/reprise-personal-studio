import { Text } from "react-native";
import type { Annotation } from "@reprise/shared";

const HIGHLIGHT_COLORS: Record<string, { bg: string; color: string }> = {
  falsetto: { bg: "rgba(96,165,250,0.15)",  color: "#60A5FA" },
  whisper:  { bg: "rgba(74,222,128,0.15)",  color: "#4ADE80" },
  accent:   { bg: "rgba(248,113,113,0.15)", color: "#F87171" },
  vibrato:  { bg: "rgba(167,139,250,0.15)", color: "#A78BFA" },
  breath:   { bg: "rgba(251,146,60,0.15)",  color: "#FB923C" },
};

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
  fontSize?: number;
  color?: string;
}

export function AnnotatedText({ text, annotations, fontSize = 18, color = "#e0e0ea" }: Props) {
  const segments = buildSegments(text, annotations);

  return (
    <Text style={{ fontSize, color, lineHeight: fontSize * 1.5, textAlign: "center", flexWrap: "wrap" }}>
      {segments.map((seg, i) => {
        const hl = seg.type ? HIGHLIGHT_COLORS[seg.type] : null;
        if (hl) {
          return (
            <Text
              key={i}
              style={{ backgroundColor: hl.bg, color: hl.color, fontSize, borderRadius: 3 }}
            >
              {seg.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={{ fontSize, color }}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}
