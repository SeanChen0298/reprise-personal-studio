# CLAUDE.md — Reprise Agent Reference

## Project
Reprise — personal vocal practice studio. **Desktop-only** (Tauri v2 + React), **fully offline / local-first**: no auth, no cloud database, no external integrations. All data lives in a local NoSQL database (Dexie/IndexedDB) on the machine; audio files live on local disk under `C:/Reprise/`.

> History: the app previously synced to Supabase (Postgres + Auth) and Google Drive, and shipped a React Native mobile app. All of that has been removed — the desktop app is now standalone and local. (An old Supabase cloud project may still exist remotely, but the app no longer references it.)

---

## Monorepo Layout (pnpm workspaces)

```
reprise/
├── apps/desktop/          Tauri v2 + React 19 + Vite 6   ← the app
│   ├── src/               React frontend (pages, components, hooks, stores, lib)
│   └── src-tauri/         Rust binary, capabilities, sidecars (Python scripts)
├── packages/shared/       Shared TS types (Song/Line/Recording/Section) + furigana
└── packages/ui/           Empty placeholder (unused)
```

---

## Common Commands

```powershell
pnpm install                                  # install all workspaces
pnpm --filter desktop tauri dev               # run desktop (Vite on 127.0.0.1:5173)
pnpm --filter desktop build                   # tsc -b && vite build (frontend)
pnpm --filter desktop exec tsc -b --noEmit    # typecheck only
```

**Vite port is 5173** (`host: 127.0.0.1` required on Windows to avoid EACCES). Tauri devUrl matches.

---

## Tech Stack (Desktop)

| Concern | Choice |
|---|---|
| Framework | Tauri v2 + React 19 |
| Routing | React Router 7 |
| State | Zustand 5 |
| Database | **Dexie 4 (IndexedDB)** — local, offline |
| Local prefs | Zustand `persist` → localStorage |
| Audio | wavesurfer.js 7 (waveform) + Web Audio |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"`, `@theme` block) |
| Japanese | kuroshiro + kuromoji (furigana) |
| BPM | music-tempo |

---

## Data Models

Stored as collections in the local Dexie DB (`apps/desktop/src/lib/local-db.ts`). Row shapes are produced/consumed by the `*ToDbRow` / `dbRowTo*` converters in `song-store.ts`. There is **no authentication**: every row carries `user_id = "local"` (constant `LOCAL_USER_ID`) purely so the converters stay intact — it is never used for filtering.

### Song
```ts
id, user_id, title, artist, youtube_url, language, translation_language
tags: string[], notes, pinned: boolean, mastery: 0–100
thumbnail_url, thumbnail_b64              // base64 JPEG from yt-dlp
audio_path, audio_folder                 // local paths under C:/Reprise/
vocals_path, instrumental_path, pitch_data_path
download_status, stem_status, pitch_status, align_status  // 'idle'|'downloading'|'processing'|'done'|'error'
created_at, updated_at
```

### Line
```ts
id, song_id, user_id
text: string                  // original lyrics
custom_text?: string          // user-edited version
annotations: Annotation[]     // [{start, end, type, furigana_html?}]
order: number
start_ms?, end_ms?
status: 'new'|'listened'|'annotated'|'practiced'|'recorded'|'best_take_set'
play_count: number            // auto-incremented by playback engine
language?: string             // null = primary, 'ja' etc. = translation row
furigana_html?: string        // auto-generated <ruby> HTML
custom_furigana_html?: string
created_at, updated_at
```

### Recording
```ts
id, song_id, line_id?, user_id, section_id?
file_path, duration_ms
is_master_take: boolean
is_best_take: boolean         // independent star toggle
note?: string
created_at, updated_at
```

### Other collections: `sections` (start/end line_order), `meta` (migration flag, misc)

### Line status progression (behavior-based, not user-set)
```
new → listened (play_count ≥ 1) → annotated (annotation added) →
practiced (play_count ≥ 10) → recorded (recording saved) → best_take_set
```

---

## Desktop Key Files

```
src/app.tsx        Routes; calls song-store loadAllData() on mount (boots to /library)
src/pages/         library-page, practice, timestamp-page, song-setup-page, recordings-page, settings-page
src/components/    sidebar, audio-player, full-waveform, waveform, pitch-curve, annotated-text, protected-route (pass-through)
src/hooks/         use-line-player (core playback), use-recorder, use-waveform-data, use-pitch-data
src/stores/        song-store (master), preferences-store, task-queue-store, queue-store
src/lib/           local-db.ts (Dexie data layer), audio-download.ts (yt-dlp), audio-analysis.ts (torchcrepe),
                   whisperx-align.ts, backup.ts (JSON export/import)
```

