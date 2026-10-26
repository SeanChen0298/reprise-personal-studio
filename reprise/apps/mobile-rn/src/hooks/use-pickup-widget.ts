// Keeps the home-screen "Pick up" widget on the song you practiced most recently: when that song
// (or what's known about it) changes, write widget.json and ask Android to redraw the widget.
import { useEffect } from "react";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { Song, SyncSnapshot } from "@reprise/shared/core";
import { useLibraryStore } from "../stores/library-store";
import { recentSongs } from "../lib/recent";
import { vividColors } from "../lib/song-palette";
import { redrawWidgets, writePickup, type PickupData } from "../widgets/pickup-widget";

/** The artwork as a file without its letterbox bars: YouTube's large picture when there is one. */
async function cleanArt(song: Song, snap: SyncSnapshot): Promise<{ uri: string; width: number; height: number } | undefined> {
  const dir = `${FileSystem.documentDirectory}thumbs/`;
  const out = `${dir}${song.id}-art.jpg`;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    if ((await FileSystem.getInfoAsync(out)).exists) {
      const info = await manipulateAsync(out, []);
      return { uri: out, width: info.width, height: info.height };
    }
    let src: string | undefined;
    let fromHq = false;
    const raw = song.thumbnail_b64?.replace(/^data:image\/\w+;base64,/, "");
    const tmp = `${FileSystem.cacheDirectory}art-${song.id}.jpg`;
    if (song.thumbnail_url?.includes("ytimg.com")) {
      // The 1280×720 picture has no 4:3 bars; not every video has one.
      const res = await FileSystem.downloadAsync(song.thumbnail_url.replace(/\/[a-z]*default\.jpg/, "/maxresdefault.jpg"), tmp);
      if (res.status === 200) src = tmp;
    }
    if (!src && raw) {
      await FileSystem.writeAsStringAsync(tmp, raw, { encoding: FileSystem.EncodingType.Base64 });
      src = tmp;
      fromHq = true;
    }
    if (!src && song.thumbnail_url) {
      await FileSystem.downloadAsync(song.thumbnail_url, tmp);
      src = tmp;
      fromHq = true;
    }
    if (!src) return undefined;
    const info = await manipulateAsync(src, []);
    // Cut away black bars (measured on the computer for the small picture; the large one rarely has them).
    const bars = fromHq ? snap.letterbox?.[song.id]?.bars ?? 0 : 0;
    const top = Math.round(info.height * bars);
    const res = await manipulateAsync(src, [{ crop: { originX: 0, originY: top, width: info.width, height: info.height - 2 * top } }], { compress: 0.9, format: SaveFormat.JPEG });
    await FileSystem.moveAsync({ from: res.uri, to: out });
    return { uri: out, width: res.width, height: res.height };
  } catch {
    return undefined;
  }
}

export function usePickupWidget() {
  const snapshot = useLibraryStore((s) => s.snapshot);
  const practiced = useLibraryStore((s) => s.local.practiced);
  const takes = useLibraryStore((s) => s.local.takes);

  useEffect(() => {
    const hero = recentSongs(snapshot, practiced, takes)[0];
    let cancelled = false;
    const timer = setTimeout(async () => {
      let d: PickupData | null = null;
      if (hero && snapshot) {
        const song = hero.song;
        const art = await cleanArt(song, snapshot);
        d = {
          id: song.id,
          title: song.title,
          artist: song.artist ?? "",
          label: hero.kind === "added" ? "Start here" : "Pick up where you left off",
          image: art?.uri,
          imageWidth: art?.width,
          imageHeight: art?.height,
          deep: vividColors(snapshot.colors?.[song.id]).bottom,
        };
      }
      if (cancelled) return;
      await writePickup(d);
      await redrawWidgets(d);
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [snapshot, practiced, takes]);
}
