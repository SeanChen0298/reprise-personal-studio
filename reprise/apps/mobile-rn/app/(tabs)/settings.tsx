import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Switch,
  Pressable,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useAuthStore } from "../../src/stores/auth-store";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { buildDriveAuthUrl } from "../../src/lib/google-drive-download";
import { useTheme, isDark } from "../../src/lib/theme";
import { usePreferencesStore, type ThemeMode } from "../../src/stores/preferences-store";

export default function SettingsScreen() {
  const C = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const driveToken      = useSongFilesStore((s) => s.driveToken);
  const setDriveToken   = useSongFilesStore((s) => s.setDriveToken);
  const autoDownload    = useSongFilesStore((s) => s.autoDownload);
  const setAutoDownload = useSongFilesStore((s) => s.setAutoDownload);
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const [connectingDrive, setConnectingDrive] = useState(false);

  const connectDrive = async () => {
    setConnectingDrive(true);
    try {
      const state = Math.random().toString(36).substring(2);
      const authUrl = buildDriveAuthUrl(state);
      await WebBrowser.openAuthSessionAsync(authUrl, "reprise://");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Drive Connection Failed", msg);
    } finally {
      setConnectingDrive(false);
    }
  };

  const disconnectDrive = () => {
    Alert.alert(
      "Disconnect Google Drive",
      "This will remove your Drive credentials. Downloaded audio files will remain on device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect", style: "destructive", onPress: () => setDriveToken(null) },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  };

  const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
    { key: "light", label: "Light" },
    { key: "system", label: "System" },
    { key: "dark", label: "Dark" },
  ];

  return (
    <>
      <StatusBar style={isDark(C) ? "light" : "dark"} />
      <ScrollView style={[st.container, { backgroundColor: C.bg }]} contentContainerStyle={st.content}>
        <View style={[st.header, { backgroundColor: C.bg }]}>
          <Text style={[st.headerTitle, { color: C.text }]}>Settings</Text>
        </View>

        {/* Appearance */}
        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.muted }]}>APPEARANCE</Text>
          <View style={[st.card, { backgroundColor: C.surface }]}>
            <Text style={[st.rowLabel, { color: C.muted }]}>Theme</Text>
            <View style={[st.segmented, { backgroundColor: C.bg, borderColor: C.border }]}>
              {THEME_OPTIONS.map(({ key, label }) => {
                const active = themeMode === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setThemeMode(key)}
                    style={[
                      st.segmentBtn,
                      active && { backgroundColor: C.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
                    ]}
                    android_ripple={{ color: "rgba(0,0,0,0.05)" }}
                  >
                    <Text style={[st.segmentText, { color: active ? C.text : C.muted }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* Account */}
        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.muted }]}>ACCOUNT</Text>
          <View style={[st.card, { backgroundColor: C.surface }]}>
            <Text style={[st.rowLabel, { color: C.muted }]}>Signed in as</Text>
            <Text style={[st.rowValue, { color: C.text }]} numberOfLines={1}>{user?.email ?? "—"}</Text>
          </View>
          <TouchableOpacity style={[st.card, st.dangerCard, { backgroundColor: C.surface }]} onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={st.dangerText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Google Drive */}
        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.muted }]}>GOOGLE DRIVE SYNC</Text>
          <View style={[st.card, { backgroundColor: C.surface }]}>
            <View style={st.driveRow}>
              <View style={st.driveInfo}>
                <Text style={[st.rowLabel, { color: C.muted }]}>Status</Text>
                <Text style={[st.rowValue, { color: C.text }, driveToken ? st.connected : { color: C.muted }]}>
                  {driveToken ? "Connected" : "Not connected"}
                </Text>
              </View>
              {driveToken ? (
                <TouchableOpacity style={[st.smallBtn, { borderColor: C.border, backgroundColor: C.bg }]} onPress={disconnectDrive} activeOpacity={0.7}>
                  <Text style={[st.smallBtnText, { color: C.muted }]}>Disconnect</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[st.smallBtn, { backgroundColor: C.theme, borderColor: C.theme }]}
                  onPress={connectDrive}
                  disabled={connectingDrive}
                  activeOpacity={0.8}
                >
                  {connectingDrive ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[st.smallBtnText, { color: "#fff" }]}>Connect</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
          <Text style={[st.hint, { color: C.muted }]}>
            Connect Google Drive to download audio files synced from the Reprise desktop app.
          </Text>

          {driveToken && (
            <View style={[st.card, st.toggleRow, { backgroundColor: C.surface }]}>
              <View style={st.toggleInfo}>
                <Text style={[st.rowValue, { color: C.text }]}>Auto-download</Text>
                <Text style={[st.rowLabel, { color: C.muted }]}>Download new songs automatically on open</Text>
              </View>
              <Switch
                value={autoDownload}
                onValueChange={setAutoDownload}
                trackColor={{ false: C.border, true: C.theme }}
                thumbColor="#fff"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingBottom: 48 },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerTitle: { fontSize: 24, fontWeight: "600", letterSpacing: -0.3 },

  section:      { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  dangerCard:   { alignItems: "center" },
  rowLabel:     { fontSize: 11, marginBottom: 3 },
  rowValue:     { fontSize: 14, fontWeight: "500" },
  dangerText:   { fontSize: 14, fontWeight: "500", color: "#EF4444" },
  connected:    { color: "#16A34A" },

  // Segmented control for theme
  segmented: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 0.5,
    padding: 3,
    marginTop: 10,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentText: { fontSize: 13, fontWeight: "500" },

  driveRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  driveInfo: { flex: 1 },

  smallBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  smallBtnText: { fontSize: 13, fontWeight: "500" },

  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 0,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
});
