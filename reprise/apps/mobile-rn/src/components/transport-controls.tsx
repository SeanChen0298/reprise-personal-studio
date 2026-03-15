/**
 * TransportControls — animated playback controls for the practice screen.
 *
 * Nav row: [Prev 52px] [Record 72px red] [Play/Pause 72px] [Next 52px]
 * Speed pill + loop row above.
 * Tappable overall progress bar.
 */

import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { IconPlay, IconPause, IconSkipBack, IconSkipForward, IconRepeat } from "./icons";
import { isDark } from "../lib/theme";
import type { ThemeColors } from "../lib/theme";
import { formatMs } from "../lib/line-status-config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransportControlsProps {
  isPlaying: boolean;
  audioReady: boolean;
  speed: number;
  lineProgress: number;
  positionMs: number;
  durationMs: number;
  loopEnabled: boolean;
  maxLoops: number;
  loopCount: number;
  currentIndex: number;
  totalLines: number;
  C: ThemeColors;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCycleSpeed: () => void;
  onResetSpeed: () => void;
  onToggleLoop: () => void;
  onCycleMaxLoops: () => void;
  onSeek: (ms: number) => void;
}

// ─── Spring presets ───────────────────────────────────────────────────────────

const PRESS_IN  = { damping: 15, stiffness: 280, mass: 0.85 } as const;
const PRESS_OUT = { damping: 12, stiffness: 200, mass: 0.85 } as const;

// ─── SkipButton ───────────────────────────────────────────────────────────────

function SkipButton({
  onPress,
  disabled,
  children,
  C,
}: {
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  C: ThemeColors;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => { scale.value = withSpring(0.86, PRESS_IN); }}
        onPressOut={() => { scale.value = withSpring(1.0, PRESS_OUT); }}
        style={{
          width: 52, height: 52, borderRadius: 26,
          alignItems: "center", justifyContent: "center",
          borderWidth: 1.5, borderColor: C.border,
          backgroundColor: C.surface,
        }}
        android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: true, radius: 26 }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── PlayPauseButton ─────────────────────────────────────────────────────────

