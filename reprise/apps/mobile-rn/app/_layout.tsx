import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useAuthStore } from "../src/stores/auth-store";
import { useSongFilesStore } from "../src/stores/song-files-store";
import { AuthScreen } from "../src/screens/auth-screen";
import { View, ActivityIndicator } from "react-native";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const hydrate = useSongFilesStore((s) => s.hydrate);
  const hydrated = useSongFilesStore((s) => s.hydrated);

  useEffect(() => {
    const unsub = initialize();
    hydrate();
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    </Stack>
  );
}
