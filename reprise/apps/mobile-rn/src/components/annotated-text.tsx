import { useMemo } from "react";
import { View, Text } from "react-native";
import type { Annotation, HighlightType } from "@reprise/shared";
import { DEFAULT_HIGHLIGHTS } from "@reprise/shared";

interface Segment {
  text: string;
  charStart: number;
  type: string | null;
  furigana_html: string | null;
}

function buildSegments(text: string, annotations?: Annotation[]): Segment[] {
  if (!annotations || annotations.length === 0) {
    return [{ text, charStart: 0, type: null, furigana_html: null }];
  }

  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const ann of sorted) {
    const start = Math.max(0, Math.min(ann.start, text.length));
    const end = Math.max(start, Math.min(ann.end, text.length));
    if (cursor < start) {
      segments.push({ text: text.slice(cursor, start), charStart: cursor, type: null, furigana_html: null });
    }
    if (start < end) {
      segments.push({ text: text.slice(start, end), charStart: start, type: ann.type, furigana_html: ann.furigana_html ?? null });
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), charStart: cursor, type: null, furigana_html: null });
  }

  return segments;
}

interface RubyPart { base: string; rt?: string }

function parseRubyHtml(html: string): RubyPart[] {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const parts: RubyPart[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) parts.push({ base: cleaned.slice(last, m.index) });
    parts.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) parts.push({ base: cleaned.slice(last) });
  return parts;
}

/**
 * Extracts ruby HTML covering characters [start, end) of the base text.
 * Ruby groups spanning a segment boundary lose their reading (base text kept).
 * Returns null if the slice contains no ruby annotations.
 */
function sliceFuriganaHtml(html: string, start: number, end: number): string | null {
  const parts = parseRubyHtml(html);
  const out: string[] = [];
  let pos = 0;
  for (const part of parts) {
    const partEnd = pos + part.base.length;
    if (partEnd > start && pos < end) {
      const s = Math.max(0, start - pos);
      const e = Math.min(part.base.length, end - pos);
      const sliced = part.base.slice(s, e);
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

interface Props {
  text: string;
  annotations?: Annotation[];
  highlights?: HighlightType[];
  fontSize?: number;
  color?: string;
  bold?: boolean;
  textAlign?: "left" | "center" | "right";
  /** Full-line ruby HTML for `text`. Used to show furigana on non-annotated segments. */
  lineFuriganaHtml?: string;
}

export function AnnotatedText({
  text,
  annotations,
  highlights = DEFAULT_HIGHLIGHTS,
  fontSize = 18,
  color = "#1C1C1E",
  bold = false,
  textAlign = "center",
  lineFuriganaHtml,
}: Props) {
  const segments = buildSegments(text, annotations);
  const weight = bold ? "700" : "400";

  const hlMap = useMemo(
    () => new Map(highlights.map((h) => [h.id, { bg: h.bg, color: h.color }])),
    [highlights]
  );

  // Resolve per-segment furigana: prefer annotation's own, fall back to slicing the full-line HTML
  const segmentFurigana = useMemo(
    () => segments.map((seg) =>
      seg.furigana_html
        ?? (lineFuriganaHtml ? sliceFuriganaHtml(lineFuriganaHtml, seg.charStart, seg.charStart + seg.text.length) : null)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, annotations, lineFuriganaHtml]
  );

  const hasFurigana = segmentFurigana.some((f) => f !== null);

  if (hasFurigana) {
    // View-based layout required for ruby text above characters
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: textAlign === "left" ? "flex-start" : textAlign === "right" ? "flex-end" : "center" }}>
        {segments.map((seg, i) => {
          const hl = seg.type ? hlMap.get(seg.type) : null;
          const textColor = hl ? hl.color : color;
          const bg = hl ? hl.bg : undefined;
          const furigana = segmentFurigana[i];

          if (furigana) {
            const parts = parseRubyHtml(furigana);
            return (
              <View key={i} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
                {parts.map((p, j) =>
                  p.rt ? (
                    <View key={j} style={{ alignItems: "center", backgroundColor: bg }}>
                      <Text style={{ fontSize: fontSize * 0.36, color: textColor, opacity: 0.55, fontFamily: "serif" }}>{p.rt}</Text>
                      <Text style={{ fontSize, color: textColor, fontFamily: "serif", fontWeight: weight }}>{p.base}</Text>
                    </View>
                  ) : (
                    <Text key={j} style={{ fontSize, color: textColor, fontFamily: "serif", fontWeight: weight, backgroundColor: bg }}>
                      {p.base}
                    </Text>
                  )
                )}
              </View>
            );
          }

          return (
            <Text key={i} style={{ fontSize, color: textColor, fontFamily: "serif", fontWeight: weight, backgroundColor: bg }}>
              {seg.text}
            </Text>
          );
        })}
      </View>
    );
  }

  // Simple case: no furigana, inline Text spans
  return (
    <Text style={{ fontSize, color, lineHeight: fontSize * 1.4, textAlign, flexWrap: "wrap", fontFamily: "serif", fontWeight: weight }}>
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
