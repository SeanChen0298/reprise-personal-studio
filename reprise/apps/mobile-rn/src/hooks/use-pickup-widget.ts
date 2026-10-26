// Keeps the home-screen "Pick up" widget current: whenever the song to pick up (or what's known
// about it) changes, write widget.json and ask Android to redraw the widget.
import { useEffect } from "react";
import * as FileSystem from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { splitLines, type Song, type SyncSnapshot } from "@reprise/shared/core";
import { linesWithEdits, useLibraryStore } from "../stores/library-store";
import { recentSongs } from "../lib/recent";
import { vividColors } from "../lib/song-palette";
import { lineAt } from "./use-line-player";
import { redrawWidgets, writePickup, type PickupData, type WidgetSong } from "../widgets/pickup-widget";

/** Text without the coach's lyric references ("(L7–8)", "L19"). */
function withoutRefs(s: string): string {
  return s
    .replace(/\s*\([^()]*\bL\d+[^()]*\)/g, "")
    .replace(/\bL\d+(?:\s*[-–—]\s*L?\d+)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The artwork as a file, so the widget shows it offline too. */
async function artworkFile(song: Song): Promise<string | undefined> {
  const dir = `${FileSystem.documentDirectory}thumbs/`;
  const file = `${dir}${song.id}.jpg`;
  try {
    if ((await FileSystem.getInfoAsync(file)).exists) return file;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const raw = song.thumbnail_b64?.replace(/^data:image\/\w+;base64,/, "");
    if (raw) {
      await FileSystem.writeAsStringAsync(file, raw, { encoding: FileSystem.EncodingType.Base64 });
      return file;
    }
    if (song.thumbnail_url) {
      await FileSystem.downloadAsync(song.thumbnail_url, file);
      return file;
    }
  } catch {
    return song.thumbnail_url ?? undefined;
  }
  return undefined;
}

/** A square of the artwork without its black letterbox bars (widgets can't crop images themselves). */
async function squareArt(song: Song, snap: SyncSnapshot): Promise<string | undefined> {
  const src = await artworkFile(song);
  if (!src?.startsWith("file:")) return src;
  const out = `${FileSystem.documentDirectory}thumbs/${song.id}-sq.jpg`;
  try {
    if ((await FileSystem.getInfoAsync(out)).exists) return out;
    const info = await manipulateAsync(src, []);
    const bars = snap.letterbox?.[song.id]?.bars ?? 0;
    const contentH = info.height * (1 - 2 * bars);
    const side = Math.floor(Math.min(info.width, contentH));
    const res = await manipulateAsync(
      src,
      [{ crop: { originX: Math.floor((info.width - side) / 2), originY: Math.floor(info.height * bars + (contentH - side) / 2), width: side, height: side } }, { resize: { width: 160, height: 160 } }],
      { compress: 0.85, format: SaveFormat.JPEG },
    );
    await FileSystem.moveAsync({ from: res.uri, to: out });
    return out;
  } catch {
    return src;
  }
}

async function widgetSong(song: Song, snap: SyncSnapshot): Promise<WidgetSong> {
  const { top, bottom } = vividColors(snap.colors?.[song.id]);
  return { id: song.id, title: song.title, artist: song.artist ?? "", image: await squareArt(song, snap), top, bottom };
}

export function usePickupWidget() {
  const snapshot = useLibraryStore((s) => s.snapshot);
  const local = useLibraryStore((s) => s.local);

  useEffect(() => {
    const recent = recentSongs(snapshot, local.practiced, local.takes);
    const hero = recent[0];
    let cancelled = false;
    const timer = setTimeout(async () => {
      let d: PickupData | null = null;
      if (hero && snapshot) {
        const song = hero.song;
        const all = linesWithEdits(snapshot, local, song.id).sort((a, b) => a.order - b.order);
        const lines = splitLines(all, song.translation_language).lines;
        const card = snapshot.coach[song.id];

        // Something to remember — your own notes on lines first, then what the coach learned / suggests.
        const pool: { text: string; line?: string }[] = [
          ...lines.filter((l) => l.note?.trim()).map((l) => ({ text: l.note!.trim(), line: (l.custom_text ?? l.text).trim() })),
          ...(card?.memory ?? []).map((m) => ({ text: m })),
          ...(card?.card?.practice_focus ?? []).map((p) => ({ text: withoutRefs(p) })),
        ].filter((x) => x.text);
        const day = Math.floor(Date.now() / 86_400_000);
        const remember = pool.length ? pool[day % pool.length] : undefined;

        // Sing from the section where you stopped (or that line, or the start).
        const pos = local.positions?.[song.id] ?? 0;
        const idx = Math.max(0, lineAt(lines, pos));
        const sections = snapshot.sections.filter((s) => s.song_id === song.id);
        const sec = lines[idx] ? sections.find((s) => lines[idx].order >= s.start_line_order && lines[idx].order <= s.end_line_order) : undefined;
        const from = sec ? lines.find((l) => l.order >= sec.start_line_order) : lines[idx];
        const fromMs = pos > 5000 ? from?.start_ms ?? 0 : 0;
        const label = fromMs === 0 ? "Sing from the start" : sec ? `Sing from ${sec.name.replace(/^\p{L}/u, (c) => c.toUpperCase())}` : "Sing from where you stopped";

        d = {
          ...(await widgetSong(song, snapshot)),
          label: hero.kind === "added" ? "Start here" : "Pick up where you left off",
          remember,
          sing: { label, uri: `reprise://song/${song.id}?sing=1&at=${fromMs}` },
          recent: await Promise.all(recent.slice(1, 6).map((r) => widgetSong(r.song, snapshot))),
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
  }, [snapshot, local]);
}
