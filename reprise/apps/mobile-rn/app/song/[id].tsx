// The song, first: its color, the lyrics following the music, play controls. Practicing
// (loop, speed, track, takes, record — and the hints, voice marks and notes in the lyrics) is
// one pull-up away; the coach's card, takes and view options are behind "⋯".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, PanResponder, Pressable, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, ZoomIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as FileSystem from "expo-file-system";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reviewInsight, splitLines, translationsByLine, type Line, type Section } from "@reprise/shared/core";
import { linesWithEdits, takesFor, TRACKS, useLibraryStore, type TrackKind } from "../../src/stores/library-store";
import { usePrefsStore } from "../../src/stores/prefs-store";
import { useLinePlayer } from "../../src/hooks/use-line-player";
import { useTakeRecorder, type PendingTake } from "../../src/hooks/use-take-recorder";
import { useClassicTheme } from "../../src/lib/theme";
import { useSongPalette, vividLook } from "../../src/lib/song-palette";
import { StatusBar } from "expo-status-bar";
import { VividBackdrop } from "../../src/components/vivid-backdrop";
import { sectionEnergy } from "../../src/lib/section-feel";
import { clock, megabytes } from "../../src/lib/format";
import { DISPLAY, DISPLAY_REGULAR, Text } from "../../src/components/text";
import { Button, Card, Chip, Label, Segmented } from "../../src/components/ui";
import { Toggle } from "../../src/components/toggle";
import { LyricRow } from "../../src/components/lyric-row";
import { PlayerBar } from "../../src/components/player-bar";
import { LineSheet } from "../../src/components/line-sheet";
import { TakesSheet } from "../../src/components/takes-sheet";
import { SongCardView } from "../../src/components/song-card-view";
import { Sheet } from "../../src/components/sheet";
import { BackIcon, ChevronIcon, DownloadIcon, MoreIcon } from "../../src/components/icons";
import { pauseRadio } from "../../src/lib/radio";

type Row = { kind: "section"; section: Section; key: string } | { kind: "line"; line: Line; index: number; key: string };

/** Don't follow the playhead for this long after you scroll yourself. */
const HANDS_OFF_MS = 5000;

const TAKES_DIR = `${FileSystem.documentDirectory}phone-takes/`;

const capitalise = (s: string) => s.replace(/^\p{L}/u, (c) => c.toUpperCase());

async function keepTake(songId: string, p: PendingTake, note: string) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await FileSystem.makeDirectoryAsync(TAKES_DIR, { intermediates: true });
  const ext = p.uri.match(/\.([a-z0-9]+)$/i)?.[1] ?? "m4a";
  const dest = `${TAKES_DIR}${id}.${ext}`;
  await FileSystem.moveAsync({ from: p.uri, to: dest });
  await useLibraryStore.getState().addTake({
    id,
    song_id: songId,
    uri: dest,
    duration_ms: p.durationMs,
    song_start_ms: p.songStartMs,
    backing: p.backing,
    section_id: p.sectionId,
    note: note.trim() || undefined,
    created_at: new Date().toISOString(),
  });
}

