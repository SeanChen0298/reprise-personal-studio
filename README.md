# Reprise
> Return to a passage and make it yours.

A personal practice studio for singers who want to learn songs deeply — line by line, word by word. Reprise lets you download a reference track, annotate every lyric with technique notes, mark timestamps, practice with loops and speed control, record your takes, and track your progress.

---

## What It Does

**The core loop:**
1. Paste a YouTube URL → audio downloads automatically
2. Enter your lyrics line by line
3. Mark start/end timestamps for each line on the waveform
4. Annotate words with technique highlights (falsetto, whisper, belt, etc.)
5. Practice each line with variable speed and loop control
6. Record your take, mark your best, track mastery

**Two clients, one sync layer:**

| | Desktop (Tauri/Windows) | Mobile (iOS/Android) |
|---|---|---|
| **Primary use** | Production setup, deep editing | On-the-go practice |
| **Audio processing** | yt-dlp download, Demucs stems, pitch analysis | Download from Google Drive |
| **Waveform editing** | Yes — drag timestamps, see pitch curve | No |
| **Annotation editor** | Full inline editor | Read-only view |
| **Recording** | Line-by-line + section takes | Line-by-line |
| **Offline** | Yes (SQLite) | Yes (AsyncStorage + local files) |
| **Sync** | Upload to Supabase + Google Drive | Pull from Supabase + Google Drive |

---

## Features

### Song Library
- Add songs manually or by pasting a YouTube URL
- Thumbnail, title, and artist auto-filled from YouTube metadata
- BPM detection on download
- Pin favorites, track mastery percentage per song
- Tag and filter your library

### Audio Processing (Desktop)
- **yt-dlp** — download audio from YouTube in the background
- **Demucs** — split into vocals + instrumental stems (htdemucs model, ~2–3 min/song)
- **torchcrepe** — extract pitch curve from vocal stem (10ms resolution, CSV output)
- Background task queue with progress tracking
- Toggle between full mix, vocals only, or instrumental during practice

### Lyrics & Annotation
- Enter lyrics line by line
- Custom text field per line (e.g., for phonetic transcriptions or translations)
- Furigana auto-generated for Japanese lyrics (rendered as `<ruby>` HTML via kuroshiro)
- **Annotation highlights** — select a span of text and apply a technique tag:
  - Built-in: Falsetto, Whisper, Accent, Vibrato, Breath mark
  - Custom: define your own with any name and color
- Line-level notes for broader technique reminders
- Translation language support (parallel lines in a second language)

### Timestamp Marking (Desktop)
- Full-song waveform view
- Click waveform to set `start_ms` / `end_ms` per line
- Undo/redo stack
- Auto-fill previous line's end when marking a new start
- Insert `[Music]` filler lines for instrumental sections

### Practice Playback
**Desktop:**
- Line-by-line or multi-line looping
- Variable speed: 0.5× – 1.0× (0.05× steps)
- Volume control
- Track selector: reference / vocals / instrumental
- Waveform visualization with pitch curve overlay
- Auto-advance through lines
- Count-in audio cue option

**Mobile:**
- Carousel view (centered line, ±2 lines visible)
- Smooth gesture controls: tap to seek, swipe to change line, hold-drag to scrub speed
- Configurable max loops per line: 1 / 2 / 3 / 5 / ∞
- Track switching (preserves playback position)

### Line Status Tracking (Automatic)
Status advances as you practice — no manual buttons needed:

```
new → listened → annotated → practiced → recorded → best_take_set
```

Driven by play count, annotation presence, and whether a recording has been marked as best.

### Recording
- Record takes line by line during practice
- Adjustable playback gain for monitoring recordings
- Mark recordings as "master take" or "best take" (independent)
- Add a free-text note per recording
- Recording library view

### Google Drive Sync
- Desktop uploads audio, stems, and pitch data to `Reprise/<Song Title>/` in your Drive
- Mobile discovers and downloads files using the Drive IDs stored on each song
- PKCE OAuth — no client secret exposed; tokens auto-refresh
- Resumable uploads for large files

