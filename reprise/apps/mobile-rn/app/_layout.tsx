import { useEffect } from "react";
import { ActivityIndicator, Alert, AppState, View } from "react-native";
import { Stack, router } from "expo-router";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useLibraryStore } from "../src/stores/library-store";
import { parsePairingUrl } from "../src/lib/sync-client";
import { useTheme } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const ready = useLibraryStore((s) => s.ready);
  const t = useTheme();

  useEffect(() => {
    void useLibraryStore
      .getState()
      .load()
      .then(() => useLibraryStore.getState().sync())
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
    // Back in the app (e.g. got home): sync again. While it's open, check the computer now and then.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && useLibraryStore.getState().ready) void useLibraryStore.getState().sync({ quiet: true });
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && useLibraryStore.getState().ready) useLibraryStore.getState().poll();
    }, 2000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // reprise://pair?… opened from the QR code with the system camera.
  const url = Linking.useURL();
  useEffect(() => {
    if (!url || !ready) return;
    const p = parsePairingUrl(url);
    if (!p) return;
    useLibraryStore
      .getState()
      .pair(p)
      .then(() => router.replace("/"))
      .catch((err) => Alert.alert("Couldn't pair", err instanceof Error ? err.message : String(err)));
  }, [url, ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator color={t.theme} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: "ios_from_right", animationDuration: 320 }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="song/[id]" />
        <Stack.Screen name="pair" options={{ presentation: "modal", animation: "fade_from_bottom" }} />
        <Stack.Screen name="settings" />
      </Stack>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
