// The coach's song card (made on the computer), as short pages: Overview / Story / Sections / Voice.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text";
import { parseLineRefs, splitLineRefs, type Line, type SongCard } from "@reprise/shared/core";
import type { Theme } from "../lib/theme";

type Tab = "overview" | "story" | "sections" | "voice";
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", story: "Story", sections: "Sections", voice: "Voice" };

const lineText = (l: Line | undefined) => (l ? (l.custom_text ?? l.text).trim() : "");
const snippet = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface Props {
  card: SongCard;
  lines: Line[];
  t: Theme;
  onJump?: (index: number) => void;
}

export function SongCardView({ card, lines, t, onJump }: Props) {
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
  const [openSection, setOpenSection] = useState<number | null>(null);

  const body = { fontSize: 14, lineHeight: 20, color: t.textSecondary } as const;
  const label = { fontSize: 10.5, fontWeight: "700", letterSpacing: 1, color: t.muted, textTransform: "uppercase", marginBottom: 6 } as const;

  const Ref = ({ from, to }: { from: number; to: number }) => (
    <Pressable
      onPress={() => onJump?.(from - 1)}
      style={{ flexDirection: "row", alignItems: "baseline", gap: 4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: t.bg, borderWidth: 1, borderColor: t.borderSubtle }}
    >
      {!!lineText(lines[from - 1]) && <Text style={{ fontSize: 12.5, color: t.text }}>{snippet(lineText(lines[from - 1]))}</Text>}
      <Text style={{ fontSize: 10.5, color: t.muted }}>
        L{from}
        {to > from ? `–${to}` : ""}
      </Text>
    </Pressable>
  );

  const Refs = ({ refs }: { refs: string }) => {
    const parsed = parseLineRefs(refs);
    if (!parsed.length) return <Text style={{ fontSize: 11, color: t.muted }}>{refs}</Text>;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {parsed.map(([a, b], i) => (
          <Ref key={i} from={a} to={b} />
        ))}
      </View>
    );
  };

  /** Text with "L12" refs shown as lyric chips. */
  const Rich = ({ text }: { text: string }) => {
    const parts = splitLineRefs(text);
    if (parts.length === 1) return <Text style={body}>{text}</Text>;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 3 }}>
        {parts.map((p, i) => {
          const r = i % 2 === 1 ? parseLineRefs(p)[0] : null;
          return r ? <Ref key={i} from={r[0]} to={r[1]} /> : p ? <Text key={i} style={body}>{p}</Text> : null;
        })}
      </View>
    );
  };

  const Chip = ({ children, voice }: { children: string; voice?: boolean }) => (
    <Text
      style={{
        fontSize: 11.5,
        paddingHorizontal: 7,
        paddingVertical: 1,
        borderRadius: 5,
        overflow: "hidden",
        color: voice ? t.themeText : t.textSecondary,
        backgroundColor: voice ? t.themeSoft : t.bg,
      }}
    >
      {children}
    </Text>
  );

  const shown = tabs.includes(tab) ? tab : "overview";

  return (
    <View style={{ gap: 14 }}>
      {tabs.length > 1 && (
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.borderSubtle }}>
          {tabs.map((x) => (
            <Pressable key={x} onPress={() => setTab(x)} style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: shown === x ? t.theme : "transparent", marginBottom: -1 }}>
              <Text style={{ fontSize: 13.5, color: shown === x ? t.text : t.muted, fontWeight: shown === x ? "600" : "400" }}>{TAB_LABEL[x]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {shown === "overview" && (
        <View style={{ gap: 14 }}>
          <View>
            <Text style={{ fontSize: 16, lineHeight: 23, color: t.text }}>{card.summary}</Text>
            {!!card.mood && <Text style={{ fontSize: 13, color: t.muted, marginTop: 6 }}>{card.mood}</Text>}
          </View>
          {card.practice_focus.length > 0 && (
            <View>
              <Text style={label}>Practise</Text>
              <View style={{ gap: 6 }}>
                {card.practice_focus.map((p, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color: t.muted }}>☐</Text>
                    <View style={{ flex: 1 }}>
                      <Rich text={p} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {shown === "story" &&
        (card.arc.length > 0 ? (
          <View style={{ gap: 10 }}>
            {card.arc.map((a, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                <Text style={{ width: 18, fontSize: 12, color: t.muted, paddingTop: 2 }}>{i + 1}.</Text>
                <View style={{ flex: 1, gap: 4 }}>
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
        <View style={{ gap: 2 }}>
          {card.sections.map((s, i) => {
            const open = openSection === i;
            return (
              <Pressable key={i} onPress={() => setOpenSection(open ? null : i)} style={{ paddingVertical: 8, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8, backgroundColor: open ? t.bg : "transparent" }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: t.text, marginRight: 2 }}>{s.name}</Text>
                  {!!s.mood && <Chip>{s.mood}</Chip>}
                  {!!s.voice?.register && <Chip voice>{s.voice.register}</Chip>}
                  {!!s.voice?.placement && <Chip voice>{s.voice.placement}</Chip>}
                </View>
                {!!s.intent && <Text style={{ ...body, marginTop: 4 }}>{s.intent}</Text>}
                {open && !!s.voice?.image && <Text style={{ ...body, fontStyle: "italic", color: t.muted, marginTop: 4 }}>Imagine: {s.voice.image}</Text>}
              </Pressable>
            );
          })}
        </View>
      )}

      {shown === "voice" && (
        <View style={{ gap: 10 }}>
          <Text style={label}>{card.singer.name ? `${card.singer.name}'s voice` : "Voice"}</Text>
          {!!card.singer.style && <Text style={body}>{card.singer.style}</Text>}
          {card.techniques.map((x, i) => (
            <View key={i} style={{ borderRadius: 10, borderWidth: 1, borderColor: t.borderSubtle, padding: 10, gap: 6 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: t.text, marginRight: 2 }}>{x.name}</Text>
                {!!x.register && <Chip voice>{x.register}</Chip>}
                {!!x.placement && <Chip voice>{x.placement}</Chip>}
              </View>
              {!!x.lines && <Refs refs={x.lines} />}
              {!!x.image && (
                <Text style={body}>
                  <Text style={{ color: t.muted }}>Imagine · </Text>
                  {x.image}
                </Text>
              )}
              {!!x.drill && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                  <Text style={{ ...body, color: t.muted }}>Drill · </Text>
                  <Rich text={x.drill} />
                </View>
              )}
            </View>
          ))}
          {card.techniques.length === 0 &&
            card.singer.techniques.map((x, i) => (
              <Text key={i} style={body}>
                • {x}
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}
