import { Image, View } from "react-native";
import type { Song } from "@reprise/shared/core";

/** The song's thumbnail (stored in the library, so it shows offline), 16:9. Without `width` it fills the row. */
export function Thumb({ song, width, radius = 8, aspect = 16 / 9 }: { song: Song; width?: number; radius?: number; aspect?: number }) {
  const uri = song.thumbnail_b64 ? (song.thumbnail_b64.startsWith("data:") ? song.thumbnail_b64 : `data:image/jpeg;base64,${song.thumbnail_b64}`) : song.thumbnail_url;
  return (
    <View style={{ width: width ?? "100%", aspectRatio: aspect, borderRadius: radius, overflow: "hidden", backgroundColor: "#16213e" }}>
      {!!uri && <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />}
    </View>
  );
}
