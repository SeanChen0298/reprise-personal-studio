// The Play all bar at the bottom of the library: what's playing, play / pause, next. Tap to open the song there.
import { Pressable, View } from "react-native";
import { Text } from "./text";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { PressableScale } from "./pressable-scale";
import { useSongPalette } from "../lib/song-palette";
import TrackPlayer, { useActiveTrack, useIsPlaying, useProgress } from "react-native-track-player";
import { useLibraryStore } from "../stores/library-store";
import { pauseRadio, stopRadio } from "../lib/radio";
import { Thumb } from "./thumb";
import { NextIcon, PauseIcon, PlayIcon } from "./icons";
import type { Theme } from "../lib/theme";

export function NowPlaying({ t }: { t: Theme }) {
  const insets = useSafeAreaInsets();
  const track = useActiveTrack();
  const { playing } = useIsPlaying();
  const { position, duration } = useProgress(500);
  const song = useLibraryStore((s) => s.snapshot?.songs.find((x) => x.id === track?.id));
  const p = useSongPalette(track?.id, t);
  if (!track || !song) return null;

  const open = async () => {
    const at = Math.round(position * 1000);
    await pauseRadio();
    router.push(`/song/${song.id}?at=${at}${playing ? "&play=1" : ""}`);
  };

  return (
    <Animated.View entering={SlideInDown.springify().damping(18)} exiting={SlideOutDown.duration(200)} style={{ position: "absolute", left: 10, right: 10, bottom: insets.bottom + 10, borderRadius: 20, backgroundColor: p.wash === t.bg ? t.raised : p.soft, overflow: "hidden", elevation: 8, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
      <PressableScale scaleTo={0.98} onPress={open} onLongPress={() => void stopRadio()} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }}>
        <Thumb song={song} width={52} radius={8} aspect={1} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: "600", color: t.text }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted }}>
            {track.artist}
          </Text>
        </View>
        <PressableScale haptic scaleTo={0.88} onPress={() => void (playing ? TrackPlayer.pause() : TrackPlayer.play())} hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.solid }}>
          {playing ? <PauseIcon color={p.onSolid} size={18} /> : <PlayIcon color={p.onSolid} size={18} />}
        </PressableScale>
        <PressableScale haptic scaleTo={0.85} onPress={() => void TrackPlayer.skipToNext()} hitSlop={8} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
          <NextIcon color={t.text} size={19} />
        </PressableScale>
      </PressableScale>
      <View style={{ height: 3, backgroundColor: "transparent" }}>
        <View style={{ height: 3, width: `${duration ? (position / duration) * 100 : 0}%`, backgroundColor: p.solid }} />
      </View>
    </Animated.View>
  );
}