export default function SongScreen() {
  useKeepAwake();
  const { id, at, play } = useLocalSearchParams<{ id: string; at?: string; play?: string }>();
  const classicT = useClassicTheme();
  const calmP = useSongPalette(id, classicT);
  const look = usePrefsStore((s) => s.look);
  const songHex = useLibraryStore((s) => s.snapshot?.colors?.[id]);
  // Vivid: this screen (and its sheets) in this song's colors.
  const vivid = useMemo(() => (look === "vivid" ? vividLook(songHex, classicT) : null), [look, songHex, classicT]);
  const t = vivid?.t ?? classicT;
  const appT = t;
  const p = vivid?.p ?? calmP;
  const tone = { solid: p.solid, onSolid: p.onSolid, soft: p.soft, tint: p.tint };
  const insets = useSafeAreaInsets();
  const snapshot = useLibraryStore((s) => s.snapshot);
  const local = useLibraryStore((s) => s.local);
  const pairing = useLibraryStore((s) => s.pairing);
  const downloading = useLibraryStore((s) => s.downloading[id]);
  const showTranslation = usePrefsStore((s) => s.showTranslation);
  const showRomaji = usePrefsStore((s) => s.showRomaji);
  const showFurigana = usePrefsStore((s) => s.showFurigana);
  const showHints = usePrefsStore((s) => s.showHints);
  const countIn = usePrefsStore((s) => s.countIn);
  const autoDownload = usePrefsStore((s) => s.autoDownload);
  const memorize = usePrefsStore((s) => s.memorize);
  const practice = usePrefsStore((s) => s.practiceOpen);

  const song = snapshot?.songs.find((s) => s.id === id);
  const allLines = useMemo(() => linesWithEdits(snapshot, local, id), [snapshot, local, id]);
  const { lines, translations } = useMemo(() => splitLines(allLines, song?.translation_language), [allLines, song?.translation_language]);
  const transById = useMemo(() => translationsByLine(lines, translations), [lines, translations]);
  const sections = useMemo(
    () => (snapshot?.sections ?? []).filter((s) => s.song_id === id).sort((a, b) => a.start_line_order - b.start_line_order),
    [snapshot, id],
  );
  const takes = useMemo(() => takesFor(snapshot, local, id), [snapshot, local, id]);
  const coach = snapshot?.coach[id];
  const card = coach?.card ?? null;
  const highlights = snapshot?.highlights ?? [];
  // Hints are practice information: only with the Practice tray open.
  const hints = practice && showHints ? snapshot?.hints?.[id] : undefined;

  // ── Audio ──────────────────────────────────────────────────────────────
  const files = snapshot?.files[id];
  const downloads = local.downloads[id];
  const tracks = TRACKS.filter((k) => downloads?.[k]);
  const [track, setTrack] = useState<TrackKind>("audio");
  const activeTrack: TrackKind = downloads?.[track] ? track : tracks[0] ?? "audio";
  const uri = downloads?.[activeTrack]?.uri ?? null;
  const missingBytes = TRACKS.reduce((n, k) => {
    const ref = files?.[k];
    const have = downloads?.[k];
    return ref && (!have || have.mtime !== ref.mtime) ? n + ref.size : n;
  }, 0);

  useEffect(() => {
    if (autoDownload && pairing && missingBytes > 0) void useLibraryStore.getState().downloadSong(id);
    // Only when the song opens (or the library changes underneath it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, files]);

  const sectionOf = useCallback(
    (idx: number) => {
      const l = lines[idx];
      return l ? sections.find((s) => l.order >= s.start_line_order && l.order <= s.end_line_order) ?? null : null;
    },
    [lines, sections],
  );
  const sectionRange = useCallback(
    (idx: number): [number, number] | null => {
      const sec = sectionOf(idx);
      if (!sec) return null;
      const inSec = lines.filter((l) => l.order >= sec.start_line_order && l.order <= sec.end_line_order && l.start_ms != null);
      if (!inSec.length) return null;
      const last = inSec[inSec.length - 1];
      return [inSec[0].start_ms!, last.end_ms ?? last.start_ms! + 4000];
    },
    [lines, sectionOf],
  );

  const touch = useCallback(() => useLibraryStore.getState().touchPracticed(id), [id]);
  const player = useLinePlayer({ uri, lines, sectionRange, onLinePlayed: touch, initialMs: at ? Number(at) || 0 : 0, initialPlay: play === "1" });
  // Practice here, so Play all stops talking over it.
  useEffect(() => void pauseRadio(), []);
  const keep = useCallback((pt: PendingTake) => void keepTake(id, pt, ""), [id]);
  const rec = useTakeRecorder(player, lines, countIn, activeTrack, keep);
  const [takeNote, setTakeNote] = useState("");

  // ── Lyrics list ─────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const out: Row[] = [];
    let current: Section | null = null;
    lines.forEach((line, index) => {
      const sec = sections.find((s) => line.order >= s.start_line_order && line.order <= s.end_line_order) ?? null;
      if (sec && sec !== current) out.push({ kind: "section", section: sec, key: `s-${sec.id}` });
      current = sec;
      out.push({ kind: "line", line, index, key: line.id });
    });
    return out;
  }, [lines, sections]);
  const rowOfLine = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => r.kind === "line" && m.set(r.index, i));
    return m;
  }, [rows]);
  const cardSection = useMemo(() => new Map((card?.sections ?? []).map((s) => [s.name.trim().toLowerCase(), s])), [card]);
  /** Sections whose coach note is open (tap the section name). */
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const listRef = useRef<FlatList<Row>>(null);
  const handsOffUntil = useRef(0);
  const active = player.activeIndex;
  useEffect(() => {
    if (Date.now() < handsOffUntil.current) return;
    const row = rowOfLine.get(active);
    if (row == null) return;
    listRef.current?.scrollToIndex({ index: row, viewPosition: 0.3, animated: true });
  }, [active, rowOfLine]);

  const [lineSheet, setLineSheet] = useState<number | null>(null);
  const [takesOpen, setTakesOpen] = useState(false);
  const [takeFocus, setTakeFocus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  /** Open another sheet once the menu has slid away. */
  const fromMenu = (open: () => void) => {
    setMenuOpen(false);
    setTimeout(open, 230);
  };

  // A take from this phone waits for the computer's review (the app checks every few seconds while it waits);
  // say so when it arrives.
  const waitingReview = useRef(new Set<string>());
  const [reviewReady, setReviewReady] = useState<{ id: string; headline: string } | null>(null);
  useEffect(() => {
    for (const tk of takes) {
      const mine = tk.onPhone || local.takes.some((x) => x.id === tk.id);
      if (!mine || tk.song_start_ms == null) continue;
      if (!tk.analysis) waitingReview.current.add(tk.id);
      else if (waitingReview.current.delete(tk.id)) setReviewReady({ id: tk.id, headline: reviewInsight(tk.analysis).headline });
    }
  }, [takes, local.takes]);

  const onPressLine = useCallback(
    (idx: number) => {
      handsOffUntil.current = 0;
      if (rec.busy) return;
      void player.playLine(idx);
      touch();
    },
    [player, rec.busy, touch],
  );
  const onLongPressLine = useCallback((idx: number) => setLineSheet(idx), []);

  // Swipe sideways on the lyrics for the previous / next line.
  const stepRef = useRef(player.step);
  stepRef.current = player.step;
  const busyRef = useRef(rec.busy);
  busyRef.current = rec.busy;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => !busyRef.current && Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 60) return;
          handsOffUntil.current = 0;
          void Haptics.selectionAsync();
          void stepRef.current(g.dx < 0 ? 1 : -1);
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  const startTake = () => {
    const sectionTake = player.loop === "section" ? sectionOf(player.cursor) : null;
    if (player.loop !== "off") player.setLoop("off");
    const from = sectionTake ? lines.find((l) => l.order === sectionTake.start_line_order) ?? lines[player.cursor] : lines[player.cursor];
    touch();
    void rec.start(from ?? null, sectionTake);
  };
  const cursorSection = sectionOf(player.cursor);
  // The feel of the part playing now (the coach's words for it), for the Vivid backdrop.
  const playingSection = sectionOf(active);
  const allHints = snapshot?.hints?.[id];
  const activeLineId = lines[active]?.id;
  const energy = useMemo(() => {
    const c = playingSection ? cardSection.get(playingSection.name.trim().toLowerCase()) : undefined;
    const base = playingSection ? sectionEnergy(playingSection.name, c?.mood) : 0.4;
    // The original singer's high notes lift it too (the only cue for songs without sections or a card).
    const high = activeLineId && allHints?.[activeLineId]?.high ? 0.22 : 0;
    return Math.min(1, base + high);
  }, [playingSection, cardSection, activeLineId, allHints]);
  const recordLabel = player.loop === "section" && cursorSection ? `Record ${capitalise(cursorSection.name)}` : "Record";

  if (!song) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg, padding: 24, gap: 14 }}>
        <Text style={{ color: t.textSecondary, fontSize: 15, textAlign: "center" }}>This song isn't in the library any more.</Text>
        <Button t={t} kind="soft" label="Back" onPress={() => router.back()} />
      </View>
    );
  }

  const hasTimings = lines.some((l) => l.start_ms != null);

  return (
    <View style={{ flex: 1, backgroundColor: p.wash }}>
      {vivid && <StatusBar style="light" />}
      {vivid && <VividBackdrop hex={songHex} top={vivid.top} bottom={vivid.bottom} energy={energy} playing={player.isPlaying} />}
      {/* Header: back, the song, more */}
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 8, paddingBottom: 4, flexDirection: "row", alignItems: "center" }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <BackIcon color={t.text} size={22} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
          <Text numberOfLines={1} style={{ fontFamily: DISPLAY, fontSize: 18, color: t.text, letterSpacing: -0.3 }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted, marginTop: 1 }}>
            {song.artist}
          </Text>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <MoreIcon color={t.text} size={22} />
        </Pressable>
      </View>

      {/* Audio not here yet */}
      {!uri && (
        <Card t={t} style={{ marginHorizontal: 16, marginTop: 6, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
          {downloading != null ? (
            <>
              <ActivityIndicator color={p.solid} size="small" />
              <Text style={{ flex: 1, fontSize: 14, color: t.textSecondary }}>Getting the audio… {Math.round(downloading * 100)}%</Text>
            </>
          ) : files?.audio ? (
            pairing ? (
              <>
                <Text style={{ flex: 1, fontSize: 14, color: t.textSecondary }}>The audio isn't on this phone yet.</Text>
                <Button t={t} tone={tone} label={megabytes(missingBytes)} icon={<DownloadIcon color={p.onSolid} size={14} />} onPress={() => useLibraryStore.getState().downloadSong(id)} />
              </>
            ) : (
              <Text style={{ flex: 1, fontSize: 14, color: t.textSecondary }}>Pair with your computer to get the audio.</Text>
            )
          ) : (
            <Text style={{ flex: 1, fontSize: 14, color: t.textSecondary }}>The computer hasn't downloaded this song's audio yet.</Text>
          )}
        </Card>
      )}
      {!!player.error && <Text style={{ fontSize: 12.5, color: t.danger, paddingHorizontal: 18, textAlign: "center" }}>Can't play: {player.error}</Text>}

      {/* Lyrics */}
      <View style={{ flex: 1 }} {...swipe.panHandlers}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 220 }}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => (handsOffUntil.current = Date.now() + HANDS_OFF_MS)}
          onMomentumScrollEnd={() => (handsOffUntil.current = Date.now() + HANDS_OFF_MS)}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.3, animated: true }), 120);
          }}
          ListEmptyComponent={<Text style={{ textAlign: "center", color: t.muted, marginTop: 40, fontSize: 14 }}>No lyrics yet — add them on the computer.</Text>}
          ListHeaderComponent={!hasTimings && lines.length > 0 ? <Text style={{ textAlign: "center", color: t.muted, fontSize: 12.5, marginBottom: 10 }}>These lyrics have no timing yet, so they won't follow the music.</Text> : null}
          renderItem={({ item }) => {
            if (item.kind === "section") {
              const c = cardSection.get(item.section.name.trim().toLowerCase());
              const voice = [c?.voice?.register, c?.voice?.placement].filter(Boolean).join(" · ");
              const open = openSections.has(item.section.id);
              const hasNote = !!c && !!(c.mood || voice || c.intent);
              return (
                <Pressable
                  disabled={!hasNote}
                  onPress={() =>
                    setOpenSections((s) => {
                      const n = new Set(s);
                      if (n.has(item.section.id)) n.delete(item.section.id);
                      else n.add(item.section.id);
                      return n;
                    })
                  }
                  style={{ alignItems: "center", marginTop: 26, marginBottom: 8, gap: 6 }}
                >
                  <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 15, color: open ? p.tint : t.muted, letterSpacing: 0.2 }}>
                    {capitalise(item.section.name)}
                    {hasNote ? <Text style={{ fontFamily: DISPLAY_REGULAR, color: open ? p.tint : t.border }}>  {open ? "–" : "+"}</Text> : null}
                  </Text>
                  {open && c && (
                    <Animated.View entering={FadeIn.duration(200)} style={{ alignItems: "center", gap: 6, paddingHorizontal: 12 }}>
                      {(!!c.mood || !!voice) && (
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                          {!!c.mood && <Chip t={t}>{c.mood}</Chip>}
                          {!!voice && <Chip t={t} tone="voice">{voice}</Chip>}
                        </View>
                      )}
                      {!!c.intent && <Text style={{ fontSize: 13.5, lineHeight: 19, color: t.textSecondary, textAlign: "center" }}>{c.intent}</Text>}
                    </Animated.View>
                  )}
                </Pressable>
              );
            }
            return (
              <LyricRow
                line={item.line}
                index={item.index}
                active={item.index === active}
                distance={Math.abs(item.index - active)}
                translation={showTranslation ? transById.get(item.line.id) : undefined}
                romaji={showRomaji && item.line.romaji_of === (item.line.custom_text ?? item.line.text) ? item.line.romaji : undefined}
                hint={hints?.[item.line.id]}
                highlights={highlights}
                showFurigana={showFurigana}
                memorize={memorize}
                practice={practice}
                t={t}
                onPress={onPressLine}
                onLongPress={onLongPressLine}
              />
            );
          }}
        />
        {/* The lyrics fade out at the edges instead of being cut off */}
        {!vivid && <LinearGradient pointerEvents="none" colors={[p.wash, `${p.wash}00`]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 28 }} />}
        {!vivid && <LinearGradient pointerEvents="none" colors={[`${p.wash}00`, p.wash]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 56 }} />}
      </View>

      {/* The computer's review of a take from here just arrived */}
      {reviewReady && !rec.pending && !rec.busy && (
        <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(180)} style={{ position: "absolute", left: 14, right: 14, bottom: insets.bottom + (practice ? 300 : 190) }}>
          <Pressable
            onPress={() => {
              setTakeFocus(reviewReady.id);
              setTakesOpen(true);
              setReviewReady(null);
            }}
          >
            <Card t={t} style={{ flexDirection: "row", alignItems: "center", gap: 12, elevation: 6 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Label t={t}>Your take</Label>
                <Text style={{ fontSize: 15, color: t.text, lineHeight: 21 }}>{reviewReady.headline}</Text>
              </View>
              <Text style={{ fontSize: 14, color: p.tint, fontWeight: "600" }}>See</Text>
              <Pressable onPress={() => setReviewReady(null)} hitSlop={10}>
                <Text style={{ fontSize: 18, color: t.muted }}>×</Text>
              </Pressable>
            </Card>
          </Pressable>
        </Animated.View>
      )}

      {/* A take just finished */}
      {rec.pending && (
        <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(180)} style={{ position: "absolute", left: 14, right: 14, bottom: insets.bottom + (practice ? 300 : 190) }}>
          <Card t={t} style={{ gap: 12, elevation: 6 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 18, color: t.text }}>That take · {clock(rec.pending.durationMs)}</Text>
            <TextInput
              value={takeNote}
              onChangeText={setTakeNote}
              placeholder="How did it feel? (optional)"
              placeholderTextColor={t.muted}
              style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: t.text, backgroundColor: t.dark ? "#FFFFFF0D" : "#0000000A", fontFamily: "Inter_400Regular" }}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button
                t={t}
                tone={tone}
                label="Keep"
                style={{ flex: 1 }}
                onPress={async () => {
                  const pt = rec.pending!;
                  rec.setPending(null);
                  await keepTake(id, pt, takeNote);
                  setTakeNote("");
                }}
              />
              <Button
                t={t}
                kind="plain"
                label="Discard"
                onPress={() => {
                  void rec.discard();
                  setTakeNote("");
                }}
              />
            </View>
            <Text style={{ fontSize: 12, color: t.muted, lineHeight: 17 }}>
              {pairing ? "Kept takes go to your computer, and its breath / high-note review shows up here a few seconds later." : "Kept takes go to your computer once you pair, where breath and high notes are checked."}
            </Text>
          </Card>
        </Animated.View>
      )}
      {rec.countdown != null && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(250)} pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: p.wash, opacity: 0.94 }}>
          <Animated.View key={rec.countdown} entering={ZoomIn.springify().damping(12)}>
            <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 120, color: p.tint }}>{rec.countdown}</Text>
          </Animated.View>
          <Text style={{ fontSize: 14, color: t.muted }}>Headphones on — the song starts after the count</Text>
        </Animated.View>
      )}
      {!!rec.error && <Text style={{ position: "absolute", bottom: insets.bottom + 200, left: 16, right: 16, fontSize: 13, color: t.danger, textAlign: "center" }}>{rec.error}</Text>}

      <PlayerBar
        player={player}
        t={t}
        p={p}
        tracks={tracks.length ? tracks : ["audio"]}
        track={activeTrack}
        onTrack={setTrack}
        hasSection={!!cursorSection}
        practice={practice}
        onPractice={usePrefsStore.getState().setPracticeOpen}
        takes={takes.length}
        onTakes={() => setTakesOpen(true)}
        rec={rec}
        onRecord={startTake}
        onStop={() => void rec.stop()}
        recordLabel={recordLabel}
      />

      {/* ⋯ */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={song.title} t={appT}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, color: appT.text }}>Look</Text>
            <Text style={{ fontSize: 13, color: appT.muted, marginTop: 2 }}>{look === "vivid" ? "Dark, in the songs' colors" : "Light, with a touch of color"}</Text>
          </View>
          <Segmented t={appT} options={["classic", "vivid"] as const} value={look} onChange={usePrefsStore.getState().setLook} label={(v) => (v === "classic" ? "Classic" : "Vivid")} />
        </View>
        <View style={{ gap: 4 }}>
          {[
            card && { label: "About this song", sub: card.mood || "The coach's notes on the song", go: () => fromMenu(() => setAboutOpen(true)) },
            { label: "Takes", sub: takes.length ? `${takes.length} so far` : "None yet", go: () => fromMenu(() => setTakesOpen(true)) },
            { label: "Lyrics view", sub: "Romaji, translation, furigana, memorize", go: () => fromMenu(() => setViewOpen(true)) },
          ]
            .filter((x): x is { label: string; sub: string; go: () => void } => !!x)
            .map((x) => (
              <Pressable key={x.label} onPress={x.go} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, color: appT.text }}>{x.label}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: appT.muted, marginTop: 2 }}>
                    {x.sub}
                  </Text>
                </View>
                <View style={{ transform: [{ rotate: "-90deg" }] }}>
                  <ChevronIcon color={appT.muted} size={16} />
                </View>
              </Pressable>
            ))}
        </View>
      </Sheet>

      <LineSheet
        line={lineSheet != null ? lines[lineSheet] ?? null : null}
        lineNo={(lineSheet ?? 0) + 1}
        t={appT}
        onClose={() => setLineSheet(null)}
        onSave={(patch) => lineSheet != null && lines[lineSheet] && useLibraryStore.getState().editLine(id, lines[lineSheet].id, patch)}
        onLoop={() => {
          if (lineSheet == null) return;
          player.setLoop("line", lineSheet);
          void player.playLine(lineSheet);
        }}
      />

      <TakesSheet
        open={takesOpen}
        onClose={() => {
          setTakesOpen(false);
          setTakeFocus(null);
        }}
        focusId={takeFocus}
        songId={id}
        takes={takes}
        lines={lines}
        t={appT}
        onBeforePlay={() => void player.pause()}
        onJumpToLine={(idx) => {
          setTakesOpen(false);
          player.setCursor(idx);
          handsOffUntil.current = 0;
          const row = rowOfLine.get(idx);
          if (row != null) listRef.current?.scrollToIndex({ index: row, viewPosition: 0.3, animated: true });
        }}
      />

      {card && (
        <Sheet open={aboutOpen} onClose={() => setAboutOpen(false)} title="About this song" t={appT} tall>
          <SongCardView
            card={card}
            lines={lines}
            sections={sections}
            t={appT}
            onJump={(idx) => {
              setAboutOpen(false);
              void player.playLine(idx);
            }}
          />
          {!!coach?.memory.length && (
            <View style={{ marginTop: 22, gap: 8 }}>
              <Label t={appT}>What you've learned</Label>
              {coach.memory.map((m, i) => (
                <Text key={i} style={{ fontSize: 14, lineHeight: 20, color: appT.textSecondary }}>
                  {m}
                </Text>
              ))}
            </View>
          )}
        </Sheet>
      )}

      <Sheet open={viewOpen} onClose={() => setViewOpen(false)} title="Lyrics view" t={appT}>
        {[
          { label: "Romaji", sub: "How each line is pronounced", value: showRomaji, set: usePrefsStore.getState().setShowRomaji, hidden: !lines.some((l) => l.romaji) },
          { label: "Translation", value: showTranslation, set: usePrefsStore.getState().setShowTranslation, hidden: translations.length === 0 },
          { label: "Furigana", value: showFurigana, set: usePrefsStore.getState().setShowFurigana, hidden: !lines.some((l) => l.furigana_html || l.custom_furigana_html) },
          { label: "Song hints while practicing", sub: "The original's high notes and long phrases", value: showHints, set: usePrefsStore.getState().setShowHints, hidden: !snapshot?.hints?.[id] },
          { label: "Memorize", sub: "Only the first word of each line", value: memorize, set: usePrefsStore.getState().setMemorize, hidden: false },
        ]
          .filter((x) => !x.hidden)
          .map((x) => (
            <View key={x.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, color: appT.text }}>{x.label}</Text>
                {!!x.sub && <Text style={{ fontSize: 12.5, color: appT.muted, marginTop: 2 }}>{x.sub}</Text>}
              </View>
              <Toggle value={x.value} onChange={x.set} t={appT} />
            </View>
          ))}
        <Text style={{ fontSize: 12.5, color: appT.muted, marginTop: 10, lineHeight: 18 }}>
          Tap a line to play from it · swipe sideways for the previous / next line · hold a line for your note and voice mark · tap a section name for the coach's note on it.
        </Text>
      </Sheet>
    </View>
  );
}
