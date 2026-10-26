// reprise://play?song=<id> — the widget's ▶. Android only lets the player start while the app is on
// screen, so the widget opens this: start Play all from that song, then show the library (its bar).
import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { playAll } from "../src/lib/radio";
import { useTheme } from "../src/lib/theme";

export default function Play() {
  const { song } = useLocalSearchParams<{ song?: string }>();
  const t = useTheme();
  useEffect(() => {
    void playAll(song, { keepOrder: true }).finally(() => router.replace("/"));
  }, [song]);
  return <View style={{ flex: 1, backgroundColor: t.bg }} />;
}
