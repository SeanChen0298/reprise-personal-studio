# CLAUDE.md — Reprise Agent Reference

## Project
Reprise — personal vocal practice studio. Cross-platform: **desktop** (Tauri/React) for production/editing, **mobile** (React Native/Expo) for practice/recording.

---

## Monorepo Layout (pnpm workspaces)

```
reprise/
├── apps/desktop/          Tauri v2 + React 19 + Vite 6
│   ├── src/               React frontend (pages, components, hooks, stores, lib)
│   └── src-tauri/         Rust binary, capabilities, sidecars (Python scripts)
├── apps/mobile-rn/        React Native 0.79 + Expo 53 + Expo Router 5
│   ├── app/               File-based routes ((tabs)/, song/[id], practice/[id])
│   └── src/               Components, hooks, stores, lib
├── packages/shared/       Shared TS types, Zod schemas, Supabase client
├── packages/ui/           Shared React components (minimal use currently)
└── supabase/              Migrations (13), RLS policies, Edge Functions (Google Drive OAuth)
```

> `apps/mobile/` is a deprecated Vite-based app — ignore it.

---

## Common Commands

```bash
pnpm install                                  # install all workspaces
pnpm --filter desktop tauri dev               # run desktop (Vite on 127.0.0.1:5173)
pnpm --filter mobile-rn expo start            # run mobile (Expo Go / dev client)
supabase start | supabase db reset            # local Supabase
find . -name "node_modules" -type d -prune -exec rm -rf '{}' +   # full clean
```

**Vite port is 5173** (`host: 127.0.0.1` required on Windows to avoid EACCES). Tauri devUrl matches.

---

## Tech Stack

| Concern | Desktop | Mobile |
|---|---|---|
| Framework | Tauri v2 + React 19 | React Native 0.79 + Expo 53 |
| Routing | React Router 7 | Expo Router 5 (file-based) |
| State | Zustand 5 | Zustand 5 |
| DB | Supabase Postgres (cloud sync) | Supabase Postgres (cloud sync) |
| Local storage | — | AsyncStorage (preferences, file paths) |
| Audio | wavesurfer.js 7 (waveform) | expo-av 15 (playback + recording) |
| Animation | — | Reanimated 3 + Gesture Handler 2 |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"`, `@theme` block) | React Native StyleSheet |
| Japanese | kuroshiro + kuromoji (furigana) | Same |
| BPM | music-tempo | — |

---

## Data Models (actual schema in Supabase)

### Song
```ts
id, user_id, title, artist, youtube_url, language, translation_language
tags: string[], notes, pinned: boolean, mastery: 0–100
thumbnail_url, thumbnail_b64              // base64 JPEG from yt-dlp
audio_path, audio_folder                 // desktop local paths
vocals_path, instrumental_path, pitch_data_path
download_status, stem_status, pitch_status  // 'idle'|'downloading'|'processing'|'done'|'error'
drive_audio_file_id, drive_vocals_file_id, drive_instrumental_file_id  // Google Drive
created_at, updated_at
```

