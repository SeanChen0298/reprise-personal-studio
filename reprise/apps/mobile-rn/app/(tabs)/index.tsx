import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import type { Song } from "@reprise/shared";
import { useAuthStore } from "../../src/stores/auth-store";
import { useSongFilesStore, getValidDriveToken } from "../../src/stores/song-files-store";
import { fetchSongs } from "../../src/lib/supabase";
import {
  downloadDriveFile,
  localFileExists,
  localPathForFile,
} from "../../src/lib/google-drive-download";
import { C } from "../../src/lib/theme";
import { IconMusic, IconChevronRight, IconCheck, IconCloud } from "../../src/components/icons";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DownloadJob {
  songId: string;
  title: string;
  state: "pending" | "downloading" | "done" | "error";
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SongsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const autoDownload  = useSongFilesStore((s) => s.autoDownload);
  const driveToken    = useSongFilesStore((s) => s.driveToken);
  const localFiles    = useSongFilesStore((s) => s.localFiles);   // full map for reactivity
  const setLocalFiles = useSongFilesStore((s) => s.setLocalFiles);

  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);

  const autoDownloadRan = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load songs ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const data = await fetchSongs(user.id);
      data.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
      setSongs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load songs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Auto-download: runs once per session after songs load ───────────────────

  useEffect(() => {
    if (!autoDownload || !driveToken || songs.length === 0 || autoDownloadRan.current) return;
    autoDownloadRan.current = true;

    let cancelled = false;

    (async () => {
      // Determine which songs need downloading
      const toDownload: Song[] = [];
      for (const song of songs) {
        if (!song.drive_audio_file_id) continue;
        const local = useSongFilesStore.getState().localFiles[song.id];
        const destPath = local?.audioPath ?? localPathForFile(song.id, "audio.m4a");
        const exists = local?.audioPath ? await localFileExists(destPath) : false;
        if (!exists) toDownload.push(song);
      }

      if (toDownload.length === 0 || cancelled) return;

      setDownloadJobs(toDownload.map((s) => ({ songId: s.id, title: s.title, state: "pending" })));

      for (const song of toDownload) {
        if (cancelled) break;

        setDownloadJobs((prev) =>
          prev.map((j) => j.songId === song.id ? { ...j, state: "downloading" } : j)
        );

        try {
          const token = await getValidDriveToken();
          const destPath = localPathForFile(song.id, "audio.m4a");
          await downloadDriveFile(song.drive_audio_file_id!, destPath, token);
          await setLocalFiles(song.id, { audioPath: destPath });
          setDownloadJobs((prev) =>
            prev.map((j) => j.songId === song.id ? { ...j, state: "done" } : j)
          );
        } catch {
          if (!cancelled) {
            setDownloadJobs((prev) =>
              prev.map((j) => j.songId === song.id ? { ...j, state: "error" } : j)
            );
          }
        }
      }

      // Auto-dismiss panel 4s after last job completes
      if (!cancelled) {
        dismissTimerRef.current = setTimeout(() => {
          if (!cancelled) setDownloadJobs([]);
        }, 4000);
      }
    })();

    return () => {
      cancelled = true;
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [autoDownload, driveToken, songs, setLocalFiles]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color={C.theme} />
      </View>
    );
  }

  const doneCount = downloadJobs.filter((j) => j.state === "done").length;
  const totalCount = downloadJobs.length;
  const isDownloadingAny = downloadJobs.some((j) => j.state === "downloading");
  const currentJob = downloadJobs.find((j) => j.state === "downloading");

  return (
    <View style={st.container}>
      {/* Header */}
      <View style={st.header}>
        <Text style={st.headerTitle}>Library</Text>
        {songs.length > 0 && (
          <Text style={st.headerCount}>
            {songs.length} {songs.length === 1 ? "song" : "songs"}
          </Text>
        )}
      </View>

      {/* Download queue panel */}
      {downloadJobs.length > 0 && (
        <View style={st.downloadPanel}>
          <TouchableOpacity
            style={st.downloadPanelHeader}
            onPress={() => setDownloadJobs([])}
            activeOpacity={0.7}
          >
            <View style={st.downloadPanelLeft}>
              {isDownloadingAny ? (
                <ActivityIndicator size="small" color={C.theme} style={st.panelSpinner} />
              ) : (
                <View style={[st.panelDot, { backgroundColor: "#16A34A" }]} />
              )}
              <Text style={st.downloadPanelTitle}>
                {isDownloadingAny
                  ? `Downloading · ${currentJob?.title ?? "…"}`
                  : `${doneCount} of ${totalCount} downloaded`}
              </Text>
            </View>
            <Text style={st.downloadPanelDismiss}>Dismiss</Text>
          </TouchableOpacity>

          {downloadJobs.map((job) => (
            <View key={job.songId} style={st.downloadJobRow}>
              <View
                style={[
                  st.jobDot,
                  {
                    backgroundColor:
                      job.state === "done"        ? "#16A34A" :
                      job.state === "downloading" ? C.theme   :
                      job.state === "error"       ? "#EF4444" :
                      C.border,
                  },
                ]}
              />
              <Text style={st.jobTitle} numberOfLines={1}>{job.title}</Text>
              <Text style={[
                st.jobState,
                job.state === "done"  && { color: "#16A34A" },
                job.state === "error" && { color: "#EF4444" },
              ]}>
                {job.state === "done"        ? "Done"
                 : job.state === "downloading" ? "Downloading…"
                 : job.state === "error"       ? "Failed"
                 : "Waiting"}
              </Text>
            </View>
          ))}
        </View>
      )}

      {error && (
        <View style={st.errorBanner}>
          <Text style={st.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={songs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={songs.length === 0 ? st.emptyList : undefined}
        ItemSeparatorComponent={() => <View style={st.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={C.theme}
          />
        }
        ListEmptyComponent={
          <View style={st.emptyContainer}>
            <View style={st.emptyIcon}>
              <IconMusic size={24} color={C.muted} />
            </View>
            <Text style={st.emptyTitle}>No songs yet</Text>
            <Text style={st.emptySubtitle}>
              Add songs on the desktop app, then sync them here via Google Drive.
            </Text>
          </View>
        }
        renderItem={({ item: song }) => {
          const local = localFiles[song.id];
          const hasDrive = !!(
            song.drive_audio_file_id ||
            song.drive_vocals_file_id ||
            song.drive_instrumental_file_id
          );
          const isOnDevice = !!local?.audioPath;

          return (
            <TouchableOpacity
              style={st.row}
              onPress={() => router.push(`/song/${song.id}`)}
              activeOpacity={0.6}
            >
              {/* Thumbnail */}
              <View style={st.thumb}>
                {song.thumbnail_url ? (
                  <Image source={{ uri: song.thumbnail_url }} style={st.thumbImg} />
                ) : (
                  <View style={st.thumbPlaceholder}>
                    <IconMusic size={18} color={C.border} />
                  </View>
                )}
                {song.pinned && <View style={st.pinnedDot} />}
              </View>

              {/* Info */}
              <View style={st.rowBody}>
                <Text style={st.rowTitle} numberOfLines={1}>{song.title}</Text>
                <Text style={st.rowArtist} numberOfLines={1}>{song.artist}</Text>

                {/* Drive / Device badge */}
                {isOnDevice ? (
                  <View style={[st.badge, st.badgeDevice]}>
                    <IconCheck size={9} color="#16A34A" />
                    <Text style={[st.badgeText, { color: "#16A34A" }]}>On device</Text>
                  </View>
                ) : hasDrive ? (
                  <View style={[st.badge, st.badgeDrive]}>
                    <IconCloud size={9} color={C.muted} />
                    <Text style={st.badgeText}>Drive</Text>
                  </View>
                ) : null}
              </View>

              {/* Mastery ring */}
              <MasteryRing value={song.mastery} />

              {/* Chevron */}
              <IconChevronRight size={16} color={C.border} />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

// ─── Mastery ring ─────────────────────────────────────────────────────────────

function MasteryRing({ value }: { value: number }) {
  const size = 26;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: C.theme,
        opacity: Math.max(0.12, (value / 100) * 0.85),
      }}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },

  header: {
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: C.bg,
  },
  headerTitle: { fontSize: 24, fontWeight: "600", color: C.text, letterSpacing: -0.3 },
  headerCount: { fontSize: 13, color: C.muted, marginTop: 2 },

  // Download queue panel
  downloadPanel: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  downloadPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  downloadPanelLeft:    { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  panelSpinner:         { transform: [{ scale: 0.8 }] },
  panelDot:             { width: 7, height: 7, borderRadius: 4 },
  downloadPanelTitle:   { fontSize: 13, fontWeight: "500", color: C.text, flex: 1 },
  downloadPanelDismiss: { fontSize: 12, color: C.muted },
  downloadJobRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  jobDot:   { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  jobTitle: { flex: 1, fontSize: 12.5, color: C.text },
  jobState: { fontSize: 11.5, color: C.muted },

  errorBanner: { margin: 16, padding: 12, backgroundColor: "#FEF2F2", borderRadius: 8 },
  errorText:   { fontSize: 13, color: "#EF4444" },

  separator:      { height: 0.5, backgroundColor: C.border, marginLeft: 76 },
  emptyList:      { flex: 1 },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyIcon: {
    width: 52, height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  emptyTitle:    { fontSize: 15, fontWeight: "500", color: C.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 20 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  thumb:            { width: 48, height: 48, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
  thumbImg:         { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  pinnedDot: {
    position: "absolute",
    top: 3, right: 3,
    width: 5, height: 5,
    borderRadius: 3,
    backgroundColor: C.theme,
    opacity: 0.5,
  },
  rowBody:   { flex: 1, minWidth: 0 },
  rowTitle:  { fontSize: 14, fontWeight: "500", color: C.text },
  rowArtist: { fontSize: 12, color: C.muted, marginTop: 2 },

  badge: {
    marginTop: 5,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeDevice: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  badgeDrive:  { backgroundColor: C.surface,  borderColor: C.border },
  badgeText:   { fontSize: 10, color: C.muted, fontWeight: "500" },
});
