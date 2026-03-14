/**
 * Google Drive integration for Reprise desktop app.
 *
 * OAuth2 PKCE flow:
 *   1. generatePKCE()        → { verifier, challenge }
 *   2. getAuthUrl(challenge)  → navigate browser to this URL
 *   3. Google redirects to REDIRECT_URI?code=...&state=...
 *   4. exchangeCodeForToken(code, verifier) → DriveToken
 *   5. storeToken(token) / getStoredToken()
 *
 * Scopes: https://www.googleapis.com/auth/drive.file
 * (Only files created by this app — never reads arbitrary Drive content.)
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID as string;
const REDIRECT_URI =
  (import.meta.env.VITE_GOOGLE_DRIVE_REDIRECT_URI as string | undefined) ??
  `${window.location.origin}/drive-auth/callback`;

const TOKEN_KEY = "reprise_drive_token";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DriveToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // unix ms
}

export interface DriveUploadProgress {
  bytesSent: number;
  totalBytes: number;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes.buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  return { verifier, challenge };
}

export function getAuthUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForToken(
  code: string,
  verifier: string
): Promise<DriveToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }
  const json = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
}

// ─── Token storage ────────────────────────────────────────────────────────────

export function storeToken(token: DriveToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function getStoredToken(): DriveToken | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveToken;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Returns a valid access token, refreshing if needed. Throws if no token. */
export async function getValidAccessToken(): Promise<string> {
  const token = getStoredToken();
  if (!token) throw new Error("Not authenticated with Google Drive");

  // Refresh 60 seconds early to avoid race conditions
  if (token.expires_at - 60_000 > Date.now()) {
    return token.access_token;
  }
  if (!token.refresh_token) {
    clearToken();
    throw new Error("Drive token expired — please re-authenticate");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });
  if (!res.ok) {
    clearToken();
    throw new Error("Failed to refresh Drive token — please re-authenticate");
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  const refreshed: DriveToken = {
    access_token: json.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  storeToken(refreshed);
  return refreshed.access_token;
}

// ─── Drive folder helpers ─────────────────────────────────────────────────────

/** Returns the ID of an existing folder or creates it under `parentId`. */
async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<string> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");

  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const { files } = await search.json() as { files: { id: string }[] };
  if (files.length > 0) return files[0].id;

  const create = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [],
    }),
  });
  const folder = await create.json() as { id: string };
  return folder.id;
}

/**
 * Ensures `Reprise/{songId}/` exists in Drive.
 * Returns the folder ID for that song.
 */
export async function ensureSongFolder(
  accessToken: string,
  songId: string
): Promise<string> {
  const rootId = await findOrCreateFolder(accessToken, "Reprise");
  return findOrCreateFolder(accessToken, songId, rootId);
}

// ─── Resumable upload ─────────────────────────────────────────────────────────

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Uploads a file to Google Drive using the resumable upload protocol.
 * Supports large files (vocals/instrumental can be 50–200 MB).
 *
 * @returns The Drive file ID of the uploaded file.
 */
export async function uploadFileResumable(
  accessToken: string,
  data: Uint8Array,
  fileName: string,
  mimeType: string,
  folderId: string,
  onProgress?: (p: DriveUploadProgress) => void
): Promise<string> {
  const totalBytes = data.byteLength;

  // Step 1: Initiate the resumable session
  const initRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(totalBytes),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );
  if (!initRes.ok) {
    throw new Error(`Failed to initiate Drive upload: ${await initRes.text()}`);
  }
  const uploadUri = initRes.headers.get("Location");
  if (!uploadUri) throw new Error("No upload URI returned from Drive");

  // Step 2: Upload in chunks
  let offset = 0;
  while (offset < totalBytes) {
    const end = Math.min(offset + CHUNK_SIZE, totalBytes);
    const chunk = data.slice(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${totalBytes}`;

    const chunkRes = await fetch(uploadUri, {
      method: "PUT",
      headers: {
        "Content-Range": contentRange,
        "Content-Type": mimeType,
      },
      body: chunk,
    });

    if (chunkRes.status === 308) {
      // Incomplete — continue
      const range = chunkRes.headers.get("Range");
      offset = range ? parseInt(range.split("-")[1], 10) + 1 : end;
      onProgress?.({ bytesSent: offset, totalBytes });
    } else if (chunkRes.status === 200 || chunkRes.status === 201) {
      // Complete
      const file = await chunkRes.json() as { id: string };
      onProgress?.({ bytesSent: totalBytes, totalBytes });
      return file.id;
    } else {
      throw new Error(`Drive upload chunk failed (${chunkRes.status}): ${await chunkRes.text()}`);
    }
  }

  throw new Error("Upload loop ended without a completed response");
}

// ─── Public download URL helper ───────────────────────────────────────────────

/** Returns a direct download URL for a Drive file (requires access token on mobile). */
export function getDriveDownloadUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
}
