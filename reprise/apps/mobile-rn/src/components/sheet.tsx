// A bottom sheet with a title and Done: springs up, fades the backdrop, and can be dragged down to close.
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DISPLAY, Text } from "./text";
import type { Theme } from "../lib/theme";

const SPRING = { damping: 22, stiffness: 240, mass: 0.9 };

export function Sheet({ open, onClose, title, t, children, scroll = true, tall }: { open: boolean; onClose: () => void; title: string; t: Theme; children: ReactNode; scroll?: boolean; /** Always 86% high (pages inside don't make it jump). */ tall?: boolean }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Stays mounted while the closing animation runs.
  const [mounted, setMounted] = useState(open);
  const y = useSharedValue(height);
  const shade = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      y.value = height;
      y.value = withSpring(0, SPRING);
      shade.value = withTiming(1, { duration: 220 });
    } else if (mounted) {
      shade.value = withTiming(0, { duration: 180 });
      y.value = withTiming(height, { duration: 220, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const drag = Gesture.Pan()
    .activeOffsetY(8)
    .onChange((e) => {
      y.value = Math.max(0, y.value + e.changeY);
    })
    .onEnd((e) => {
      if (y.value > 120 || e.velocityY > 900) runOnJS(onClose)();
      else y.value = withSpring(0, SPRING);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: shade.value }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }, shadeStyle]}>
            <Pressable onPress={onClose} style={{ flex: 1 }} />
          </Animated.View>
          <View style={{ flex: 1 }} pointerEvents="box-none" />
          <Animated.View style={[{ maxHeight: "86%", height: tall ? "86%" : undefined, backgroundColor: t.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: insets.bottom + 12, elevation: 16 }, sheetStyle]}>
            <GestureDetector gesture={drag}>
              <View>
                <View style={{ alignItems: "center", paddingTop: 9 }}>
                  <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: t.border }} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: DISPLAY, fontSize: 19, color: t.text }}>
                    {title}
                  </Text>
                  <Pressable onPress={onClose} hitSlop={12}>
                    <Text style={{ fontSize: 15, fontWeight: "500", color: t.theme }}>Done</Text>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>
            {scroll ? (
              <ScrollView style={tall ? { flex: 1 } : undefined} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                {children}
              </ScrollView>
            ) : (
              <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>{children}</View>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
