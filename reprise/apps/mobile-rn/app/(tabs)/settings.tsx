import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useAuthStore } from "../../src/stores/auth-store";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { buildDriveAuthUrl } from "../../src/lib/google-drive-download";
import { C } from "../../src/lib/theme";

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const driveToken = useSongFilesStore((s) => s.driveToken);
  const setDriveToken = useSongFilesStore((s) => s.setDriveToken);
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

  return (
    <ScrollView style={st.container} contentContainerStyle={st.content}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Settings</Text>
      </View>

      {/* Account */}
      <View style={st.section}>
        <Text style={st.sectionLabel}>ACCOUNT</Text>
        <View style={st.card}>
          <Text style={st.rowLabel}>Signed in as</Text>
          <Text style={st.rowValue} numberOfLines={1}>{user?.email ?? "—"}</Text>
        </View>
        <TouchableOpacity style={[st.card, st.dangerCard]} onPress={handleSignOut} activeOpacity={0.7}>
          <Text style={st.dangerText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Google Drive */}
      <View style={st.section}>
        <Text style={st.sectionLabel}>GOOGLE DRIVE SYNC</Text>
        <View style={st.card}>
          <View style={st.driveRow}>
            <View style={st.driveInfo}>
              <Text style={st.rowLabel}>Status</Text>
              <Text style={[st.rowValue, driveToken ? st.connected : st.disconnected]}>
                {driveToken ? "Connected" : "Not connected"}
              </Text>
            </View>
            {driveToken ? (
              <TouchableOpacity style={st.smallBtn} onPress={disconnectDrive} activeOpacity={0.7}>
                <Text style={st.smallBtnText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[st.smallBtn, st.primaryBtn]}
                onPress={connectDrive}
                disabled={connectingDrive}
                activeOpacity={0.8}
              >
                {connectingDrive ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[st.smallBtnText, st.primaryBtnText]}>Connect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={st.hint}>
          Connect Google Drive to download audio files synced from the Reprise desktop app.
        </Text>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { paddingBottom: 48 },
  header: {
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: C.bg,
  },
  headerTitle: { fontSize: 24, fontWeight: "600", color: C.text, letterSpacing: -0.3 },

  section:      { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: C.muted,
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  card: {
    backgroundColor: C.surface,
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
  rowLabel:     { fontSize: 11, color: C.muted, marginBottom: 3 },
  rowValue:     { fontSize: 14, fontWeight: "500", color: C.text },
  dangerText:   { fontSize: 14, fontWeight: "500", color: "#EF4444" },

  driveRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  driveInfo: { flex: 1 },
  connected:    { color: "#16A34A" },
  disconnected: { color: C.muted },

  smallBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  primaryBtn:     { backgroundColor: C.theme, borderColor: C.theme },
  smallBtnText:   { fontSize: 13, fontWeight: "500", color: C.muted },
  primaryBtnText: { color: "#fff" },

  hint: {
    fontSize: 12,
    color: C.muted,
    lineHeight: 18,
    marginTop: 6,
    paddingHorizontal: 4,
  },
});
