/**
 * Google Drive download helpers for Reprise mobile (Expo).
 *
 * OAuth2 PKCE flow via expo-auth-session:
 *   1. startDriveAuth()  → opens browser, returns DriveToken on success
 *   2. downloadDriveFile(fileId, destPath, token, onProgress) → downloads to FS
 *
 * Scope: https://www.googleapis.com/auth/drive.file
 */

import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!;

// Expo uses a special redirect URI proxy in development, or the app scheme in production.
// expo-auth-session provides `makeRedirectUri()` which handles both cases.
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: "reprise", path: "drive-callback" });

const DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

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

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    Math.random().toString(36) + Date.now().toString(36),
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  // Compute challenge from verifier
  const challengeBytes = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  // Base64url-encode
  const challenge = challengeBytes
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return { verifier, challenge };
}

// ─── OAuth flow ───────────────────────────────────────────────────────────────

/**
 * Initiates the Google Drive OAuth2 PKCE flow using expo-auth-session.
 * Returns a DriveToken on success, or throws on failure/cancellation.
 *
 * NOTE: This must be called from a component using `useAuthRequest` hook
 * from expo-auth-session. This function is the lower-level token exchange
 * called after the browser redirect completes.
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string
): Promise<DriveToken> {
  const res = await fetch(DISCOVERY.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive token exchange failed: ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<DriveToken> {
  const res = await fetch(DISCOVERY.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) throw new Error("Failed to refresh Drive access token");

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Returns usable auth request config for `useAuthRequest` from expo-auth-session. */
export async function buildAuthRequest(): Promise<{
  request: AuthSession.AuthRequest;
  verifier: string;
}> {
  const { verifier, challenge } = await generatePKCE();

  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    codeChallenge: challenge,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
    },
  });

  return { request, verifier };
}

// ─── File download ────────────────────────────────────────────────────────────

/**
 * Downloads a Google Drive file to the local filesystem using expo-file-system.
 * Uses a resumable download to support large files (.wav up to 200 MB).
 *
 * @param fileId    - Google Drive file ID
 * @param destPath  - Absolute local path (e.g. FileSystem.documentDirectory + "songs/id/audio.m4a")
 * @param accessToken - Valid Drive access token
 * @param onProgress - Optional progress callback
 */
export async function downloadDriveFile(
  fileId: string,
  destPath: string,
  accessToken: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  // Ensure parent directory exists
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
 * Creates the songs/{songId}/ directory structure.
 */
export function localPathForFile(songId: string, fileName: string): string {
  return `${FileSystem.documentDirectory}songs/${songId}/${fileName}`;
}

/** Checks if a local file exists. */
export async function localFileExists(path: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists;
}
