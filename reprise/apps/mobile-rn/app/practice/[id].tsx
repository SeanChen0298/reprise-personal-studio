import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Song, Line } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { useLinePlayer } from "../../src/hooks/use-line-player";
import { AnnotatedText } from "../../src/components/annotated-text";
import { STATUS_CONFIG, formatMs } from "../../src/lib/line-status-config";

type TrackMode = "audio" | "vocals" | "instr";

// ─── Furigana renderer ────────────────────────────────────────────────────────

interface RubySegment {
  base: string;
  rt?: string;
}

function parseRubyHtml(html: string): RubySegment[] {
  const cleaned = html.replace(/<rp>[^<]*<\/rp>/g, "");
  const segments: RubySegment[] = [];
  const re = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) segments.push({ base: cleaned.slice(last, m.index) });
    segments.push({ base: m[1], rt: m[2] });
    last = m.index + m[0].length;
  }
  if (last < cleaned.length) segments.push({ base: cleaned.slice(last) });
  return segments;
}

function RubyText({
  html,
  baseFontSize = 14,
  color = "#475569",
}: {
  html: string;
  baseFontSize?: number;
  color?: string;
}) {
  const segments = parseRubyHtml(html);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
      {segments.map((seg, i) =>
        seg.rt ? (
          <View key={i} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: baseFontSize * 0.5, color }}>{seg.rt}</Text>
            <Text style={{ fontSize: baseFontSize, color }}>{seg.base}</Text>
          </View>
        ) : (
          <Text key={i} style={{ fontSize: baseFontSize, color }}>
            {seg.base}
          </Text>
        )
      )}
    </View>
  );
}

// ─── Track selector button ────────────────────────────────────────────────────

