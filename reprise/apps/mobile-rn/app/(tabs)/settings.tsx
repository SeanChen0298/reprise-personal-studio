import { useMemo, useState } from "react";
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
  Modal,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useAuthStore } from "../../src/stores/auth-store";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { buildDriveAuthUrl } from "../../src/lib/google-drive-download";
import { useTheme, isDark, ACCENT_DOT } from "../../src/lib/theme";
import { usePreferencesStore, type ThemeMode, type AccentKey } from "../../src/stores/preferences-store";

const ACCENT_OPTIONS: { key: AccentKey; label: string }[] = [
  { key: "blue",     label: "Blue"     },
  { key: "violet",   label: "Violet"   },
  { key: "emerald",  label: "Emerald"  },
  { key: "red",      label: "Red"      },
  { key: "amber",    label: "Amber"    },
  { key: "midnight", label: "Midnight" },
];

export default function SettingsScreen() {
  const C = useTheme();
  const st = useMemo(() => makeStyles(C), [C]);

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const driveToken      = useSongFilesStore((s) => s.driveToken);
  const setDriveToken   = useSongFilesStore((s) => s.setDriveToken);
  const autoDownload        = useSongFilesStore((s) => s.autoDownload);
  const setAutoDownload     = useSongFilesStore((s) => s.setAutoDownload);
  const autoDownloadStems   = useSongFilesStore((s) => s.autoDownloadStems);
  const setAutoDownloadStems = useSongFilesStore((s) => s.setAutoDownloadStems);
  const localFiles      = useSongFilesStore((s) => s.localFiles);
  const themeMode    = usePreferencesStore((s) => s.themeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const accentKey    = usePreferencesStore((s) => s.accentKey);
  const setAccentKey = usePreferencesStore((s) => s.setAccentKey);

  const [connectingDrive, setConnectingDrive] = useState(false);
  const [storageVisible, setStorageVisible] = useState(false);

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

  const storageEntries = Object.entries(localFiles);

  return (
    <>
      <StatusBar style={isDark(C) ? "light" : "dark"} />
      <ScrollView style={st.container} contentContainerStyle={st.content}>
        <View style={st.header}>
          <Text style={st.headerTitle}>Settings</Text>
        </View>

        {/* ── Appearance ─────────────────────────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionLabel}>APPEARANCE</Text>
          <View style={st.card}>
            {/* Light / System / Dark */}
            <Text style={st.rowLabel}>Theme</Text>
            <View style={st.segmented}>
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

            {/* Accent color */}
            <Text style={[st.rowLabel, { marginTop: 18 }]}>Accent color</Text>
            <View style={st.accentRow}>
              {ACCENT_OPTIONS.map(({ key, label }) => {
                const active = accentKey === key;
                return (
                  <Pressable key={key} onPress={() => setAccentKey(key)} style={st.accentItem}>
                    <View style={[
                      st.accentDot,
                      { backgroundColor: ACCENT_DOT[key] },
                      active && { borderWidth: 2.5, borderColor: C.text },
                    ]}>
                      {active && <View style={st.accentInner} />}
                    </View>
                    <Text style={[st.accentLabel, { color: active ? C.text : C.muted }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Account ────────────────────────────────────────────── */}
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

        {/* ── Google Drive ───────────────────────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionLabel}>GOOGLE DRIVE SYNC</Text>
          <View style={st.card}>
            <View style={st.driveRow}>
              <View style={st.driveInfo}>
                <Text style={st.rowLabel}>Status</Text>
                <Text style={[st.rowValue, driveToken ? st.connected : { color: C.muted }]}>
                  {driveToken ? "Connected" : "Not connected"}
                </Text>
              </View>
              {driveToken ? (
                <TouchableOpacity style={st.smallBtnOutline} onPress={disconnectDrive} activeOpacity={0.7}>
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
          <Text style={st.hint}>
            Connect Google Drive to download audio files synced from the Reprise desktop app.
          </Text>

          {driveToken && (
            <>
              <View style={[st.card, st.toggleRow]}>
                <View style={st.toggleInfo}>
                  <Text style={st.rowValue}>Auto-download</Text>
                  <Text style={st.rowLabel}>Download new songs automatically on open</Text>
                </View>
                <Switch
                  value={autoDownload}
                  onValueChange={setAutoDownload}
                  trackColor={{ false: C.border, true: C.theme }}
                  thumbColor="#fff"
                />
              </View>
              {autoDownload && (
                <View style={[st.card, st.toggleRow, { marginTop: -4 }]}>
                  <View style={st.toggleInfo}>
                    <Text style={st.rowValue}>Include stems</Text>
                    <Text style={st.rowLabel}>Also download vocal and instrumental tracks</Text>
                  </View>
                  <Switch
                    value={autoDownloadStems}
                    onValueChange={setAutoDownloadStems}
                    trackColor={{ false: C.border, true: C.theme }}
                    thumbColor="#fff"
                  />
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Local Storage ──────────────────────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionLabel}>LOCAL STORAGE</Text>
          <TouchableOpacity style={st.card} onPress={() => setStorageVisible(true)} activeOpacity={0.7}>
            <View style={st.driveRow}>
              <View style={st.driveInfo}>
                <Text style={st.rowValue}>Stored song files</Text>
                <Text style={st.rowLabel}>
                  {storageEntries.length === 0
                    ? "No files downloaded"
                    : `${storageEntries.length} song${storageEntries.length !== 1 ? "s" : ""} with local data`}
                </Text>
              </View>
              <Text style={[st.chevron, { color: C.muted }]}>›</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Storage modal ──────────────────────────────────────────── */}
      <Modal visible={storageVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setStorageVisible(false)}>
        <View style={[st.modalContainer, { backgroundColor: C.bg }]}>
          <View style={[st.modalHeader, { borderBottomColor: C.border }]}>
            <Text style={[st.modalTitle, { color: C.text }]}>Local Storage</Text>
            <Pressable onPress={() => setStorageVisible(false)} style={st.modalClose} android_ripple={{ color: "rgba(0,0,0,0.08)" }}>
              <Text style={[st.modalCloseText, { color: C.theme }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView style={st.modalScroll} contentContainerStyle={st.modalContent}>
            {storageEntries.length === 0 ? (
              <Text style={[st.emptyText, { color: C.muted }]}>No downloaded files.</Text>
            ) : (
              storageEntries.map(([songId, files]) => (
                <View key={songId} style={[st.storageCard, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Text style={[st.storageId, { color: C.muted }]} numberOfLines={1}>
                    {songId}
                  </Text>
                  <View style={st.fileRow}>
                    <FileBadge label="Audio"  present={!!files.audioPath}  C={C} />
                    <FileBadge label="Vocals" present={!!files.vocalsPath} C={C} />
                    <FileBadge label="Instr"  present={!!files.instrPath}  C={C} />
                  </View>
                  {files.driveAudioFileId && (
                    <Text style={[st.driveIdText, { color: C.muted }]} numberOfLines={1}>
                      Drive audio: {files.driveAudioFileId}
                    </Text>
                  )}
                  {files.driveVocalsFileId && (
                    <Text style={[st.driveIdText, { color: C.muted }]} numberOfLines={1}>
                      Drive vocals: {files.driveVocalsFileId}
                    </Text>
                  )}
                  {files.driveInstrFileId && (
                    <Text style={[st.driveIdText, { color: C.muted }]} numberOfLines={1}>
                      Drive instr: {files.driveInstrFileId}
                    </Text>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function FileBadge({ label, present, C }: { label: string; present: boolean; C: ReturnType<typeof useTheme> }) {
  return (
    <View style={[
      fileBadgeSt.badge,
      { backgroundColor: present ? C.theme + "22" : C.border, borderColor: present ? C.theme + "55" : "transparent" },
    ]}>
      <Text style={[fileBadgeSt.text, { color: present ? C.theme : C.muted }]}>
        {present ? "✓ " : "— "}{label}
      </Text>
    </View>
  );
}

const fileBadgeSt = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, marginRight: 6 },
  text:  { fontSize: 11, fontWeight: "500" },
});

import type { ThemeColors } from "../../src/lib/theme";

function makeStyles(C: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    content:   { paddingBottom: 48 },
    header: {
      paddingTop: 56,
      paddingBottom: 16,
      paddingHorizontal: 20,
      backgroundColor: C.bg,
    },
    headerTitle: { fontSize: 24, fontWeight: "600", letterSpacing: -0.3, color: C.text },

    section:      { marginTop: 28, paddingHorizontal: 16 },
    sectionLabel: {
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 1.2,
      marginBottom: 10,
      color: C.muted,
    },

    card: {
      borderRadius: 12,
      padding: 16,
      marginBottom: 8,
      backgroundColor: C.surface,
      shadowColor: "#000",
      shadowOpacity: 0.04,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    dangerCard:   { alignItems: "center" },
    rowLabel:     { fontSize: 11, marginBottom: 3, color: C.muted },
    rowValue:     { fontSize: 14, fontWeight: "500", color: C.text },
    dangerText:   { fontSize: 14, fontWeight: "500", color: "#EF4444" },
    connected:    { color: "#16A34A" },
    chevron:      { fontSize: 22, fontWeight: "300" },

    // Segmented
    segmented: {
      flexDirection: "row",
      borderRadius: 10,
      borderWidth: 0.5,
      borderColor: C.border,
      backgroundColor: C.bg,
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

    // Accent picker
    accentRow:  { flexDirection: "row", marginTop: 12, gap: 16 },
    accentItem: { alignItems: "center", gap: 4 },
    accentDot:  { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center" },
    accentInner:{ width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.6)" },
    accentLabel:{ fontSize: 10, fontWeight: "500" },

    driveRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    driveInfo: { flex: 1 },

    smallBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
    },
    smallBtnOutline: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.bg,
    },
    smallBtnText: { fontSize: 13, fontWeight: "500" },

    hint: {
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
      paddingHorizontal: 4,
      color: C.muted,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleInfo: { flex: 1, marginRight: 12 },

    // Modal
    modalContainer: { flex: 1 },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modalTitle:     { fontSize: 17, fontWeight: "600", color: C.text },
    modalClose:     { padding: 4 },
    modalCloseText: { fontSize: 16, fontWeight: "500" },
    modalScroll:    { flex: 1 },
    modalContent:   { padding: 16, gap: 10 },
    emptyText:      { fontSize: 14, textAlign: "center", marginTop: 40 },

    storageCard: {
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12,
      gap: 8,
    },
    storageId:    { fontSize: 10, fontFamily: "monospace" },
    fileRow:      { flexDirection: "row" },
    driveIdText:  { fontSize: 10, fontFamily: "monospace" },
  });
}