**`song-store.ts`** — the master store. All persistence goes through `localDb` (in `local-db.ts`), which returns `{ data, error }` results mirroring the old Supabase shape so the optimistic-update-with-rollback flow is preserved. Cascade deletes (song → lines/recordings/sections) are explicit, inside a Dexie transaction.

**`local-db.ts`** — Dexie schema + typed per-collection CRUD (`getAllSongs`, `insertLine`, `deleteSongCascade`, `deleteLinesForSongExceptLanguage`, etc.).

**`use-line-player.ts`** — single-line and range looping, speed 0.5x–1.0x (0.05x steps), auto-advance, `onLinePlayed` callback increments `play_count`.

**`task-queue-store.ts`** — persisted queue for Demucs / torchcrepe / WhisperX. Processed by `use-task-queue-processor.ts`.

---

## Backup

- **Backup export/import** (`lib/backup.ts`): Settings → Preferences → "Backup & restore". Exports the whole local DB to a timestamped JSON file; imports/upserts by id. Audio files are NOT included (they live on disk under `C:/Reprise/`). This is also how you move a library between machines.

---

## Coding Rules

- **TypeScript strict.** Cross-cutting types live in `packages/shared`.
- **All timing in milliseconds.** Never use seconds in audio logic.
- **Playback speed:** 0.5x–1.0x only (0.05x increments).
- **Functional components only.** No class components.
- **Naming:** `PascalCase` components, `camelCase` functions/vars, `kebab-case` files.
- **DB rows:** always include `updated_at` (and `user_id = LOCAL_USER_ID`).
- **Persistence goes through `localDb`** (`lib/local-db.ts`) — don't talk to IndexedDB directly.
- **Audio processing** (Demucs, torchcrepe, WhisperX) → Python sidecars, desktop only.

---

## yt-dlp (YouTube Downloads)

Requires:
1. **Node.js** in PATH (`--js-runtimes node`)
2. **Cookies file** at `C:/Reprise/cookies.txt` (export from Chrome while logged into YouTube)
3. **Deno** sidecar (see `src-tauri/` external binaries config)

**Known issues:**
- Tauri shell can't decode non-ASCII stderr → folder names sanitized to ASCII. `error` events treated as non-fatal.
- `--cookies-from-browser chrome` fails while Chrome is running → use cookies.txt file.

**Cookie refresh:** Re-export from Chrome if downloads fail with "Sign in to confirm you're not a bot".

---

## Demucs (Stem Separation)

Requires Python 3.11 (not compatible with 3.14+), FFmpeg, `pip install demucs soundfile`.
- Do NOT install `torchcodec` — conflicts with torchaudio on Windows.
- Pin `torch` and `torchaudio` to 2.5.1.

```bash
python -m demucs -n htdemucs --two-stems vocals "C:/Reprise/<song>/audio.m4a"
# Output: separated/htdemucs/<track>/vocals.wav + no_vocals.wav
```

First run downloads ~80 MB model to `~/.cache/torch/hub/checkpoints/`.

---

## torchcrepe (Pitch Analysis)

Requires Python 3.11, PyTorch (already with Demucs), `pip install torchcrepe`.
Runs on **vocals stem only** (after Demucs).

```bash
python -m torchcrepe --audio_files vocals.wav --output_files pitch.csv \
  --model full --hop_length 160 --decoder viterbi
# Output: CSV with time_ms, freq_hz, confidence at 10ms resolution
```

---

## Furigana

Auto-generated via `kuroshiro` + `kuromoji` analyzer. Output is `<ruby>` HTML stored in `furigana_html` / `custom_furigana_html` on Line rows. Never manually edit furigana HTML — regenerate via `generateFurigana()` in `packages/shared/src/lib/furigana.ts`. The kuromoji dictionary (~17 MB) is bundled at `apps/desktop/public/kuromoji/dict` and served from the app origin, so it works fully offline.

---

## Theme System

6 built-in themes: `blue`, `midnight`, `violet`, `emerald`, `red`, `amber`.
CSS variable-based: `--theme`, `--theme-light`, `--theme-text`. Stored in `preferences-store` (localStorage).

---

## What's Built

**Working:** local song library, YouTube import, yt-dlp download, Demucs stems, torchcrepe pitch, WhisperX timestamp alignment, manual lyrics + furigana, annotation editor (5 predefined + custom types), timestamp waveform marker, line-by-line practice playback, recording, line status auto-tracking, 6 themes, task queue, section markers, local DB backup/restore.

**Not yet built:** compile line recordings → full song, pitch accuracy comparison (user vs. reference vocal).