function TrackBtn({
  label,
  mode,
  current,
  onPress,
}: {
  label: string;
  mode: TrackMode;
  current: TrackMode;
  onPress: (m: TrackMode) => void;
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

// ─── Line display (prev/active/next) ─────────────────────────────────────────

function LineRow({
  line,
  role,
  translation,
  showTranslation,
  onPress,
}: {
  line: Line | undefined;
  role: "prev" | "active" | "next";
  translation?: string;
  showTranslation?: boolean;
  onPress?: () => void;
}) {
  if (!line) return <View style={s.lineRowPlaceholder} />;

  const isActive = role === "active";
  const opacity = role === "prev" ? 0.35 : role === "next" ? 0.5 : 1;
  const fontSize = isActive ? 26 : 16;
  const textColor = isActive ? "#0F172A" : "#475569";

  const displayText = line.custom_text ?? line.text;

  const content = (
    <View style={[s.lineRowInner, { opacity }]}>
      {line.furigana_html ? (
        <RubyText html={line.furigana_html} baseFontSize={fontSize} color={textColor} />
      ) : line.annotations && line.annotations.length > 0 ? (
        <AnnotatedText
          text={displayText}
          annotations={line.annotations}
          fontSize={fontSize}
          color={textColor}
        />
      ) : (
        <Text style={{ fontSize, color: textColor, textAlign: "center", lineHeight: fontSize * 1.4 }}>
          {displayText}
        </Text>
      )}
      {isActive && showTranslation && translation ? (
        <Text style={s.translationText}>{translation}</Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={s.lineRowPressable} android_ripple={{ color: "#E2E8F020" }}>
        {content}
      </Pressable>
    );
  }
  return <View style={s.lineRowPressable}>{content}</View>;
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

  // Derive audio path from track mode
  const audioPath = useMemo(() => {
    if (trackMode === "vocals" && localFiles.vocalsPath) return localFiles.vocalsPath;
    if (trackMode === "instr" && localFiles.instrPath) return localFiles.instrPath;
    return localFiles.audioPath;
  }, [trackMode, localFiles]);

  // Split primary vs translation lines
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

  // Load song & lines
  useEffect(() => {
    if (!id) return;
    Promise.all([fetchSong(id), fetchLines(id)])
      .then(([s, lines]) => {
        setSong(s);
        setAllLines(lines);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const player = useLinePlayer({ audioPath, lines: primaryLines });

  const {
    positionMs,
    durationMs,
    isPlaying,
    lineProgress,
    currentLineIndex,
    loopEnabled,
    toggleLoop,
    loopCount,
    maxLoops,
    cycleMaxLoops,
    speed,
    incrementSpeed,
    decrementSpeed,
    togglePlay,
    goToLine,
    nextLine,
    prevLine,
    audioReady,
    audioError,
  } = player;

  const hasAudio = !!audioPath;
  const currentLine = primaryLines[currentLineIndex];
  const prevLine_ = primaryLines[currentLineIndex - 1];
  const nextLine_ = primaryLines[currentLineIndex + 1];
  const statusCfg = currentLine ? STATUS_CONFIG[currentLine.status] : null;
  const currentTranslation = currentLine ? translationByOrder.get(currentLine.order) : undefined;
  const overallProgress = durationMs > 0 ? positionMs / durationMs : 0;

  const maxLoopsLabel = maxLoops === 0 ? "∞" : String(maxLoops);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
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

  return (
    <View style={s.container}>
      {/* ── Top bar ── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.backTouch}>
          <Text style={s.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={s.topCenter}>
          <Text style={s.topTitle} numberOfLines={1}>{song.title}</Text>
          <Text style={s.topArtist} numberOfLines={1}>{song.artist}</Text>
        </View>
        {/* Loop toggle */}
        <TouchableOpacity
          onPress={toggleLoop}
          style={[s.iconBtn, loopEnabled && s.iconBtnActive]}
        >
          <Text style={[s.iconBtnText, loopEnabled && s.iconBtnTextActive]}>⟲</Text>
        </TouchableOpacity>
        {/* Max-loops badge */}
        {loopEnabled && (
          <TouchableOpacity onPress={cycleMaxLoops} style={s.loopCountBtn}>
            <Text style={s.loopCountText}>×{maxLoopsLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Track selector ── */}
      {(hasVocals || hasInstr) && (
        <View style={s.trackSelector}>
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
          <TouchableOpacity onPress={() => router.back()} style={s.goBackBtn}>
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

      {/* ── Player UI ── */}
      {hasAudio && !audioError && (
        <>
          {/* 3-line karaoke view */}
          <View style={s.karaokeArea}>
            {/* Prev line */}
            <LineRow
              line={prevLine_}
              role="prev"
              onPress={prevLine_ ? () => goToLine(currentLineIndex - 1) : undefined}
            />

            {/* Active line */}
            <View style={s.activeLineWrap}>
              <LineRow
                line={currentLine}
                role="active"
                translation={currentTranslation}
                showTranslation={showTranslation}
              />
              {/* Status row */}
              <View style={s.statusRow}>
                {statusCfg && (
                  <View style={[s.statusBadge, { backgroundColor: statusCfg.tagBg }]}>
                    <Text style={[s.statusBadgeText, { color: statusCfg.tagColor }]}>
                      {statusCfg.label}
                    </Text>
                  </View>
                )}
                {primaryLines.length > 0 && (
                  <Text style={s.lineCounter}>
                    {currentLineIndex + 1}/{primaryLines.length}
                  </Text>
                )}
                {currentLine?.start_ms != null && currentLine?.end_ms != null && (
                  <Text style={s.timeBadge}>
                    {formatMs(currentLine.start_ms)}–{formatMs(currentLine.end_ms)}
                  </Text>
                )}
                {/* Translation toggle */}
                {translationByOrder.size > 0 && (
                  <TouchableOpacity
                    onPress={() => setShowTranslation((v) => !v)}
                    style={[s.translationBtn, showTranslation && s.translationBtnActive]}
                  >
                    <Text style={[s.translationBtnText, showTranslation && s.translationBtnTextActive]}>
                      T
                    </Text>
                  </TouchableOpacity>
                )}
                {/* Loop count indicator */}
                {loopEnabled && maxLoops > 0 && (
                  <Text style={s.loopIndicator}>{loopCount}/{maxLoops}</Text>
                )}
              </View>
            </View>

            {/* Next line */}
            <LineRow
              line={nextLine_}
              role="next"
              onPress={nextLine_ ? () => goToLine(currentLineIndex + 1) : undefined}
            />
          </View>

          {/* ── Line progress bar ── */}
          <View style={s.lineProgressWrap}>
            <View style={s.lineProgressTrack}>
              <View style={[s.lineProgressFill, { width: `${lineProgress * 100}%` as any }]} />
            </View>
          </View>

          {/* ── Overall progress bar ── */}
          <View style={s.progressWrap}>
            <Text style={s.timeLabel}>{formatMs(positionMs)}</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${overallProgress * 100}%` as any }]} />
            </View>
            <Text style={s.timeLabel}>{formatMs(durationMs)}</Text>
          </View>

          {/* ── Controls ── */}
          <View style={s.controls}>
            {/* Prev line */}
            <TouchableOpacity
              style={s.navBtn}
              onPress={prevLine}
              disabled={currentLineIndex === 0}
            >
              <Text style={[s.navBtnText, currentLineIndex === 0 && s.dimmed]}>⏮</Text>
            </TouchableOpacity>

            {/* Speed − */}
            <TouchableOpacity style={s.speedBtn} onPress={decrementSpeed} disabled={speed <= 0.5}>
              <Text style={[s.speedBtnText, speed <= 0.5 && s.dimmed]}>−</Text>
            </TouchableOpacity>

            {/* Speed display */}
            <View style={s.speedDisplay}>
              <Text style={s.speedText}>{Math.round(speed * 100)}%</Text>
            </View>

            {/* Speed + */}
            <TouchableOpacity style={s.speedBtn} onPress={incrementSpeed} disabled={speed >= 1.0}>
              <Text style={[s.speedBtnText, speed >= 1.0 && s.dimmed]}>+</Text>
            </TouchableOpacity>

            {/* Play/Pause */}
            <TouchableOpacity
              style={[s.playBtn, !audioReady && s.playBtnLoading]}
              onPress={() => void togglePlay()}
              disabled={!audioReady}
              activeOpacity={0.8}
            >
              {!audioReady ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
              )}
            </TouchableOpacity>

            {/* Next line */}
            <TouchableOpacity
              style={s.navBtn}
              onPress={nextLine}
              disabled={currentLineIndex >= primaryLines.length - 1}
            >
              <Text
                style={[s.navBtnText, currentLineIndex >= primaryLines.length - 1 && s.dimmed]}
              >
                ⏭
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F8FAFC" },
  errorText: { fontSize: 14, color: "#64748B" },
  textBtn: { padding: 8 },
  textBtnLabel: { fontSize: 14, color: "#3B82F6" },

  // Top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    gap: 8,
  },
  backTouch: { padding: 4 },
  backArrow: { fontSize: 28, color: "#3B82F6", lineHeight: 32 },
  topCenter: { flex: 1 },
  topTitle: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  topArtist: { fontSize: 12, color: "#64748B", marginTop: 1 },

  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  iconBtnText: { fontSize: 18, color: "#94A3B8" },
  iconBtnTextActive: { color: "#2563EB" },

  loopCountBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1.5,
    borderColor: "#3B82F6",
  },
  loopCountText: { fontSize: 12, fontWeight: "700", color: "#2563EB" },

  // Track selector
  trackSelector: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  trackBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    alignItems: "center",
  },
  trackBtnActive: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  trackBtnText: { fontSize: 12.5, fontWeight: "500", color: "#64748B" },
  trackBtnTextActive: { color: "#2563EB", fontWeight: "600" },

  // Empty / error states
  emptyCard: {
    margin: 20,
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: "#475569", marginBottom: 6 },
  emptySub: { fontSize: 13, color: "#94A3B8", textAlign: "center", lineHeight: 20 },
  goBackBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#3B82F6",
    borderRadius: 8,
  },
  goBackBtnText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  // Karaoke area
  karaokeArea: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 8,
    backgroundColor: "#F8FAFC",
  },
  lineRowPlaceholder: { minHeight: 44 },
  lineRowPressable: { paddingVertical: 8, paddingHorizontal: 4 },
  lineRowInner: { alignItems: "center" },
  translationText: {
    marginTop: 8,
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    fontStyle: "italic",
  },

  activeLineWrap: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
  },

  // Status row
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "600" },
  lineCounter: { fontSize: 12, color: "#94A3B8" },
  timeBadge: { fontSize: 11, color: "#94A3B8" },
  loopIndicator: { fontSize: 11, color: "#2563EB" },

  // Translation toggle
  translationBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  translationBtnActive: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  translationBtnText: { fontSize: 13, fontWeight: "700", color: "#94A3B8" },
  translationBtnTextActive: { color: "#2563EB" },

  // Line progress bar (within current line)
  lineProgressWrap: {
    paddingHorizontal: 20,
    paddingVertical: 4,
    backgroundColor: "#F8FAFC",
  },
  lineProgressTrack: {
    height: 3,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
  },
  lineProgressFill: { height: "100%", backgroundColor: "#3B82F6" },

  // Overall progress bar
  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: "#F8FAFC",
  },
  timeLabel: { fontSize: 11, color: "#94A3B8", width: 36, textAlign: "center" },
  progressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#3B82F6" },

  // Controls
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 36,
    gap: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  navBtn: { padding: 10 },
  navBtnText: { fontSize: 26, color: "#475569" },
  dimmed: { opacity: 0.25 },

  speedBtn: { padding: 10 },
  speedBtnText: { fontSize: 22, fontWeight: "300", color: "#475569" },
  speedDisplay: {
    width: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  speedText: { fontSize: 13, fontWeight: "600", color: "#0F172A" },

  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#3B82F6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3B82F6",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  playBtnLoading: { backgroundColor: "#93C5FD" },
  playBtnText: { fontSize: 24, color: "#fff" },
});
