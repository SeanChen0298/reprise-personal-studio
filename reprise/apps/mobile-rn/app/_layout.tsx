import { useEffect } from "react";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import { Alert, View, ActivityIndicator, Text, ScrollView, Pressable } from "react-native";
import { useAuthStore } from "../src/stores/auth-store";
import { useSongFilesStore } from "../src/stores/song-files-store";
import { usePreferencesStore } from "../src/stores/preferences-store";
import type { DriveToken } from "../src/lib/google-drive-download";
import { AuthScreen } from "../src/screens/auth-screen";

SplashScreen.preventAutoHideAsync();

// Never let the native splash cover the app indefinitely if startup stalls.
setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 8000);

/** Rendered by expo-router when any screen throws — shows the error instead of a white screen. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 64, backgroundColor: "#111" }}>
      <Text style={{ color: "#F87171", fontSize: 18, fontWeight: "600", marginBottom: 12 }}>
        Something went wrong
      </Text>
      <Text selectable style={{ color: "#eee", fontSize: 13, marginBottom: 12 }}>{error.message}</Text>
      <Text selectable style={{ color: "#888", fontSize: 11, fontFamily: "monospace" }}>{error.stack}</Text>
      <Pressable onPress={retry} style={{ marginTop: 24, padding: 12, borderRadius: 8, backgroundColor: "#3B82F6", alignItems: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
      </Pressable>
    </ScrollView>
  );
}

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const hydrate = useSongFilesStore((s) => s.hydrate);
  const hydrated = useSongFilesStore((s) => s.hydrated);
  const loadHighlights = usePreferencesStore((s) => s.loadHighlights);

  useEffect(() => {
    const unsub = initialize();
    hydrate();
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load user's custom highlight config whenever the user changes
  useEffect(() => {
    if (user?.id) loadHighlights(user.id);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Google Drive OAuth deep link callback: reprise://auth/drive-callback?tokens...
  const url = Linking.useURL();
  useEffect(() => {
    if (!url) return;
    const parsed = Linking.parse(url);
    // reprise://auth/drive-callback → hostname="auth", path="drive-callback"
    if (parsed.hostname !== "auth" || parsed.path !== "drive-callback") return;

    const params = (parsed.queryParams ?? {}) as Record<string, string>;
    if (params.error) {
      Alert.alert("Drive Connection Failed", params.error);
      return;
    }
    if (!params.access_token) return;

    const token: DriveToken = {
      accessToken: params.access_token,
      refreshToken: params.refresh_token,
      expiresAt: Date.now() + Number(params.expires_in ?? 3600) * 1000,
    };
    useSongFilesStore.getState().setDriveToken(token).then(() => {
      Alert.alert("Google Drive Connected", "Your Drive account is now linked.");
    });
  }, [url]);

  useEffect(() => {
    if (!loading && hydrated) {
      SplashScreen.hideAsync();
    }
  }, [loading, hydrated]);

  if (loading || !hydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="song/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="practice/[id]" options={{ presentation: "card", gestureEnabled: true }} />
    </Stack>
  );
}
