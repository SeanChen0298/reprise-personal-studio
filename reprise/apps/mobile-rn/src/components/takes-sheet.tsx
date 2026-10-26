// Takes for the song: the computer's (with its breath / high-note review) and the ones recorded here.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import { Text } from "./text";
import { Toggle } from "./toggle";
import { Audio } from "expo-av";
import { ISSUE_LABEL, isBreathIssue, issueClip, issueLineParts, reviewInsight, type Line, type Recording, type TakeIssue } from "@reprise/shared/core";
import { useLibraryStore } from "../stores/library-store";
import { Sheet } from "./sheet";
import { PauseIcon, PlayIcon, StarIcon, TrashIcon } from "./icons";
import { clock } from "../lib/format";
import type { Theme } from "../lib/theme";

type Take = Recording & { onPhone?: boolean };

interface Props {
  open: boolean;
  onClose: () => void;
  songId: string;
  takes: Take[];
  lines: Line[];
  t: Theme;
  /** Stop the song while a take plays. */
  onBeforePlay: () => void;
  onJumpToLine: (index: number) => void;
  /** Open with this take expanded (its review just arrived). */
  focusId?: string | null;
}

function when(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function TakesSheet({ open, onClose, songId, takes, lines, t, onBeforePlay, onJumpToLine, focusId }: Props) {
  const local = useLibraryStore((s) => s.local);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(takes[0]?.id ?? null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [withBacking, setWithBacking] = useState(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  const backingRef = useRef<Audio.Sound | null>(null);
  const backingUri = local.downloads[songId]?.instrumental?.uri;

  const stop = async () => {
    const s = soundRef.current;
    const b = backingRef.current;
    soundRef.current = null;
    backingRef.current = null;
    setPlaying(null);
    await Promise.all([s?.unloadAsync().catch(() => {}), b?.unloadAsync().catch(() => {})]);
  };
  useEffect(() => {
    if (!open) void stop();
    else setExpanded(focusId ?? takes[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(
    () => () => {
      void soundRef.current?.unloadAsync();
      void backingRef.current?.unloadAsync();
    },
    [],
  );

  /** Which clip is playing: `${issueKey}:orig` / `:you`. */
  const [clip, setClip] = useState<string | null>(null);
  const clipRef = useRef<Audio.Sound | null>(null);
  const stopClip = async () => {
    const s = clipRef.current;
    clipRef.current = null;
    setClip(null);
    await s?.unloadAsync().catch(() => {});
  };
  useEffect(() => () => void clipRef.current?.unloadAsync(), []);
  // The original singer's voice alone (the vocal track) when it's on the phone — voice against voice.
  const originalUri = local.downloads[songId]?.vocals?.uri ?? local.downloads[songId]?.audio?.uri;

  const playClip = async (uri: string, fromMs: number, toMs: number, key: string): Promise<void> => {
    await stopClip();
    await stop();
    onBeforePlay();
    return new Promise((resolve) => {
      Audio.Sound.createAsync({ uri }, { shouldPlay: true, positionMillis: Math.max(0, fromMs), progressUpdateIntervalMillis: 50 }, (st) => {
        if (!st.isLoaded) return;
        if (st.positionMillis >= toMs || st.didJustFinish) {
          void stopClip().then(() => resolve());
        }
      })
        .then(({ sound }) => {
          clipRef.current = sound;
          setClip(key);
        })
        .catch(() => resolve());
    });
  };

  const clipOriginal = (issue: TakeIssue, key: string) => {
    const c = issueClip(issue);
    return originalUri ? playClip(originalUri, c.fromMs, c.toMs, `${key}:orig`) : Promise.resolve();
  };
  const clipYou = async (take: Take, issue: TakeIssue, key: string) => {
    if (take.song_start_ms == null) return;
    const uri = await useLibraryStore.getState().fetchTakeAudio(take);
    if (!uri) return;
    const c = issueClip(issue);
    const shift = -take.song_start_ms + (take.analysis?.lag_ms ?? 0);
    await playClip(uri, c.fromMs + shift, c.toMs + shift, `${key}:you`);
  };
  const clipBoth = async (take: Take, issue: TakeIssue, key: string) => {
    await clipOriginal(issue, key);
    await new Promise((r) => setTimeout(r, 350));
    await clipYou(take, issue, key);
  };

  const play = async (take: Take) => {
    if (playing === take.id) return stop();
    await stop();
    onBeforePlay();
    setLoading(take.id);
    const uri = await useLibraryStore.getState().fetchTakeAudio(take);
    setLoading(null);
    if (!uri) {
      Alert.alert("Can't play this take", "It's on the computer — sync when you're on the same Wi-Fi to fetch it.");
      return;
    }
    try {
      // Sung-along takes can play with the backing under them, lined up like on the computer.
      const songMs = take.song_start_ms != null ? take.song_start_ms - (take.analysis?.lag_ms ?? 0) : null;
      const mix = withBacking && backingUri && songMs != null;
      const takeFrom = mix ? Math.max(0, -songMs) : 0;
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, positionMillis: takeFrom }, (st) => {
        if (st.isLoaded && st.didJustFinish) void stop();
      });
      let backing: Audio.Sound | null = null;
      if (mix) {
        backing = (await Audio.Sound.createAsync({ uri: backingUri }, { shouldPlay: false, volume: 0.55, positionMillis: Math.max(0, songMs) })).sound;
      }
      soundRef.current = sound;
      backingRef.current = backing;
      await Promise.all([sound.playAsync(), backing?.playAsync()]);
      setPlaying(take.id);
    } catch (err) {
      Alert.alert("Can't play this take", err instanceof Error ? err.message : String(err));
    }
  };

  const lineIndex = (id?: string) => (id ? lines.findIndex((l) => l.id === id) : -1);

  return (
    <Sheet open={open} onClose={onClose} title={`Takes · ${takes.length}`} t={t}>
      {takes.length === 0 && (
        <Text style={{ fontSize: 14, color: t.muted, lineHeight: 20 }}>
          No takes yet. Tap Record to sing along from the current line — use headphones so the song doesn't go into the mic.
        </Text>
      )}
      {!!backingUri && takes.some((x) => x.song_start_ms != null) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Toggle value={withBacking} onChange={setWithBacking} t={t} />
          <Text style={{ fontSize: 13.5, color: t.textSecondary }}>Play with the backing under it</Text>
        </View>
      )}
      <View style={{ gap: 10 }}>
        {takes.map((take) => {
          const open = expanded === take.id;
          const insight = take.analysis ? reviewInsight(take.analysis) : null;
          const pending = take.onPhone && !local.takes.find((x) => x.id === take.id)?.uploaded;
          const source = take.onPhone ? (pending ? "On this phone · not sent yet" : "Sung on the phone") : "";
          const sungWith = take.backing ? `with ${take.backing === "original" ? "the song" : take.backing === "instrumental" ? "the backing" : "the vocals"}` : "";
          return (
            <Pressable key={take.id} onPress={() => setExpanded(open ? null : take.id)} style={{ borderRadius: 18, backgroundColor: (t.dark ? "#FFFFFF0D" : "#0000000A"), padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable onPress={() => play(take)} hitSlop={8} style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: t.surface }}>
                  {loading === take.id ? (
                    <ActivityIndicator size="small" color={t.theme} />
                  ) : playing === take.id ? (
                    <PauseIcon color={t.theme} size={15} />
                  ) : (
                    <PlayIcon color={t.theme} size={15} />
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "500", color: t.text }}>{when(take.created_at)}</Text>
                  <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 1 }}>{[clock(take.duration_ms), sungWith, source].filter(Boolean).join(" · ")}</Text>
                </View>
                {!pending && (
                  <Pressable onPress={() => useLibraryStore.getState().editTake(songId, take.id, { is_best_take: !take.is_best_take })} hitSlop={8}>
                    <StarIcon color={take.is_best_take ? "#F59E0B" : t.muted} filled={take.is_best_take} size={19} />
                  </Pressable>
                )}
                {pending && (
                  <Pressable
                    onPress={() =>
                      Alert.alert("Delete this take?", "It hasn't been sent to the computer yet.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => useLibraryStore.getState().deleteLocalTake(take.id) },
                      ])
                    }
                    hitSlop={8}
                  >
                    <TrashIcon color={t.muted} size={18} />
                  </Pressable>
                )}
              </View>

              {editing?.id === take.id ? (
                <TextInput
                  autoFocus
                  value={editing.text}
                  onChangeText={(text) => setEditing({ id: take.id, text })}
                  onBlur={() => {
                    const text = editing.text.trim();
                    if (text !== (take.note ?? "")) useLibraryStore.getState().editTake(songId, take.id, { note: text || null });
                    setEditing(null);
                  }}
                  placeholder="How did it go?"
                  placeholderTextColor={t.muted}
                  style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: t.text, backgroundColor: t.surface, fontFamily: "Inter_400Regular" }}
                />
              ) : (
                <Pressable onPress={() => setEditing({ id: take.id, text: take.note ?? "" })}>
                  <Text style={{ fontSize: 13.5, color: take.note ? t.textSecondary : t.muted, fontStyle: take.note ? "italic" : "normal" }}>
                    {take.note ? `“${take.note}”` : "+ note"}
                  </Text>
                </Pressable>
              )}

              {open && insight && take.analysis && (
                <View style={{ gap: 8, marginTop: 2 }}>
                  <Text style={{ fontSize: 14, color: t.text, fontWeight: "600" }}>{insight.headline}</Text>
                  {insight.tips.map((tip, i) => (
                    <Text key={i} style={{ fontSize: 13.5, lineHeight: 19, color: t.textSecondary }}>
                      {tip}
                    </Text>
                  ))}
                  {take.analysis.issues.slice(0, 12).map((issue, i) => {
                    const idx = lineIndex(issue.line_id);
                    const l = idx >= 0 ? lines[idx] : null;
                    const text = l ? l.custom_text ?? l.text : "";
                    const parts = l ? issueLineParts(text, issue) : null;
                    const key = `${take.id}:${i}`;
                    const tone = isBreathIssue(issue.kind) ? "#0EA5E9" : "#F59E0B";
                    const clipBtn = (label: string, k: string, go: () => void) => (
                      <Pressable
                        key={label}
                        onPress={() => (clip?.startsWith(key) ? void stopClip() : go())}
                        hitSlop={6}
                        style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: clip === `${key}:${k}` ? t.theme : t.surface }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "500", color: clip === `${key}:${k}` ? t.onAccent : t.textSecondary }}>{label}</Text>
                      </Pressable>
                    );
                    return (
                      <View key={i} style={{ gap: 6, paddingTop: 6 }}>
                        <Pressable onPress={() => idx >= 0 && onJumpToLine(idx)} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: tone }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13.5, color: t.text }}>
                              {ISSUE_LABEL[issue.kind]} <Text style={{ color: t.muted }}>· {issue.detail}</Text>
                            </Text>
                            {l && (
                              <Text numberOfLines={2} style={{ fontSize: 15, color: t.muted, fontFamily: "serif", marginTop: 2 }}>
                                {parts ? (
                                  <>
                                    {parts[0]}
                                    <Text style={{ fontFamily: "serif", color: t.text, textDecorationLine: "underline", textDecorationColor: tone, fontWeight: "600" }}>{parts[1]}</Text>
                                    {parts[2]}
                                  </>
                                ) : (
                                  text
                                )}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                        {take.song_start_ms != null && (
                          <View style={{ flexDirection: "row", gap: 6, paddingLeft: 15 }}>
                            {!!originalUri && clipBtn("Original", "orig", () => void clipOriginal(issue, key))}
                            {clipBtn("You", "you", () => void clipYou(take, issue, key))}
                            {!!originalUri && clipBtn("Both", "both", () => void clipBoth(take, issue, key))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {open && !take.analysis && take.song_start_ms != null && (
                <Text style={{ fontSize: 12.5, color: t.muted }}>
                  {pending ? "The computer checks breath and high notes once it has the take." : "Not reviewed yet — the computer reviews takes sung along with the song."}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
