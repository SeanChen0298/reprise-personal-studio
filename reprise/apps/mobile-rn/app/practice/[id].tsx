import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Audio, type AVPlaybackStatus } from "expo-av";
import type { Song, Line } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore } from "../../src/stores/song-files-store";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Furigana renderer ────────────────────────────────────────────────────────

interface RubySegment {
  base: string;
  rt?: string;
}

function parseRubyHtml(html: string): RubySegment[] {
  const segments: RubySegment[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) segments.push({ base: html.slice(last, m.index) });
    segments.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < html.length) segments.push({ base: html.slice(last) });
  return segments;
}

function RubyText({ html, baseFontSize = 14, active = false }: { html: string; baseFontSize?: number; active?: boolean }) {
  const segments = parseRubyHtml(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" }}>
      {segments.map((seg, i) =>
        seg.rt ? (
          <View key={i} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: baseFontSize * 0.5, color: active ? "#93C5FD" : "#94A3B8" }}>
              {seg.rt}
            </Text>
            <Text style={{ fontSize: baseFontSize, color: active ? "#fff" : "#475569", fontWeight: active ? "600" : "400" }}>
              {seg.base}
            </Text>
          </View>
        ) : (
          <Text key={i} style={{ fontSize: baseFontSize, color: active ? "#fff" : "#475569", fontWeight: active ? "600" : "400" }}>
            {seg.base}
          </Text>
        )
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PracticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [song, setSong] = useState<Song | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const localFiles = useSongFilesStore((s) => s.getLocalFiles(id ?? ""));

  // ── Load song & lines ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchSong(id), fetchLines(id)])
      .then(([s, l]) => { setSong(s); setLines(l); })
      .finally(() => setLoading(false));
  }, [id]);

  // ── Load audio ────────────────────────────────────────────────────────────

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis);
    setDurationMs(status.durationMillis ?? 0);
    setIsPlaying(status.isPlaying);
  }, []);

  useEffect(() => {
    if (!localFiles.audioPath) return;
    let sound: Audio.Sound | null = null;

    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: localFiles.audioPath! },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onPlaybackStatusUpdate
        );
        sound = s;
        soundRef.current = s;
        setAudioReady(true);
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : "Failed to load audio");
      }
    };

    load();
    return () => {
      sound?.unloadAsync();
      soundRef.current = null;
      setAudioReady(false);
    };
  }, [localFiles.audioPath, onPlaybackStatusUpdate]);

  // ── Auto-advance current line based on playback position ─────────────────

  useEffect(() => {
    if (!lines.length || !isPlaying) return;
    const timed = lines.filter((l) => l.start_ms != null && l.end_ms != null);
    if (!timed.length) return;
    const active = timed.findIndex((l) => positionMs >= l.start_ms! && positionMs < l.end_ms!);
    if (active !== -1) {
      setCurrentIndex(lines.indexOf(timed[active]));
    }
  }, [positionMs, lines, isPlaying]);

  // ── Line loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    loopTimerRef.current = null;
    if (!isLooping || !isPlaying || !soundRef.current) return;
    const line = lines[currentIndex];
    if (!line?.start_ms || !line?.end_ms) return;
    const remaining = line.end_ms - positionMs;
    if (remaining <= 0) return;
    loopTimerRef.current = setTimeout(async () => {
      if (soundRef.current && isLooping) await soundRef.current.setPositionAsync(line.start_ms!);
    }, remaining);
    return () => { if (loopTimerRef.current) clearTimeout(loopTimerRef.current); };
  }, [isLooping, isPlaying, currentIndex, positionMs, lines]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    };
  }, []);

  // ── Controls ──────────────────────────────────────────────────────────────

  const togglePlay = async () => {
    if (!soundRef.current) return;
    if (isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  };

  const seekToLine = async (index: number) => {
    const line = lines[index];
    if (!line) return;
    setCurrentIndex(index);
    if (soundRef.current && line.start_ms != null) {
      await soundRef.current.setPositionAsync(line.start_ms);
      if (!isPlaying) await soundRef.current.playAsync();
    }
  };

  const formatMs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color="#3B82F6" /></View>;
  }

  if (!song) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Song not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.textBtn}>
          <Text style={s.textBtnLabel}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasAudio = !!localFiles.audioPath;
  const progressPct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;
  const currentLine = lines[currentIndex];

  return (
    <View style={s.container}>
      {/* Top bar */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backTouch}>
          <Text style={s.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={s.topCenter}>
          <Text style={s.topTitle} numberOfLines={1}>{song.title}</Text>
          <Text style={s.topArtist} numberOfLines={1}>{song.artist}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setIsLooping((v) => !v)}
          style={[s.loopBtn, isLooping && s.loopBtnActive]}
        >
          <Text style={[s.loopBtnText, isLooping && s.loopBtnTextActive]}>⟲</Text>
        </TouchableOpacity>
      </View>

      {/* No audio */}
      {!hasAudio && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No audio downloaded</Text>
          <Text style={s.emptySub}>
            {song.drive_audio_file_id
              ? "Go to Song Detail to download audio from Google Drive."
              : "Sync this song from the desktop app first."}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={s.goBackBtn}>
            <Text style={s.goBackBtnText}>Go to Song Detail</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Audio error */}
      {hasAudio && audioError && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>Playback error</Text>
          <Text style={s.emptySub}>{audioError}</Text>
        </View>
      )}

      {/* Player UI */}
      {hasAudio && !audioError && (
        <>
          {/* Current line (large) */}
          <View style={s.bigLine}>
            {currentLine ? (
              currentLine.furigana_html ? (
                <RubyText html={currentLine.furigana_html} baseFontSize={26} active={false} />
              ) : (
                <Text style={s.bigLineText}>{currentLine.custom_text ?? currentLine.text}</Text>
              )
            ) : (
              <Text style={s.noLinesText}>No lyrics loaded.</Text>
            )}
            {lines.length > 0 && (
              <Text style={s.lineCounter}>{currentIndex + 1} / {lines.length}</Text>
            )}
          </View>

          {/* Scrollable lyrics list */}
          <ScrollView ref={scrollRef} style={s.lyricsList} contentContainerStyle={s.lyricsContent}>
            {lines.map((line, i) => (
              <TouchableOpacity
                key={line.id}
                onPress={() => seekToLine(i)}
                style={[s.lyricRow, i === currentIndex && s.lyricRowActive]}
                activeOpacity={0.6}
              >
                {line.furigana_html ? (
                  <RubyText html={line.furigana_html} baseFontSize={14} active={i === currentIndex} />
                ) : (
                  <Text style={[s.lyricText, i === currentIndex && s.lyricTextActive]}>
                    {line.custom_text ?? line.text}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Progress bar */}
          <View style={s.progressWrap}>
            <Text style={s.timeLabel}>{formatMs(positionMs)}</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${progressPct}%` as any }]} />
            </View>
            <Text style={s.timeLabel}>{formatMs(durationMs)}</Text>
          </View>

          {/* Controls */}
          <View style={s.controls}>
            <TouchableOpacity style={s.navBtn} onPress={() => seekToLine(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}>
              <Text style={[s.navBtnText, currentIndex === 0 && s.dimmed]}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.playBtn, !audioReady && s.playBtnLoading]} onPress={togglePlay} disabled={!audioReady} activeOpacity={0.8}>
              {!audioReady
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.navBtn} onPress={() => seekToLine(Math.min(lines.length - 1, currentIndex + 1))} disabled={currentIndex === lines.length - 1}>
              <Text style={[s.navBtnText, currentIndex === lines.length - 1 && s.dimmed]}>⏭</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 14, color: "#64748B" },
  textBtn: { padding: 8 },
  textBtnLabel: { fontSize: 14, color: "#3B82F6" },

  topBar: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", gap: 10,
  },
  backTouch: { padding: 4 },
  backArrow: { fontSize: 28, color: "#3B82F6", lineHeight: 32 },
  topCenter: { flex: 1 },
  topTitle: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  topArtist: { fontSize: 12, color: "#64748B", marginTop: 1 },
  loopBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1.5, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center" },
  loopBtnActive: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  loopBtnText: { fontSize: 18, color: "#94A3B8" },
  loopBtnTextActive: { color: "#3B82F6" },

  emptyCard: {
    margin: 20, padding: 24, backgroundColor: "#fff", borderRadius: 16,
    alignItems: "center", borderWidth: 1.5, borderColor: "#E2E8F0",
  },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: "#475569", marginBottom: 6 },
  emptySub: { fontSize: 13, color: "#94A3B8", textAlign: "center", lineHeight: 20 },
  goBackBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#3B82F6", borderRadius: 8 },
  goBackBtnText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  bigLine: {
    minHeight: SCREEN_HEIGHT * 0.18,
    justifyContent: "center", alignItems: "center",
    paddingHorizontal: 24, paddingVertical: 20,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0",
  },
  bigLineText: { fontSize: 26, fontWeight: "600", color: "#0F172A", textAlign: "center", lineHeight: 36 },
  noLinesText: { fontSize: 15, color: "#94A3B8" },
  lineCounter: { fontSize: 11, color: "#94A3B8", marginTop: 10 },

  lyricsList: { flex: 1 },
  lyricsContent: { paddingVertical: 8, paddingHorizontal: 16 },
  lyricRow: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginVertical: 2 },
  lyricRowActive: { backgroundColor: "#1D4ED8" },
  lyricText: { fontSize: 14, color: "#475569", lineHeight: 22 },
  lyricTextActive: { color: "#fff", fontWeight: "600" },

  progressWrap: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E2E8F0",
  },
  timeLabel: { fontSize: 11, color: "#94A3B8", width: 36, textAlign: "center" },
  progressTrack: { flex: 1, height: 3, backgroundColor: "#E2E8F0", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#3B82F6" },

  controls: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32, paddingTop: 12, paddingBottom: 32, gap: 32,
    backgroundColor: "#fff",
  },
  navBtn: { padding: 8 },
  navBtnText: { fontSize: 28, color: "#475569" },
  dimmed: { opacity: 0.25 },
  playBtn: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: "#3B82F6",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#3B82F6", shadowOpacity: 0.35, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  playBtnLoading: { backgroundColor: "#93C5FD" },
  playBtnText: { fontSize: 26, color: "#fff" },
});
