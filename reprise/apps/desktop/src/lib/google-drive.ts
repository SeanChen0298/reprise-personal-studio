/**
 * Google Drive integration for Reprise desktop app.
 *
 * OAuth2 PKCE flow (system browser + Rust local HTTP server):
 *   1. startDriveOAuth()
 *      a. Rust binds a random loopback port, returns it
 *      b. JS generates PKCE, opens OAuth URL in system browser
 *      c. User authenticates; Google redirects to http://localhost:PORT/...?code=...
 *      d. Rust catches the request, emits "drive-oauth-code" Tauri event
 *      e. JS receives the code, exchanges it for a token, stores it
 *
 * Scopes: https://www.googleapis.com/auth/drive.file
 * (Only files created by this app — never reads arbitrary Drive content.)
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID as string;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_SECRET as string;
const TOKEN_KEY = "reprise_drive_token";

// ─── Types ────────────────────────────────────────────────────────────────────

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

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(verifierBytes.buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  return { verifier, challenge };
}

function buildAuthUrl(challenge: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCodeForToken(
  code: string,
  verifier: string,
  redirectUri: string
): Promise<DriveToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
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

// ─── Full OAuth flow ──────────────────────────────────────────────────────────

/**
 * Runs the complete Google Drive OAuth2 PKCE flow via system browser.
 *
 * 1. Asks Rust to bind a random loopback port (one-shot HTTP server)
 * 2. Opens the Google consent screen in the user's default browser
 * 3. Waits for the "drive-oauth-code" Tauri event from Rust
 * 4. Exchanges the code for a token and stores it
 *
 * Throws on error or if the user cancels (no code received).
 */
export async function startDriveOAuth(
  onUrl?: (url: string) => void
): Promise<DriveToken> {
  // Start the Rust callback server — returns the random port
  const port = await invoke<number>("start_drive_oauth_listener");
  const redirectUri = `http://localhost:${port}/drive-auth/callback`;

  const { verifier, challenge } = await generatePKCE();
  const authUrl = buildAuthUrl(challenge, redirectUri);

  // Open the consent screen in the system browser, then expose URL to caller
  await open(authUrl);
  onUrl?.(authUrl);

  // Wait for Rust to emit the code (or an error)
  return new Promise<DriveToken>((resolve, reject) => {
    const unlistenCode = listen<string>("drive-oauth-code", async (event) => {
      cleanup();
      try {
        const token = await exchangeCodeForToken(event.payload, verifier, redirectUri);
        storeToken(token);
        resolve(token);
      } catch (err) {
        reject(err);
      }
    });

    const unlistenError = listen<string>("drive-oauth-error", (event) => {
      cleanup();
      reject(new Error(event.payload));
    });

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Authentication timed out. Please try again."));
    }, 2 * 60 * 1000); // 2 minutes

    function cleanup() {
      clearTimeout(timeoutId);
      unlistenCode.then((fn) => fn());
      unlistenError.then((fn) => fn());
    }
  });
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
      client_secret: CLIENT_SECRET,
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

// Deduplicates concurrent findOrCreateFolder calls for the same folder key so
// parallel song uploads never race to create the same folder simultaneously.
const _folderInFlight = new Map<string, Promise<string>>();

async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<string> {
  const key = `${parentId ?? "root"}::${name}`;
  const inflight = _folderInFlight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
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
  })();

  _folderInFlight.set(key, promise);
  promise.finally(() => _folderInFlight.delete(key));
  return promise;
}

export async function ensureSongFolder(
  accessToken: string,
  folderName: string
): Promise<string> {
  const rootId = await findOrCreateFolder(accessToken, "[Reprise Audio Files - DO NOT MODIFY]");
  return findOrCreateFolder(accessToken, folderName, rootId);
}

/**
 * Search for existing files inside a Drive folder by name.
 * Returns a map of { fileName → fileId } for any matches found.
 */
