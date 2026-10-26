import { memo, useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "./text";
import { Chip } from "./ui";
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
  /** Only the start of the line (singing from memory). */
  memorize?: boolean;
  /** Practice tray open: show voice marks, hints and notes. */
  practice?: boolean;
  t: Theme;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
}

// No band behind the current line: it's just the brightest; the rest step back.
const FADE = [1, 0.5, 0.36, 0.28];

/** The first word (or first two characters of Japanese / Chinese). */
function lineStart(text: string): string {
  const s = text.trim();
  const word = s.match(/^\S+/)?.[0] ?? s;
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(word.slice(0, 1)) ? s.slice(0, 2) : word;
}

export const LyricRow = memo(function LyricRow({ line, index, active, distance, translation, hint, highlights, showFurigana, memorize, practice, t, onPress, onLongPress }: Props) {
  const text = (line.custom_text ?? line.text).trim();
  // Kana / kanji count fully, Latin letters about half (they're narrower).
  const width = [...text].reduce((n, c) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(c) ? 1 : 0.55), 0);
  // Long lines a little smaller (they wrap between phrases rather than shrinking further).
  const size = width > 16.5 ? 20 : 23;
  const voice = practice ? [line.register, line.placement].filter(Boolean).join(" · ") : "";
  const note = practice ? line.note : undefined;
  const timed = line.start_ms != null;
  // The current line eases up to full size and brightness; the others settle back (no jump in layout:
  // every line is laid out at full size and scaled).
  const on = useSharedValue(active ? 1 : 0);
  const fade = useSharedValue(active ? 1 : FADE[Math.min(distance, FADE.length - 1)]);
  useEffect(() => {
    const ease = { duration: 320, easing: Easing.out(Easing.cubic) };
    on.value = withTiming(active ? 1 : 0, ease);
    fade.value = withTiming(active ? 1 : FADE[Math.min(distance, FADE.length - 1)], ease);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, distance]);
  const band = useAnimatedStyle(() => ({ opacity: fade.value }));
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: 0.94 + 0.06 * on.value }] }));
  return (
    <Pressable onPress={() => onPress(index)} onLongPress={() => onLongPress(index)} delayLongPress={350}>
      <Animated.View style={[{ paddingVertical: 9, paddingHorizontal: 14, marginHorizontal: -6, borderRadius: 14 }, band]}>
      <Animated.View style={grow}>
      {memorize ? (
        <Text style={{ textAlign: "center", fontFamily: "serif", fontSize: size, lineHeight: size * 1.4, color: timed ? t.text : t.muted }}>
          {lineStart(line.custom_text ?? line.text)}
          <Text style={{ fontFamily: "serif", color: t.muted }}> · · ·</Text>
        </Text>
      ) : (
        <AnnotatedText line={line} highlights={highlights} fontSize={size} color={timed ? t.text : t.muted} showFurigana={showFurigana} dark={t.dark} />
      )}
      </Animated.View>
      {!!translation && !memorize && (
        <Text style={{ textAlign: "center", fontSize: 13.5, lineHeight: 19, color: t.muted, marginTop: 4 }}>{translation}</Text>
      )}
      {(!!voice || !!note || !!hint) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 5 }}>
          {!!voice && (
            <Chip t={t} tone="voice">
              {voice}
            </Chip>
          )}
          {!!hint?.long_ms && (
            <Text style={{ fontSize: 12, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, overflow: "hidden", color: t.dark ? "#7DD3FC" : "#0369A1", backgroundColor: t.dark ? "#0EA5E922" : "#E0F2FE" }}>
              long · {(hint.long_ms / 1000).toFixed(1)} s
            </Text>
          )}
          {!!hint?.high && (
            <Text style={{ fontSize: 12, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, overflow: "hidden", color: t.dark ? "#FCD34D" : "#B45309", backgroundColor: t.dark ? "#F59E0B22" : "#FEF3C7" }}>
              high · {hint.high}
            </Text>
          )}
          {!!note && (
            <Text style={{ fontSize: 12.5, fontStyle: "italic", color: t.textSecondary }} numberOfLines={active ? 4 : 1}>
              {note}
            </Text>
          )}
        </View>
      )}
      </Animated.View>
    </Pressable>
  );
});
