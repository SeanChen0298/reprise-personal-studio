// The coach's warm-up for this song (made on the computer): drills in order, each with why, how and
// a picture to imagine; a drill with a note pattern plays its notes to sing along with (the same
// synth as the desktop, written to a WAV in the cache).
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { DISPLAY_REGULAR, Text } from "./text";
import { Sheet } from "./sheet";
import { PauseIcon, PlayIcon } from "./icons";
import { parseLineRefs, renderDrill, toBase64, type Line, type Warmup, type WarmupDrill } from "@reprise/shared/core";
import type { Theme } from "../lib/theme";

/** A short, stable name for a drill's notes (the cached WAV's file name). */
function drillKey(d: WarmupDrill): string {
  const s = JSON.stringify([d.pattern, d.from, d.to, d.glide, d.tempo]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `drill-${(h >>> 0).toString(36)}.wav`;
}

async function drillFile(d: WarmupDrill): Promise<string | null> {
  const path = `${FileSystem.cacheDirectory}${drillKey(d)}`;
  if ((await FileSystem.getInfoAsync(path)).exists) return path;
  const bytes = renderDrill(d, 22050);
  if (!bytes) return null;
  await FileSystem.writeAsStringAsync(path, toBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
  return path;
}

export function WarmupSheet({ open, onClose, warmup, lines, t, onBeforePlay, onJump }: {
  open: boolean;
  onClose: () => void;
  warmup: Warmup;
  lines: Line[];
  t: Theme;
  /** Pause the song before the notes play. */
  onBeforePlay: () => void;
  onJump: (lineIndex: number) => void;
}) {
  const [playing, setPlaying] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const sound = useRef<Audio.Sound | null>(null);

  const stop = async () => {
    const s = sound.current;
    sound.current = null;
    setPlaying(null);
    setProgress(0);
    if (s) await s.unloadAsync().catch(() => {});
  };
  useEffect(() => {
    if (!open) void stop();
  }, [open]);
  useEffect(() => () => void stop(), []);

  const play = async (i: number, d: WarmupDrill) => {
    const was = playing;
    await stop();
    if (was === i) return;
    onBeforePlay();
    setLoading(i);
    try {
      // Let the spinner show before the notes are rendered.
      await new Promise((r) => setTimeout(r, 30));
      const uri = await drillFile(d);
      if (!uri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, progressUpdateIntervalMillis: 100 }, (st) => {
        if (!st.isLoaded) return;
        if (st.durationMillis) setProgress(st.positionMillis / st.durationMillis);
        if (st.didJustFinish) void stop();
      });
      sound.current = s;
      setPlaying(i);
    } finally {
      setLoading(null);
    }
  };

  const fill = t.dark ? "#FFFFFF0D" : "#0000000A";
  const lineText = (n: number) => {
    const l = lines[n - 1];
    const s = l ? (l.custom_text ?? l.text).trim() : "";
    return s.length > 14 ? `${s.slice(0, 14)}…` : s;
  };

  return (
    <Sheet open={open} onClose={onClose} title="Warm up" t={t} tall>
      <View style={{ gap: 22 }}>
        {!!warmup.focus && (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: DISPLAY_REGULAR, fontSize: 18, lineHeight: 26, color: t.text }}>{warmup.focus.replace(/\s*\(?L\d+(?:\s*[-–]\s*L?\d+)?\)?/g, "").trim()}</Text>
            <Text style={{ fontSize: 13, color: t.muted }}>About {warmup.minutes} minutes · {warmup.drills.length} drills</Text>
          </View>
        )}
        {warmup.drills.map((d, i) => {
          const refs = parseLineRefs(d.lines ?? "");
          const voice = [d.register, d.placement].filter(Boolean).join(" · ");
          return (
            <View key={i} style={{ flexDirection: "row", gap: 14 }}>
              <Text style={{ width: 16, fontSize: 13, color: t.muted, marginTop: 2 }}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: t.text }}>{d.name}</Text>
                    <Text style={{ fontSize: 12.5, color: t.muted, marginTop: 1 }}>
                      {d.minutes} min{d.syllable ? ` · “${d.syllable}”` : ""}{d.pattern?.length ? ` · ${d.from}–${d.to}` : ""}
                    </Text>
                  </View>
                  {!!d.pattern?.length && (
                    <Pressable
                      onPress={() => void play(i, d)}
                      hitSlop={8}
                      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: playing === i ? t.accent : fill, opacity: pressed ? 0.7 : 1 })}
                    >
                      {loading === i ? (
                        <ActivityIndicator size="small" color={t.muted} />
                      ) : playing === i ? (
                        <PauseIcon color={t.onAccent} size={16} />
                      ) : (
                        <PlayIcon color={t.text} size={16} />
                      )}
                    </Pressable>
                  )}
                </View>
                {playing === i && (
                  <View style={{ height: 2, borderRadius: 1, backgroundColor: fill, overflow: "hidden" }}>
                    <View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: t.accent }} />
                  </View>
                )}
                {!!d.purpose && <Text style={{ fontSize: 14, lineHeight: 20, color: t.textSecondary }}>{d.purpose}</Text>}
                <Text style={{ fontSize: 14.5, lineHeight: 21, color: t.text }}>{d.how}</Text>
                {(!!d.image || !!voice) && (
                  <Text style={{ fontSize: 13.5, lineHeight: 19, color: t.muted }}>
                    {!!voice && <Text style={{ color: t.voice }}>{voice}</Text>}
                    {!!voice && !!d.image ? " — " : ""}
                    {!!d.image && <Text style={{ fontStyle: "italic", color: t.muted }}>{d.image}</Text>}
                  </Text>
                )}
                {refs.length > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
                    {refs.map(([a, b], k) => (
                      <Pressable
                        key={k}
                        onPress={() => onJump(a - 1)}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "baseline", gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: fill, opacity: pressed ? 0.6 : 1 })}
                      >
                        {!!lineText(a) && <Text style={{ fontFamily: "serif", fontSize: 13, color: t.text }}>{lineText(a)}</Text>}
                        <Text style={{ fontSize: 10.5, color: t.muted }}>{a}{b > a ? `–${b}` : ""}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>
          );
        })}
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: t.muted }}>
          ▶ plays the notes: the start note first, then the pattern, a half step higher each time. Sing along softly — if anything strains, lighten or stop.
        </Text>
      </View>
    </Sheet>
  );
}
