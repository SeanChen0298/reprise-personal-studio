/**
 * Background hook: processes the task queue sequentially — one download,
 * Demucs, or torchcrepe job at a time to prevent saturating CPU/RAM.
 *
 * After a successful stem-separation, automatically enqueues pitch and chord
 * analysis for the same song.
 */

import { useEffect, useRef } from "react";
import { useTaskQueueStore } from "../stores/task-queue-store";
import { useSongStore } from "../stores/song-store";

export function useTaskQueueProcessor() {
  const tasks = useTaskQueueStore((s) => s.tasks);
  const processingRef = useRef(false);

  // Grab store functions — stable references, safe to omit from deps
  const downloadSongAudio = useSongStore((s) => s.downloadSongAudio);
  const separateSongStems = useSongStore((s) => s.separateSongStems);
  const analyzeSongPitch = useSongStore((s) => s.analyzeSongPitch);
  const analyzeSongChords = useSongStore((s) => s.analyzeSongChords);

  useEffect(() => {
    const firstPending = tasks.find((t) => t.status === "pending");
    if (!firstPending || processingRef.current) return;

    const { markRunning, dequeue, enqueue } = useTaskQueueStore.getState();

    processingRef.current = true;
    markRunning(firstPending.id);

    const work =
      firstPending.type === "download" ? downloadSongAudio(firstPending.songId) :
      firstPending.type === "stems"    ? separateSongStems(firstPending.songId) :
      firstPending.type === "pitch"    ? analyzeSongPitch(firstPending.songId)  :
      firstPending.type === "chords"   ? analyzeSongChords(firstPending.songId) :
      /* a job type that no longer exists (e.g. an old lyric alignment) */ Promise.resolve();

    work
      .then(() => {
        // After stems succeed, auto-enqueue pitch and chords if not already done/queued
        if (firstPending.type === "stems") {
          const song = useSongStore
            .getState()
            .songs.find((s) => s.id === firstPending.songId);
          if (song?.stem_status === "done" && (!song.pitch_status || song.pitch_status === "idle")) {
            enqueue(firstPending.songId, firstPending.songTitle, "pitch");
          }
          if (song?.stem_status === "done" && (!song.chord_status || song.chord_status === "idle")) {
            enqueue(firstPending.songId, firstPending.songTitle, "chords");
          }
        }
        // Chords may have run before pitch existed; re-run them once pitch
        // lands so the fingerstyle arrangement (which needs the melody) is built.
        if (firstPending.type === "pitch") {
          const song = useSongStore
            .getState()
            .songs.find((s) => s.id === firstPending.songId);
          if (song?.pitch_status === "done" && song.chord_status === "done") {
            enqueue(firstPending.songId, firstPending.songTitle, "chords");
          }
        }
      })
      .finally(() => {
        dequeue(firstPending.id);
        processingRef.current = false;
      });
    // Only re-run when the tasks list changes (a task was added/removed/marked running)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);
}
