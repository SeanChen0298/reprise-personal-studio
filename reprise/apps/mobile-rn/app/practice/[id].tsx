import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Song, Line } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { useLinePlayer } from "../../src/hooks/use-line-player";
import { AnnotatedText } from "../../src/components/annotated-text";
import { formatMs } from "../../src/lib/line-status-config";
import { C, lineOpacity } from "../../src/lib/theme";
import {
  IconPlay,
  IconPause,
  IconSkipBack,
  IconSkipForward,
  IconRepeat,
  IconChevronLeft,
} from "../../src/components/icons";

type TrackMode = "audio" | "vocals" | "instr";

// ─── Furigana renderer ────────────────────────────────────────────────────────

interface RubySegment { base: string; rt?: string }

function parseRubyHtml(html: string): RubySegment[] {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const segments: RubySegment[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) segments.push({ base: cleaned.slice(last, m.index) });
    segments.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) segments.push({ base: cleaned.slice(last) });
  return segments;
}

function RubyText({ html, baseFontSize = 18 }: { html: string; baseFontSize?: number }) {
  const segments = parseRubyHtml(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
      {segments.map((seg, i) =>
        seg.rt ? (
          <View key={i} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: baseFontSize * 0.5, color: C.muted }}>{seg.rt}</Text>
            <Text style={{ fontSize: baseFontSize, color: C.text }}>{seg.base}</Text>
          </View>
        ) : (
          <Text key={i} style={{ fontSize: baseFontSize, color: C.text }}>{seg.base}</Text>
        )
      )}
    </View>
  );
}

// ─── Track selector ───────────────────────────────────────────────────────────

