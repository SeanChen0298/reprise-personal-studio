// The Play all bar at the bottom of the library: what's playing, play / pause, next. Tap to open the song there.
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  if (!track || !song) return null;

  const open = async () => {
    const at = Math.round(position * 1000);
    await pauseRadio();
    router.push(`/song/${song.id}?at=${at}${playing ? "&play=1" : ""}`);
  };

  return (
    <View style={{ position: "absolute", left: 10, right: 10, bottom: insets.bottom + 10, borderRadius: 16, backgroundColor: t.raised, borderWidth: 1, borderColor: t.border, overflow: "hidden", elevation: 8, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
      <Pressable onPress={open} onLongPress={() => void stopRadio()} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }}>
        <Thumb song={song} width={52} radius={8} aspect={1} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: "600", color: t.text }}>
            {song.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.muted }}>
            {track.artist}
          </Text>
        </View>
        <Pressable onPress={() => void (playing ? TrackPlayer.pause() : TrackPlayer.play())} hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: t.theme }}>
          {playing ? <PauseIcon color="#fff" size={18} /> : <PlayIcon color="#fff" size={18} />}
        </Pressable>
        <Pressable onPress={() => void TrackPlayer.skipToNext()} hitSlop={8} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}>
          <NextIcon color={t.text} size={19} />
        </Pressable>
      </Pressable>
      <View style={{ height: 2, backgroundColor: t.borderSubtle }}>
        <View style={{ height: 2, width: `${duration ? (position / duration) * 100 : 0}%`, backgroundColor: t.theme }} />
      </View>
    </View>
  );
}
