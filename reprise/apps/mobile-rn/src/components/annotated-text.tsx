import { Text, View } from "react-native";
import type { Annotation } from "@reprise/shared";

// Hardcoded highlight colors (matches desktop highlight-config.ts defaults)
const HIGHLIGHT_COLORS: Record<string, { bg: string; color: string }> = {
  falsetto: { bg: "#DBEAFE", color: "#1D4ED8" },
  whisper:  { bg: "#DCFCE7", color: "#15803D" },
  accent:   { bg: "#FEE2E2", color: "#DC2626" },
  vibrato:  { bg: "#F3E8FF", color: "#7E22CE" },
  breath:   { bg: "#FFEDD5", color: "#C2410C" },
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

export function AnnotatedText({ text, annotations, fontSize = 26, color = "#0F172A" }: Props) {
  const segments = buildSegments(text, annotations);

  return (
    <Text style={{ fontSize, color, lineHeight: fontSize * 1.4, textAlign: "center", flexWrap: "wrap" }}>
      {segments.map((seg, i) => {
        const hl = seg.type ? HIGHLIGHT_COLORS[seg.type] : null;
        if (hl) {
          return (
            <Text
              key={i}
              style={{
                backgroundColor: hl.bg,
                color: hl.color,
                fontSize,
                borderRadius: 3,
              }}
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
