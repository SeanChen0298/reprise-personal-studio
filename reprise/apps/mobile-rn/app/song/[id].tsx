// The song: lyrics that follow the music, loops, speed, tracks, sung-along takes,
// your notes and voice marks, and the coach's song card from the computer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, PanResponder, Pressable, Switch, Text, TextInput, View } from "react-native";
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
import { useTheme } from "../../src/lib/theme";
import { clock, megabytes } from "../../src/lib/format";
import { LyricRow } from "../../src/components/lyric-row";
import { Transport } from "../../src/components/transport";
import { LineSheet } from "../../src/components/line-sheet";
import { TakesSheet } from "../../src/components/takes-sheet";
import { SongCardView } from "../../src/components/song-card-view";
import { Sheet } from "../../src/components/sheet";
import { BackIcon, ChevronIcon, DownloadIcon } from "../../src/components/icons";
import { pauseRadio } from "../../src/lib/radio";

type Row = { kind: "section"; section: Section; key: string } | { kind: "line"; line: Line; index: number; key: string };

/** Don't follow the playhead for this long after you scroll yourself. */
const HANDS_OFF_MS = 5000;

const TAKES_DIR = `${FileSystem.documentDirectory}phone-takes/`;

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
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const snapshot = useLibraryStore((s) => s.snapshot);
  const local = useLibraryStore((s) => s.local);
  const pairing = useLibraryStore((s) => s.pairing);
  const downloading = useLibraryStore((s) => s.downloading[id]);
  const showTranslation = usePrefsStore((s) => s.showTranslation);
  const showFurigana = usePrefsStore((s) => s.showFurigana);
  const showHints = usePrefsStore((s) => s.showHints);
  const countIn = usePrefsStore((s) => s.countIn);
  const autoDownload = usePrefsStore((s) => s.autoDownload);
  const memorise = usePrefsStore((s) => s.memorise);
  const [focus, setFocus] = useState(false);

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
  const hints = showHints && !focus ? snapshot?.hints?.[id] : undefined;

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
  const keep = useCallback((p: PendingTake) => void keepTake(id, p, ""), [id]);
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

  const listRef = useRef<FlatList<Row>>(null);
  const handsOffUntil = useRef(0);
  const active = player.activeIndex;
  useEffect(() => {
    if (Date.now() < handsOffUntil.current) return;
    const row = rowOfLine.get(active);
    if (row == null) return;
    listRef.current?.scrollToIndex({ index: row, viewPosition: 0.32, animated: true });
  }, [active, rowOfLine]);

  const [lineSheet, setLineSheet] = useState<number | null>(null);
  const [takesOpen, setTakesOpen] = useState(false);
  const [takeFocus, setTakeFocus] = useState<string | null>(null);

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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

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
  const recordLabel = player.loop === "section" && cursorSection ? `Record ${cursorSection.name}` : "Record";

  if (!song) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg, padding: 24 }}>
        <Text style={{ color: t.textSecondary, fontSize: 15, textAlign: "center" }}>This song isn't in the library any more.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 14 }}>
          <Text style={{ color: t.theme, fontSize: 15 }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const hasTimings = lines.some((l) => l.start_ms != null);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 6, paddingLeft: 10, paddingRight: 16, paddingBottom: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <BackIcon color={t.text} size={22} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: "serif", fontSize: 19, color: t.text }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted }}>
            {song.artist}
          </Text>
        </View>
        <Pressable onPress={() => setViewOpen(true)} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
          <Text style={{ fontSize: 15, color: t.textSecondary, fontFamily: "serif" }}>Aa</Text>
        </Pressable>
        <Pressable onPress={() => setTakesOpen(true)} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderSubtle }}>
          <Text style={{ fontSize: 13, color: t.textSecondary }}>Takes {takes.length || ""}</Text>
        </Pressable>
      </View>

      {/* About this song (coach card) */}
      {card && !focus && (
        <Pressable onPress={() => setAboutOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingBottom: 6 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.muted }}>
            About this song{card.mood ? ` · ${card.mood}` : ""}
          </Text>
          <ChevronIcon color={t.muted} size={14} />
        </Pressable>
      )}

      {/* Audio not here yet */}
      {!uri && (
        <View style={{ marginHorizontal: 16, marginBottom: 6, padding: 12, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderSubtle, flexDirection: "row", alignItems: "center", gap: 10 }}>
          {downloading != null ? (
            <>
              <ActivityIndicator color={t.theme} size="small" />
              <Text style={{ flex: 1, fontSize: 13.5, color: t.textSecondary }}>Getting the audio… {Math.round(downloading * 100)}%</Text>
            </>
          ) : files?.audio ? (
            pairing ? (
              <>
                <Text style={{ flex: 1, fontSize: 13.5, color: t.textSecondary }}>The audio isn't on this phone yet.</Text>
                <Pressable onPress={() => useLibraryStore.getState().downloadSong(id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: t.accent }}>
                  <DownloadIcon color={t.onAccent} size={14} />
                  <Text style={{ color: t.onAccent, fontSize: 13, fontWeight: "600" }}>{megabytes(missingBytes)}</Text>
                </Pressable>
              </>
            ) : (
              <Text style={{ flex: 1, fontSize: 13.5, color: t.textSecondary }}>Pair with your computer to get the audio.</Text>
            )
          ) : (
            <Text style={{ flex: 1, fontSize: 13.5, color: t.textSecondary }}>The computer hasn't downloaded this song's audio yet.</Text>
          )}
        </View>
      )}
      {uri && downloading != null && (
        <Text style={{ fontSize: 12, color: t.muted, paddingHorizontal: 18, paddingBottom: 4 }}>Getting the other tracks… {Math.round(downloading * 100)}%</Text>
      )}
      {!!player.error && <Text style={{ fontSize: 12.5, color: t.danger, paddingHorizontal: 18 }}>Can't play: {player.error}</Text>}

      {/* Lyrics */}
      <View style={{ flex: 1 }} {...swipe.panHandlers}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 260 }}
        onScrollBeginDrag={() => (handsOffUntil.current = Date.now() + HANDS_OFF_MS)}
        onMomentumScrollEnd={() => (handsOffUntil.current = Date.now() + HANDS_OFF_MS)}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.32, animated: true }), 120);
        }}
        ListEmptyComponent={<Text style={{ textAlign: "center", color: t.muted, marginTop: 40, fontSize: 14 }}>No lyrics yet — add them on the computer.</Text>}
        ListHeaderComponent={!hasTimings && lines.length > 0 ? <Text style={{ textAlign: "center", color: t.muted, fontSize: 12.5, marginBottom: 10 }}>These lyrics have no timing yet, so they won't follow the music.</Text> : null}
        renderItem={({ item }) => {
          if (item.kind === "section") {
            const c = cardSection.get(item.section.name.trim().toLowerCase());
            const voice = [c?.voice?.register, c?.voice?.placement].filter(Boolean).join(" · ");
            return (
              <View style={{ alignItems: "center", marginTop: 22, marginBottom: 6, gap: 3 }}>
                <Text style={{ fontSize: 11.5, fontWeight: "700", letterSpacing: 1.4, color: t.muted, textTransform: "uppercase" }}>{item.section.name}</Text>
                {!focus && c && (c.mood || voice) && (
                  <Text style={{ fontSize: 12, color: t.muted }}>
                    {c.mood}
                    {c.mood && voice ? " · " : ""}
                    <Text style={{ color: t.voice }}>{voice}</Text>
                  </Text>
                )}
              </View>
            );
          }
          return (
            <LyricRow
              line={item.line}
              index={item.index}
              active={item.index === active}
              distance={Math.abs(item.index - active)}
              translation={showTranslation ? transById.get(item.line.id) : undefined}
              hint={hints?.[item.line.id]}
              highlights={highlights}
              showFurigana={showFurigana}
              memorise={memorise}
              t={t}
              onPress={onPressLine}
              onLongPress={onLongPressLine}
            />
          );
        }}
      />
      </View>

      {/* The computer's review of a take from here just arrived */}
      {reviewReady && !rec.pending && !rec.busy && (
        <Pressable
          onPress={() => {
            setTakeFocus(reviewReady.id);
            setTakesOpen(true);
            setReviewReady(null);
          }}
          style={{ position: "absolute", left: 12, right: 12, bottom: insets.bottom + 190, padding: 14, borderRadius: 14, backgroundColor: t.raised, borderWidth: 1, borderColor: t.border, elevation: 6, flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 1, color: t.theme, textTransform: "uppercase" }}>Your take's review</Text>
            <Text style={{ fontSize: 14.5, color: t.text, marginTop: 3, lineHeight: 20 }}>{reviewReady.headline}</Text>
          </View>
          <Text style={{ fontSize: 13.5, color: t.theme, fontWeight: "600" }}>See</Text>
          <Pressable onPress={() => setReviewReady(null)} hitSlop={10}>
            <Text style={{ fontSize: 18, color: t.muted }}>×</Text>
          </Pressable>
        </Pressable>
      )}

      {/* A take just finished */}
      {rec.pending && (
        <View style={{ position: "absolute", left: 12, right: 12, bottom: insets.bottom + 190, padding: 14, borderRadius: 14, backgroundColor: t.raised, borderWidth: 1, borderColor: t.border, gap: 10, elevation: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: t.text }}>Take · {clock(rec.pending.durationMs)}</Text>
          <TextInput
            value={takeNote}
            onChangeText={setTakeNote}
            placeholder="How did it go? (optional)"
            placeholderTextColor={t.muted}
            style={{ borderWidth: 1.5, borderColor: t.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14.5, color: t.text }}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={async () => {
                const p = rec.pending!;
                rec.setPending(null);
                await keepTake(id, p, takeNote);
                setTakeNote("");
              }}
              style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: t.accent }}
            >
              <Text style={{ color: t.onAccent, fontWeight: "600", fontSize: 14.5 }}>Keep</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void rec.discard();
                setTakeNote("");
              }}
              style={{ paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1.5, borderColor: t.border }}
            >
              <Text style={{ color: t.textSecondary, fontSize: 14.5 }}>Discard</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: t.muted }}>
            {pairing ? "A kept take goes to your computer right away when it's reachable; its breath / high-note review shows up here a few seconds later." : "Kept takes go to your computer when you pair, where breath and high notes are checked."}
          </Text>
        </View>
      )}
      {rec.countdown != null && (
        <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: t.dark ? "rgba(12,12,16,0.82)" : "rgba(249,249,249,0.86)" }}>
          <Text style={{ fontSize: 96, fontWeight: "200", color: t.danger }}>{rec.countdown}</Text>
          <Text style={{ fontSize: 14, color: t.muted }}>Headphones on — the song starts after the count</Text>
        </View>
      )}
      {!!rec.error && <Text style={{ position: "absolute", bottom: insets.bottom + 180, left: 16, right: 16, fontSize: 13, color: t.danger, textAlign: "center" }}>{rec.error}</Text>}

      <Transport
        player={player}
        t={t}
        tracks={tracks.length ? tracks : ["audio"]}
        track={activeTrack}
        onTrack={setTrack}
        hasSection={!!cursorSection}
        rec={rec}
        onRecord={startTake}
        onStop={() => void rec.stop()}
        recordLabel={recordLabel}
      />

      <LineSheet
        line={lineSheet != null ? lines[lineSheet] ?? null : null}
        lineNo={(lineSheet ?? 0) + 1}
        t={t}
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
        t={t}
        onBeforePlay={() => void player.pause()}
        onJumpToLine={(idx) => {
          setTakesOpen(false);
          player.setCursor(idx);
          handsOffUntil.current = 0;
          const row = rowOfLine.get(idx);
          if (row != null) listRef.current?.scrollToIndex({ index: row, viewPosition: 0.32, animated: true });
        }}
      />

      {card && (
        <Sheet open={aboutOpen} onClose={() => setAboutOpen(false)} title="About this song" t={t}>
          <SongCardView
            card={card}
            lines={lines}
            t={t}
            onJump={(idx) => {
              setAboutOpen(false);
              void player.playLine(idx);
            }}
          />
          {!!coach?.memory.length && (
            <View style={{ marginTop: 18, gap: 6 }}>
              <Text style={{ fontSize: 10.5, fontWeight: "700", letterSpacing: 1, color: t.muted, textTransform: "uppercase" }}>What you've learned</Text>
              {coach.memory.map((m, i) => (
                <Text key={i} style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary }}>
                  • {m}
                </Text>
              ))}
            </View>
          )}
        </Sheet>
      )}

      <Sheet open={viewOpen} onClose={() => setViewOpen(false)} title="View" t={t}>
        {[
          { label: "Translation", value: showTranslation, set: usePrefsStore.getState().setShowTranslation, hidden: translations.length === 0 },
          { label: "Furigana", value: showFurigana, set: usePrefsStore.getState().setShowFurigana, hidden: !lines.some((l) => l.furigana_html || l.custom_furigana_html) },
          { label: "Song hints (high notes, long phrases)", value: showHints, set: usePrefsStore.getState().setShowHints, hidden: !snapshot?.hints?.[id] },
          { label: "Focus (hide the coach's notes and hints)", value: focus, set: setFocus, hidden: !card && !snapshot?.hints?.[id] },
          { label: "Memorise (only the first word of each line)", value: memorise, set: usePrefsStore.getState().setMemorise, hidden: false },
        ]
          .filter((x) => !x.hidden)
          .map((x) => (
            <View key={x.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ flex: 1, fontSize: 15, color: t.text }}>{x.label}</Text>
              <Switch value={x.value} onValueChange={x.set} trackColor={{ true: t.theme, false: t.border }} thumbColor="#fff" />
            </View>
          ))}
        <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 8, lineHeight: 18 }}>
          Tap a line to play from it · swipe sideways for the previous / next line · hold a line for your note and voice mark · Loop cycles line → section → off · Record sings along from the current line (with a section loop on, it records that section).
        </Text>
      </Sheet>
    </View>
  );
}
