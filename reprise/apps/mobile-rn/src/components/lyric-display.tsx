/**
 * LyricDisplay — circular-buffer carousel animation.
 *
 * Gesture model (outer container claims ALL touches):
 *  - Short tap (<350ms, <15px)  → tap the nearest slot (line seek)
 *  - Double-tap (<300ms apart)  → onDoubleTap callback
 *  - Vertical swipe (dy>40)     → next / prev line
 *  - Hold (1 s) + drag ←→      → speed scrub (indicator shown on hold)
 *
 * Slot animation:
 *  physicalCenter (Reanimated SV) + scrollPos (Reanimated SV) drive all
 *  position, scale, and opacity — no React state in the render path.
 *  Only the invisible "recycled" slot's content updates via React state,
 *  so visible content never changes mid-animation (no flash / snap).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder } from "react-native";
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

const LARGE_FONT   = 36;
const CENTER_FRAC  = 0.36;   // center slot's Y as fraction of container height
const STEP_FRAC    = 0.20;   // step between slots
const HOLD_MS      = 1000;   // hold before speed-drag activates
const DOUBLE_MS    = 300;    // max gap for double-tap
const MIN_SWIPE    = 40;     // min dy to register a swipe
const PX_PER_STEP  = 28;     // px of horizontal drag per speed step
const SPEED_STEPS  = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

// ─── Worklet helpers ──────────────────────────────────────────────────────────

function circularOffset(s: number, PC: number): number {
  "worklet";
  return ((s - PC + 2 + 5) % 5) - 2;
}

function slotAnimStyle(eo: number, h: number) {
  "worklet";
  const opacity  = interpolate(eo, [-2, -1, 0, 1, 2], [0, 1, 1, 1, 0], Extrapolation.CLAMP);
  const scale    = interpolate(Math.abs(eo), [0, 1, 2], [1.0, 0.6667, 0.6667], Extrapolation.CLAMP);
  // maxHeight prevents long lines from bleeding into adjacent slots
  const maxH     = eo === 0 ? h * 0.34 : h * 0.24;
  return {
    opacity,
    overflow: "hidden" as const,
    maxHeight: maxH,
    transform: [
      { translateY: h * CENTER_FRAC + eo * h * STEP_FRAC },
      { scale },
    ] as any,
  };
}


// ─── Types ────────────────────────────────────────────────────────────────────

export interface LyricDisplayProps {
  lines: Line[];
  currentIndex: number;
  showTranslation: boolean;
  translationByOrder: Map<number, string>;
  highlights: HighlightType[];
  C: ThemeColors;
  speed?: number;
  onTapLine: (idx: number) => void;
  onDoubleTap?: () => void;
  onSwipeLeft?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSpeedChange?: (s: number) => void;
}

// ─── LyricDisplay ────────────────────────────────────────────────────────────

export function LyricDisplay({
  lines,
  currentIndex,
  showTranslation,
  translationByOrder,
  highlights,
  C,
  speed = 1.0,
  onTapLine,
  onDoubleTap,
  onSwipeLeft,
  onNext,
  onPrev,
  onSpeedChange,
}: LyricDisplayProps) {
  const [slotLines, setSlotLines] = useState<(Line | null)[]>(() =>
    [-2, -1, 0, 1, 2].map(o => lines[currentIndex + o] ?? null)
  );
  const [physicalCenterState, setPhysicalCenterState] = useState(2);
  const [committedIndex, setCommittedIndex] = useState(currentIndex);
  const [speedDragActive, setSpeedDragActive] = useState(false);

  const committedIndexRef  = useRef(currentIndex);
  const isAnimatingRef     = useRef(false);
  const containerHRef      = useRef(480);
  // Touch tracking
  const touchStartTimeRef  = useRef(0);
  const lastTapTimeRef     = useRef(0);
  const holdTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Speed drag state (all on JS thread)
  const speedDragActiveRef = useRef(false);
  const dragBaseSpeedRef   = useRef(speed);
  const dragBaseXRef       = useRef(0);
  const gestureConsumedRef = useRef(false); // true once swipe/hold triggers

  // Live-updatable refs for PanResponder callbacks (avoids stale closure)
  const cbRef = useRef({ onNext, onPrev, onSpeedChange, onDoubleTap, onSwipeLeft, onTapLine, speed, committedIndex });
  cbRef.current = { onNext, onPrev, onSpeedChange, onDoubleTap, onSwipeLeft, onTapLine, speed, committedIndex };

  // Reanimated shared values
  const scrollPos      = useSharedValue(0);
  const physicalCenter = useSharedValue(2);
  const containerH     = useSharedValue(480);

  // ── Tap-zone helper (JS thread) ────────────────────────────────────────────
  // Determine which logical slot (center / prev / next) a touch Y coordinate hits.
  const resolveSlot = (locationY: number) => {
    const h = containerHRef.current;
    const centerY = h * CENTER_FRAC;
    const prevY   = centerY - h * STEP_FRAC;
    const nextY   = centerY + h * STEP_FRAC;
    const distC = Math.abs(locationY - centerY);
    const distP = Math.abs(locationY - prevY);
    const distN = Math.abs(locationY - nextY);
    if (distC <= distP && distC <= distN) return "center";
    if (distP <= distN) return "prev";
    return "next";
  };

  // ── Gesture ────────────────────────────────────────────────────────────────
  const clearHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      // Claim ALL touches so gestures work anywhere in the display area
      onStartShouldSetPanResponder: () => true,

      onPanResponderGrant: (e) => {
        touchStartTimeRef.current = Date.now();
        dragBaseXRef.current = e.nativeEvent.pageX;
        gestureConsumedRef.current = false;
        speedDragActiveRef.current = false;

        // After HOLD_MS: show speed indicator (before any drag movement)
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          speedDragActiveRef.current = true;
          dragBaseSpeedRef.current = cbRef.current.speed;
          setSpeedDragActive(true);
        }, HOLD_MS);
      },

      onPanResponderMove: (e, g) => {
        const dx = Math.abs(g.dx);
        const dy = Math.abs(g.dy);

        if (speedDragActiveRef.current) {
          gestureConsumedRef.current = true;
          const totalDx = e.nativeEvent.pageX - dragBaseXRef.current;
          const steps   = Math.round(totalDx / PX_PER_STEP);
          const baseIdx = SPEED_STEPS.indexOf(dragBaseSpeedRef.current);
          const fromIdx = baseIdx >= 0 ? baseIdx : SPEED_STEPS.length - 1;
          const newIdx  = Math.max(0, Math.min(SPEED_STEPS.length - 1, fromIdx + steps));
          cbRef.current.onSpeedChange?.(SPEED_STEPS[newIdx]);
          return;
        }

        // Cancel hold timer on any significant movement before it fires
        if ((dx > 8 || dy > 8) && holdTimerRef.current) {
          clearHold();
        }
      },

      onPanResponderRelease: (e, g) => {
        clearHold();

        if (speedDragActiveRef.current) {
          speedDragActiveRef.current = false;
          setSpeedDragActive(false);
          return;
        }

        if (gestureConsumedRef.current) return;

        const elapsed = Date.now() - touchStartTimeRef.current;
        const totalDx = Math.abs(g.dx);
        const totalDy = Math.abs(g.dy);

        // Horizontal swipe left → switch to list view
        if (totalDx > MIN_SWIPE && totalDx > totalDy * 1.5 && g.dx < 0) {
          cbRef.current.onSwipeLeft?.();
          return;
        }

        // Vertical swipe → next / prev
        if (totalDy > MIN_SWIPE && totalDy > totalDx * 1.2) {
          if (g.dy < 0) cbRef.current.onNext?.();
          else cbRef.current.onPrev?.();
          return;
        }

        // Tap (short, minimal movement)
        if (elapsed < 350 && totalDx < 15 && totalDy < 15) {
          const slot = resolveSlot(e.nativeEvent.locationY);
          const ci   = cbRef.current.committedIndex;

          if (slot === "center") {
            const now = Date.now();
            if (now - lastTapTimeRef.current < DOUBLE_MS) {
              lastTapTimeRef.current = 0;
              cbRef.current.onDoubleTap?.();
            } else {
              lastTapTimeRef.current = now;
              cbRef.current.onTapLine(ci);
            }
          } else if (slot === "prev") {
            lastTapTimeRef.current = 0;
            if (ci - 1 >= 0) cbRef.current.onTapLine(ci - 1);
          } else {
            lastTapTimeRef.current = 0;
            if (ci + 1 < lines.length) cbRef.current.onTapLine(ci + 1);
          }
        }
      },

      onPanResponderTerminate: () => {
        clearHold();
        speedDragActiveRef.current = false;
        setSpeedDragActive(false);
      },
    })
  ).current;

  // ── JS callbacks ───────────────────────────────────────────────────────────

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

  const snapToIndex = useCallback((target: number) => {
    isAnimatingRef.current = false;
    setSlotLines([-2, -1, 0, 1, 2].map(o => lines[target + o] ?? null));
    setCommittedIndex(target);
    setPhysicalCenterState(2);
  }, [lines]);

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
      scrollPos.value = 0;
      physicalCenter.value = 2;
      snapToIndex(target);
      return;
    }

    const dir = target > prevIdx ? 1 : -1;
    isAnimatingRef.current = true;

    const newLineIdx     = target + (dir === 1 ? 2 : -2);
    const capturedTarget = target;

    scrollPos.value = withTiming(
      dir,
      { duration: 320, easing: Easing.out(Easing.cubic) },
      (finished) => {
        "worklet";
        if (!finished) { runOnJS(clearAnimating)(); return; }
        const P        = physicalCenter.value;
        const newPC    = (P + (dir === 1 ? 1 : 4)) % 5;
        const recycled = dir === 1 ? (P + 3) % 5 : (P + 2) % 5;
        physicalCenter.value = newPC;
        scrollPos.value      = 0;
        runOnJS(recycleSlot)(recycled, newLineIdx, capturedTarget, newPC);
      },
    );
  }, [currentIndex, recycleSlot, snapToIndex, clearAnimating]);

  // ── Slot animated styles ───────────────────────────────────────────────────
  const anim0 = useAnimatedStyle(() => slotAnimStyle(circularOffset(0, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim1 = useAnimatedStyle(() => slotAnimStyle(circularOffset(1, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim2 = useAnimatedStyle(() => slotAnimStyle(circularOffset(2, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim3 = useAnimatedStyle(() => slotAnimStyle(circularOffset(3, physicalCenter.value) - scrollPos.value, containerH.value));
  const anim4 = useAnimatedStyle(() => slotAnimStyle(circularOffset(4, physicalCenter.value) - scrollPos.value, containerH.value));
  const animStyles = [anim0, anim1, anim2, anim3, anim4];

  // Content opacity: smoothly dims non-center slots during animation (UI thread, no snap)
  const cop0 = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(circularOffset(0, physicalCenter.value) - scrollPos.value), [0, 1], [1, 0.38], Extrapolation.CLAMP) }));
  const cop1 = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(circularOffset(1, physicalCenter.value) - scrollPos.value), [0, 1], [1, 0.38], Extrapolation.CLAMP) }));
  const cop2 = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(circularOffset(2, physicalCenter.value) - scrollPos.value), [0, 1], [1, 0.38], Extrapolation.CLAMP) }));
  const cop3 = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(circularOffset(3, physicalCenter.value) - scrollPos.value), [0, 1], [1, 0.38], Extrapolation.CLAMP) }));
  const cop4 = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(circularOffset(4, physicalCenter.value) - scrollPos.value), [0, 1], [1, 0.38], Extrapolation.CLAMP) }));
  const copStyles = [cop0, cop1, cop2, cop3, cop4];

  // ── Line content renderer ─────────────────────────────────────────────────
  const renderLine = (line: Line | null) => {
    if (!line) return null;
    const color = C.text;

    // Scale font down for longer lines to avoid multi-line overflow
    const mainText  = line.custom_text ?? line.text ?? "";
    const len       = mainText.length;
    const fontSize  = len > 30 ? 20 : len > 22 ? 24 : len > 14 ? 28 : LARGE_FONT;

    if (line.custom_text) {
      return (
        <View style={{ alignItems: "center" }}>
          <AnnotatedText
            text={line.custom_text}
            annotations={line.annotations}
            highlights={highlights}
            fontSize={fontSize}
            color={color}
            bold
            lineFuriganaHtml={line.custom_furigana_html}
          />
          <Text selectable={false} style={{ fontSize: Math.round(fontSize * 0.5), color, opacity: 0.4, fontFamily: "serif", marginTop: 4, textAlign: "center" }}>
            {line.text}
          </Text>
        </View>
      );
    }

    return (
      <AnnotatedText
        text={line.text}
        annotations={line.annotations}
        highlights={highlights}
        fontSize={fontSize}
        color={color}
        bold
        lineFuriganaHtml={line.furigana_html}
      />
    );
  };

  // ── Meta row ──────────────────────────────────────────────────────────────
  const PC          = physicalCenterState;
  const centerLine  = slotLines[PC] ?? null;
  const statusCfg   = centerLine ? STATUS_CONFIG[centerLine.status] : null;
  const hasTs       = centerLine?.start_ms !== undefined && centerLine?.end_ms !== undefined;
  const timestampTx = hasTs ? `${formatMs(centerLine!.start_ms!)} – ${formatMs(centerLine!.end_ms!)}` : null;

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        containerH.value = h;
        containerHRef.current = h;
      }}
      {...panResponder.panHandlers}
    >
      {/* 5 physical slots — pointerEvents none since outer container handles all input */}
      {([0, 1, 2, 3, 4] as const).map(s => (
        <Animated.View
          key={s}
          style={[styles.slot, animStyles[s], s === PC && { zIndex: 10 }]}
          pointerEvents="none"
        >
          <Animated.View style={[styles.slotInner, copStyles[s]]}>
            {renderLine(slotLines[s])}
            {s === PC && showTranslation && centerLine && translationByOrder.has(centerLine.order) && (
              <Text selectable={false} style={[styles.translation, { color: C.muted }]}>
                {translationByOrder.get(centerLine.order)}
              </Text>
            )}
          </Animated.View>
        </Animated.View>
      ))}

      {/* Speed indicator — top-right, shown during hold+drag */}
      {speedDragActive && (
        <View style={styles.speedIndicator} pointerEvents="none">
          <Text style={[styles.speedIndicatorText, { color: C.muted }]}>
            {Math.round(speed * 100)}%
          </Text>
        </View>
      )}

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
  slotInner: {
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
  speedIndicator: {
    position: "absolute",
    top: 10,
    right: 14,
    backgroundColor: "rgba(0,0,0,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  speedIndicatorText: {
    fontSize: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
    opacity: 0.7,
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
