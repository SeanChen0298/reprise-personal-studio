/**
 * LyricDisplay — carousel conveyor lyric animation for the practice screen.
 *
 * 5 absolutely-positioned slots driven by a single `scrollPos` shared value.
 * Forward: everything shifts up — prev vanishes, center→prev, next→center, next-next→next.
 * Backward: mirror image — everything shifts down.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  PanResponder,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
  runOnJS,
} from "react-native-reanimated";
import type { Line } from "@reprise/shared";
import { AnnotatedText } from "./annotated-text";
import type { ThemeColors } from "../lib/theme";
import { STATUS_CONFIG, formatMs } from "../lib/line-status-config";

// ─── Constants ────────────────────────────────────────────────────────────────

const LARGE_FONT  = 36;
const SMALL_SCALE = 24 / 36;   // ~0.667  (24 px visual size for prev/next)
const CENTER_FRAC = 0.36;       // center slot top-edge as fraction of container height
const STEP_FRAC   = 0.20;       // vertical gap between slots (fraction)

// ─── Worklet helper ───────────────────────────────────────────────────────────

function slotAnimStyle(offset: number, scrollPosVal: number, h: number) {
  "worklet";
  const eo      = offset - scrollPosVal;
  const opacity = interpolate(eo, [-2, -1, 0, 1, 2], [0, 1, 1, 1, 0], Extrapolation.CLAMP);
  const scale   = interpolate(
    Math.abs(eo), [0, 1, 2], [1.0, SMALL_SCALE, SMALL_SCALE], Extrapolation.CLAMP,
  );
  const translateY = h * CENTER_FRAC + eo * h * STEP_FRAC;
  return { opacity, transform: [{ translateY }, { scale }] as any };
}

// ─── Furigana / ruby renderer ────────────────────────────────────────────────

interface RubySegment { base: string; rt?: string }

function parseRubyHtml(html: string): RubySegment[] {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const segments: RubySegment[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) segments.push({ base: cleaned.slice(last, m.index) });
    segments.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) segments.push({ base: cleaned.slice(last) });
  return segments;
}

function RubyText({ html, color }: { html: string; color: string }) {
  const segments = parseRubyHtml(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
      {segments.map((seg, i) =>
        seg.rt ? (
          <View key={i} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: LARGE_FONT * 0.36, color, opacity: 0.55, fontFamily: "serif" }}>{seg.rt}</Text>
            <Text style={{ fontSize: LARGE_FONT, color, fontFamily: "serif", fontWeight: "700" }}>{seg.base}</Text>
          </View>
        ) : (
          <Text key={i} style={{ fontSize: LARGE_FONT, color, fontFamily: "serif", fontWeight: "700" }}>{seg.base}</Text>
        )
      )}
    </View>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LyricDisplayProps {
  lines: Line[];
  currentIndex: number;
  showTranslation: boolean;
  translationByOrder: Map<number, string>;
  C: ThemeColors;
  onTapLine: (idx: number) => void;
  onNext?: () => void;
  onPrev?: () => void;
}

// ─── LyricDisplay ────────────────────────────────────────────────────────────

export function LyricDisplay({
  lines,
  currentIndex,
  showTranslation,
  translationByOrder,
  C,
  onTapLine,
  onNext,
  onPrev,
}: LyricDisplayProps) {
  const [committedIndex, setCommittedIndex] = useState(currentIndex);
  const committedIndexRef = useRef(currentIndex);
  const isAnimatingRef    = useRef(false);

  const scrollPos  = useSharedValue(0);
  const containerH = useSharedValue(480);

  // ── Swipe gesture ──────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40) onNext?.();
        else if (g.dy > 40) onPrev?.();
      },
    })
  ).current;

  // ── Animation finish (JS thread) ───────────────────────────────────────────
  // Reset scrollPos AND update committedIndex in the same JS call so Fabric
  // commits both to the native layer in the same frame (New Architecture / JSI).
  const onAnimationFinish = useCallback(() => {
    isAnimatingRef.current = false;
    scrollPos.value = 0;
    setCommittedIndex(committedIndexRef.current);
  }, []);

  // ── Trigger carousel transition ────────────────────────────────────────────
  useEffect(() => {
    const target = currentIndex;
    if (target === committedIndexRef.current) return;

    const prevIdx = committedIndexRef.current;
    committedIndexRef.current = target;

    if (isAnimatingRef.current) {
      // Already animating — snap both together
      isAnimatingRef.current = false;
      scrollPos.value = 0;
      setCommittedIndex(target); // same-frame as scrollPos reset
      return;
    }

    const dir = target > prevIdx ? 1 : -1;
    isAnimatingRef.current = true;

    scrollPos.value = withTiming(
      dir,
      { duration: 320, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onAnimationFinish)();
        } else {
          runOnJS(() => { isAnimatingRef.current = false; })();
        }
      },
    );
  }, [currentIndex, onAnimationFinish]);

  // ── Animated styles (one per slot offset) ─────────────────────────────────
  const anim_m2 = useAnimatedStyle(() => slotAnimStyle(-2, scrollPos.value, containerH.value));
  const anim_m1 = useAnimatedStyle(() => slotAnimStyle(-1, scrollPos.value, containerH.value));
  const anim_0  = useAnimatedStyle(() => slotAnimStyle(0,  scrollPos.value, containerH.value));
  const anim_p1 = useAnimatedStyle(() => slotAnimStyle(1,  scrollPos.value, containerH.value));
  const anim_p2 = useAnimatedStyle(() => slotAnimStyle(2,  scrollPos.value, containerH.value));

  // ── Line content renderer ─────────────────────────────────────────────────
  const renderLine = (line: Line | null, isCenter: boolean) => {
    if (!line) return null;
    const text   = line.custom_text ?? line.text;
    const color  = isCenter ? C.text : C.muted;
    const weight = isCenter ? "700" : "500";

    const hasAnnotations = Array.isArray(line.annotations) && line.annotations.length > 0;
    if (hasAnnotations) {
      return (
        <AnnotatedText
          text={text}
          annotations={line.annotations}
          fontSize={LARGE_FONT}
          color={color}
          bold={isCenter}
        />
      );
    }

    if (line.furigana_html) {
      return <RubyText html={line.furigana_html} color={color} />;
    }

    return (
      <Text style={{ fontSize: LARGE_FONT, color, lineHeight: LARGE_FONT * 1.35, textAlign: "center", fontWeight: weight, fontFamily: "serif" }}>
        {text}
      </Text>
    );
  };

  // ── Meta row data ─────────────────────────────────────────────────────────
  const centerLine  = lines[committedIndex] ?? null;
  const statusCfg   = centerLine ? STATUS_CONFIG[centerLine.status] : null;
  const hasTs       = centerLine?.start_ms !== undefined && centerLine?.end_ms !== undefined;
  const timestampTx = hasTs ? `${formatMs(centerLine!.start_ms!)} – ${formatMs(centerLine!.end_ms!)}` : null;

  return (
    <View
      style={styles.container}
      onLayout={(e) => { containerH.value = e.nativeEvent.layout.height; }}
      {...panResponder.panHandlers}
    >
      {/* Slot −2: hidden above (no touch) */}
      <Animated.View style={[styles.slot, anim_m2]} pointerEvents="none">
        {renderLine(lines[committedIndex - 2] ?? null, false)}
      </Animated.View>

      {/* Slot −1: prev */}
      <Animated.View style={[styles.slot, anim_m1]}>
        <Pressable
          onPress={() => committedIndex - 1 >= 0 && onTapLine(committedIndex - 1)}
          style={styles.touch}
          android_ripple={{ color: "rgba(0,0,0,0.04)" }}
        >
          {renderLine(lines[committedIndex - 1] ?? null, false)}
        </Pressable>
      </Animated.View>

      {/* Slot 0: center (rendered last = highest z-order) */}
      <Animated.View style={[styles.slot, anim_0, { zIndex: 10 }]}>
        <Pressable
          onPress={() => centerLine && onTapLine(committedIndex)}
          style={styles.touch}
          android_ripple={{ color: "rgba(0,0,0,0.04)" }}
        >
          {renderLine(centerLine, true)}
          {showTranslation && centerLine && translationByOrder.has(centerLine.order) && (
            <Text style={[styles.translation, { color: C.muted }]}>
              {translationByOrder.get(centerLine.order)}
            </Text>
          )}
        </Pressable>
      </Animated.View>

      {/* Slot +1: next */}
      <Animated.View style={[styles.slot, anim_p1]}>
        <Pressable
          onPress={() => committedIndex + 1 < lines.length && onTapLine(committedIndex + 1)}
          style={styles.touch}
          android_ripple={{ color: "rgba(0,0,0,0.04)" }}
        >
          {renderLine(lines[committedIndex + 1] ?? null, false)}
        </Pressable>
      </Animated.View>

      {/* Slot +2: hidden below (no touch) */}
      <Animated.View style={[styles.slot, anim_p2]} pointerEvents="none">
        {renderLine(lines[committedIndex + 2] ?? null, false)}
      </Animated.View>

      {/* Meta row — fixed at bottom */}
      {lines.length > 0 && (
        <View style={styles.metaRow}>
          {timestampTx && (
            <Text style={[styles.metaMono, { color: C.muted }]}>{timestampTx}</Text>
          )}
          <Text style={[styles.metaCounter, { color: C.muted }]}>
            {committedIndex + 1} / {lines.length}
          </Text>
          {statusCfg && (
            <View style={[styles.statusChip, { backgroundColor: "#F3F4F6", borderColor: "#D1D5DB" }]}>
              <Text style={[styles.statusChipText, { color: "#6B7280" }]}>
                {statusCfg.label}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  slot: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 0,
    alignItems: "center",
  },
  touch: {
    alignItems: "center",
    width: "100%",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  translation: {
    marginTop: 8,
    fontSize: 13,
    textAlign: "center",
    fontStyle: "italic",
    lineHeight: 19,
  },
  metaRow: {
    position: "absolute",
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  metaMono: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.2,
  },
  metaCounter: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  statusChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 0.5,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
