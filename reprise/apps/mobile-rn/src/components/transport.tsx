// Bottom transport: seek bar, line / section loop, prev / play / next, speed, track, record.
import { useRef, useState } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LinePlayer, LoopMode } from "../hooks/use-line-player";
import type { TrackKind } from "../stores/library-store";
import type { Theme } from "../lib/theme";
import { clock } from "../lib/format";
import { LoopIcon, MicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, StopIcon } from "./icons";

const TRACK_LABEL: Record<TrackKind, string> = { audio: "Original", instrumental: "Backing", vocals: "Vocals" };
const LOOP_NEXT: Record<LoopMode, LoopMode> = { off: "line", line: "section", section: "off" };

interface Props {
  player: LinePlayer;
  t: Theme;
  tracks: TrackKind[];
  track: TrackKind;
  onTrack: (k: TrackKind) => void;
  hasSection: boolean;
  /** Recording controls. */
  rec: { busy: boolean; recording: boolean; countdown: number | null; elapsedMs: number };
  onRecord: () => void;
  onStop: () => void;
  recordLabel: string;
}

export function Transport({ player, t, tracks, track, onTrack, hasSection, rec, onRecord, onStop, recordLabel }: Props) {
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

  const btn = (active = false) => ({
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: active ? t.themeSoft : "transparent",
  });

  const loopLabel = player.loop === "line" ? "Line" : player.loop === "section" ? "Section" : "Loop";

  return (
    <View style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.borderSubtle, paddingHorizontal: 14, paddingTop: 6, paddingBottom: insets.bottom + 8 }}>
      {/* Seek bar */}
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
        style={{ height: 22, justifyContent: "center" }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: t.border }}>
          <View style={{ height: 3, borderRadius: 2, width: `${(pos / dur) * 100}%`, backgroundColor: rec.recording ? t.danger : t.theme }} />
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -2 }}>
        <Text style={{ fontSize: 11, color: t.muted, fontVariant: ["tabular-nums"] }}>{clock(pos)}</Text>
        <Text style={{ fontSize: 11, color: t.muted, fontVariant: ["tabular-nums"] }}>{clock(player.durationMs)}</Text>
      </View>

      {/* Main controls */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <Pressable
          onPress={() => {
            let next = LOOP_NEXT[player.loop];
            if (next === "section" && !hasSection) next = "off";
            player.setLoop(next);
          }}
          disabled={rec.busy}
          style={{ ...btn(player.loop !== "off"), flexDirection: "row", gap: 5, paddingHorizontal: 10 }}
        >
          <LoopIcon color={player.loop !== "off" ? t.theme : t.textSecondary} size={17} />
          <Text style={{ fontSize: 12, color: player.loop !== "off" ? t.theme : t.textSecondary }}>{loopLabel}</Text>
        </Pressable>
        <Pressable onPress={() => player.step(-1)} disabled={rec.busy} style={btn()}>
          <PrevIcon color={t.text} size={20} />
        </Pressable>
        <Pressable
          onPress={() => player.toggle()}
          disabled={rec.busy || !player.ready}
          style={{ width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: t.theme, opacity: player.ready ? 1 : 0.4 }}
        >
          {player.isPlaying ? <PauseIcon color="#fff" size={24} /> : <PlayIcon color="#fff" size={24} />}
        </Pressable>
        <Pressable onPress={() => player.step(1)} disabled={rec.busy} style={btn()}>
          <NextIcon color={t.text} size={20} />
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => player.setSpeed(player.speed - 0.05)} disabled={rec.busy || player.speed <= 0.5} hitSlop={6} style={{ paddingHorizontal: 6, paddingVertical: 8 }}>
            <Text style={{ fontSize: 18, color: player.speed <= 0.5 ? t.border : t.textSecondary }}>−</Text>
          </Pressable>
          <Pressable onPress={() => player.setSpeed(1)} disabled={rec.busy}>
            <Text style={{ fontSize: 12.5, color: player.speed < 1 ? t.theme : t.textSecondary, fontVariant: ["tabular-nums"], minWidth: 38, textAlign: "center" }}>
              {player.speed.toFixed(2)}×
            </Text>
          </Pressable>
          <Pressable onPress={() => player.setSpeed(player.speed + 0.05)} disabled={rec.busy || player.speed >= 1} hitSlop={6} style={{ paddingHorizontal: 6, paddingVertical: 8 }}>
            <Text style={{ fontSize: 18, color: player.speed >= 1 ? t.border : t.textSecondary }}>+</Text>
          </Pressable>
        </View>
      </View>

      {/* Track + record */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
        <View style={{ flexDirection: "row", flex: 1, backgroundColor: t.bg, borderRadius: 10, padding: 3 }}>
          {tracks.map((k) => (
            <Pressable
              key={k}
              onPress={() => onTrack(k)}
              disabled={rec.busy}
              style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center", backgroundColor: track === k ? t.surface : "transparent" }}
            >
              <Text style={{ fontSize: 12.5, color: track === k ? t.text : t.muted, fontWeight: track === k ? "600" : "400" }}>{TRACK_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>
        {rec.busy ? (
          <Pressable onPress={onStop} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: t.danger }}>
            <StopIcon color="#fff" size={14} />
            <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
              {rec.countdown != null ? `${rec.countdown}…` : clock(rec.elapsedMs)}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={onRecord} disabled={!player.ready} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: t.danger, opacity: player.ready ? 1 : 0.4 }}>
            <MicIcon color={t.danger} size={16} />
            <Text style={{ color: t.danger, fontSize: 13.5, fontWeight: "600" }}>{recordLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