export async function discoverFilesInFolder(
  accessToken: string,
  folderId: string,
  fileNames: string[]
): Promise<Record<string, string>> {
  const nameList = fileNames.map((n) => `name = '${n}'`).join(" or ");
  const q = `(${nameList}) and '${folderId}' in parents and trashed = false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const { files } = await res.json() as { files: { id: string; name: string }[] };
  const result: Record<string, string> = {};
  for (const f of files) result[f.name] = f.id;
  return result;
}

// ─── Resumable upload ─────────────────────────────────────────────────────────

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

export async function uploadFileResumable(
  accessToken: string,
  data: Uint8Array,
  fileName: string,
  mimeType: string,
  folderId: string,
  onProgress?: (p: DriveUploadProgress) => void,
  existingFileId?: string
): Promise<string> {
  const totalBytes = data.byteLength;

  // If an existing file ID is provided, update the file in-place (PATCH) to avoid
  // creating a duplicate. Otherwise, create a new file (POST).
  const initUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id";
  const initBody = existingFileId
    ? JSON.stringify({ name: fileName }) // no parents when updating
    : JSON.stringify({ name: fileName, parents: [folderId] });

  const initRes = await fetch(initUrl, {
    method: existingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(totalBytes),
    },
    body: initBody,
  });
  if (!initRes.ok) {
    throw new Error(`Failed to initiate Drive upload: ${await initRes.text()}`);
  }
  const uploadUri = initRes.headers.get("Location");
  if (!uploadUri) throw new Error("No upload URI returned from Drive");

  let offset = 0;
  while (offset < totalBytes) {
    const end = Math.min(offset + CHUNK_SIZE, totalBytes);
    const chunk = data.slice(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${totalBytes}`;

    const chunkRes = await fetch(uploadUri, {
      method: "PUT",
      headers: { "Content-Range": contentRange, "Content-Type": mimeType },
      body: chunk,
    });

    if (chunkRes.status === 308) {
      const range = chunkRes.headers.get("Range");
      offset = range ? parseInt(range.split("-")[1], 10) + 1 : end;
      onProgress?.({ bytesSent: offset, totalBytes });
    } else if (chunkRes.status === 200 || chunkRes.status === 201) {
      const file = await chunkRes.json() as { id: string };
      onProgress?.({ bytesSent: totalBytes, totalBytes });
      return file.id;
    } else {
      throw new Error(`Drive upload chunk failed (${chunkRes.status}): ${await chunkRes.text()}`);
    }
  }

  throw new Error("Upload loop ended without a completed response");
}

/** Returns a direct download URL for a Drive file (requires access token on mobile). */
export function getDriveDownloadUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
}

/**
 * Delete ALL files and folders inside the Reprise root folder on Drive.
 * This permanently removes every audio file synced by this app for every song.
 * Returns the total number of items deleted.
 */
export async function purgeDriveAll(accessToken: string): Promise<number> {
  const delOne = async (id: string): Promise<number> => {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return r.ok || r.status === 404 ? 1 : 0;
  };

  // Find the root folder
  const q = [
    "name = '[Reprise Audio Files - DO NOT MODIFY]'",
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    "'root' in parents",
  ].join(" and ");
  const rootRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const { files: rootFiles } = await rootRes.json() as { files: { id: string }[] };
  console.log("[purgeDriveAll] root folders found:", rootFiles.length);
  if (rootFiles.length === 0) return 0;

  let deleted = 0;
  for (const root of rootFiles) {
    const childQ = `'${root.id}' in parents and trashed = false`;
    const childRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(childQ)}&fields=files(id,mimeType)&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const { files: children } = await childRes.json() as { files: { id: string; mimeType: string }[] };
    console.log("[purgeDriveAll] song folders + files found:", children.length);

    for (const child of children) {
      if (child.mimeType === "application/vnd.google-apps.folder") {
        const gcQ = `'${child.id}' in parents and trashed = false`;
        const gcRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(gcQ)}&fields=files(id)&pageSize=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const { files: grandChildren } = await gcRes.json() as { files: { id: string }[] };
        console.log("[purgeDriveAll] deleting", grandChildren.length, "files in folder", child.id);
        for (const gc of grandChildren) {
          deleted += await delOne(gc.id);
        }
      }
      deleted += await delOne(child.id);
    }
    await delOne(root.id);
  }
  console.log("[purgeDriveAll] total deleted:", deleted);
  return deleted;
}
