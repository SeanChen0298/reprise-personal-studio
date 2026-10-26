// The song screen's bottom: the song's progress and play controls, like a music player, and a
// Practise tray you pull up for loop, speed, track, takes and Record.
import { useRef, useState } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LinePlayer, LoopMode } from "../hooks/use-line-player";
import type { TrackKind } from "../stores/library-store";
import type { Theme } from "../lib/theme";
import type { SongPalette } from "../lib/song-palette";
import { clock } from "../lib/format";
import { Text } from "./text";
import { PressableScale } from "./pressable-scale";
import { Button, Segmented } from "./ui";
import { ChevronIcon, MicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, StopIcon } from "./icons";

const TRACK_LABEL: Record<TrackKind, string> = { audio: "Original", instrumental: "Backing", vocals: "Vocals" };
const LOOP_LABEL: Record<LoopMode, string> = { off: "Off", line: "Line", section: "Section" };

interface Props {
  player: LinePlayer;
  t: Theme;
  p: SongPalette;
  tracks: TrackKind[];
  track: TrackKind;
  onTrack: (k: TrackKind) => void;
  hasSection: boolean;
  practise: boolean;
  onPractise: (open: boolean) => void;
  takes: number;
  onTakes: () => void;
  rec: { busy: boolean; recording: boolean; countdown: number | null; elapsedMs: number };
  onRecord: () => void;
  onStop: () => void;
  recordLabel: string;
}

export function PlayerBar({ player, t, p, tracks, track, onTrack, hasSection, practise, onPractise, takes, onTakes, rec, onRecord, onStop, recordLabel }: Props) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const dur = player.durationMs || 1;
  const pos = drag ?? player.positionMs;
  const at = (e: GestureResponderEvent) => Math.min(1, Math.max(0, e.nativeEvent.locationX / width)) * dur;
  const setD = (v: number | null) => {
    dragRef.current = v;
    setDrag(v);
  };
  const fill = rec.recording ? t.danger : p.solid;
  const tone = { solid: p.solid, onSolid: p.onSolid, soft: p.soft, tint: p.tint };

  return (
    <Animated.View layout={LinearTransition.springify().damping(20)} style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: insets.bottom + 6 }}>
      {/* Progress */}
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => !rec.busy}
        onMoveShouldSetResponder={() => !rec.busy}
        onResponderGrant={(e) => setD(at(e))}
        onResponderMove={(e) => setD(at(e))}
        onResponderRelease={() => {
          if (dragRef.current != null) void player.seek(dragRef.current);
          setD(null);
        }}
        onResponderTerminate={() => setD(null)}
        hitSlop={{ top: 12, bottom: 8 }}
        style={{ height: 22, justifyContent: "center" }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.dark ? "#FFFFFF1F" : "#0000001A" }}>
          <View style={{ height: 4, borderRadius: 2, width: `${(pos / dur) * 100}%`, backgroundColor: fill }} />
          <View style={{ position: "absolute", top: drag != null ? -6 : -4, left: `${(pos / dur) * 100}%`, marginLeft: drag != null ? -8 : -6, width: drag != null ? 16 : 12, height: drag != null ? 16 : 12, borderRadius: 8, backgroundColor: fill }} />
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11.5, color: t.muted, fontVariant: ["tabular-nums"] }}>{clock(pos)}</Text>
        <Text style={{ fontSize: 11.5, color: t.muted, fontVariant: ["tabular-nums"] }}>{clock(player.durationMs)}</Text>
      </View>

      {/* Play controls */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 34, marginTop: 2 }}>
        <PressableScale scaleTo={0.85} onPress={() => player.step(-1)} disabled={rec.busy} style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", opacity: rec.busy ? 0.35 : 1 }}>
          <PrevIcon color={t.text} size={24} />
        </PressableScale>
        <PressableScale
          haptic
          scaleTo={0.9}
          onPress={() => player.toggle()}
          disabled={rec.busy || !player.ready}
          style={{ width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: p.solid, opacity: player.ready && !rec.busy ? 1 : 0.4 }}
        >
          {player.isPlaying ? <PauseIcon color={p.onSolid} size={26} /> : <PlayIcon color={p.onSolid} size={26} />}
        </PressableScale>
        <PressableScale scaleTo={0.85} onPress={() => player.step(1)} disabled={rec.busy} style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", opacity: rec.busy ? 0.35 : 1 }}>
          <NextIcon color={t.text} size={24} />
        </PressableScale>
      </View>

      {/* Practise tray */}
      {rec.busy ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ alignItems: "center", marginTop: 10 }}>
          <Button
            t={t}
            danger
            label={rec.countdown != null ? `Starting… ${rec.countdown}` : `Stop · ${clock(rec.elapsedMs)}`}
            icon={<StopIcon color="#fff" size={13} />}
            onPress={onStop}
            style={{ paddingHorizontal: 26 }}
          />
        </Animated.View>
      ) : (
        <>
          <Pressable onPress={() => onPractise(!practise)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: practise ? p.tint : t.muted }}>Practise</Text>
            <ChevronIcon color={practise ? p.tint : t.muted} size={14} up={!practise} />
          </Pressable>
          {practise && (
            <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={{ gap: 12, paddingTop: 2, paddingBottom: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ width: 52, fontSize: 12.5, color: t.muted }}>Loop</Text>
                <Segmented
                  t={t}
                  options={(hasSection ? ["off", "line", "section"] : ["off", "line"]) as LoopMode[]}
                  value={player.loop}
                  onChange={(m) => player.setLoop(m)}
                  label={(m) => LOOP_LABEL[m]}
                />
                <View style={{ flex: 1 }} />
                <PressableScale haptic scaleTo={0.88} onPress={() => player.setSpeed(player.speed - 0.05)} disabled={player.speed <= 0.5} style={{ width: 32, height: 34, alignItems: "center", justifyContent: "center", opacity: player.speed <= 0.5 ? 0.3 : 1 }}>
                  <Text style={{ fontSize: 20, color: t.textSecondary }}>−</Text>
                </PressableScale>
                <Pressable onPress={() => player.setSpeed(1)}>
                  <Text style={{ fontSize: 13, fontWeight: "600", minWidth: 40, textAlign: "center", color: player.speed < 1 ? p.tint : t.textSecondary, fontVariant: ["tabular-nums"] }}>{player.speed.toFixed(2)}×</Text>
                </Pressable>
                <PressableScale haptic scaleTo={0.88} onPress={() => player.setSpeed(player.speed + 0.05)} disabled={player.speed >= 1} style={{ width: 32, height: 34, alignItems: "center", justifyContent: "center", opacity: player.speed >= 1 ? 0.3 : 1 }}>
                  <Text style={{ fontSize: 20, color: t.textSecondary }}>+</Text>
                </PressableScale>
              </View>
              {tracks.length > 1 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ width: 52, fontSize: 12.5, color: t.muted }}>Track</Text>
                  <View style={{ flex: 1 }}>
                    <Segmented t={t} stretch options={tracks} value={track} onChange={onTrack} label={(k) => TRACK_LABEL[k]} />
                  </View>
                </View>
              )}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Button t={t} kind="soft" tone={tone} label={takes ? `Takes · ${takes}` : "Takes"} onPress={onTakes} style={{ flex: 1 }} />
                <Button
                  t={t}
                  kind="soft"
                  danger
                  label={recordLabel}
                  icon={<MicIcon color={t.danger} size={15} />}
                  onPress={onRecord}
                  disabled={!player.ready}
                  style={{ flex: 1.4 }}
                />
              </View>
            </Animated.View>
          )}
        </>
      )}
    </Animated.View>
  );
}
