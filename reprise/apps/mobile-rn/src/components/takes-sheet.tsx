// Takes for the song: the computer's (with its breath / high-note review) and the ones recorded here.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import { Text } from "./text";
import { Audio } from "expo-av";
import { ISSUE_LABEL, isBreathIssue, reviewInsight, type Line, type Recording } from "@reprise/shared/core";
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
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
        <Pressable onPress={() => setWithBacking((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, alignSelf: "flex-start" }}>
          <View style={{ width: 34, height: 20, borderRadius: 10, padding: 2, backgroundColor: withBacking ? t.theme : t.border, alignItems: withBacking ? "flex-end" : "flex-start" }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" }} />
          </View>
          <Text style={{ fontSize: 13.5, color: t.textSecondary }}>Play with the backing under it</Text>
        </Pressable>
      )}
      <View style={{ gap: 10 }}>
        {takes.map((take) => {
          const open = expanded === take.id;
          const insight = take.analysis ? reviewInsight(take.analysis) : null;
          const pending = take.onPhone && !local.takes.find((x) => x.id === take.id)?.uploaded;
          const source = take.onPhone ? (pending ? "On this phone · not sent yet" : "From this phone") : "On the computer";
          return (
            <Pressable key={take.id} onPress={() => setExpanded(open ? null : take.id)} style={{ borderRadius: 12, borderWidth: 1, borderColor: open ? t.border : t.borderSubtle, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable onPress={() => play(take)} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: t.themeSoft }}>
                  {loading === take.id ? (
                    <ActivityIndicator size="small" color={t.theme} />
                  ) : playing === take.id ? (
                    <PauseIcon color={t.theme} size={15} />
                  ) : (
                    <PlayIcon color={t.theme} size={15} />
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, color: t.text }}>
                    {when(take.created_at)} · {clock(take.duration_ms)}
                  </Text>
                  <Text style={{ fontSize: 12, color: t.muted }}>
                    {source}
                    {take.backing ? ` · sung with ${take.backing === "original" ? "the song" : take.backing === "instrumental" ? "the backing" : "the vocals"}` : ""}
                  </Text>
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
                  style={{ borderWidth: 1.5, borderColor: t.border, borderRadius: 8, padding: 8, fontSize: 14, color: t.text }}
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
                    return (
                      <Pressable key={i} onPress={() => idx >= 0 && onJumpToLine(idx)} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: isBreathIssue(issue.kind) ? "#0EA5E9" : "#F59E0B" }} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13.5, color: t.text }}>
                            {ISSUE_LABEL[issue.kind]} <Text style={{ color: t.muted }}>· {issue.detail}</Text>
                          </Text>
                          {l && (
                            <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.theme }}>
                              L{idx + 1} {l.custom_text ?? l.text}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {open && !take.analysis && take.song_start_ms != null && (
                <Text style={{ fontSize: 12.5, color: t.muted }}>
                  {pending ? "The computer checks breath and high notes once it has the take." : "Not reviewed yet — the computer reviews it after the next sync."}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