### Themes
6 built-in themes: Blue, Midnight, Violet, Emerald, Red, Amber. CSS variable-based, persistent per user.

---

## Setup

### Requirements

**All platforms:**
- Node.js (in PATH — required by yt-dlp for YouTube extraction)
- pnpm v10+

**Desktop additional:**
- Rust toolchain (for Tauri)
- Python 3.11 (for Demucs and torchcrepe — not compatible with 3.14+)
- FFmpeg (`winget install Gyan.FFmpeg`)
- `pip install demucs soundfile torchcrepe`
  - Pin `torch` and `torchaudio` to 2.5.1
  - Do **not** install `torchcodec`

**YouTube downloads:**
- Export YouTube cookies from Chrome (while logged in) using a "Get cookies.txt LOCALLY" extension
- Save to `C:/Reprise/cookies.txt`
- Re-export if downloads fail with "Sign in to confirm you're not a bot"

### Install & Run

```bash
pnpm install

# Desktop
pnpm --filter desktop tauri dev

# Mobile
pnpm --filter mobile-rn expo start
```

### Supabase (local dev)

```bash
supabase start
supabase db reset    # applies all 13 migrations
```

---

## Tech Stack

**Desktop:** Tauri v2 · React 19 · React Router 7 · Zustand 5 · Tailwind CSS v4 · wavesurfer.js 7 · kuroshiro/kuromoji

**Mobile:** React Native 0.79 · Expo 53 · Expo Router 5 · Expo AV · Reanimated 3 · Gesture Handler 2 · Zustand 5 · kuroshiro/kuromoji

**Backend:** Supabase (Postgres + Auth + Edge Functions) · Google Drive API (PKCE OAuth)

**Processing:** yt-dlp · Demucs (htdemucs) · torchcrepe · FFmpeg

---

## Data Model

```
Song
├── title, artist, youtube_url, language
├── tags, notes, pinned, mastery (0–100)
├── thumbnail_b64                    # base64 JPEG captured at download
├── audio_path, vocals_path, instrumental_path, pitch_data_path
├── download_status, stem_status, pitch_status
└── drive_audio_file_id, drive_vocals_file_id, drive_instrumental_file_id

Line
├── song_id, order
├── text (original), custom_text (user-edited)
├── annotations []                   # [{start, end, type}] char-index spans on custom_text
├── start_ms, end_ms                 # audio timestamps
├── status, play_count               # auto-tracked
├── language                         # null = primary language row
└── furigana_html, custom_furigana_html

Recording
├── song_id, line_id (optional)
├── file_path, duration_ms
├── is_master_take, is_best_take
└── note

Section                              # named practice segments
└── song_id, name, start_line_order, end_line_order

HighlightType (in preferences)
└── id, name, color_hex              # per-user annotation vocabulary
```

---

## Monorepo Structure

```
reprise/
├── apps/
│   ├── desktop/           Tauri app (Rust + React)
│   │   ├── src/           React frontend
│   │   └── src-tauri/     Rust backend + Python sidecar scripts
│   └── mobile-rn/         React Native + Expo
│       ├── app/           Expo Router screens
│       └── src/           Components, hooks, stores
├── packages/
│   ├── shared/            Shared TypeScript types, schemas, Supabase client
│   └── ui/                Shared React components
└── supabase/              Migrations, RLS policies, Edge Functions
```

---

## Roadmap

| Phase | Status | Features |
|---|---|---|
| MVP | ✅ Done | Song library, YouTube import, manual lyrics, timestamp waveform, annotation editor, line-by-line playback (desktop + mobile), recording, Google Drive sync |
| v1.5 | 🚧 Partial | Demucs stems ✅, torchcrepe pitch ✅, mobile practice ✅, WhisperX auto-align ❌, compile recordings ❌ |
| v2 | 📋 Planned | Pitch accuracy comparison (user vs. reference vocal), waveform on mobile, auto lyrics fetch |
| v3+ | 📋 Planned | Multi-track recording, collaboration, cloud storage provider selection |
