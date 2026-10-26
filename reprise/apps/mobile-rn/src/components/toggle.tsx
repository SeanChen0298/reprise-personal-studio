// The app's on / off switch (Android's stock one looks out of place): the knob slides with a spring.
import { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { Theme } from "../lib/theme";

export function Toggle({ value, onChange, t }: { value: boolean; onChange: (v: boolean) => void; t: Theme }) {
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.value = withSpring(value ? 1 : 0, { damping: 18, stiffness: 260 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [t.border, t.theme]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: 2 + on.value * 18 }] }));
  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => {
        void Haptics.selectionAsync();
        onChange(!value);
      }}
    >
      <Animated.View style={[{ width: 42, height: 24, borderRadius: 12, justifyContent: "center" }, track]}>
        {/* In Vivid the "on" track is white, so the knob takes the page's deep color there. */}
        <Animated.View style={[{ width: 20, height: 20, borderRadius: 10, backgroundColor: value && t.theme.toUpperCase() === "#FFFFFF" ? t.onAccent : "#fff", elevation: 2 }, knob]} />
      </Animated.View>
    </Pressable>
  );
}