### Line
```ts
id, song_id, user_id
text: string                  // original lyrics
custom_text?: string          // user-edited version
annotations: Annotation[]     // JSONB — [{start, end, type, furigana_html?}]
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

### Other tables: `sections` (start/end line_order), `profiles`, `preferences` (highlights JSONB)

### Annotation structure
```ts
{ start: number, end: number, type: string }  // start/end = char indices in custom_text
```

### Line status progression (behavior-based, not user-set)
```
new → listened (play_count ≥ 1) → annotated (annotation added) →
practiced (play_count ≥ 10) → recorded (recording saved) → best_take_set
```

---

## Desktop Key Files

```
src/pages/         library-page, practice-page, timestamp-page, song-setup-page, recordings-page
src/components/    audio-player, full-waveform, waveform, pitch-curve, annotated-text
src/hooks/         use-line-player (core playback), use-recorder, use-waveform-data, use-pitch-data
src/stores/        song-store (master), preferences-store, auth-store, task-queue-store, drive-sync-store
src/lib/           audio-download.ts (yt-dlp), audio-analysis.ts (torchcrepe), google-drive.ts
```

**`use-line-player.ts`** — single-line and range looping, speed 0.5x–1.0x (0.05x steps), auto-advance, `onLinePlayed` callback increments `play_count`.

**`task-queue-store.ts`** — persisted queue for Demucs, torchcrepe, Drive uploads. Processed by `use-task-queue-processor.ts`.

---

## Mobile Key Files

```
app/(tabs)/index.tsx     Songs list (fetch from Supabase, Drive auto-download)
app/(tabs)/settings.tsx  Theme, Drive auth, highlight config
app/song/[id].tsx        Song detail, line status pills, tap-to-practice
app/practice/[id].tsx    Carousel + transport controls
src/components/lyric-display.tsx    Reanimated 3 carousel (5-slot circular buffer)
src/components/transport-controls.tsx
src/stores/song-files-store.ts      songId → {audioPath, vocalsPath, instrPath, driveFileIds}
src/hooks/use-line-player.ts        expo-av based, same logic as desktop
```

**Gesture map in `lyric-display.tsx`:**
- Tap (<350ms, <15px) → seek to line
- Vertical swipe (dy > 40px) → prev/next line
- Hold + horizontal drag → speed scrub

---

## Coding Rules

- **TypeScript strict.** Types shared by both apps → `packages/shared`.
- **All timing in milliseconds.** Never use seconds in audio logic.
- **Playback speed:** 0.5x–1.0x only (0.05x increments).
- **Functional components only.** No class components.
- **Naming:** `PascalCase` components, `camelCase` functions/vars, `kebab-case` files.
- **DB rows:** Always include `updated_at` and `user_id`.
- **Audio processing** (Demucs, torchcrepe) → Python sidecars on desktop only.
- **Do not use `apps/mobile/`** — use `apps/mobile-rn/`.

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

## Google Drive Sync

- Desktop: Upload via PKCE OAuth (system browser + local HTTP callback server). Resumable uploads.
- Mobile: Download using Drive file IDs stored on Song rows (`drive_*_file_id`).
- Edge Functions in `supabase/functions/`: `google-drive-auth`, `google-drive-callback`, `google-drive-refresh`.
- Folder structure: `Reprise/<Song-Title>/` with `audio.m4a`, `vocals.wav`, `instrumental.wav`, `pitch.csv`.

---

## Furigana

Auto-generated via `kuroshiro` + `kuromoji` analyzer. Output is `<ruby>` HTML stored in `furigana_html` / `custom_furigana_html` on Line rows. Never manually edit furigana HTML — regenerate via `generateFurigana()` in `packages/shared/src/furigana.ts`.

---

## Theme System (Desktop)

6 built-in themes: `blue`, `midnight`, `violet`, `emerald`, `red`, `amber`.
CSS variable-based: `--theme`, `--theme-light`, `--theme-text`. Stored in `preferences-store`.

---

## Supabase Migrations (13 total)

```
00001 profiles (auto-create trigger on auth.users)
00002 songs
00003 lines
00004 sections
00005 recordings
00006 language fields (song + line)
00007 preferences (highlights JSONB, other_settings JSONB)
00008 is_best_take, note on recordings
00009 line status enum + play_count
00010 furigana_html on lines
00011 Google Drive file IDs on songs
00012 furigana_html on annotations
00013 custom_furigana_html for custom_text
```

---

## What's Actually Built (vs. Planned)

**Working:** Auth (email + Google OAuth), song library, YouTube import, yt-dlp download, Demucs stems, torchcrepe pitch, manual lyrics + furigana, annotation editor (5 predefined + custom types), timestamp waveform marker, line-by-line practice playback (desktop + mobile), recording, Google Drive sync, line status auto-tracking, 6 themes, task queue, section markers.

**Not yet built:** WhisperX auto-alignment, compile line recordings → full song, pitch accuracy comparison (user vs. reference vocal), waveform display on mobile, collaboration/sharing.
