import { useEffect, useRef } from "react";
import { View, Text, FlatList, TouchableOpacity, PanResponder, StyleSheet } from "react-native";
import type { Line, HighlightType } from "@reprise/shared";
import { AnnotatedText } from "./annotated-text";
import type { ThemeColors } from "../lib/theme";

const MIN_SWIPE_H  = 40;
const FADE_HEIGHT  = 72;
const FADE_STEPS   = 12;
const FADE_SLICES  = Array.from({ length: FADE_STEPS }, (_, i) => (FADE_STEPS - i) / FADE_STEPS);

export interface LyricListViewProps {
  lines: Line[];
  currentIndex: number;
  showTranslation: boolean;
  translationByOrder: Map<number, string>;
  highlights: HighlightType[];
  C: ThemeColors;
  onTapLine: (idx: number) => void;
  onSwipeRight?: () => void;
}

export function LyricListView({
  lines,
  currentIndex,
  showTranslation,
  translationByOrder,
  highlights,
  C,
  onTapLine,
  onSwipeRight,
}: LyricListViewProps) {
  const listRef = useRef<FlatList<Line>>(null);

  // Keep current line visible
  useEffect(() => {
    if (lines.length === 0) return;
    const idx = Math.min(Math.max(currentIndex, 0), lines.length - 1);
    listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.35 });
  }, [currentIndex, lines.length]);

  // Claim horizontal swipes to navigate back; let FlatList handle vertical
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (g.dx > MIN_SWIPE_H) onSwipeRight?.();
      },
    })
  ).current;

  const fadeColor = C.surface;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          });
        }}
        renderItem={({ item, index }) => {
          const isPast    = index < currentIndex;
          const isCurrent = index === currentIndex;
          const lineText  = item.custom_text ?? item.text;
          const lineFuriganaHtml = item.custom_text ? item.custom_furigana_html : item.furigana_html;
          const translation = showTranslation ? translationByOrder.get(item.order) : null;

          return (
            <TouchableOpacity
              onPress={() => onTapLine(index)}
              activeOpacity={0.55}
              style={[
                styles.row,
                isCurrent && { backgroundColor: C.surface },
              ]}
            >
              {/* Active indicator bar */}
              <View style={[styles.activeMark, { backgroundColor: isCurrent ? C.theme : "transparent" }]} />

              {/* Text content */}
              <View style={styles.lineContent}>
                <AnnotatedText
                  text={lineText}
                  annotations={item.annotations}
                  highlights={highlights}
                  fontSize={18}
                  color={isCurrent ? C.text : isPast ? C.text : C.muted}
                  bold={false}
                  textAlign="left"
                  lineFuriganaHtml={lineFuriganaHtml}
                />
                {translation && (
                  <Text style={[styles.translation, { color: C.muted }]}>{translation}</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Top fade */}
      <View style={styles.fadeTop} pointerEvents="none">
        {FADE_SLICES.map((opacity, i) => (
          <View key={i} style={[styles.fadeSlice, { backgroundColor: fadeColor, opacity }]} />
        ))}
      </View>

      {/* Bottom fade */}
      <View style={styles.fadeBottom} pointerEvents="none">
        {[...FADE_SLICES].reverse().map((opacity, i) => (
          <View key={i} style={[styles.fadeSlice, { backgroundColor: fadeColor, opacity }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingTop: FADE_HEIGHT,
    paddingBottom: FADE_HEIGHT,
  },
  fadeTop: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: FADE_HEIGHT,
  },
  fadeBottom: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: FADE_HEIGHT,
  },
  fadeSlice: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 9,
    paddingRight: 20,
    borderRadius: 8,
    marginHorizontal: 8,
    marginVertical: 1,
  },
  activeMark: {
    width: 3,
    borderRadius: 2,
    alignSelf: "stretch",
    marginRight: 8,
    marginLeft: 4,
    minHeight: 20,
  },
  lineContent: {
    flex: 1,
    minWidth: 0,
  },
  translation: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
    fontStyle: "italic",
  },
});
