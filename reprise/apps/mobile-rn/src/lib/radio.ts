// Play all: the songs on the phone one after another, round and round, like a music app —
// keeps playing with the screen off, with controls on the lock screen and in the notification.
// (The song screen has its own player for practice; opening a song pauses this.)
import TrackPlayer, { AppKilledPlaybackBehavior, Capability, Event, RepeatMode, State, type Track } from "react-native-track-player";
import * as FileSystem from "expo-file-system";
import { create } from "zustand";
import { splitLines, type Line, type Song } from "@reprise/shared/core";
import { useLibraryStore } from "../stores/library-store";
import { usePrefsStore } from "../stores/prefs-store";
import { vividColors } from "./song-palette";
import { lineAt } from "../hooks/use-line-player";
import { redrawWidgets, writeLive, type LiveData } from "../widgets/pickup-widget";

let setup: Promise<void> | null = null;

/** Whether Play all has a queue (the bar shows only then — the player isn't set up before). */
export const useRadio = create<{ on: boolean }>(() => ({ on: false }));
const started = () => useRadio.getState().on;

/** The widget can start Play all with the app closed: load the library and settings first. */
async function ensureLoaded(): Promise<void> {
  if (!useLibraryStore.getState().ready) await useLibraryStore.getState().load();
  if (!usePrefsStore.persist.hasHydrated()) await usePrefsStore.persist.rehydrate();
}

function ensurePlayer(): Promise<void> {
  setup ??= (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
    } catch (err) {
      // Already set up by the app (the widget's task runs in the same app).
      if (!String(err).includes("already been initialized")) throw err;
    }
    await TrackPlayer.updateOptions({
      android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
      capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo, Capability.Stop],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      progressUpdateEventInterval: 1,
    });
  })().catch((err) => {
    setup = null;
    throw err;
  });
  return setup;
}

/** The thumbnail as a file (the notification can't show the library's base64 image). */
async function artwork(song: Song): Promise<string | undefined> {
  const b64 = song.thumbnail_b64?.replace(/^data:image\/\w+;base64,/, "");
  if (!b64) return song.thumbnail_url ?? undefined;
  const dir = `${FileSystem.documentDirectory}thumbs/`;
  const file = `${dir}${song.id}.jpg`;
  try {
    if (!(await FileSystem.getInfoAsync(file)).exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 });
    }
    return file;
  } catch {
    return song.thumbnail_url ?? undefined;
  }
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Songs Play all can play (their audio is on the phone), in library order. */
export function playableSongs(): Song[] {
  const { snapshot, local } = useLibraryStore.getState();
  const track = usePrefsStore.getState().radioTrack;
  return [...(snapshot?.songs ?? [])]
    .filter((s) => local.downloads[s.id]?.[track] ?? local.downloads[s.id]?.audio)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Start Play all, from `startId` if given (`keepOrder`: library order even with shuffle on). */
export async function playAll(startId?: string, opts: { keepOrder?: boolean } = {}): Promise<void> {
  await ensureLoaded();
  await ensurePlayer();
  const { local } = useLibraryStore.getState();
  const { radioTrack, radioShuffle } = usePrefsStore.getState();
  let songs = playableSongs();
  if (!songs.length) return;
  if (radioShuffle && !opts.keepOrder) songs = shuffled(songs);
  if (startId) {
    const i = songs.findIndex((s) => s.id === startId);
    if (i > 0) songs = [...songs.slice(i), ...songs.slice(0, i)];
  }
  const tracks: Track[] = await Promise.all(
    songs.map(async (s) => {
      const files = local.downloads[s.id]!;
      const backing = radioTrack === "instrumental" && files.instrumental;
      return {
        id: s.id,
        url: (backing ? files.instrumental! : files.audio!).uri,
        title: s.title,
        artist: backing ? `${s.artist ?? ""} · backing` : s.artist ?? "",
        artwork: await artwork(s),
      };
    }),
  );
  await TrackPlayer.reset();
  await TrackPlayer.add(tracks);
  await TrackPlayer.setRepeatMode(RepeatMode.Queue);
  await TrackPlayer.play();
  useRadio.setState({ on: true });
}

/** Pause Play all if it's running (the song screen is about to play). */
export async function pauseRadio(): Promise<void> {
  if (started()) await TrackPlayer.pause().catch(() => {});
}

export async function stopRadio(): Promise<void> {
  useRadio.setState({ on: false });
  await TrackPlayer.reset().catch(() => {});
  lastLive = "";
  await writeLive(null);
  await redrawWidgets(undefined, null);
}

/** Play / pause from the widget. */
export async function toggleRadio(): Promise<void> {
  try {
    const st = (await TrackPlayer.getPlaybackState()).state;
    if (st === State.Playing || st === State.Buffering) await TrackPlayer.pause();
    else await TrackPlayer.play();
  } catch {
    // Not set up (the app was closed): nothing to toggle.
  }
}

// ── The widget follows Play all: what's playing and the lyric line being sung ──
const linesCache = new Map<string, Line[]>();
let lastLive = "";

function songLines(songId: string): Line[] {
  const hit = linesCache.get(songId);
  if (hit) return hit;
  const { snapshot } = useLibraryStore.getState();
  const song = snapshot?.songs.find((s) => s.id === songId);
  const all = (snapshot?.lines ?? []).filter((l) => l.song_id === songId).sort((a, b) => a.order - b.order);
  const lines = splitLines(all, song?.translation_language).lines;
  linesCache.set(songId, lines);
  return lines;
}

async function updateWidget(): Promise<void> {
  try {
    await ensureLoaded();
    const track = await TrackPlayer.getActiveTrack();
    const st = (await TrackPlayer.getPlaybackState()).state;
    const songId = typeof track?.id === "string" ? track.id : undefined;
    const song = songId ? useLibraryStore.getState().snapshot?.songs.find((s) => s.id === songId) : undefined;
    if (!song || st === State.None || st === State.Stopped) return;
    const lines = songLines(song.id);
    const i = lineAt(lines, (await TrackPlayer.getPosition()) * 1000);
    const l = i >= 0 ? lines[i] : undefined;
    const { top, bottom } = vividColors(useLibraryStore.getState().snapshot?.colors?.[song.id]);
    const thumb = `${FileSystem.documentDirectory}thumbs/${song.id}.jpg`;
    const live: LiveData = {
      id: song.id,
      title: song.title,
      artist: song.artist ?? "",
      image: (await FileSystem.getInfoAsync(thumb)).exists ? thumb : song.thumbnail_url ?? undefined,
      top,
      bottom,
      playing: st === State.Playing || st === State.Buffering || st === State.Loading,
      lyric: l ? (l.custom_text ?? l.text).trim() : undefined,
    };
    // Redraw only when something you'd see changed (the progress event fires every second).
    const key = `${live.id}|${live.playing}|${live.lyric ?? ""}`;
    if (key === lastLive) return;
    lastLive = key;
    await writeLive(live);
    await redrawWidgets(undefined, live);
  } catch {
    // The widget is a nicety; never let it disturb playback.
  }
}

/** Lock screen / notification / headset buttons. Registered at startup (index.js). */
export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => void TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => void TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => void TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    // Like music apps: back to the start first, then the previous song.
    if ((await TrackPlayer.getPosition()) > 4) await TrackPlayer.seekTo(0);
    else await TrackPlayer.skipToPrevious();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => void TrackPlayer.seekTo(e.position));
  TrackPlayer.addEventListener(Event.RemoteStop, () => void stopRadio());
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => void updateWidget());
  TrackPlayer.addEventListener(Event.PlaybackState, () => void updateWidget());
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, () => void updateWidget());
}
