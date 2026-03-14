/**
 * Google Drive download helpers for Reprise mobile (Expo).
 *
 * OAuth is handled server-side via Supabase Edge Functions:
 *   1. Open browser to google-drive-auth edge function
 *   2. Edge function completes OAuth, deep-links back with tokens
 *   3. refreshAccessToken() calls google-drive-refresh edge function
 *
 * Scope: https://www.googleapis.com/auth/drive.file
 */

import * as FileSystem from "expo-file-system";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriveToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // unix ms
}

export interface DownloadProgress {
  bytesWritten: number;
  totalBytesExpected: number;
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────

/**
 * Returns the URL to open in the browser to start the Google Drive OAuth flow.
 * The state param is used for CSRF protection — validate it in the deep link callback.
 */
export function buildDriveAuthUrl(state: string): string {
  return `${SUPABASE_URL}/functions/v1/google-drive-auth?state=${encodeURIComponent(state)}`;
}

/**
 * Refreshes an expired Drive access token via the Supabase Edge Function.
 * The client secret is kept server-side.
 */
export async function refreshAccessToken(refreshToken: string): Promise<DriveToken> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) throw new Error("Failed to refresh Drive access token");

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

// ─── File download ────────────────────────────────────────────────────────────

/**
 * Downloads a Google Drive file to the local filesystem using expo-file-system.
 * Uses a resumable download to support large files (.wav up to 200 MB).
 *
 * @param fileId      - Google Drive file ID
 * @param destPath    - Absolute local path (e.g. FileSystem.documentDirectory + "songs/id/audio.m4a")
 * @param accessToken - Valid Drive access token
 * @param onProgress  - Optional progress callback
 */
export async function downloadDriveFile(
  fileId: string,
  destPath: string,
  accessToken: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const dir = destPath.substring(0, destPath.lastIndexOf("/"));
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    destPath,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    onProgress
      ? (p) =>
          onProgress({
            bytesWritten: p.totalBytesWritten,
            totalBytesExpected: p.totalBytesExpectedToWrite,
          })
      : undefined
  );

  const result = await downloadResumable.downloadAsync();
  if (!result) throw new Error(`Download failed for Drive file ${fileId}`);
  if (result.status !== 200) {
    throw new Error(`Drive download returned HTTP ${result.status}`);
  }
}

/**
 * Returns the local path for a song's audio file in the document directory.
 */
export function localPathForFile(songId: string, fileName: string): string {
  return `${FileSystem.documentDirectory}songs/${songId}/${fileName}`;
}

/** Checks if a local file exists. */
export async function localFileExists(path: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists;
}
