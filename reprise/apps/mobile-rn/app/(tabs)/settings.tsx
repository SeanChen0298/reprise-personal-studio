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
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useAuthStore } from "../../src/stores/auth-store";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { buildAuthRequest, exchangeCodeForToken } from "../../src/lib/google-drive-download";

// Required for expo-auth-session on Android
WebBrowser.maybeCompleteAuthSession();

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const driveToken = useSongFilesStore((s) => s.driveToken);
  const setDriveToken = useSongFilesStore((s) => s.setDriveToken);
  const [connectingDrive, setConnectingDrive] = useState(false);

  const connectDrive = async () => {
    setConnectingDrive(true);
    try {
      const { request, verifier } = await buildAuthRequest();
      await request.makeAuthUrlAsync({ authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth" });
      const result = await request.promptAsync({ authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth" });

      if (result.type === "success" && result.params.code) {
        const token = await exchangeCodeForToken(result.params.code, verifier);
        await setDriveToken(token);
        Alert.alert("Google Drive Connected", "Your Drive account is now linked.");
      } else if (result.type === "cancel" || result.type === "dismiss") {
        // User cancelled — no-op
      } else {
        Alert.alert("Error", "Could not connect to Google Drive.");
      }
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
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => setDriveToken(null),
        },
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>Signed in as</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{user?.email ?? "—"}</Text>
        </View>
        <TouchableOpacity style={[styles.card, styles.danger]} onPress={handleSignOut}>
          <Text style={styles.dangerText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Google Drive */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>GOOGLE DRIVE SYNC</Text>
        <View style={styles.card}>
          <View style={styles.driveRow}>
            <View style={styles.driveInfo}>
              <Text style={styles.rowLabel}>Status</Text>
              <Text style={[styles.rowValue, driveToken ? styles.connected : styles.disconnected]}>
                {driveToken ? "Connected" : "Not connected"}
              </Text>
            </View>
            {driveToken ? (
              <TouchableOpacity style={styles.smallBtn} onPress={disconnectDrive}>
                <Text style={styles.smallBtnText}>Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.smallBtn, styles.primaryBtn]}
                onPress={connectDrive}
                disabled={connectingDrive}
              >
                {connectingDrive ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.smallBtnText, { color: "#fff" }]}>Connect</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.hint}>
          Connect Google Drive to download audio files synced from the Reprise desktop app.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { paddingBottom: 40 },
  header: {
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#0F172A" },
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "#94A3B8",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  rowLabel: { fontSize: 11.5, color: "#64748B", marginBottom: 2 },
  rowValue: { fontSize: 13.5, fontWeight: "500", color: "#0F172A" },
  danger: { alignItems: "center" },
  dangerText: { fontSize: 14, fontWeight: "600", color: "#EF4444" },
  driveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  driveInfo: { flex: 1 },
  connected: { color: "#16A34A" },
  disconnected: { color: "#94A3B8" },
  smallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  primaryBtn: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },
  smallBtnText: { fontSize: 12.5, fontWeight: "600", color: "#475569" },
  hint: { fontSize: 11.5, color: "#94A3B8", lineHeight: 17, marginTop: 4, paddingHorizontal: 4 },
});
