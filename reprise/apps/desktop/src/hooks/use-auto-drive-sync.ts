/**
 * Background hook: when "Auto-sync audio to Google Drive" is enabled,
 * watches for songs with local audio files not yet on Drive and uploads them.
 *
 * - Triggers when a song's download_status or stem_status changes to "done"
 * - Skips songs already fully synced
 * - Runs one song at a time to avoid saturating the upload connection
 * - Silent on error (logs to console; user can manual-sync from song setup)
 */

import { useEffect, useRef } from "react";
import { getStoredToken } from "../lib/google-drive";
import { syncSongToDrive, songNeedsDriveSync } from "../lib/drive-sync";
import { usePreferencesStore } from "../stores/preferences-store";
import { useSongStore } from "../stores/song-store";
import { useDriveSyncStore } from "../stores/drive-sync-store";

export function useAutoDriveSync() {
  const autoSyncDrive = usePreferencesStore((s) => s.autoSyncDrive);
  const songs = useSongStore((s) => s.songs);
  const updateSong = useSongStore((s) => s.updateSong);
  const { addSyncing, removeSyncing } = useDriveSyncStore();

  // Track which song IDs are currently being synced to avoid double-queuing
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!autoSyncDrive) return;
    if (!getStoredToken()) return;

    const pending = songs.filter(
      (s) =>
        s.download_status === "done" &&
        songNeedsDriveSync(s) &&
        !inFlightRef.current.has(s.id),
    );

    for (const song of pending) {
      inFlightRef.current.add(song.id);
      addSyncing(song.id);
      syncSongToDrive(song)
        .then((updates) => {
          if (Object.keys(updates).length > 0) {
            return updateSong(song.id, updates);
          }
        })
        .catch((err) => {
          console.warn(`[auto-drive-sync] Failed to sync "${song.title}":`, err);
        })
        .finally(() => {
          inFlightRef.current.delete(song.id);
          removeSyncing(song.id);
        });
    }
  }, [autoSyncDrive, songs, updateSong, addSyncing, removeSyncing]);
}
