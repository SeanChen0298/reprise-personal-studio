// The coach's song card (made on the computer), as short pages: Overview / Story / Sections / Voice.
// Lyric references (L12) are shown as the lyric itself; tapping one plays the song from there.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DISPLAY_REGULAR, Text } from "./text";
import { Chip, Label, Segmented } from "./ui";
import { parseLineRefs, splitLineRefs, type Line, type Section, type SongCard } from "@reprise/shared/core";
import type { Theme } from "../lib/theme";

type Tab = "overview" | "story" | "sections" | "voice";
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", story: "Story", sections: "Sections", voice: "Voice" };

const lineText = (l: Line | undefined) => (l ? (l.custom_text ?? l.text).trim() : "");
const snippet = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n)}…` : s);
const capitalise = (s: string) => s.replace(/^\p{L}/u, (c) => c.toUpperCase());
/** Voice values the coach sometimes fills in when there's nothing to say. */
const real = (v?: string) => !!v && !/^(n\/?a|none|all|-|—|any)$/i.test(v.trim());

const REF = String.raw`L\d+(?:\s*[-–—]\s*L?\d+)?`;
/** "Long phrases (L7–8, L15–18)" → "Long phrases L7–8 L15–18": the chips follow the words, without brackets and commas. */
function tidyRefs(text: string): string[] {
  const tidy = text.replace(new RegExp(String.raw`\s*\(\s*(${REF}(?:\s*(?:,|;|and|&)\s*${REF})*)\s*\)`, "g"), " $1");
  return splitLineRefs(tidy).map((p, i) => (i % 2 === 0 && /^[\s,;&]*(and)?[\s,;&]*$/.test(p) ? "" : p));
}

interface Props {
  card: SongCard;
  lines: Line[];
  /** The song's sections, so a section of the card can jump to it. */
  sections?: Section[];
  t: Theme;
  onJump?: (index: number) => void;
}

export function SongCardView({ card, lines, sections = [], t, onJump }: Props) {
  const tabs = (["overview", "story", "sections", "voice"] as Tab[]).filter((x) =>
    x === "overview"
      ? true
      : x === "story"
        ? card.arc.length > 0 || !!card.story
        : x === "sections"
          ? card.sections.length > 0
          : !!card.singer.style || card.techniques.length > 0 || card.singer.techniques.length > 0,
  );
  const [tab, setTab] = useState<Tab>("overview");

  const body = { fontSize: 14.5, lineHeight: 21, color: t.textSecondary } as const;
  const fill = t.dark ? "#FFFFFF0D" : "#0000000A";

  const Ref = ({ from, to }: { from: number; to: number }) => (
    <Pressable
      onPress={() => onJump?.(from - 1)}
      hitSlop={4}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "baseline", gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: fill, opacity: pressed ? 0.6 : 1 })}
    >
      {!!lineText(lines[from - 1]) && <Text style={{ fontFamily: "serif", fontSize: 13, color: t.text }}>{snippet(lineText(lines[from - 1]))}</Text>}
      <Text style={{ fontSize: 10.5, color: t.muted }}>
        {from}
        {to > from ? `–${to}` : ""}
      </Text>
    </Pressable>
  );

  const Refs = ({ refs }: { refs: string }) => {
    const parsed = parseLineRefs(refs);
    if (!parsed.length) return null;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {parsed.map(([a, b], i) => (
          <Ref key={i} from={a} to={b} />
        ))}
      </View>
    );
  };

  /** Text with "L12" refs as lyric chips (after the words), optionally after a small label. */
  const Rich = ({ text, lead }: { text: string; lead?: string }) => {
    const parts = tidyRefs(text);
    const words = parts.filter((_, i) => i % 2 === 0).join("").replace(/\s+/g, " ").trim();
    const refs = parts.filter((_, i) => i % 2 === 1).flatMap((r) => parseLineRefs(r));
    return (
      <View style={{ gap: 6 }}>
        <Text style={body}>
          {!!lead && <Text style={{ color: t.muted }}>{lead} · </Text>}
          {refs.length ? words : text}
        </Text>
        {refs.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {refs.map(([a, b], i) => (
              <Ref key={i} from={a} to={b} />
            ))}
          </View>
        )}
      </View>
    );
  };

  const jumpToSection = (name: string) => {
    const sec = sections.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!sec) return;
    const idx = lines.findIndex((l) => l.order >= sec.start_line_order);
    if (idx >= 0) onJump?.(idx);
  };

  const shown = tabs.includes(tab) ? tab : "overview";

  return (
    <View style={{ gap: 18 }}>
      {tabs.length > 1 && <Segmented t={t} stretch options={tabs} value={shown} onChange={setTab} label={(x) => TAB_LABEL[x]} />}

      {shown === "overview" && (
        <View style={{ gap: 18 }}>
          <View style={{ gap: 10 }}>
            <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 19, lineHeight: 27, color: t.text }}>{card.summary}</Text>
            {!!card.mood && <Text style={{ fontSize: 13.5, color: t.muted }}>{card.mood}</Text>}
          </View>
          {card.practice_focus.length > 0 && (
            <View style={{ gap: 12 }}>
              <Label t={t}>Worth working on</Label>
              {card.practice_focus.map((x, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.muted, marginTop: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Rich text={x} />
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {shown === "story" &&
        (card.arc.length > 0 ? (
          <View>
            {card.arc.map((a, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 14 }}>
                {/* The song's journey as a thread through its parts */}
                <View style={{ alignItems: "center", width: 12 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: t.muted }} />
                  {i < card.arc.length - 1 && <View style={{ flex: 1, width: 1.5, backgroundColor: t.border, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, gap: 7, paddingBottom: 18 }}>
                  <Rich text={a.text} />
                  {!!a.lines && <Refs refs={a.lines} />}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={body}>{card.story}</Text>
        ))}

      {shown === "sections" && (
        <View style={{ gap: 6 }}>
          {card.sections.map((s, i) => {
            const voice = [s.voice?.register, s.voice?.placement].filter(real).join(" · ");
            const canJump = sections.some((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase());
            return (
              <Pressable key={i} disabled={!canJump} onPress={() => jumpToSection(s.name)} style={({ pressed }) => ({ paddingVertical: 10, gap: 6, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 17, color: t.text, marginRight: 4 }}>{capitalise(s.name)}</Text>
                  {!!s.mood && <Chip t={t}>{s.mood}</Chip>}
                  {!!voice && (
                    <Chip t={t} tone="voice">
                      {voice}
                    </Chip>
                  )}
                </View>
                {!!s.intent && <Text style={body}>{s.intent}</Text>}
                {!!s.voice?.image && <Text style={{ ...body, fontStyle: "italic", color: t.muted }}>Imagine {s.voice.image.replace(/^./, (c) => c.toLowerCase())}</Text>}
              </Pressable>
            );
          })}
        </View>
      )}

      {shown === "voice" && (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 8 }}>
            <Label t={t}>{card.singer.name ? `How ${card.singer.name} sings it` : "How it's sung"}</Label>
            {!!card.singer.style && <Text style={body}>{card.singer.style}</Text>}
          </View>
          {card.techniques.map((x, i) => {
            const voice = [x.register, x.placement].filter(real).join(" · ");
            return (
              <View key={i} style={{ borderRadius: 16, backgroundColor: fill, padding: 14, gap: 9 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 16.5, color: t.text, marginRight: 4 }}>{x.name}</Text>
                  {!!voice && (
                    <Chip t={t} tone="voice">
                      {voice}
                    </Chip>
                  )}
                </View>
                {!!x.lines && <Refs refs={x.lines} />}
                {!!x.image && <Rich lead="Imagine" text={x.image} />}
                {!!x.drill && <Rich lead="Try" text={x.drill} />}
              </View>
            );
          })}
          {card.techniques.length === 0 &&
            card.singer.techniques.map((x, i) => (
              <Text key={i} style={body}>
                {x}
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}