function TrackBtn({
  label, mode, current, onPress,
}: {
  label: string; mode: TrackMode; current: TrackMode; onPress: (m: TrackMode) => void;
}) {
  const active = mode === current;
  return (
    <TouchableOpacity
      style={[s.trackBtn, active && s.trackBtnActive]}
      onPress={() => onPress(mode)}
      activeOpacity={0.7}
    >
      <Text style={[s.trackBtnText, active && s.trackBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PracticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [song, setSong] = useState<Song | null>(null);
  const [allLines, setAllLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackMode, setTrackMode] = useState<TrackMode>("audio");
  const [showTranslation, setShowTranslation] = useState(false);

  const localFiles = useSongFilesStore(useShallow((s) => s.getLocalFiles(id ?? "")));
  const hasVocals = !!localFiles.vocalsPath;
  const hasInstr = !!localFiles.instrPath;

  const audioPath = useMemo(() => {
    if (trackMode === "vocals" && localFiles.vocalsPath) return localFiles.vocalsPath;
    if (trackMode === "instr" && localFiles.instrPath) return localFiles.instrPath;
    return localFiles.audioPath;
  }, [trackMode, localFiles]);

  const { primaryLines, translationByOrder } = useMemo(() => {
    const translationLang = song?.translation_language;
    const primary = translationLang
      ? allLines.filter((l) => !l.language || l.language !== translationLang)
      : allLines.filter((l) => !l.language);
    const finalPrimary = primary.length > 0 ? primary : allLines;
    const byOrder = new Map<number, string>(
      allLines
        .filter((l) => l.language === translationLang)
        .map((l) => [l.order, l.custom_text ?? l.text])
    );
    return { primaryLines: finalPrimary, translationByOrder: byOrder };
  }, [allLines, song]);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchSong(id), fetchLines(id)])
      .then(([s, lines]) => { setSong(s); setAllLines(lines); })
      .finally(() => setLoading(false));
  }, [id]);

  const player = useLinePlayer({ audioPath, lines: primaryLines });
  const {
    positionMs, durationMs, isPlaying, lineProgress,
    currentLineIndex, loopEnabled, toggleLoop, loopCount, maxLoops,
    cycleMaxLoops, speed, incrementSpeed, decrementSpeed,
    togglePlay, goToLine, nextLine, prevLine, audioReady, audioError,
  } = player;

  // ── Scroll-to-active-line ───────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView>(null);
  const itemYsRef = useRef<Map<number, number>>(new Map());
  const [scrollHeight, setScrollHeight] = useState(400);

  useEffect(() => {
    const y = itemYsRef.current.get(currentLineIndex);
    if (y == null) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - scrollHeight / 2 + 44),
      animated: true,
    });
  }, [currentLineIndex, scrollHeight]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const hasAudio = !!audioPath;
  const overallProgress = durationMs > 0 ? positionMs / durationMs : 0;
  const maxLoopsLabel = maxLoops === 0 ? "∞" : String(maxLoops);
  const speedLabel = `${Math.round(speed * 100)}%`;

  // ── Loading / not-found ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={C.theme} />
      </View>
    );
  }

  if (!song) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Song not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.textBtn}>
          <Text style={s.textBtnLabel}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.container}>

      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backTouch} activeOpacity={0.6}>
          <IconChevronLeft size={24} color={C.text} />
        </TouchableOpacity>

        <View style={s.topCenter}>
          <Text style={s.topTitle} numberOfLines={1}>{song.title}</Text>
          <Text style={s.topArtist} numberOfLines={1}>{song.artist}</Text>
        </View>

        {/* Translation toggle */}
        {translationByOrder.size > 0 && (
          <TouchableOpacity
            onPress={() => setShowTranslation((v) => !v)}
            style={[s.headerBtn, showTranslation && s.headerBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[s.headerBtnText, showTranslation && s.headerBtnTextActive]}>TL</Text>
          </TouchableOpacity>
        )}

        {/* Loop toggle */}
        <TouchableOpacity
          onPress={toggleLoop}
          style={[s.headerBtn, loopEnabled && s.headerBtnActive]}
          activeOpacity={0.7}
        >
          <IconRepeat size={16} color={loopEnabled ? C.theme : C.muted} />
        </TouchableOpacity>

        {loopEnabled && (
          <TouchableOpacity onPress={cycleMaxLoops} style={s.loopBadge} activeOpacity={0.7}>
            <Text style={s.loopBadgeText}>×{maxLoopsLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Track selector ── */}
      {(hasVocals || hasInstr) && (
        <View style={s.trackRow}>
          <TrackBtn label="Full Audio" mode="audio" current={trackMode} onPress={setTrackMode} />
          {hasVocals && <TrackBtn label="Vocals" mode="vocals" current={trackMode} onPress={setTrackMode} />}
          {hasInstr && <TrackBtn label="Instr" mode="instr" current={trackMode} onPress={setTrackMode} />}
        </View>
      )}

      {/* ── No audio ── */}
      {!hasAudio && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No audio downloaded</Text>
          <Text style={s.emptySub}>
            {song.drive_audio_file_id
              ? "Go to Song Detail to download audio from Google Drive."
              : "Sync this song from the desktop app first."}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={s.goBackBtn} activeOpacity={0.8}>
            <Text style={s.goBackBtnText}>Go to Song Detail</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Audio error ── */}
      {hasAudio && audioError && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>Playback error</Text>
          <Text style={s.emptySub}>{audioError}</Text>
        </View>
      )}

      {/* ── Lyrics stream + player ── */}
      {hasAudio && !audioError && (
        <>
          {/* Scrollable lyrics */}
          <ScrollView
            ref={scrollRef}
            style={s.lyricsScroll}
            contentContainerStyle={s.lyricsContent}
            showsVerticalScrollIndicator={false}
            onLayout={(e) => setScrollHeight(e.nativeEvent.layout.height)}
          >
            <View style={{ height: 140 }} />

            {primaryLines.length === 0 ? (
              <View style={{ alignItems: "center", padding: 40 }}>
                <Text style={{ color: C.muted, fontSize: 14 }}>No lyrics added yet.</Text>
              </View>
            ) : (
              primaryLines.map((line, idx) => {
                const isActive = idx === currentLineIndex;
                const opacity = lineOpacity(idx - currentLineIndex);
                const displayText = line.custom_text ?? line.text;
                const translation = translationByOrder.get(line.order);

                return (
                  <Pressable
                    key={line.id}
                    onLayout={(e) => itemYsRef.current.set(idx, e.nativeEvent.layout.y)}
                    onPress={() => goToLine(idx, true)}
                    style={{ opacity, paddingVertical: 10, paddingHorizontal: 28 }}
                    android_ripple={{ color: "rgba(0,0,0,0.04)" }}
                  >
                    {line.furigana_html ? (
                      <RubyText html={line.furigana_html} baseFontSize={18} />
                    ) : line.annotations && line.annotations.length > 0 ? (
                      <AnnotatedText
                        text={displayText}
                        annotations={line.annotations}
                        fontSize={18}
                        color={C.text}
                      />
                    ) : (
                      <Text
                        style={{
                          fontSize: 18,
                          fontWeight: isActive ? "500" : "400",
                          color: C.text,
                          lineHeight: 28,
                          textAlign: "center",
                        }}
                      >
                        {displayText}
                      </Text>
                    )}

                    {isActive && showTranslation && translation && (
                      <Text style={s.translationText}>{translation}</Text>
                    )}
                  </Pressable>
                );
              })
            )}

            <View style={{ height: 140 }} />
          </ScrollView>

          {/* Status strip */}
          <View style={s.statusStrip}>
            {primaryLines.length > 0 && (
              <Text style={s.statusStripText}>
                {currentLineIndex + 1} / {primaryLines.length}
                {loopEnabled && maxLoops > 0 ? `  ·  ${loopCount}/${maxLoops}` : ""}
              </Text>
            )}
          </View>

          {/* Line progress bar */}
          <View style={s.lineProgressWrap}>
            <View style={s.lineProgressTrack}>
              <View style={[s.lineProgressFill, { width: `${lineProgress * 100}%` as any }]} />
            </View>
          </View>

          {/* Overall progress */}
          <View style={s.progressWrap}>
            <Text style={s.timeLabel}>{formatMs(positionMs)}</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${overallProgress * 100}%` as any }]} />
            </View>
            <Text style={s.timeLabel}>{formatMs(durationMs)}</Text>
          </View>

          {/* Controls */}
          <View style={s.controls}>

            {/* Speed row */}
            <View style={s.speedRow}>
              <TouchableOpacity
                style={s.speedBtn}
                onPress={decrementSpeed}
                disabled={speed <= 0.5}
                activeOpacity={0.6}
              >
                <Text style={[s.speedBtnText, speed <= 0.5 && s.dimmed]}>−</Text>
              </TouchableOpacity>

              <View style={s.speedDisplay}>
                <Text style={s.speedText}>{speedLabel}</Text>
              </View>

              <TouchableOpacity
                style={s.speedBtn}
                onPress={incrementSpeed}
                disabled={speed >= 1.0}
                activeOpacity={0.6}
              >
                <Text style={[s.speedBtnText, speed >= 1.0 && s.dimmed]}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Nav row */}
            <View style={s.navRow}>
              <TouchableOpacity
                style={s.navBtn}
                onPress={prevLine}
                disabled={currentLineIndex === 0}
                activeOpacity={0.6}
              >
                <IconSkipBack size={22} color={currentLineIndex === 0 ? C.border : C.text} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.playBtn, !audioReady && s.playBtnLoading]}
                onPress={() => void togglePlay()}
                disabled={!audioReady}
                activeOpacity={0.85}
              >
                {!audioReady ? (
                  <ActivityIndicator size="small" color={C.theme} />
                ) : isPlaying ? (
                  <IconPause size={22} color="#fff" />
                ) : (
                  <IconPlay size={22} color="#fff" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={s.navBtn}
                onPress={nextLine}
                disabled={currentLineIndex >= primaryLines.length - 1}
                activeOpacity={0.6}
              >
                <IconSkipForward size={22} color={currentLineIndex >= primaryLines.length - 1 ? C.border : C.text} />
              </TouchableOpacity>
            </View>

          </View>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: C.bg },
  errorText: { fontSize: 14, color: C.muted },
  textBtn:   { paddingVertical: 8, paddingHorizontal: 16, marginTop: 4 },
  textBtnLabel: { fontSize: 14, color: C.theme },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    gap: 8,
  },
  backTouch: { padding: 4, marginRight: 2 },
  topCenter: { flex: 1 },
  topTitle:  { fontSize: 14, fontWeight: "600", color: C.text },
  topArtist: { fontSize: 12, color: C.muted, marginTop: 1 },

  headerBtn: {
    width: 36, height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
  },
  headerBtnActive:     { borderColor: C.theme, backgroundColor: "#EEEEFF" },
  headerBtnText:       { fontSize: 13, fontWeight: "500", color: C.muted },
  headerBtnTextActive: { color: C.theme },

  loopBadge: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#EEEEFF",
    borderWidth: 1,
    borderColor: C.theme,
  },
  loopBadgeText: { fontSize: 11, fontWeight: "600", color: C.theme },

  // Track selector
  trackRow: {
    flexDirection: "row",
    paddingHorizontal: 16, paddingVertical: 8,
    gap: 8,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  trackBtn: {
    flex: 1, paddingVertical: 7,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    backgroundColor: C.surface,
  },
  trackBtnActive:     { borderColor: C.theme, backgroundColor: "#EEEEFF" },
  trackBtnText:       { fontSize: 12, fontWeight: "500", color: C.muted },
  trackBtnTextActive: { color: C.theme },

  // Empty / error
  emptyCard: {
    margin: 20, padding: 24,
    backgroundColor: C.surface,
    borderRadius: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyTitle: { fontSize: 15, fontWeight: "500", color: C.text, marginBottom: 6 },
  emptySub:   { fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 20 },
  goBackBtn: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: C.theme, borderRadius: 8,
  },
  goBackBtnText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  // Lyrics
  lyricsScroll:  { flex: 1, backgroundColor: C.bg },
  lyricsContent: {},
  translationText: {
    marginTop: 6, fontSize: 13,
    color: C.muted, textAlign: "center", fontStyle: "italic",
  },

  // Status strip
  statusStrip:     { alignItems: "center", paddingVertical: 4, backgroundColor: C.bg },
  statusStripText: { fontSize: 11, color: C.muted, letterSpacing: 0.4 },

  // Line progress
  lineProgressWrap:  { paddingHorizontal: 20, paddingVertical: 3, backgroundColor: C.bg },
  lineProgressTrack: { height: 2, backgroundColor: C.border, borderRadius: 1, overflow: "hidden" },
  lineProgressFill:  { height: "100%", backgroundColor: C.theme },

  // Overall progress
  progressWrap: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8,
    gap: 8, backgroundColor: C.surface,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  timeLabel:     { fontSize: 11, color: C.muted, width: 36, textAlign: "center" },
  progressTrack: { flex: 1, height: 2, backgroundColor: C.border, borderRadius: 1, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: C.theme },

  // Controls
  controls: {
    flexDirection: "column",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 14,
    backgroundColor: C.surface,
  },

  // Speed row
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  speedBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  speedBtnText: { fontSize: 22, fontWeight: "300", color: C.text },
  speedDisplay: {
    width: 56, height: 32,
    alignItems: "center", justifyContent: "center",
    borderRadius: 8,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  speedText: { fontSize: 12, fontWeight: "600", color: C.muted },
  dimmed:    { opacity: 0.2 },

  // Nav row
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
  },
  navBtn: {
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
  },
  playBtn: {
    width: 56, height: 56,
    borderRadius: 28,
    backgroundColor: C.theme,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.theme,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  playBtnLoading: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    shadowOpacity: 0,
    elevation: 0,
  },
});
