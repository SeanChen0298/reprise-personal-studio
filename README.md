# Reprise
> Return to a passage and make it yours.

A personal practice studio for singers who want to learn songs deeply — line by line, word by word. Reprise lets you download a reference track, annotate every lyric with technique notes, mark timestamps, practice with loops and speed control, record your takes, and track your progress.

**Desktop-only and fully offline** — everything runs locally on your machine. No account, no cloud, no network required.

---

## What It Does

**The core loop:**
1. Paste a YouTube URL → audio downloads automatically
2. Enter your lyrics line by line
3. Mark start/end timestamps for each line on the waveform (or auto-align with WhisperX)
4. Annotate words with technique highlights (falsetto, whisper, belt, etc.)
5. Practice each line with variable speed and loop control
6. Record your take, mark your best, track mastery

All songs, lyrics, annotations, recordings metadata, and sections are stored in a **local database (Dexie/IndexedDB)**. Audio files live on local disk under `C:/Reprise/`.

---

## Features

### Song Library
- Add songs manually or by pasting a YouTube URL
- Thumbnail, title, and artist auto-filled from YouTube metadata
- BPM detection on download
- Pin favorites, track mastery percentage per song
- Tag and filter your library

### Audio Processing
- **yt-dlp** — download audio from YouTube in the background
- **Demucs** — split into vocals + instrumental stems (htdemucs model, ~2–3 min/song)
- **torchcrepe** — extract pitch curve from vocal stem (10ms resolution, CSV output)
- **WhisperX** — auto-align lyrics to audio for per-line timestamps
- Background task queue with progress tracking
- Toggle between full mix, vocals only, or instrumental during practice

### Lyrics & Annotation
- Enter lyrics line by line
- Custom text field per line (e.g., phonetic transcriptions or translations)
- Furigana auto-generated for Japanese lyrics (rendered as `<ruby>` HTML via kuroshiro)
- **Annotation highlights** — select a span of text and apply a technique tag:
  - Built-in: Falsetto, Whisper, Accent, Vibrato, Breath mark
  - Custom: define your own with any name and color
- Line-level notes for broader technique reminders
- Translation language support (parallel lines in a second language)

### Timestamp Marking
- Full-song waveform view
- Click waveform to set `start_ms` / `end_ms` per line
- Undo/redo stack; auto-fill previous line's end when marking a new start
- Insert `[Music]` filler lines for instrumental sections

### Practice Playback
- Line-by-line or multi-line looping
- Variable speed: 0.5× – 1.0× (0.05× steps)
- Volume control; track selector: reference / vocals / instrumental
- Waveform visualization with pitch curve overlay
- Auto-advance through lines; count-in audio cue option

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
- Add a free-text note per recording; recording library view

### Backup & Restore
- Export the entire local database (songs, lyrics, recordings, sections) to a JSON file
- Restore from a backup file (upsert by id)
- Settings → Preferences → "Backup & restore"

### Themes
6 built-in themes: Blue, Midnight, Violet, Emerald, Red, Amber. CSS variable-based, persisted locally.

---

## Setup

### Requirements
- Node.js (in PATH — required by yt-dlp for YouTube extraction)
- pnpm v10+
- Rust toolchain (for Tauri)
- Python 3.11 (for Demucs / torchcrepe / WhisperX — not compatible with 3.14+)
- FFmpeg (`winget install Gyan.FFmpeg`)
- `pip install demucs soundfile torchcrepe`
  - Pin `torch` and `torchaudio` to 2.5.1
  - Do **not** install `torchcodec`

**YouTube downloads:**
- Export YouTube cookies from Chrome (while logged in) using a "Get cookies.txt LOCALLY" extension
- Save to `C:/Reprise/cookies.txt`
- Re-export if downloads fail with "Sign in to confirm you're not a bot"

### Install & Run

```powershell
pnpm install
pnpm --filter desktop tauri dev      # run the app
pnpm --filter desktop build          # build the frontend (tsc -b && vite build)
```

### First run

Works **immediately, no setup**:
- Library, lyrics & annotation, manual timestamp marking, practice playback, recording
- **YouTube download** (needs `C:\Reprise\cookies.txt` — see below)
- **Translation** (Helsinki-NLP Opus-MT) — pure JS; the model auto-downloads from the web on first use, then runs offline
- **Furigana** — pure JS; the kuromoji dictionary is bundled, so it works offline immediately

Needs the **audio toolchain** (Demucs stems · torchcrepe pitch · WhisperX align):

1. Install Python 3.11 + FFmpeg + the ML packages — easiest via the helper script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File reprise\scripts\setup.ps1
   ```
   …or manually: install **Python 3.11** (not 3.14+) and **FFmpeg**, then:
   ```powershell
   python -m pip install torch==2.5.1 torchaudio==2.5.1
   python -m pip install demucs soundfile torchcrepe whisperx
   ```
   > The app runs the `python` on your PATH — make sure `python --version` reports **3.11**. Do **not** install `torchcodec`.
2. **Models download themselves on first use** (internet required once): Demucs htdemucs (~80 MB), torchcrepe model, WhisperX (~3 GB). Cached afterward and run offline.
3. Check **Settings → Downloads** for live tool-detection status.

YouTube cookies (for downloads):
- Export YouTube cookies from Chrome (while logged in) with a "Get cookies.txt LOCALLY" extension → save to `C:\Reprise\cookies.txt`.

Moving data between machines:
- **Settings → Preferences → Backup & restore** exports/imports the whole library as JSON. Audio files live on disk, so copy your `C:\Reprise\<song>\` folders separately.

---

## Tech Stack

**App:** Tauri v2 · React 19 · React Router 7 · Zustand 5 · Tailwind CSS v4 · wavesurfer.js 7 · kuroshiro/kuromoji

**Database:** Dexie 4 (IndexedDB) — local, offline

**Processing:** yt-dlp · Demucs (htdemucs) · torchcrepe · WhisperX · FFmpeg

---

## Data Model

```
Song
├── title, artist, youtube_url, language, translation_language
├── tags, notes, pinned, mastery (0–100)
├── thumbnail_b64                    # base64 JPEG captured at download
├── audio_path, vocals_path, instrumental_path, pitch_data_path
└── download_status, stem_status, pitch_status, align_status

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
```

---

## Monorepo Structure

```
reprise/
├── apps/
│   └── desktop/           Tauri app (Rust + React)
│       ├── src/           React frontend
│       └── src-tauri/     Rust backend + Python sidecar scripts
└── packages/
    ├── shared/            Shared TypeScript types + furigana
    └── ui/                (empty placeholder)
```

> Reprise was previously cloud-synced (Supabase) with a companion mobile app and Google Drive sync. All of that has been removed — it is now a single, fully-local desktop app.

---

## Roadmap

| Phase | Status | Features |
|---|---|---|
| MVP | ✅ Done | Song library, YouTube import, manual lyrics, timestamp waveform, annotation editor, line-by-line playback, recording |
| v1.5 | ✅ Done | Demucs stems, torchcrepe pitch, WhisperX auto-align, local-first DB, backup/restore |
| v2 | 📋 Planned | Pitch accuracy comparison (user vs. reference vocal), compile line recordings → full song |
| v3+ | 📋 Planned | Multi-track recording |
