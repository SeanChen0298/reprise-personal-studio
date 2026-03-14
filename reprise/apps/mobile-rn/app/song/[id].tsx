import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Song, Line } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore, getValidDriveToken } from "../../src/stores/song-files-store";
import {
  downloadDriveFile,
  localFileExists,
  localPathForFile,
  type DownloadProgress,
} from "../../src/lib/google-drive-download";

// ─── Types ────────────────────────────────────────────────────────────────────

type DownloadState = "idle" | "checking" | "downloading" | "done" | "error";

interface FileDownloadStatus {
  state: DownloadState;
  progress: number; // 0–100
  error?: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SongDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  const localFiles = useSongFilesStore((s) => s.getLocalFiles(id ?? ""));
  const setLocalFiles = useSongFilesStore((s) => s.setLocalFiles);
  const driveToken = useSongFilesStore((s) => s.driveToken);

  const [audioStatus, setAudioStatus] = useState<FileDownloadStatus>({ state: "idle", progress: 0 });
  const [vocalsStatus, setVocalsStatus] = useState<FileDownloadStatus>({ state: "idle", progress: 0 });
  const [instrStatus, setInstrStatus] = useState<FileDownloadStatus>({ state: "idle", progress: 0 });

  // ── Load song data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    Promise.all([fetchSong(id), fetchLines(id)])
      .then(([s, l]) => {
        setSong(s);
        setLines(l);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Check which files already exist locally ──────────────────────────────────
  useEffect(() => {
    if (!id || !song) return;

    const checkFile = async (
      path: string | undefined,
      fileName: string,
      setter: (s: FileDownloadStatus) => void
    ) => {
      if (!path) return;
      const exists = await localFileExists(path);
      setter({ state: exists ? "done" : "idle", progress: exists ? 100 : 0 });
    };

    const audioPath = localFiles.audioPath ?? localPathForFile(id, "audio.m4a");
    const vocalsPath = localFiles.vocalsPath ?? localPathForFile(id, "vocals.wav");
    const instrPath = localFiles.instrPath ?? localPathForFile(id, "no_vocals.wav");

    checkFile(audioPath, "audio.m4a", setAudioStatus);
    if (song.drive_vocals_file_id) checkFile(vocalsPath, "vocals.wav", setVocalsStatus);
    if (song.drive_instrumental_file_id) checkFile(instrPath, "no_vocals.wav", setInstrStatus);
  }, [id, song, localFiles]);

  // ── Download a single file ────────────────────────────────────────────────────
  const downloadFile = useCallback(
    async (
      fileId: string,
      fileName: string,
      localKey: "audioPath" | "vocalsPath" | "instrPath",
      setter: (s: FileDownloadStatus) => void
    ) => {
      if (!id) return;
      setter({ state: "downloading", progress: 0 });
      try {
        const accessToken = await getValidDriveToken();
        const destPath = localPathForFile(id, fileName);

        await downloadDriveFile(
          fileId,
          destPath,
          accessToken,
          (p: DownloadProgress) => {
            const pct =
              p.totalBytesExpected > 0
                ? Math.round((p.bytesWritten / p.totalBytesExpected) * 100)
                : 0;
            setter({ state: "downloading", progress: pct });
          }
        );

        await setLocalFiles(id, { [localKey]: destPath });
        setter({ state: "done", progress: 100 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setter({ state: "error", progress: 0, error: msg });
        Alert.alert("Download Failed", msg);
      }
    },
    [id, setLocalFiles]
  );

  // ── Download all available Drive files ───────────────────────────────────────
  const downloadAll = useCallback(async () => {
    if (!song || !driveToken) {
      Alert.alert(
        "Drive Not Connected",
        "Connect Google Drive in Settings to download audio files."
      );
      return;
    }

    const tasks: Promise<void>[] = [];

    if (song.drive_audio_file_id && audioStatus.state !== "done") {
      tasks.push(
        downloadFile(song.drive_audio_file_id, "audio.m4a", "audioPath", setAudioStatus)
      );
    }
    if (song.drive_vocals_file_id && vocalsStatus.state !== "done") {
      tasks.push(
        downloadFile(song.drive_vocals_file_id, "vocals.wav", "vocalsPath", setVocalsStatus)
      );
    }
    if (song.drive_instrumental_file_id && instrStatus.state !== "done") {
      tasks.push(
        downloadFile(song.drive_instrumental_file_id, "no_vocals.wav", "instrPath", setInstrStatus)
      );
    }

    // Run downloads in parallel
    await Promise.allSettled(tasks);
  }, [song, driveToken, audioStatus, vocalsStatus, instrStatus, downloadFile]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (!song) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Song not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasDriveFiles =
    !!song.drive_audio_file_id ||
    !!song.drive_vocals_file_id ||
    !!song.drive_instrumental_file_id;

  const allDownloaded =
    (!song.drive_audio_file_id || audioStatus.state === "done") &&
    (!song.drive_vocals_file_id || vocalsStatus.state === "done") &&
    (!song.drive_instrumental_file_id || instrStatus.state === "done");

  const isDownloading =
    audioStatus.state === "downloading" ||
    vocalsStatus.state === "downloading" ||
    instrStatus.state === "downloading";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back button */}
      <TouchableOpacity style={styles.headerBack} onPress={() => router.back()}>
        <Text style={styles.backArrow}>‹</Text>
        <Text style={styles.backLabel}>Songs</Text>
      </TouchableOpacity>

      {/* Song header */}
      <View style={styles.songHeader}>
        <View style={styles.thumb}>
          {song.thumbnail_url ? (
            <Image source={{ uri: song.thumbnail_url }} style={styles.thumbImg} />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <Text style={{ fontSize: 28 }}>♫</Text>
            </View>
          )}
        </View>
        <Text style={styles.songTitle}>{song.title}</Text>
        <Text style={styles.songArtist}>{song.artist}</Text>
        <View style={styles.masteryBadge}>
          <Text style={styles.masteryText}>{song.mastery}% mastered</Text>
        </View>
      </View>

      {/* Drive sync section */}
      {hasDriveFiles && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AUDIO FILES</Text>

          <View style={styles.card}>
            {song.drive_audio_file_id && (
              <FileRow
                label="audio.m4a"
                sublabel="Reference audio"
                status={audioStatus}
                onDownload={
                  audioStatus.state !== "done"
                    ? () =>
                        downloadFile(
                          song.drive_audio_file_id!,
                          "audio.m4a",
                          "audioPath",
                          setAudioStatus
                        )
                    : undefined
                }
              />
            )}
            {song.drive_vocals_file_id && (
              <FileRow
                label="vocals.wav"
                sublabel="Isolated vocals"
                status={vocalsStatus}
                onDownload={
                  vocalsStatus.state !== "done"
                    ? () =>
                        downloadFile(
                          song.drive_vocals_file_id!,
                          "vocals.wav",
                          "vocalsPath",
                          setVocalsStatus
                        )
                    : undefined
                }
              />
            )}
            {song.drive_instrumental_file_id && (
              <FileRow
                label="no_vocals.wav"
                sublabel="Instrumental track"
                status={instrStatus}
                onDownload={
                  instrStatus.state !== "done"
                    ? () =>
                        downloadFile(
                          song.drive_instrumental_file_id!,
                          "no_vocals.wav",
                          "instrPath",
                          setInstrStatus
                        )
                    : undefined
                }
              />
            )}
          </View>

          {/* Download All / Re-download button */}
          {!allDownloaded && (
            <TouchableOpacity
              style={[styles.primaryBtn, isDownloading && styles.primaryBtnDisabled]}
              onPress={downloadAll}
              disabled={isDownloading}
              activeOpacity={0.8}
            >
              {isDownloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {!driveToken ? "Connect Drive to Download" : "Download from Drive"}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {allDownloaded && (
            <View style={styles.allDoneRow}>
              <Text style={styles.allDoneText}>✓ All audio files downloaded</Text>
            </View>
          )}

          {!driveToken && hasDriveFiles && (
            <Text style={styles.hint}>
              Connect Google Drive in Settings → Google Drive Sync to download audio files.
            </Text>
          )}
        </View>
      )}

      {!hasDriveFiles && (
        <View style={styles.section}>
          <View style={styles.emptyDriveCard}>
            <Text style={styles.emptyDriveTitle}>No audio synced yet</Text>
            <Text style={styles.emptyDriveSubtitle}>
              On the desktop app, go to Song → Audio Setup → Sync to Drive to make audio available here.
            </Text>
          </View>
        </View>
      )}

      {/* Lyrics */}
      {lines.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LYRICS</Text>
          <View style={styles.card}>
            {lines.map((line, i) => (
              <Text key={line.id} style={[styles.lyricLine, i > 0 && styles.lyricLineSep]}>
                {line.custom_text ?? line.text}
              </Text>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── FileRow component ────────────────────────────────────────────────────────

function FileRow({
  label,
  sublabel,
  status,
  onDownload,
}: {
  label: string;
  sublabel: string;
  status: FileDownloadStatus;
  onDownload?: () => void;
}) {
  const dotColor =
    status.state === "done"
      ? "#22C55E"
      : status.state === "downloading"
      ? "#F59E0B"
      : status.state === "error"
      ? "#EF4444"
      : "#CBD5E1";

  return (
    <View style={fileStyles.row}>
      <View style={[fileStyles.dot, { backgroundColor: dotColor }]} />
      <View style={fileStyles.info}>
        <Text style={fileStyles.label}>{label}</Text>
        <Text style={fileStyles.sublabel}>
          {status.state === "downloading"
            ? `Downloading… ${status.progress}%`
            : status.state === "done"
            ? sublabel + " · on device"
            : status.state === "error"
            ? status.error ?? "Download failed"
            : sublabel}
        </Text>
        {status.state === "downloading" && (
          <View style={fileStyles.progressTrack}>
            <View style={[fileStyles.progressFill, { width: `${status.progress}%` }]} />
          </View>
        )}
      </View>
      {onDownload && status.state !== "downloading" && (
        <TouchableOpacity style={fileStyles.btn} onPress={onDownload}>
          <Text style={fileStyles.btnText}>↓</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const fileStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  info: { flex: 1 },
  label: { fontSize: 13.5, fontWeight: "600", color: "#0F172A" },
  sublabel: { fontSize: 11.5, color: "#64748B", marginTop: 1 },
  progressTrack: {
    marginTop: 6,
    height: 3,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#3B82F6" },
  btn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  btnText: { fontSize: 16, color: "#3B82F6", fontWeight: "700" },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 14, color: "#64748B" },
  backBtn: { padding: 8 },
  backBtnText: { fontSize: 14, color: "#3B82F6" },

  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 4,
  },
  backArrow: { fontSize: 24, color: "#3B82F6", lineHeight: 28 },
  backLabel: { fontSize: 15, color: "#3B82F6" },

  songHeader: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 20 },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  songTitle: { fontSize: 22, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  songArtist: { fontSize: 14, color: "#64748B", marginTop: 4, textAlign: "center" },
  masteryBadge: {
    marginTop: 10,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  masteryText: { fontSize: 12.5, color: "#2563EB", fontWeight: "600" },

  section: { paddingHorizontal: 16, marginBottom: 20 },
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
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  primaryBtn: {
    marginTop: 10,
    backgroundColor: "#3B82F6",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 14.5, fontWeight: "600", color: "#fff" },
  allDoneRow: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  allDoneText: { fontSize: 13, color: "#16A34A", fontWeight: "500" },
  hint: { fontSize: 11.5, color: "#94A3B8", lineHeight: 17, marginTop: 8, paddingHorizontal: 2 },

  emptyDriveCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },
  emptyDriveTitle: { fontSize: 14, fontWeight: "600", color: "#475569", marginBottom: 6 },
  emptyDriveSubtitle: {
    fontSize: 12.5,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 19,
  },

  lyricLine: { fontSize: 14, color: "#1E293B", lineHeight: 22 },
  lyricLineSep: { marginTop: 2 },
});
