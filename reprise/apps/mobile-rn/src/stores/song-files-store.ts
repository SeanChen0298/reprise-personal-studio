/**
 * Zustand store for locally-downloaded song audio files and Drive tokens.
 *
 * Persisted to AsyncStorage so downloads survive app restarts.
 *
 * Key structure in AsyncStorage:
 *   "reprise_song_files"  → serialized SongFilesState.localFiles
 *   "reprise_drive_token" → serialized DriveToken
 */

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DriveToken } from "../lib/google-drive-download";

const FILES_KEY = "reprise_song_files";
const TOKEN_KEY = "reprise_drive_token";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SongLocalFiles {
  audioPath?: string;     // absolute local path to audio.m4a
  vocalsPath?: string;    // absolute local path to vocals.wav
  instrPath?: string;     // absolute local path to no_vocals.wav
}

interface SongFilesState {
  /** songId → local paths */
  localFiles: Record<string, SongLocalFiles>;
  /** Stored Drive OAuth token */
  driveToken: DriveToken | null;
  /** Whether initial load from AsyncStorage has completed */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setLocalFiles: (songId: string, files: Partial<SongLocalFiles>) => Promise<void>;
  clearLocalFiles: (songId: string) => Promise<void>;
  getLocalFiles: (songId: string) => SongLocalFiles;
  setDriveToken: (token: DriveToken | null) => Promise<void>;
  getDriveToken: () => DriveToken | null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSongFilesStore = create<SongFilesState>((set, get) => ({
  localFiles: {},
  driveToken: null,
  hydrated: false,

  async hydrate() {
    const [filesRaw, tokenRaw] = await Promise.all([
      AsyncStorage.getItem(FILES_KEY),
      AsyncStorage.getItem(TOKEN_KEY),
    ]);

    const localFiles = filesRaw ? (JSON.parse(filesRaw) as Record<string, SongLocalFiles>) : {};
    const driveToken = tokenRaw ? (JSON.parse(tokenRaw) as DriveToken) : null;

    set({ localFiles, driveToken, hydrated: true });
  },

  async setLocalFiles(songId, files) {
    const current = get().localFiles[songId] ?? {};
    const updated = { ...current, ...files };
    const next = { ...get().localFiles, [songId]: updated };
    set({ localFiles: next });
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(next));
  },

  async clearLocalFiles(songId) {
    const next = { ...get().localFiles };
    delete next[songId];
    set({ localFiles: next });
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(next));
  },

  getLocalFiles(songId) {
    return get().localFiles[songId] ?? {};
  },

  async setDriveToken(token) {
    set({ driveToken: token });
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  },

  getDriveToken() {
    return get().driveToken;
  },
}));

// ─── Token helper with auto-refresh ──────────────────────────────────────────

import { refreshAccessToken } from "../lib/google-drive-download";

/**
 * Returns a valid access token, refreshing via the stored refresh token if needed.
 * Throws if no token is stored or token can't be refreshed.
 */
export async function getValidDriveToken(): Promise<string> {
  const { driveToken, setDriveToken } = useSongFilesStore.getState();

  if (!driveToken) throw new Error("Not authenticated with Google Drive");

  // Still valid (with 60s buffer)
  if (driveToken.expiresAt - 60_000 > Date.now()) {
    return driveToken.accessToken;
  }

  if (!driveToken.refreshToken) {
    await setDriveToken(null);
    throw new Error("Drive session expired — please re-authenticate");
  }

  const refreshed = await refreshAccessToken(driveToken.refreshToken);
  await setDriveToken(refreshed);
  return refreshed.accessToken;
}
