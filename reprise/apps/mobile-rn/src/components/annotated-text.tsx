// A lyric line with the singer's highlight marks and furigana (ruby) above kanji.
import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import type { Annotation, HighlightType, Line } from "@reprise/shared/core";

interface Segment {
  text: string;
  start: number;
  type: string | null;
  furigana: string | null;
}

interface RubyPart {
  base: string;
  rt?: string;
}

function parseRuby(html: string): RubyPart[] {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const parts: RubyPart[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) parts.push({ base: cleaned.slice(last, m.index) });
    parts.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) parts.push({ base: cleaned.slice(last) });
  return parts.map((p) => ({ ...p, base: p.base.replace(/<[^>]+>/g, "") }));
}

/** Ruby HTML for characters [start, end) of the base text (ruby spanning the edge keeps only its base). */
function sliceRuby(html: string, start: number, end: number): string | null {
  const out: string[] = [];
  let pos = 0;
  for (const part of parseRuby(html)) {
    const partEnd = pos + part.base.length;
    if (partEnd > start && pos < end) {
      const sliced = part.base.slice(Math.max(0, start - pos), Math.min(part.base.length, end - pos));
      out.push(part.rt && pos >= start && partEnd <= end ? `<ruby>${sliced}<rt>${part.rt}</rt></ruby>` : sliced);
    }
    pos = partEnd;
    if (pos >= end) break;
  }
  const r = out.join("");
  return r.includes("<ruby>") ? r : null;
}

function segments(text: string, annotations: Annotation[] | undefined, lineRuby: string | null): Segment[] {
  const sorted = [...(annotations ?? [])].sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let cursor = 0;
  const push = (start: number, end: number, type: string | null, own?: string) => {
    if (end <= start) return;
    segs.push({ text: text.slice(start, end), start, type, furigana: own ?? (lineRuby ? sliceRuby(lineRuby, start, end) : null) });
  };
  for (const a of sorted) {
    const s = Math.max(0, Math.min(a.start, text.length));
    const e = Math.max(s, Math.min(a.end, text.length));
    if (s < cursor) continue;
    push(cursor, s, null);
    push(s, e, a.type, a.furigana_html);
    cursor = e;
  }
  push(cursor, text.length, null);
  return segs.length ? segs : [{ text, start: 0, type: null, furigana: lineRuby }];
}

interface Props {
  line: Line;
  highlights: HighlightType[];
  fontSize: number;
  color: string;
  bold?: boolean;
  showFurigana: boolean;
}

export const AnnotatedText = memo(function AnnotatedText({ line, highlights, fontSize, color, bold, showFurigana }: Props) {
  const text = line.custom_text ?? line.text;
  const ruby = showFurigana ? (line.custom_text != null ? line.custom_furigana_html : line.furigana_html) ?? null : null;
  const segs = useMemo(() => segments(text, line.annotations, ruby), [text, line.annotations, ruby]);
  const hl = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const weight = bold ? "600" : "400";
  const style = { fontSize, color, fontFamily: "serif", fontWeight: weight } as const;
  const hasRuby = segs.some((s) => s.furigana);

  if (!hasRuby) {
    return (
      <Text style={{ ...style, lineHeight: fontSize * 1.4, textAlign: "center" }}>
        {segs.map((s, i) => {
          const h = s.type ? hl.get(s.type) : null;
          return (
            <Text key={i} style={h ? { backgroundColor: h.bg, color: h.color } : undefined}>
              {s.text}
            </Text>
          );
        })}
      </Text>
    );
  }

  // Ruby needs a view per character group (reading above the base).
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "flex-end" }}>
      {segs.map((s, i) => {
        const h = s.type ? hl.get(s.type) : null;
        const c = h ? h.color : color;
        const bg = h ? h.bg : undefined;
        // Plain stretches are split so the line can wrap inside them (per character for kana/kanji, per word otherwise).
        const parts = (s.furigana ? parseRuby(s.furigana) : [{ base: s.text }]).flatMap((p): RubyPart[] =>
          p.rt ? [p] : (p.base.match(/[　-鿿＀-￯]|[^　-鿿＀-￯\s]+\s*|\s+/g) ?? []).map((b) => ({ base: b })),
        );
        return parts.map((p, j) => (
          <View key={`${i}-${j}`} style={{ alignItems: "center", backgroundColor: bg }}>
            <Text style={{ fontSize: fontSize * 0.42, lineHeight: fontSize * 0.55, color: c, opacity: p.rt ? 0.6 : 0, fontFamily: "serif" }}>
              {p.rt ?? " "}
            </Text>
            <Text style={{ ...style, color: c, lineHeight: fontSize * 1.3 }}>{p.base}</Text>
          </View>
        ));
      })}
    </View>
  );
});
