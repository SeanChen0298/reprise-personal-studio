---
name: google-drive
description: Work on the Google Drive audio sync integration in Reprise. Use when adding features, debugging OAuth, changing folder structure, or implementing mobile re-discovery for Drive-synced files.
argument-hint: [debug-oauth | fix-upload | rediscover | <describe task>]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are working on the **Reprise** Google Drive integration. Use this project-specific knowledge to perform the requested task: **$ARGUMENTS**

---

## Overview

Reprise syncs processed audio files (audio.m4a, vocals.wav, no_vocals.wav) to Google Drive so the mobile app can download them for offline practice. The desktop app handles OAuth and upload; the mobile app handles download.

OAuth scope: `https://www.googleapis.com/auth/drive.file`
(Only files this app created — never reads arbitrary Drive content.)

---

## Key Files

| File | Purpose |
|------|---------|
| `reprise/apps/desktop/src/lib/google-drive.ts` | All Drive API logic: OAuth, token storage, folder helpers, resumable upload, re-discovery |
| `reprise/apps/desktop/src/pages/song-setup-page.tsx` | UI: Connect button, re-discovery on reconnect, per-file progress, Sync button |
| `reprise/apps/desktop/src-tauri/src/lib.rs` | Rust command `start_drive_oauth_listener` — one-shot HTTP callback server |
| `reprise/apps/desktop/src-tauri/Cargo.toml` | `tiny_http = "0.12"` dependency |
| `reprise/apps/desktop/src-tauri/capabilities/default.json` | `shell:allow-open` permits `https?://.+` (needed to open OAuth URL in browser) |
| `reprise/apps/desktop/src/lib/audio-download.ts` | `buildSongFolder` and `buildDriveFolderName` — shared naming convention |
| `reprise/supabase/migrations/00011_add_drive_file_ids.sql` | Adds `drive_audio_file_id`, `drive_vocals_file_id`, `drive_instrumental_file_id` to `songs` |
| `reprise/packages/shared/src/types/song.ts` | Three optional `drive_*_file_id` fields on `Song` interface |

---

## OAuth Flow (Desktop)

**Why system browser?** Tauri production WebView origin is `http://tauri.localhost` — Google does not accept it as a redirect URI. The solution uses a one-shot local HTTP server.

### Flow
1. JS calls `invoke("start_drive_oauth_listener")` → Rust binds `127.0.0.1:0`, returns random port
2. JS generates PKCE, builds auth URL with `redirect_uri = http://localhost:{port}/drive-auth/callback`
3. `shell.open(authUrl)` opens system browser → user consents
4. Google redirects to localhost; Rust `tiny_http` server receives it, parses `?code=`, responds with HTML "you can close this tab", emits Tauri event `drive-oauth-code`
5. JS receives code, exchanges for token (with `client_secret`), stores in `localStorage`
6. 2-minute timeout: Rust `recv_timeout(120s)` + JS `setTimeout(120_000)` both independently fire `drive-oauth-error` / reject

### Required env vars (`.env.production`)
```
VITE_GOOGLE_DRIVE_CLIENT_ID=...
VITE_GOOGLE_DRIVE_CLIENT_SECRET=...   ← required for Desktop OAuth client type
```

### Google Cloud Console requirements
- OAuth client type: **Desktop app** (not Web)
- Redirect URI: not needed (localhost ports are auto-allowed for Desktop apps)
- Scope: `https://www.googleapis.com/auth/drive.file`
- While app is in Testing mode: add user's Google account as a Test User

---

## Folder Structure on Drive

```
[Reprise Audio Files - DO NOT MODIFY]/
  {Title} - {Artist} [songId[:8]]/
    audio.m4a
    vocals.wav
    no_vocals.wav
```

The `[songId[:8]]` suffix is the first 8 characters of the Supabase UUID. This is **deterministic** — the same song always maps to the same folder name, enabling re-discovery.

**Local folder uses the same convention:**
`C:/Reprise/{Title} - {Artist} [songId[:8]]/`

Both are built by functions in `audio-download.ts`:
- `buildSongFolder(title, artist, songId)` → full local path
- `buildDriveFolderName(title, artist, songId)` → Drive subfolder name only

---

## Token Storage & Refresh

Tokens are stored in `localStorage` under key `reprise_drive_token` as `DriveToken`:
```typescript
interface DriveToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // unix ms
}
```

`getValidAccessToken()` auto-refreshes 60 seconds before expiry. If refresh fails, token is cleared and an error is thrown (user must re-authenticate).

---

## File Upload

`uploadFileResumable(accessToken, data, fileName, mimeType, folderId, onProgress?)`:
- Initiates a Drive resumable upload session
- Uploads in **5 MB chunks** using `Content-Range` headers
- Status 308 = chunk received, continue; 200/201 = complete
- Returns the Drive file ID
- Progress reported via `DriveUploadProgress { bytesSent, totalBytes }`

File IDs are saved to Supabase via `updateSong` after each file completes:
- `drive_audio_file_id`
- `drive_vocals_file_id`
- `drive_instrumental_file_id`

---

## Re-discovery (on Reconnect)

After OAuth completes, `connectDrive` automatically tries to re-link existing Drive files:

1. Calls `ensureSongFolder` (finds-or-creates the folder)
2. Calls `discoverFilesInFolder(accessToken, folderId, ["audio.m4a", "vocals.wav", "no_vocals.wav"])`
3. Writes any found file IDs back to Supabase via `updateSong`
4. Only updates fields not already populated (won't overwrite existing IDs)
5. Failure is silently swallowed — UI falls back to showing the Sync button

**Limitation:** `drive.file` scope only returns files the same app+account created. Cross-account re-discovery is not possible.

---

## Common Tasks

### Debug a 400 Bad Request on token exchange
Ensure `VITE_GOOGLE_DRIVE_CLIENT_SECRET` is set in `.env.production`. Desktop OAuth clients require `client_secret` in the token exchange body.

### Debug "Authentication timed out"
Either the Rust 120s `recv_timeout` or the JS `setTimeout(120_000)` fired. Both sides independently time out — the first to fire wins. Check that the system browser actually opened and the user completed the flow within 2 minutes.

### Debug files landing in Drive root instead of correct folder
Check that `ensureSongFolder` is called before `uploadFileResumable`. Verify `buildDriveFolderName` returns the expected string. The root folder name must be exactly `[Reprise Audio Files - DO NOT MODIFY]`.

### Add a new file to the sync set
1. Add the file path field to `Song` in `packages/shared/src/types/song.ts`
2. Add a `drive_*_file_id` column in a new Supabase migration
3. Add an upload block in `uploadToDrive` in `song-setup-page.tsx`
4. Add the filename to the `discoverFilesInFolder` call in `connectDrive`
5. Add the filename to the mobile download list in `app/song/[id].tsx`

---

## Invariants to Preserve

- **Never use `http://tauri.localhost` as redirect URI** — it will fail with `Error 400: invalid_request` in production
- **Always include `client_secret` in token exchange** — Desktop OAuth client type requires it
- **Folder name must be deterministic** — use `songId.slice(0, 8)` suffix, never timestamps
- **`discoverFilesInFolder` is best-effort** — always wrap in try/catch, never block the connect flow
- **`drive.file` scope is intentional** — do not expand to `drive` or `drive.readonly`; the app should never read arbitrary user Drive content
