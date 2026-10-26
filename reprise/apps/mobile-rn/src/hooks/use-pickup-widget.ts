// Keeps the home-screen "Pick up" widget current: whenever the song to pick up (or what's known
// about it) changes, write widget.json and ask Android to redraw the widget.
import { createElement, useEffect } from "react";
import * as FileSystem from "expo-file-system";
import { requestWidgetUpdate } from "react-native-android-widget";
import { useLibraryStore } from "../stores/library-store";
import { recentSongs } from "../lib/recent";
import { vividColors } from "../lib/song-palette";
import { PICKUP_WIDGET, PickupWidget, writePickup, type PickupData } from "../widgets/pickup-widget";

/** The coach's first practice point, without its lyric references. */
function focusText(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s
    .replace(/\s*\([^()]*\bL\d+[^()]*\)/g, "")
    .replace(/\bL\d+(?:\s*[-–—]\s*L?\d+)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t ? `Work on: ${t.replace(/^./, (c) => c.toLowerCase())}` : undefined;
}

/** The artwork as a file, so the widget shows it offline too. */
async function artworkFile(songId: string, url?: string | null, b64?: string | null): Promise<string | undefined> {
  const dir = `${FileSystem.documentDirectory}thumbs/`;
  const file = `${dir}${songId}.jpg`;
  try {
    if ((await FileSystem.getInfoAsync(file)).exists) return file;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const raw = b64?.replace(/^data:image\/\w+;base64,/, "");
    if (raw) {
      await FileSystem.writeAsStringAsync(file, raw, { encoding: FileSystem.EncodingType.Base64 });
      return file;
    }
    if (url) {
      await FileSystem.downloadAsync(url, file);
      return file;
    }
  } catch {
    return url ?? undefined;
  }
  return undefined;
}

export function usePickupWidget() {
  const snapshot = useLibraryStore((s) => s.snapshot);
  const practiced = useLibraryStore((s) => s.local.practiced);
  const takes = useLibraryStore((s) => s.local.takes);

  useEffect(() => {
    const hero = recentSongs(snapshot, practiced, takes)[0];
    let cancelled = false;
    (async () => {
      let d: PickupData | null = null;
      if (hero && snapshot) {
        const song = hero.song;
        const { top, bottom } = vividColors(snapshot.colors?.[song.id]);
        d = {
          songId: song.id,
          title: song.title,
          artist: song.artist ?? "",
          label: hero.kind === "added" ? "Start here" : "Pick up where you left off",
          focus: focusText(snapshot.coach[song.id]?.card?.practice_focus?.[0]),
          top,
          bottom,
          image: await artworkFile(song.id, song.thumbnail_url, song.thumbnail_b64),
        };
      }
      if (cancelled) return;
      await writePickup(d);
      await requestWidgetUpdate({
        widgetName: PICKUP_WIDGET,
        renderWidget: (info) => createElement(PickupWidget, { d, width: info.width, height: info.height }),
      }).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot, practiced, takes]);
}
