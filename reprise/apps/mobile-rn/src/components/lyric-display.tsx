/**
 * LyricDisplay — circular-buffer carousel animation.
 *
 * 5 physical slots rotate through roles (prev-prev, prev, center, next, next-next).
 * physicalCenter (Reanimated shared value) tracks which slot is center.
 *
 * On animation complete (worklet, UI thread):
 *   physicalCenter += dir   ← ATOMIC with
 *   scrollPos = 0           ← no JS thread involvement → zero race condition
 *
 * Only the recycled (invisible) slot's content updates via React state.
 * Visible slots never change content mid-animation → no flash.
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
import type { Line, HighlightType } from "@reprise/shared";
import { AnnotatedText } from "./annotated-text";
import type { ThemeColors } from "../lib/theme";
import { STATUS_CONFIG, formatMs } from "../lib/line-status-config";

// ─── Constants ────────────────────────────────────────────────────────────────

const LARGE_FONT  = 36;
const SMALL_SCALE = 24 / 36;   // 0.667 — visual prev/next size
const CENTER_FRAC = 0.36;
const STEP_FRAC   = 0.20;

// ─── Worklet helpers ──────────────────────────────────────────────────────────

// Compute circular offset for physical slot s, given physicalCenter PC
// All values are 0–4; arithmetic keeps numerator positive so JS % works.
function circularOffset(s: number, PC: number): number {
  "worklet";
  return ((s - PC + 2 + 5) % 5) - 2;
}

function slotAnimStyle(eo: number, h: number) {
  "worklet";
  const opacity = interpolate(eo, [-2, -1, 0, 1, 2], [0, 1, 1, 1, 0], Extrapolation.CLAMP);
  const scale   = interpolate(Math.abs(eo), [0, 1, 2], [1.0, 0.6667, 0.6667], Extrapolation.CLAMP);
  return {
    opacity,
    transform: [
      { translateY: h * CENTER_FRAC + eo * h * STEP_FRAC },
      { scale },
    ] as any,
  };
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
  const segs = parseRubyHtml(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
      {segs.map((seg, i) =>
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
  highlights: HighlightType[];
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
  highlights,
  C,
  onTapLine,
  onNext,
  onPrev,
}: LyricDisplayProps) {
  // slotLines[s] = the line rendered in physical slot s (0–4)
  // Initially: slots 0–4 show lines at offsets -2,-1,0,+1,+2 from currentIndex
  const [slotLines, setSlotLines] = useState<(Line | null)[]>(() =>
    [-2, -1, 0, 1, 2].map(o => lines[currentIndex + o] ?? null)
  );
  // physicalCenterState mirrors physicalCenter.value for React rendering
  const [physicalCenterState, setPhysicalCenterState] = useState(2);
  // committedIndex: index of the line currently in the center slot (for meta + tap)
  const [committedIndex, setCommittedIndex] = useState(currentIndex);

  const committedIndexRef = useRef(currentIndex);
  const isAnimatingRef    = useRef(false);

  // Reanimated shared values (UI thread)
  const scrollPos     = useSharedValue(0);
  const physicalCenter = useSharedValue(2);
  const containerH    = useSharedValue(480);

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

  // ── JS callbacks ───────────────────────────────────────────────────────────

  // Called after animation: update the recycled (invisible) slot + bookkeeping
  const recycleSlot = useCallback((
    recycledSlotIdx: number,
    newLineIdx: number,
    newCommittedIndex: number,
    newPhysCenter: number,
  ) => {
    isAnimatingRef.current = false;
    setSlotLines(prev => {
      const next = [...prev] as (Line | null)[];
      next[recycledSlotIdx] = lines[newLineIdx] ?? null;
      return next;
    });
    setCommittedIndex(newCommittedIndex);
    setPhysicalCenterState(newPhysCenter);
  }, [lines]);

  // Called on animation cancel (rapid navigation)
  const snapToIndex = useCallback((target: number) => {
    isAnimatingRef.current = false;
    setSlotLines([-2, -1, 0, 1, 2].map(o => lines[target + o] ?? null));
    setCommittedIndex(target);
    setPhysicalCenterState(2);
  }, [lines]);

  // Stable callback to clear isAnimatingRef from worklet via runOnJS
  const clearAnimating = useCallback(() => {
    isAnimatingRef.current = false;
  }, []);

  // ── Animation trigger ─────────────────────────────────────────────────────
  useEffect(() => {
    const target = currentIndex;
    if (target === committedIndexRef.current) return;

    const prevIdx = committedIndexRef.current;
    committedIndexRef.current = target;

    if (isAnimatingRef.current) {
      // Cancel in-flight animation, snap
      scrollPos.value = 0;
      physicalCenter.value = 2;
      snapToIndex(target);
      return;
    }

    const dir = target > prevIdx ? 1 : -1;
    isAnimatingRef.current = true;

    // Pre-compute on JS thread — captured by value in the worklet closure,
    // so the worklet never needs to read from a ref on the UI thread.
    const newLineIdx      = target + (dir === 1 ? 2 : -2);
    const capturedTarget  = target;

    scrollPos.value = withTiming(
      dir,
      { duration: 320, easing: Easing.out(Easing.cubic) },
      (finished) => {
        "worklet";
        if (!finished) {
          runOnJS(clearAnimating)();
          return;
        }

        const P = physicalCenter.value;
        // New center: the slot that was at offset +dir
        const newPC        = (P + (dir === 1 ? 1 : 4)) % 5;
        // Recycled slot: the slot leaving the visible range
        const recycledSlot = dir === 1 ? (P + 3) % 5 : (P + 2) % 5;

        // ── ATOMIC on UI thread (same worklet frame = same UI frame) ─────────
        physicalCenter.value = newPC;
        scrollPos.value      = 0;
        // ────────────────────────────────────────────────────────────────────

        // Async: update the invisible recycled slot + React bookkeeping
        runOnJS(recycleSlot)(recycledSlot, newLineIdx, capturedTarget, newPC);
      },
    );
  }, [currentIndex, recycleSlot, snapToIndex, clearAnimating]);

  // ── Animated styles (one per physical slot) ───────────────────────────────
  const anim0 = useAnimatedStyle(() => slotAnimStyle(circularOffset(0, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim1 = useAnimatedStyle(() => slotAnimStyle(circularOffset(1, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim2 = useAnimatedStyle(() => slotAnimStyle(circularOffset(2, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim3 = useAnimatedStyle(() => slotAnimStyle(circularOffset(3, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim4 = useAnimatedStyle(() => slotAnimStyle(circularOffset(4, physicalCenter.value) - scrollPos.value, containerH.value));

  const animStyles = [anim0, anim1, anim2, anim3, anim4];

  // ── Slot role helpers ─────────────────────────────────────────────────────
  const PC = physicalCenterState;
  const prevSlot   = (PC + 4) % 5;  // offset -1
  const nextSlot   = (PC + 1) % 5;  // offset +1

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
          highlights={highlights}
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

  // ── Meta row ──────────────────────────────────────────────────────────────
  const centerLine  = slotLines[PC] ?? null;
  const statusCfg   = centerLine ? STATUS_CONFIG[centerLine.status] : null;
  const hasTs       = centerLine?.start_ms !== undefined && centerLine?.end_ms !== undefined;
  const timestampTx = hasTs ? `${formatMs(centerLine!.start_ms!)} – ${formatMs(centerLine!.end_ms!)}` : null;

  return (
    <View
      style={styles.container}
      onLayout={(e) => { containerH.value = e.nativeEvent.layout.height; }}
      {...panResponder.panHandlers}
    >
      {/* 5 physical slots rendered in z-order: hidden first, center last */}
      {([0, 1, 2, 3, 4] as const).map(s => {
        const isCenter = s === PC;
        const isPrev   = s === prevSlot;
        const isNext   = s === nextSlot;
        const interactive = isCenter || isPrev || isNext;

        return (
          <Animated.View
            key={s}
            style={[styles.slot, animStyles[s], isCenter && { zIndex: 10 }]}
            pointerEvents={interactive ? "auto" : "none"}
          >
            <Pressable
              onPress={() => {
                if (isCenter) { centerLine && onTapLine(committedIndex); }
                else if (isPrev) { committedIndex - 1 >= 0 && onTapLine(committedIndex - 1); }
                else if (isNext) { committedIndex + 1 < lines.length && onTapLine(committedIndex + 1); }
              }}
              style={styles.touch}
              android_ripple={{ color: "rgba(0,0,0,0.04)" }}
            >
              {renderLine(slotLines[s], isCenter)}
              {isCenter && showTranslation && centerLine && translationByOrder.has(centerLine.order) && (
                <Text style={[styles.translation, { color: C.muted }]}>
                  {translationByOrder.get(centerLine.order)}
                </Text>
              )}
            </Pressable>
          </Animated.View>
        );
      })}

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
