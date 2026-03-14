import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

const ACCENT = "#3B82F6";
const MUTED = "#94A3B8";

function MusicIcon({ color }: { color: string }) {
  // Simple inline SVG-style icon via View shapes isn't practical in RN — use text glyphs
  return (
    <View style={[styles.iconWrap, { opacity: color === ACCENT ? 1 : 0.5 }]}>
      {/* ♫ */}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#E2E8F0",
          paddingBottom: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Songs",
          tabBarIcon: ({ color }) => <TabIcon glyph="♫" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  const { Text } = require("react-native") as typeof import("react-native");
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
