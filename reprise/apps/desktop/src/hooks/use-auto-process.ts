/**
 * Background hook: when auto-demucs or auto-pitch is enabled in preferences,
 * watches the song list and enqueues eligible songs for processing.
 *
 * - autoDemucs: enqueues stem separation for songs that are downloaded but
 *   not yet processed (stem_status idle or undefined).
 * - autoPitch: enqueues pitch analysis for songs whose stems are done but
 *   pitch has not been analyzed (pitch_status idle or undefined).
 */

import { useEffect } from "react";
import { usePreferencesStore } from "../stores/preferences-store";
import { useSongStore } from "../stores/song-store";
import { useTaskQueueStore } from "../stores/task-queue-store";

export function useAutoProcess() {
  const autoDemucs = usePreferencesStore((s) => s.autoDemucs);
  const autoPitch = usePreferencesStore((s) => s.autoPitch);
  const songs = useSongStore((s) => s.songs);

  useEffect(() => {
    const { enqueue, tasks } = useTaskQueueStore.getState();
    const alreadyQueued = (songId: string, type: "stems" | "pitch") =>
      tasks.some((t) => t.songId === songId && t.type === type);

    if (autoDemucs) {
      for (const song of songs) {
        if (
          song.download_status === "done" &&
          (!song.stem_status || song.stem_status === "idle") &&
          !alreadyQueued(song.id, "stems")
        ) {
          enqueue(song.id, song.title, "stems");
        }
      }
    }

    if (autoPitch) {
      for (const song of songs) {
        if (
          song.stem_status === "done" &&
          (!song.pitch_status || song.pitch_status === "idle") &&
          !alreadyQueued(song.id, "pitch")
        ) {
          enqueue(song.id, song.title, "pitch");
        }
      }
    }
  }, [autoDemucs, autoPitch, songs]);
}
