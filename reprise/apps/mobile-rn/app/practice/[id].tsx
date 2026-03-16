import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Song, Line } from "@reprise/shared";
import { fetchSong, fetchLines } from "../../src/lib/supabase";
import { useSongFilesStore } from "../../src/stores/song-files-store";
import { usePreferencesStore } from "../../src/stores/preferences-store";
import { useLinePlayer } from "../../src/hooks/use-line-player";
import { useTheme, isDark } from "../../src/lib/theme";
import { LyricDisplay } from "../../src/components/lyric-display";
import { TransportControls } from "../../src/components/transport-controls";
import { IconChevronLeft } from "../../src/components/icons";

type TrackMode = "audio" | "vocals" | "instr";

const SPEED_STEPS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

const TRACK_LABELS: Record<TrackMode, string> = {
  audio: "Full Audio",
  vocals: "Vocals",
  instr: "Instrumental",
};

export default function PracticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const C = useTheme();
  const highlights = usePreferencesStore((s) => s.highlights);
  // Always use pure white surface for practice screen
  const bg = C.surface;

  const [song, setSong] = useState<Song | null>(null);
  const [allLines, setAllLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackMode, setTrackMode] = useState<TrackMode>("audio");
  const [showTranslation, setShowTranslation] = useState(false);
  const [showTrackMenu, setShowTrackMenu] = useState(false);

  const localFiles = useSongFilesStore(useShallow((s) => s.getLocalFiles(id ?? "")));
  const hasVocals = !!localFiles.vocalsPath;
  const hasInstr  = !!localFiles.instrPath;
  const hasAlternate = hasVocals || hasInstr;

  const audioPath = useMemo(() => {
    if (trackMode === "vocals" && localFiles.vocalsPath) return localFiles.vocalsPath;
    if (trackMode === "instr"  && localFiles.instrPath)  return localFiles.instrPath;
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
    cycleMaxLoops, speed, setSpeed,
    togglePlay, goToLine, nextLine, prevLine, audioReady, audioError,
  } = player;

  // ── Speed cycling ──────────────────────────────────────────────────────────
  const cycleSpeed = () => {
    const next = SPEED_STEPS.find((s) => s > speed) ?? SPEED_STEPS[0];
    setSpeed(next);
  };
  const resetSpeed = () => setSpeed(1.0);

  // ── Seek: tap on progress bar → jump to nearest line ─────────────────────
  const handleSeek = (ms: number) => {
    let targetIdx = 0;
    for (let i = 0; i < primaryLines.length; i++) {
      const l = primaryLines[i];
      if (l.start_ms !== undefined && l.start_ms <= ms) {
        targetIdx = i;
      }
    }
    void goToLine(targetIdx, isPlaying);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasAudio = !!audioPath;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[s.center, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={C.theme} />
      </View>
    );
  }

  if (!song) {
    return (
      <View style={[s.center, { backgroundColor: bg }]}>
        <Text style={[s.errorText, { color: C.muted }]}>Song not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.textBtn}>
          <Text style={[s.textBtnLabel, { color: C.theme }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const subtitleText = [song.artist, song.bpm ? `${song.bpm} BPM` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <SafeAreaView style={[s.safeArea, { backgroundColor: bg }]}>
      <StatusBar style={isDark(C) ? "light" : "dark"} />
      <View style={[s.container, { backgroundColor: bg }]}>

        {/* ── Top bar ── */}
        <View style={[s.topBar, { backgroundColor: bg }]}>
          {/* Absolutely centered title */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={[s.topTitle, { color: C.text }]} numberOfLines={1}>{song.title}</Text>
              {subtitleText ? (
                <Text style={[s.topArtist, { color: C.muted }]} numberOfLines={1}>{subtitleText}</Text>
              ) : null}
            </View>
          </View>

          {/* Back button (left) */}
          <TouchableOpacity onPress={() => router.back()} style={s.backTouch} activeOpacity={0.6}>
            <IconChevronLeft size={24} color={C.text} />
          </TouchableOpacity>

          {/* Push right buttons to far right */}
          <View style={{ flex: 1 }} />

          {/* Translation toggle */}
          {translationByOrder.size > 0 && (
            <Pressable
              onPress={() => setShowTranslation((v) => !v)}
              style={[
                s.headerBtn,
                {
                  borderColor: showTranslation ? C.theme : C.border,
                  backgroundColor: showTranslation ? (isDark(C) ? "#1E1E3F" : "#EEEEFF") : bg,
                },
              ]}
              android_ripple={{ color: "rgba(0,0,0,0.06)" }}
            >
              <Text style={[s.headerBtnText, { color: showTranslation ? C.theme : C.muted }]}>TL</Text>
            </Pressable>
          )}

          {/* Track selector trigger */}
          {hasAlternate && (
            <Pressable
              onPress={() => setShowTrackMenu(true)}
              style={[
                s.headerBtn,
                {
                  borderColor: trackMode !== "audio" ? C.theme : C.border,
                  backgroundColor: trackMode !== "audio" ? (isDark(C) ? "#1E1E3F" : "#EEEEFF") : bg,
                },
              ]}
              android_ripple={{ color: "rgba(0,0,0,0.06)" }}
            >
              <Text style={[s.headerBtnText, { color: trackMode !== "audio" ? C.theme : C.muted }]}>
                {trackMode === "audio" ? "···" : trackMode === "vocals" ? "VOC" : "INS"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── Track selector modal ── */}
        <Modal
          visible={showTrackMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowTrackMenu(false)}
        >
          <Pressable style={s.modalOverlay} onPress={() => setShowTrackMenu(false)}>
            <View style={[s.trackMenu, { backgroundColor: C.surface, borderColor: C.border }]}>
              <Text style={[s.trackMenuTitle, { color: C.muted }]}>Audio Track</Text>
              {(["audio", hasVocals && "vocals", hasInstr && "instr"] as const)
                .filter(Boolean)
                .map((mode) => {
                  if (!mode) return null;
                  const active = mode === trackMode;
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => { setTrackMode(mode as TrackMode); setShowTrackMenu(false); }}
                      style={[
                        s.trackMenuItem,
                        { backgroundColor: active ? (isDark(C) ? "#1E1E3F" : "#EEEEFF") : "transparent" },
                      ]}
                      android_ripple={{ color: "rgba(0,0,0,0.06)" }}
                    >
                      <Text style={[s.trackMenuItemText, { color: active ? C.theme : C.text }]}>
                        {TRACK_LABELS[mode as TrackMode]}
                      </Text>
                      {active && (
                        <View style={[s.trackMenuCheck, { backgroundColor: C.theme }]}>
                          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>✓</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
            </View>
          </Pressable>
        </Modal>

        {/* ── No audio ── */}
        {!hasAudio && (
          <View style={[s.emptyCard, { backgroundColor: C.surface }]}>
            <Text style={[s.emptyTitle, { color: C.text }]}>No audio downloaded</Text>
            <Text style={[s.emptySub, { color: C.muted }]}>
              {song.drive_audio_file_id
                ? "Go to Song Detail to download audio from Google Drive."
                : "Sync this song from the desktop app first."}
            </Text>
            <TouchableOpacity onPress={() => router.back()} style={[s.goBackBtn, { backgroundColor: C.theme }]} activeOpacity={0.8}>
              <Text style={s.goBackBtnText}>Go to Song Detail</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Playback error ── */}
        {hasAudio && audioError && (
          <View style={[s.emptyCard, { backgroundColor: C.surface }]}>
            <Text style={[s.emptyTitle, { color: C.text }]}>Playback error</Text>
            <Text style={[s.emptySub, { color: C.muted }]}>{audioError}</Text>
          </View>
        )}

        {/* ── Main practice area ── */}
        {hasAudio && !audioError && (
          <>
            {primaryLines.length === 0 ? (
              <View style={[s.center, { flex: 1 }]}>
                <Text style={[s.errorText, { color: C.muted }]}>No lyrics added yet.</Text>
              </View>
            ) : (
              <LyricDisplay
                lines={primaryLines}
                currentIndex={currentLineIndex}
                showTranslation={showTranslation}
                translationByOrder={translationByOrder}
                highlights={highlights}
                C={C}
                onTapLine={(idx) => goToLine(idx, true)}
                onNext={() => void nextLine()}
                onPrev={() => void prevLine()}
              />
            )}

            <TransportControls
              isPlaying={isPlaying}
              audioReady={audioReady}
              speed={speed}
              lineProgress={lineProgress}
              positionMs={positionMs}
              durationMs={durationMs}
              loopEnabled={loopEnabled}
              maxLoops={maxLoops}
              loopCount={loopCount}
              currentIndex={currentLineIndex}
              totalLines={primaryLines.length}
              C={C}
              onTogglePlay={() => void togglePlay()}
              onPrev={() => void prevLine()}
              onNext={() => void nextLine()}
              onCycleSpeed={cycleSpeed}
              onResetSpeed={resetSpeed}
              onToggleLoop={toggleLoop}
              onCycleMaxLoops={cycleMaxLoops}
              onSeek={handleSeek}
            />
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safeArea:  { flex: 1 },
  container: { flex: 1 },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 14 },
  textBtn:   { paddingVertical: 8, paddingHorizontal: 16, marginTop: 4 },
  textBtnLabel: { fontSize: 14 },

  // Top bar — no bottom border, white background
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  backTouch: { padding: 4, marginRight: 2 },
  topTitle:  { fontSize: 17, fontWeight: "600", textAlign: "center" },
  topArtist: { fontSize: 13, marginTop: 2, textAlign: "center" },

  headerBtn: {
    width: 36, height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { fontSize: 12, fontWeight: "600" },

  // Track menu modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 64,
    paddingRight: 16,
  },
  trackMenu: {
    minWidth: 180,
    borderRadius: 12,
    borderWidth: 0.5,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  trackMenuTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  trackMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginHorizontal: 4,
    borderRadius: 8,
  },
  trackMenuItemText: { fontSize: 14, fontWeight: "500" },
  trackMenuCheck: {
    width: 18, height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  // Empty / error
  emptyCard: {
    margin: 20, padding: 24,
    borderRadius: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyTitle: { fontSize: 15, fontWeight: "500", marginBottom: 6 },
  emptySub:   { fontSize: 13, textAlign: "center", lineHeight: 20 },
  goBackBtn: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8,
  },
  goBackBtnText: { fontSize: 13, fontWeight: "600", color: "#fff" },
});
