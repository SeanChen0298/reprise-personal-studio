import { Tabs } from "expo-router";
import { C } from "../../src/lib/theme";
import { IconMusic, IconSettings } from "../../src/components/icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: C.theme,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopColor: C.border,
          borderTopWidth: 0.5,
          height: 56,
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
