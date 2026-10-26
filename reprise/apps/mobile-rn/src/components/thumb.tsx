import { Image, View } from "react-native";
import type { Song } from "@reprise/shared/core";
import { useLibraryStore } from "../stores/library-store";

/** The song's thumbnail (stored in the library, so it shows offline), 16:9. Without `width` it fills the row. */
/** `zoom` crops in a little (music videos often have black bars inside the thumbnail). */
export function Thumb({ song, width, radius = 8, aspect = 16 / 9, zoom = 1 }: { song: Song; width?: number; radius?: number; aspect?: number; zoom?: number }) {
  // Black letterbox bars in the thumbnail (measured on the computer) are zoomed out of view.
  const box = useLibraryStore((s) => s.snapshot?.letterbox?.[song.id]);
  let scale = zoom;
  if (box) {
    // "cover" already crops some of the image; scale on so the picture inside the bars covers the frame.
    const a = box.aspect;
    const fit = Math.max(aspect / a, 1);
    const want = Math.max(aspect / a, 1 / (1 - 2 * box.bars));
    scale = Math.max(1, want / fit);
  }
  const uri = song.thumbnail_b64 ? (song.thumbnail_b64.startsWith("data:") ? song.thumbnail_b64 : `data:image/jpeg;base64,${song.thumbnail_b64}`) : song.thumbnail_url;
  return (
    <View style={{ width: width ?? "100%", aspectRatio: aspect, borderRadius: radius, overflow: "hidden", backgroundColor: "#16213e" }}>
      {!!uri && <Image source={{ uri }} style={{ width: "100%", height: "100%", transform: [{ scale }] }} resizeMode="cover" />}
    </View>
  );
}
