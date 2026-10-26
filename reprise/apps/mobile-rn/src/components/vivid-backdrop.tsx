// The Vivid look's moving background: soft glows in the song's colors drifting behind the lyrics.
// `energy` (from the current section's feel) sets how fast and far they move and how much the
// brighter, warmer glows show; changes ease in. Nearly still while paused; still with reduce motion.
import { memo, useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { hexToHsl, hsl } from "../lib/song-palette";

interface Glow {
  color: string;
  /** Size as a share of the screen width. */
  size: number;
  /** Resting place (share of width / height) and how it wanders. */
  x: number;
  y: number;
  ax: number;
  ay: number;
  /** Speed multipliers and phase offsets for its two axes. */
  fx: number;
  fy: number;
  px: number;
  py: number;
  /** Part of the "big" set (fades in with energy) or the quiet one. */
  bright: boolean;
}

function Blob({ g, id, w, h, phase, energy }: { g: Glow; id: string; w: number; h: number; phase: SharedValue<number>; energy: SharedValue<number> }) {
  const d = g.size * w;
  const style = useAnimatedStyle(() => {
    const e = energy.value;
    const reach = 0.5 + e * 0.9;
    const tx = (g.x + Math.sin(phase.value * g.fx + g.px) * g.ax * reach) * w - d / 2;
    const ty = (g.y + Math.cos(phase.value * g.fy + g.py) * g.ay * reach) * h - d / 2;
    const breathe = 1 + Math.sin(phase.value * 0.7 + g.px) * (0.04 + e * 0.08);
    return {
      opacity: g.bright ? 0.15 + e * 0.75 : 0.95 - e * 0.35,
      transform: [{ translateX: tx }, { translateY: ty }, { scale: breathe }],
    };
  });
  return (
    <Animated.View style={[{ position: "absolute", width: d, height: d }, style]}>
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={g.color} stopOpacity={0.85} />
            <Stop offset="0.55" stopColor={g.color} stopOpacity={0.32} />
            <Stop offset="1" stopColor={g.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={d} height={d} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export const VividBackdrop = memo(function VividBackdrop({ hex, top, bottom, energy, playing }: { hex: string | undefined; top: string; bottom: string; energy: number; playing: boolean }) {
  const { width: w, height: h } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [hue, s0] = hexToHsl(hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#3b4a6b");
  const s = Math.min(0.75, Math.max(0.22, s0));

  // The song's hue and two neighbours; the bright set leans warmer and lighter.
  const glows = useMemo<Glow[]>(
    () => [
      { color: hsl(hue, s * 0.9, 0.34), size: 1.5, x: 0.2, y: 0.22, ax: 0.18, ay: 0.08, fx: 0.31, fy: 0.23, px: 0, py: 1.1, bright: false },
      { color: hsl((hue + 0.07) % 1, s * 0.8, 0.28), size: 1.4, x: 0.85, y: 0.55, ax: 0.16, ay: 0.1, fx: 0.19, fy: 0.27, px: 2.1, py: 0.4, bright: false },
      { color: hsl((hue + 0.93) % 1, s * 0.85, 0.24), size: 1.6, x: 0.35, y: 0.88, ax: 0.2, ay: 0.07, fx: 0.24, fy: 0.17, px: 4.0, py: 2.7, bright: false },
      { color: hsl((hue + 0.96) % 1, Math.min(0.9, s * 1.2), 0.55), size: 1.1, x: 0.7, y: 0.2, ax: 0.22, ay: 0.12, fx: 0.43, fy: 0.37, px: 1.3, py: 3.3, bright: true },
      { color: hsl((hue + 0.04) % 1, Math.min(0.9, s * 1.15), 0.5), size: 1.0, x: 0.25, y: 0.62, ax: 0.24, ay: 0.14, fx: 0.37, fy: 0.47, px: 3.4, py: 0.9, bright: true },
    ],
    [hue, s],
  );

  const e = useSharedValue(energy);
  useEffect(() => {
    e.value = withTiming(energy, { duration: 2400, easing: Easing.inOut(Easing.cubic) });
  }, [energy, e]);

  // A clock whose speed follows the energy (so speed changes are smooth, never a jump).
  const phase = useSharedValue(0);
  const run = useSharedValue(playing ? 1 : 0.12);
  useEffect(() => {
    run.value = withTiming(playing ? 1 : 0.12, { duration: 900 });
  }, [playing, run]);
  useFrameCallback((f) => {
    if (reduce) return;
    const dt = Math.min(64, f.timeSincePreviousFrame ?? 16) / 1000;
    phase.value += dt * (0.12 + e.value * 0.55) * run.value;
  }, true);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[top, bottom]} style={StyleSheet.absoluteFill} />
      {glows.map((g, i) => (
        <Blob key={i} g={g} id={`glow${i}`} w={w} h={h} phase={phase} energy={e} />
      ))}
      {/* Keeps the lyrics readable over the brightest glows */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: bottom, opacity: 0.28 }]} />
    </View>
  );
});
