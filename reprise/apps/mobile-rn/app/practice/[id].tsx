import { useEffect, useMemo, useRef, useState } from "react";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { Dimensions } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useShallow } from "zustand/react/shallow";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
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
import { LyricListView } from "../../src/components/lyric-list-view";
import { TransportControls } from "../../src/components/transport-controls";
import { IconChevronLeft } from "../../src/components/icons";

type TrackMode = "audio" | "vocals" | "instr";

const SPEED_STEPS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

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
  const [viewMode, setViewMode] = useState<"carousel" | "list">("carousel");

  // Slide animation: 0 = carousel visible, -W = list visible
  const panelW = useRef(Dimensions.get("window").width);
  const slideX = useSharedValue(0);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slideX.value }] }));

  const showList     = () => { slideX.value = withTiming(-panelW.current, { duration: 280, easing: Easing.out(Easing.cubic) }); setViewMode("list"); };
  const showCarousel = () => { slideX.value = withTiming(0,               { duration: 280, easing: Easing.out(Easing.cubic) }); setViewMode("carousel"); };

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

  // ── Seamless track swap ────────────────────────────────────────────────────
  // When trackMode changes, capture playback position so we can resume there
  // after the new audio file loads.
  const pendingSeekRef = useRef<{ lineIndex: number; wasPlaying: boolean } | null>(null);
  const prevAudioReadyRef = useRef(false);

  useEffect(() => {
    // audioReady just flipped true → restore position from pending seek
    if (audioReady && !prevAudioReadyRef.current && pendingSeekRef.current) {
      const { lineIndex, wasPlaying } = pendingSeekRef.current;
      pendingSeekRef.current = null;
      void goToLine(lineIndex, wasPlaying);
    }
    prevAudioReadyRef.current = audioReady;
  }, [audioReady, goToLine]);

  const switchTrack = (newMode: TrackMode) => {
    pendingSeekRef.current = { lineIndex: currentLineIndex, wasPlaying: isPlaying };
    setTrackMode(newMode);
  };

  const cycleTrack = () => {
    const cycle = (["audio", hasVocals && "vocals", hasInstr && "instr"] as const).filter(Boolean) as TrackMode[];
    const next = cycle[(cycle.indexOf(trackMode) + 1) % cycle.length];
    switchTrack(next);
  };

  // ── Keep screen awake during playback ─────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      void activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
  }, [isPlaying]);

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

          {/* Track cycle button */}
          {hasAlternate && (
            <Pressable
              onPress={cycleTrack}
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
              <View
                style={s.panelContainer}
                onLayout={(e) => { panelW.current = e.nativeEvent.layout.width; }}
              >
                <Animated.View style={[s.panelRow, slideStyle]}>
                  {/* Panel 0 — carousel */}
                  <View style={s.panel}>
                    <LyricDisplay
                      lines={primaryLines}
                      currentIndex={currentLineIndex}
                      showTranslation={false}
                      translationByOrder={translationByOrder}
                      highlights={highlights}
                      C={C}
                      speed={speed}
                      onTapLine={(idx) => goToLine(idx, true)}
                      onSwipeLeft={showList}
                      onNext={() => void nextLine()}
                      onPrev={() => void prevLine()}
                      onSpeedChange={setSpeed}
                    />
                  </View>

                  {/* Panel 1 — full list */}
                  <View style={s.panel}>
                    {viewMode === "list" && (
                      <LyricListView
                        lines={primaryLines}
                        currentIndex={currentLineIndex}
                        showTranslation={false}
                        translationByOrder={translationByOrder}
                        highlights={highlights}
                        C={C}
                        onTapLine={(idx) => { void goToLine(idx, true); }}
                        onSwipeRight={showCarousel}
                      />
                    )}
                  </View>
                </Animated.View>

                {/* Page dots */}
                <View style={s.pageDots} pointerEvents="none">
                  <View style={[s.dot, { backgroundColor: viewMode === "carousel" ? C.theme : C.border }]} />
                  <View style={[s.dot, { backgroundColor: viewMode === "list"     ? C.theme : C.border }]} />
                </View>
              </View>
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

  // Two-panel slide layout
  panelContainer: {
    flex: 1,
    overflow: "hidden",
  },
  panelRow: {
    flex: 1,
    flexDirection: "row",
    width: "200%",
  },
  panel: {
    flex: 1,
  },
  pageDots: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
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
