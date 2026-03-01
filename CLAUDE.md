# CLAUDE.md — Reprise Project Memory

## Project: Reprise
Personal practice studio for singers. Cross-platform (Tauri/React Native).
**Motto:** "Return to a passage and make it yours."

## Architecture & Monorepo (pnpm)
- `apps/desktop`: Tauri (Rust) + React (TS). Production/Editing client.
- `apps/mobile`: React Native + Expo. Practice/Recording companion.
- `packages/shared`: Common TS types, Zod schemas, constants.
- `packages/ui`: Shared React components.
- `src-tauri/sidecars`: Python binaries (`demucs`, `whisperx`, `yt-dlp`).
- `supabase/`: Database migrations, RLS, and Edge Functions.

## Tech Stack & Standards
- **State:** `Zustand` for playback and global UI state.
- **Database:** Offline-first. `tauri-plugin-sql` (Desktop) / `expo-sqlite` (Mobile).
- **Styling:** Tailwind CSS (Desktop) / NativeWind or StyleSheet (Mobile).
- **Audio:** `ms` (milliseconds) for all timing. 0.5x–1.0x speed range.
- **Sync:** Supabase (Postgres) with `updated_at` last-write-wins conflict resolution.

## Common Commands
- **Install:** `pnpm install`
- **Run Desktop:** `pnpm --filter desktop tauri dev`
- **Run Mobile:** `pnpm --filter mobile expo start`
- **Supabase:** `supabase start` | `supabase db reset`
- **Clean:** `find . -name "node_modules" -type d -prune -exec rm -rf '{}' +`

## Coding Rules
- **TypeScript:** Strict typing. Use `packages/shared` for any type used by both apps.
- **Audio Logic:** Keep heavy processing (compilation, stems) in Rust sidecars/core.
- **Components:** Functional components only. Atomic design in `packages/ui`.
- **Naming:** `PascalCase` for components, `camelCase` for functions/variables, `kebab-case` for files.
- **Sync:** Always include `updated_at` and `user_id` in DB-related schemas.

## Core Data Entities
- **Song:** Metadata, file paths (vocals/inst/ref), bpm, mastery %, `thumbnail_b64` (base64 JPEG from yt-dlp), `pinned` (bool).
- **Line:** `start_ms`, `end_ms`, `status` (not_started/learning/mastered).
- **Annotation:** JSON array: `[{ text: string, type: HighlightType }]`.
- **Recording:** `line_id`, `file_path`, `is_master_take`.

## yt-dlp Setup (YouTube Downloads)
yt-dlp is used to download audio and subtitles from YouTube. It requires:
1. **Node.js** in PATH (used as JS runtime for YouTube extraction via `--js-runtimes node`)
2. **Cookies file** at `C:/Reprise/cookies.txt` (YouTube requires auth to avoid bot detection)
3. **Remote challenge solver** enabled via `--remote-components ejs:github`

### Exporting cookies (when downloads fail with "Sign in to confirm you're not a bot")
1. Install a Netscape cookie export extension in Chrome (e.g. "Get cookies.txt LOCALLY")
2. Navigate to `youtube.com` while logged in
3. Export cookies and save to `C:/Reprise/cookies.txt`
4. The cookies file may expire periodically — re-export if downloads start failing again

### Known Tauri shell issues
- **Non-UTF-8 output:** Tauri's shell plugin can't decode non-ASCII characters (e.g. Japanese) in yt-dlp's stderr. Folder names are sanitized to ASCII-only to reduce this. The `error` event is treated as non-fatal.
- **Chrome cookie DB locked:** `--cookies-from-browser chrome` fails while Chrome is running. Use a cookies.txt file instead.

## Demucs Setup (Stem Separation)
Demucs splits audio into vocal and instrumental tracks. It requires:
1. **Python 3.11** (Demucs is not compatible with Python 3.14+)
2. **FFmpeg** (audio decoder — install via `winget install Gyan.FFmpeg`)
3. **Demucs + torchcodec** (`pip install demucs torchcodec`)

### Usage
```
python -m demucs -n htdemucs --two-stems vocals "C:/Reprise/<song-folder>/audio.m4a"
```
- `--two-stems vocals` outputs vocals + accompaniment (no-vocals) only
- `-n htdemucs` uses the hybrid transformer model (best speed/quality tradeoff)
- Output goes to `separated/htdemucs/<track>/vocals.wav` and `no_vocals.wav`
- First run downloads the model (~80 MB) to `~/.cache/torch/hub/checkpoints/`

### Tauri shell permissions
`python` and `ffmpeg` commands are allowed in `src-tauri/capabilities/default.json` alongside `yt-dlp`.

## Current Roadmap
- **MVP:** Manual lyrics, tap-to-mark timestamps, desktop playback/recording.
- **v1.5:** Sidecar integration (Demucs/WhisperX), Mobile app sync.