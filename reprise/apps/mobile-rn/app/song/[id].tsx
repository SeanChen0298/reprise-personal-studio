import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
import type { Song, Line, LineStatus, Annotation } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore, getValidDriveToken } from "../../src/stores/song-files-store";
import {
  downloadDriveFile,
  localFileExists,
  localPathForFile,
  type DownloadProgress,
} from "../../src/lib/google-drive-download";
import { AnnotatedText } from "../../src/components/annotated-text";
import { C } from "../../src/lib/theme";
import { IconChevronLeft, IconMusic, IconDownload, IconPlay } from "../../src/components/icons";

// ─── Types ────────────────────────────────────────────────────────────────────

type DownloadState = "idle" | "checking" | "downloading" | "done" | "error";

interface FileDownloadStatus {
  state: DownloadState;
  progress: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  return formatMs(ms);
}

// ─── Furigana parser + renderer ───────────────────────────────────────────────

interface FuriganaPart {
  base: string;
  reading?: string;
}

function parseFurigana(html: string): FuriganaPart[] {
  const parts: FuriganaPart[] = [];
  const regex = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(html)) !== null) {
    if (m.index > lastIdx) {
      const plain = html.slice(lastIdx, m.index).replace(/<[^>]+>/g, "");
      if (plain) parts.push({ base: plain });
    }
    parts.push({ base: m[1], reading: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < html.length) {
    const plain = html.slice(lastIdx).replace(/<[^>]+>/g, "");
    if (plain) parts.push({ base: plain });
  }
  return parts;
}

function FuriganaText({ html, fontSize = 15 }: { html: string; fontSize?: number }) {
  const parts = parseFurigana(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
      {parts.map((p, i) =>
        p.reading ? (
          <View key={i} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: Math.round(fontSize * 0.55), color: C.muted, lineHeight: Math.round(fontSize * 0.7) }}>
              {p.reading}
            </Text>
            <Text style={{ fontSize, color: C.text }}>{p.base}</Text>
          </View>
        ) : (
          <Text key={i} style={{ fontSize, color: C.text, lineHeight: fontSize * 1.6 }}>
            {p.base}
          </Text>
        )
      )}
    </View>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<LineStatus, { label: string; color: string; bg: string }> = {
  new:           { label: "New",       color: "#6B7280", bg: "#F3F4F6" },
  listened:      { label: "Listened",  color: "#3B82F6", bg: "#EFF6FF" },
  annotated:     { label: "Noted",     color: "#D97706", bg: "#FFFBEB" },
  practiced:     { label: "Practiced", color: "#F97316", bg: "#FFF7ED" },
  recorded:      { label: "Recorded",  color: "#16A34A", bg: "#F0FDF4" },
  best_take_set: { label: "Best Take", color: "#CA8A04", bg: "#FEFCE8" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as LineStatus] ?? STATUS_CONFIG.new;
  return (
    <View style={[ll.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[ll.pillText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

// ─── Single lyrics line ───────────────────────────────────────────────────────

function LyricsLine({ line, translation }: { line: Line; translation?: string }) {
  const displayText = line.custom_text ?? line.text;
  const hasFurigana  = !!line.furigana_html;
  const hasAnnotations = !!(line.annotations && (line.annotations as Annotation[]).length > 0);

  return (
    <View style={ll.container}>
      {/* Timestamp + status row */}
      <View style={ll.metaRow}>
        <Text style={ll.timestamp}>
          {line.start_ms != null ? formatMs(line.start_ms) : "—:——"}
        </Text>
        <StatusPill status={line.status} />
      </View>

      {/* Lyrics text */}
      {hasFurigana ? (
        <FuriganaText html={line.furigana_html!} fontSize={15} />
      ) : hasAnnotations ? (
        <AnnotatedText
          text={displayText}
          annotations={line.annotations as Annotation[]}
          fontSize={15}
          color={C.text}
        />
      ) : (
        <Text style={ll.text}>{displayText}</Text>
      )}

      {/* Translation sub-text */}
      {translation && (
        <Text style={ll.translation}>{translation}</Text>
      )}
    </View>
  );
}

const ll = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  metaRow:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  timestamp: { fontSize: 11, color: C.muted, fontVariant: ["tabular-nums"], width: 36 },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillText:    { fontSize: 10, fontWeight: "600" },
  text:        { fontSize: 15, color: C.text, lineHeight: 22 },
  translation: { fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 18, fontStyle: "italic" },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SongDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  const localFiles   = useSongFilesStore(useShallow((s) => s.getLocalFiles(id ?? "")));
  const setLocalFiles = useSongFilesStore((s) => s.setLocalFiles);
  const driveToken    = useSongFilesStore((s) => s.driveToken);

  const [audioStatus,  setAudioStatus]  = useState<FileDownloadStatus>({ state: "idle", progress: 0 });
  const [vocalsStatus, setVocalsStatus] = useState<FileDownloadStatus>({ state: "idle", progress: 0 });
  const [instrStatus,  setInstrStatus]  = useState<FileDownloadStatus>({ state: "idle", progress: 0 });

  // ── Fetch data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchSong(id), fetchLines(id)])
      .then(([s, l]) => { setSong(s); setLines(l); })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Check local file existence ──────────────────────────────────────────────

  useEffect(() => {
    if (!id || !song) return;

    const checkFile = async (path: string | undefined, setter: (s: FileDownloadStatus) => void) => {
      if (!path) return;
      const exists = await localFileExists(path);
      setter({ state: exists ? "done" : "idle", progress: exists ? 100 : 0 });
    };

    const audioPath  = localFiles.audioPath  ?? localPathForFile(id, "audio.m4a");
    const vocalsPath = localFiles.vocalsPath  ?? localPathForFile(id, "vocals.wav");
    const instrPath  = localFiles.instrPath   ?? localPathForFile(id, "no_vocals.wav");

    checkFile(audioPath, setAudioStatus);
    if (song.drive_vocals_file_id)       checkFile(vocalsPath, setVocalsStatus);
    if (song.drive_instrumental_file_id) checkFile(instrPath,  setInstrStatus);
  }, [id, song, localFiles]);

  // ── Download helpers ────────────────────────────────────────────────────────

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
        await downloadDriveFile(fileId, destPath, accessToken, (p: DownloadProgress) => {
          const pct = p.totalBytesExpected > 0
            ? Math.round((p.bytesWritten / p.totalBytesExpected) * 100)
            : 0;
          setter({ state: "downloading", progress: pct });
        });
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

  const downloadAll = useCallback(async () => {
    if (!song || !driveToken) {
      Alert.alert("Drive Not Connected", "Connect Google Drive in Settings to download audio files.");
      return;
    }
    const tasks: Promise<void>[] = [];
    if (song.drive_audio_file_id && audioStatus.state !== "done")
      tasks.push(downloadFile(song.drive_audio_file_id, "audio.m4a", "audioPath", setAudioStatus));
    if (song.drive_vocals_file_id && vocalsStatus.state !== "done")
      tasks.push(downloadFile(song.drive_vocals_file_id, "vocals.wav", "vocalsPath", setVocalsStatus));
    if (song.drive_instrumental_file_id && instrStatus.state !== "done")
      tasks.push(downloadFile(song.drive_instrumental_file_id, "no_vocals.wav", "instrPath", setInstrStatus));
    await Promise.allSettled(tasks);
  }, [song, driveToken, audioStatus, vocalsStatus, instrStatus, downloadFile]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const { primaryLines, translationByOrder } = useMemo(() => {
    const transLang = song?.translation_language;
    const primary = transLang
      ? lines.filter((l) => !l.language || l.language !== transLang)
      : lines;
    const transMap = new Map<number, string>();
    if (transLang) {
      lines
        .filter((l) => l.language === transLang)
        .forEach((l) => transMap.set(l.order, l.custom_text ?? l.text));
    }
    return { primaryLines: primary, translationByOrder: transMap };
  }, [lines, song]);

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.theme} />
      </View>
    );
  }

  if (!song) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Song not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasDriveFiles =
    !!song.drive_audio_file_id ||
    !!song.drive_vocals_file_id ||
    !!song.drive_instrumental_file_id;

  const allDownloaded =
    (!song.drive_audio_file_id       || audioStatus.state  === "done") &&
    (!song.drive_vocals_file_id      || vocalsStatus.state === "done") &&
    (!song.drive_instrumental_file_id || instrStatus.state  === "done");

  const isDownloading =
    audioStatus.state  === "downloading" ||
    vocalsStatus.state === "downloading" ||
    instrStatus.state  === "downloading";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back button */}
      <TouchableOpacity style={styles.headerBack} onPress={() => router.back()} activeOpacity={0.6}>
        <IconChevronLeft size={22} color={C.theme} />
        <Text style={styles.backLabel}>Library</Text>
      </TouchableOpacity>

      {/* Song header */}
      <View style={styles.songHeader}>
        <View style={styles.thumb}>
          {song.thumbnail_url ? (
            <Image source={{ uri: song.thumbnail_url }} style={styles.thumbImg} />
          ) : (
            <View style={styles.thumbPlaceholder}>
              <IconMusic size={32} color={C.muted} />
            </View>
          )}
        </View>

        <Text style={styles.songTitle}>{song.title}</Text>
        <Text style={styles.songArtist}>{song.artist}</Text>

        {/* Meta badges row */}
        <View style={styles.metaBadgeRow}>
          {song.bpm ? (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{song.bpm} BPM</Text>
            </View>
          ) : null}
          {song.duration_ms ? (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{formatDuration(song.duration_ms)}</Text>
            </View>
          ) : null}
          {song.language ? (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{song.language.toUpperCase()}</Text>
            </View>
          ) : null}
          {primaryLines.length > 0 ? (
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{primaryLines.length} lines</Text>
            </View>
          ) : null}
        </View>

        {/* Mastery progress bar */}
        <View style={styles.masterySection}>
          <View style={styles.masteryLabelRow}>
            <Text style={styles.masteryLabel}>Mastery</Text>
            <Text style={styles.masteryPct}>{song.mastery}%</Text>
          </View>
          <View style={styles.masteryTrack}>
            <View style={[styles.masteryFill, { width: `${song.mastery}%` as unknown as number }]} />
          </View>
        </View>
      </View>

      {/* Audio files section */}
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
                    ? () => downloadFile(song.drive_audio_file_id!, "audio.m4a", "audioPath", setAudioStatus)
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
                    ? () => downloadFile(song.drive_vocals_file_id!, "vocals.wav", "vocalsPath", setVocalsStatus)
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
                    ? () => downloadFile(song.drive_instrumental_file_id!, "no_vocals.wav", "instrPath", setInstrStatus)
                    : undefined
                }
              />
            )}
          </View>

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
              <Text style={styles.allDoneText}>All audio files on device</Text>
            </View>
          )}

          {!driveToken && hasDriveFiles && (
            <Text style={styles.hint}>
              Connect Google Drive in Settings to download audio files.
            </Text>
          )}
        </View>
      )}

      {!hasDriveFiles && (
        <View style={styles.section}>
          <View style={styles.emptyDriveCard}>
            <Text style={styles.emptyDriveTitle}>No audio synced yet</Text>
            <Text style={styles.emptyDriveSubtitle}>
              On the desktop app, go to Song → Audio Setup → Sync to Drive.
            </Text>
          </View>
        </View>
      )}

      {/* Practice button */}
      {(localFiles.audioPath || audioStatus.state === "done") && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.practiceBtn}
            onPress={() => router.push(`/practice/${id}`)}
            activeOpacity={0.85}
          >
            <IconPlay size={16} color="#fff" />
            <Text style={styles.practiceBtnText}>Start Practicing</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Lyrics */}
      {primaryLines.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            LYRICS · {primaryLines.length} LINES
            {translationByOrder.size > 0 ? ` · ${song.translation_language?.toUpperCase() ?? "TL"}` : ""}
          </Text>
          <View style={styles.card}>
            {primaryLines.map((line) => (
              <LyricsLine
                key={line.id}
                line={line}
                translation={translationByOrder.get(line.order)}
              />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ─── FileRow component ────────────────────────────────────────────────────────

function FileRow({
  label, sublabel, status, onDownload,
}: {
  label: string;
  sublabel: string;
  status: FileDownloadStatus;
  onDownload?: () => void;
}) {
  const dotColor =
    status.state === "done"        ? "#16A34A" :
    status.state === "downloading" ? "#F59E0B" :
    status.state === "error"       ? "#EF4444" :
    C.border;

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
            <View style={[fileStyles.progressFill, { width: `${status.progress}%` as unknown as number }]} />
          </View>
        )}
      </View>
      {onDownload && status.state !== "downloading" && (
        <TouchableOpacity style={fileStyles.btn} onPress={onDownload} activeOpacity={0.7}>
          <IconDownload size={18} color={C.theme} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const fileStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, gap: 10 },
  dot:      { width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  info:     { flex: 1 },
  label:    { fontSize: 13.5, fontWeight: "600", color: C.text },
  sublabel: { fontSize: 11.5, color: C.muted, marginTop: 1 },
  progressTrack: { marginTop: 6, height: 2, backgroundColor: C.border, borderRadius: 1, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: C.theme },
  btn: {
    width: 32, height: 32,
    borderRadius: 8,
    backgroundColor: "#EEEEFF",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { paddingBottom: 48 },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: C.bg },
  errorText: { fontSize: 14, color: C.muted },
  backBtn:   { padding: 8 },
  backBtnText: { fontSize: 14, color: C.theme },

  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 4,
  },
  backLabel: { fontSize: 15, color: C.theme },

  // Song header
  songHeader: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 20 },
  thumb: {
    width: 88, height: 88,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%", height: "100%",
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  songTitle:  { fontSize: 20, fontWeight: "700", color: C.text, textAlign: "center" },
  songArtist: { fontSize: 13, color: C.muted, marginTop: 4, textAlign: "center" },

  metaBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  metaBadge: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  metaBadgeText: { fontSize: 11.5, color: C.muted, fontWeight: "500" },

  masterySection: { width: "100%", marginTop: 16 },
  masteryLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  masteryLabel: { fontSize: 12, color: C.muted },
  masteryPct:   { fontSize: 12, color: C.theme, fontWeight: "600" },
  masteryTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  masteryFill: {
    height: "100%",
    backgroundColor: C.theme,
    borderRadius: 2,
  },

  section:      { paddingHorizontal: 16, marginBottom: 20 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: C.muted,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },

  primaryBtn: {
    marginTop: 10,
    backgroundColor: C.theme,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },

  allDoneRow:  { marginTop: 10, alignItems: "center", paddingVertical: 8 },
  allDoneText: { fontSize: 13, color: "#16A34A", fontWeight: "500" },

  hint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 8, paddingHorizontal: 2 },

  emptyDriveCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
  },
  emptyDriveTitle:    { fontSize: 14, fontWeight: "600", color: C.muted, marginBottom: 6 },
  emptyDriveSubtitle: { fontSize: 12.5, color: C.muted, textAlign: "center", lineHeight: 19 },

  practiceBtn: {
    backgroundColor: C.theme,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: C.theme,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  practiceBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
