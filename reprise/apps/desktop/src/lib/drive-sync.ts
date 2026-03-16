/**
 * Shared Drive upload logic used by both manual sync (song-setup-page)
 * and the auto-sync background hook.
 */

import { readFile } from "@tauri-apps/plugin-fs";
import type { Song } from "../types/song";
import { buildDriveFolderName } from "./audio-download";
import {
  discoverFilesInFolder,
  ensureSongFolder,
  getValidAccessToken,
  uploadFileResumable,
  type DriveUploadProgress,
} from "./google-drive";

export interface SyncSongResult {
  drive_audio_file_id?: string;
  drive_vocals_file_id?: string;
  drive_instrumental_file_id?: string;
}

/**
 * Uploads any available, not-yet-synced audio files for a song to Google Drive.
 * Returns the file IDs that were uploaded (only newly uploaded ones).
 * Throws if authentication fails or any upload errors.
 */
export async function syncSongToDrive(
  song: Song,
  onProgress?: (file: string, p: DriveUploadProgress) => void,
): Promise<SyncSongResult> {
  const accessToken = await getValidAccessToken();
  const folderName = buildDriveFolderName(song.title, song.artist, song.id);
  const folderId = await ensureSongFolder(accessToken, folderName);

  // Discover files already in the Drive folder so we can PATCH instead of POST
  // even when the local DB IDs are null (e.g. after a Drive reset). This prevents
  // creating duplicate files when a file with the same name already exists.
  const existingOnDrive = await discoverFilesInFolder(accessToken, folderId, [
    "audio.m4a",
    "vocals.wav",
    "no_vocals.wav",
  ]);

  const updates: SyncSongResult = {};

  if (song.audio_path) {
    const data = await readFile(song.audio_path);
    const fileId = await uploadFileResumable(
      accessToken,
      data,
      "audio.m4a",
      "audio/mp4",
      folderId,
      onProgress ? (p) => onProgress("audio.m4a", p) : undefined,
      song.drive_audio_file_id ?? existingOnDrive["audio.m4a"],
    );
    updates.drive_audio_file_id = fileId;
  }

  if (song.vocals_path) {
    const data = await readFile(song.vocals_path);
    const fileId = await uploadFileResumable(
      accessToken,
      data,
      "vocals.wav",
      "audio/wav",
      folderId,
      onProgress ? (p) => onProgress("vocals.wav", p) : undefined,
      song.drive_vocals_file_id ?? existingOnDrive["vocals.wav"],
    );
    updates.drive_vocals_file_id = fileId;
  }

  if (song.instrumental_path) {
    const data = await readFile(song.instrumental_path);
    const fileId = await uploadFileResumable(
      accessToken,
      data,
      "no_vocals.wav",
      "audio/wav",
      folderId,
      onProgress ? (p) => onProgress("no_vocals.wav", p) : undefined,
      song.drive_instrumental_file_id ?? existingOnDrive["no_vocals.wav"],
    );
    updates.drive_instrumental_file_id = fileId;
  }

  return updates;
}

/** Returns true if a song has at least one local audio file not yet on Drive. */
export function songNeedsDriveSync(song: Song): boolean {
  return (
    (!!song.audio_path && !song.drive_audio_file_id) ||
    (!!song.vocals_path && !song.drive_vocals_file_id) ||
    (!!song.instrumental_path && !song.drive_instrumental_file_id)
  );
}
