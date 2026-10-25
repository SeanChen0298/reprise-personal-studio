import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import type { HighlightType, Line, SyncLineHint } from "@reprise/shared/core";
import { AnnotatedText } from "./annotated-text";
import type { Theme } from "../lib/theme";

interface Props {
  line: Line;
  index: number;
  active: boolean;
  /** Distance from the active line (for the calm fade). */
  distance: number;
  translation?: string;
  /** The original singer's long phrase / high note here. */
  hint?: SyncLineHint;
  highlights: HighlightType[];
  showFurigana: boolean;
  t: Theme;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
}

const FADE = [1, 0.62, 0.45, 0.38];

export const LyricRow = memo(function LyricRow({ line, index, active, distance, translation, hint, highlights, showFurigana, t, onPress, onLongPress }: Props) {
  const voice = [line.register, line.placement].filter(Boolean).join(" · ");
  const timed = line.start_ms != null;
  return (
    <Pressable
      onPress={() => onPress(index)}
      onLongPress={() => onLongPress(index)}
      delayLongPress={350}
      style={{
        paddingVertical: 9,
        paddingHorizontal: 14,
        marginHorizontal: -6,
        borderRadius: 12,
        backgroundColor: active ? t.themeSoft : "transparent",
        opacity: active ? 1 : FADE[Math.min(distance, FADE.length - 1)],
      }}
    >
      <AnnotatedText line={line} highlights={highlights} fontSize={active ? 22 : 20} color={timed ? t.text : t.muted} bold={active} showFurigana={showFurigana} dark={t.dark} />
      {!!translation && (
        <Text style={{ textAlign: "center", fontSize: 13.5, lineHeight: 19, color: t.muted, marginTop: 3 }}>{translation}</Text>
      )}
      {(!!voice || !!line.note || !!hint) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 5 }}>
          {!!voice && (
            <Text style={{ fontSize: 11.5, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 5, overflow: "hidden", color: t.voice, backgroundColor: t.voiceSoft }}>
              {voice}
            </Text>
          )}
          {!!hint?.long_ms && (
            <Text style={{ fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, overflow: "hidden", color: t.dark ? "#7DD3FC" : "#0369A1", backgroundColor: t.dark ? "#0EA5E922" : "#E0F2FE" }}>
              long · {(hint.long_ms / 1000).toFixed(1)} s
            </Text>
          )}
          {!!hint?.high && (
            <Text style={{ fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, overflow: "hidden", color: t.dark ? "#FCD34D" : "#B45309", backgroundColor: t.dark ? "#F59E0B22" : "#FEF3C7" }}>
              high · {hint.high}
            </Text>
          )}
          {!!line.note && (
            <Text style={{ fontSize: 12.5, fontStyle: "italic", color: t.textSecondary }} numberOfLines={active ? 4 : 1}>
              ✎ {line.note}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
});