function PlayPauseButton({
  isPlaying,
  audioReady,
  onTogglePlay,
  C,
}: {
  isPlaying: boolean;
  audioReady: boolean;
  onTogglePlay: () => void;
  C: ThemeColors;
}) {
  const scale = useSharedValue(1);
  const pauseOpacity = useSharedValue(isPlaying ? 1 : 0);
  const playOpacity  = useSharedValue(isPlaying ? 0 : 1);

  useEffect(() => {
    pauseOpacity.value = withTiming(isPlaying ? 1 : 0, { duration: 120, easing: Easing.inOut(Easing.ease) });
    playOpacity.value  = withTiming(isPlaying ? 0 : 1, { duration: 120, easing: Easing.inOut(Easing.ease) });
  }, [isPlaying]);

  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pauseStyle  = useAnimatedStyle(() => ({ opacity: pauseOpacity.value, position: "absolute" }));
  const playStyle   = useAnimatedStyle(() => ({ opacity: playOpacity.value,  position: "absolute" }));

  const bgColor   = audioReady ? (isDark(C) ? "#F3F4F6" : "#111111") : C.surface;
  const iconColor = audioReady ? (isDark(C) ? "#111111" : "#FFFFFF")  : C.theme;
  const borderStyle = audioReady ? {} : { borderWidth: 1.5, borderColor: C.border };

  return (
    <Animated.View style={buttonStyle}>
      <Pressable
        onPress={onTogglePlay}
        disabled={!audioReady}
        onPressIn={() => { scale.value = withSpring(0.91, PRESS_IN); }}
        onPressOut={() => { scale.value = withSpring(1.0, PRESS_OUT); }}
        style={[
          {
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: bgColor,
            alignItems: "center", justifyContent: "center",
          },
          borderStyle,
        ]}
        android_ripple={{ color: "rgba(255,255,255,0.15)", borderless: false }}
      >
        {!audioReady ? (
          <ActivityIndicator size="small" color={C.theme} />
        ) : (
          <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={playStyle}>
              <IconPlay size={26} color={iconColor} />
            </Animated.View>
            <Animated.View style={pauseStyle}>
              <IconPause size={26} color={iconColor} />
            </Animated.View>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─── RecordButton ─────────────────────────────────────────────────────────────

function RecordButton({ C }: { C: ThemeColors }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={() => { /* TODO: recording */ }}
        onPressIn={() => { scale.value = withSpring(0.91, PRESS_IN); }}
        onPressOut={() => { scale.value = withSpring(1.0, PRESS_OUT); }}
        style={{
          width: 72, height: 72, borderRadius: 36,
          backgroundColor: "#DC2626",
          alignItems: "center", justifyContent: "center",
          shadowColor: "#000", shadowOpacity: 0.12,
          shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }}
        android_ripple={{ color: "rgba(255,255,255,0.15)", borderless: false }}
      >
        {/* White circle dot — the record indicator */}
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#FFFFFF" }} />
      </Pressable>
    </Animated.View>
  );
}

// ─── SpeedPill ────────────────────────────────────────────────────────────────

function SpeedPill({
  speed, onCycle, onReset, C,
}: {
  speed: number; onCycle: () => void; onReset: () => void; C: ThemeColors;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isMax = speed >= 1.0;

  return (
    <Animated.View style={animStyle}>
      <Pressable
        onPress={onCycle}
        onLongPress={onReset}
        delayLongPress={500}
        onPressIn={() => { scale.value = withSpring(0.94, PRESS_IN); }}
        onPressOut={() => { scale.value = withSpring(1.0, PRESS_OUT); }}
        style={{
          height: 32, paddingHorizontal: 14, borderRadius: 20,
          borderWidth: 1,
          borderColor: isMax ? C.border : C.theme,
          backgroundColor: C.surface,
          alignItems: "center", justifyContent: "center",
        }}
        android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: true }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: isMax ? C.muted : C.theme, letterSpacing: 0.3 }}>
          {`${Math.round(speed * 100)}%`}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── TappableProgressBar ─────────────────────────────────────────────────────

function TappableProgressBar({
  progress, color, backgroundColor, onSeekFraction,
}: {
  progress: number; color: string; backgroundColor: string;
  onSeekFraction: (fraction: number) => void;
}) {
  const [barWidth, setBarWidth] = useState(1);
  const progressSV = useSharedValue(progress);

  useEffect(() => {
    progressSV.value = withTiming(progress, { duration: 80, easing: Easing.linear });
  }, [progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progressSV.value * 100}%` as any,
  }));

  return (
    <Pressable
      onPress={(e) => {
        const frac = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth));
        onSeekFraction(frac);
      }}
      onLayout={(e) => setBarWidth(Math.max(1, e.nativeEvent.layout.width))}
      style={{ paddingVertical: 10 }}
    >
      <View style={{ height: 3, backgroundColor, borderRadius: 2, overflow: "hidden" }}>
        <Animated.View style={[{ height: "100%", backgroundColor: color, borderRadius: 2 }, fillStyle]} />
      </View>
    </Pressable>
  );
}

// ─── TransportControls ────────────────────────────────────────────────────────

export function TransportControls({
  isPlaying, audioReady, speed, positionMs, durationMs,
  loopEnabled, maxLoops, loopCount, currentIndex, totalLines,
  C, onTogglePlay, onPrev, onNext, onCycleSpeed, onResetSpeed,
  onToggleLoop, onCycleMaxLoops, onSeek,
}: TransportControlsProps) {
  const maxLoopsLabel = maxLoops === 0 ? "∞" : String(maxLoops);
  const overallProgress = durationMs > 0 ? positionMs / durationMs : 0;

  return (
    <View style={[styles.container, { backgroundColor: C.surface, borderTopColor: C.border }]}>

      {/* Overall progress (tappable) */}
      <View style={styles.overallRow}>
        <Text style={[styles.timeLabel, { color: C.muted }]}>{formatMs(positionMs)}</Text>
        <View style={{ flex: 1 }}>
          <TappableProgressBar
            progress={overallProgress}
            color={C.theme}
            backgroundColor={C.border}
            onSeekFraction={(frac) => onSeek(frac * durationMs)}
          />
        </View>
        <Text style={[styles.timeLabel, { color: C.muted }]}>{formatMs(durationMs)}</Text>
      </View>

      {/* Speed + loop */}
      <View style={styles.optionsRow}>
        <SpeedPill speed={speed} onCycle={onCycleSpeed} onReset={onResetSpeed} C={C} />
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={onToggleLoop}
          style={[styles.loopBtn, {
            borderColor: loopEnabled ? C.theme : C.border,
            backgroundColor: loopEnabled ? (isDark(C) ? "#1E1E3F" : "#EEEEFF") : C.surface,
          }]}
          android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: true }}
        >
          <IconRepeat size={14} color={loopEnabled ? C.theme : C.muted} />
        </Pressable>
        {loopEnabled && (
          <Pressable
            onPress={onCycleMaxLoops}
            style={[styles.loopBadge, { backgroundColor: isDark(C) ? "#1E1E3F" : "#EEEEFF", borderColor: C.theme }]}
            android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: true }}
          >
            <Text style={[styles.loopBadgeText, { color: C.theme }]}>×{maxLoopsLabel}</Text>
          </Pressable>
        )}
      </View>

      {/* Nav row: Prev · Record · Play · Next */}
      <View style={styles.navRow}>
        <SkipButton
          onPress={onPrev}
          disabled={currentIndex === 0}
          C={C}
        >
          <IconSkipBack size={22} color={currentIndex === 0 ? C.border : C.text} />
        </SkipButton>

        <RecordButton C={C} />

        <PlayPauseButton
          isPlaying={isPlaying}
          audioReady={audioReady}
          onTogglePlay={onTogglePlay}
          C={C}
        />

        <SkipButton
          onPress={onNext}
          disabled={currentIndex >= totalLines - 1}
          C={C}
        >
          <IconSkipForward size={22} color={currentIndex >= totalLines - 1 ? C.border : C.text} />
        </SkipButton>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: "column",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 36,
    gap: 8,
    borderTopWidth: 0.5,
  },
  overallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeLabel: {
    fontSize: 11,
    width: 36,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loopBtn: {
    width: 32, height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loopBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  loopBadgeText: { fontSize: 11, fontWeight: "600" },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginTop: 2,
  },
});
