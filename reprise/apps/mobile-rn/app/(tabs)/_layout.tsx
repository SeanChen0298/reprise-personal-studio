import { Tabs } from "expo-router";
import { useTheme } from "../../src/lib/theme";
import { IconMusic, IconSettings } from "../../src/components/icons";

export default function TabLayout() {
  const C = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: C.theme,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopWidth: 0,
          height: 56,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Songs",
          tabBarIcon: ({ color }) => <IconMusic size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <IconSettings size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
