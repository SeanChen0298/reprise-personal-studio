# Reprise
> Personal practice studio for mastering songs, line by line. Demo URL: https://desktop-weld.vercel.app/

---

## Vision

A cross-platform app (desktop + mobile) for learning and recording songs with precision — line by line, word by word. Built around a stateful practice loop with rich lyric annotation, reference playback, and recording. Desktop is the production and compilation client; mobile is the practice and annotation client. Architected to grow into a full production studio over time.

---

## Platform Philosophy

| | Desktop (Tauri) | Mobile (React Native) |
|---|---|---|
| Primary role | Production, compilation, deep editing | Practice, annotation, on-the-go learning |
| Audio engine | Rust / cpal — low latency, precise | expo-av — acceptable for practice |
| Recording | Line-by-line + full song | Line-by-line (compilation deferred to desktop) |
| Compile recordings | Yes | No |
| Waveform display | Yes | No (v2+ maybe) |
| Timestamp marking | Yes (tap + waveform marker + auto) | Tap only |
| Vocal removal | Yes (Demucs sidecar) | No |
| Auto-align lyrics | Yes (WhisperX sidecar) | No |
| Offline capable | Yes (SQLite local cache) | Yes (SQLite local cache) |

---

## MVP Feature Set

### Songs
- Add a song (title, artist, genre)
- View overall song progress (% of lines mastered)
- See all songs in a library view

### Lyrics & Lines
- Input lyrics manually (MVP) — auto-fetch via API in v2
- Lines are broken into individual units (by line or section)
- Each line has a status: `Not Started` → `Learning` → `Mastered`

### Annotations — Rich Lyric Markup
- Word and syllable-level inline highlighting with semantic meaning (e.g. falsetto, whisper, belt, breath, stress)
- User-defined highlight types with custom colors — vocabulary is personal, not hardcoded
- Ability to insert symbols and spacing markers between syllables (e.g. breath marks, pause indicators)
- Line-level text notes for broader context (e.g. "drop energy here", "open vowel")
- Visual indicator on lines that have annotations
- Highlight types stored in DB per user, fully customizable

Lyric segments are stored as structured JSON per line, not plain text:

```json
{
  "segments": [
    { "text": "Hikaru", "type": "normal" },
    { "text": "nara", "type": "falsetto" },
    { "text": " ", "type": "breath" },
    { "text": "sotto", "type": "whisper" }
  ]
}
```

### Reference Audio — Download & Management
- User pastes a YouTube URL per song
- App downloads audio via bundled **yt-dlp** sidecar binary
- Audio stored locally in the song's project folder as WAV
- Song metadata (title, artist, duration) auto-filled from yt-dlp output
- User can also provide a local audio file directly (MP3, WAV, FLAC)
- Audio file manager: view, re-download, or replace reference audio per song

### Vocal Removal — Demucs
- User triggers "Remove vocals" per song (one-time operation)
- **Demucs htdemucs_ft** model runs as a Python sidecar script in the background
- Splits reference audio into two files: `vocals.wav` and `instrumental.wav`
- User can toggle between practicing against full mix or instrumental only
- Isolated `vocals.wav` is also used as input for WhisperX alignment (cleaner signal)
- Model size: ~80MB. Peak RAM during processing: ~3–4GB. Unloads after completion.
- Processing time: roughly 1–3 minutes per song on a mid-range machine

### Timestamp Mapping — Line-to-Audio Sync
- Every line is mapped to a start and end timestamp in the reference audio
- **MVP: Manual tap-to-mark** — user plays the reference audio and taps a key at the start of each line
- **v1.5: Waveform marker view (desktop only)** — drag markers onto waveform per line
- **v1.5: Auto-align via WhisperX** — runs on isolated `vocals.wav` for best accuracy

#### WhisperX Auto-Alignment
- Runs **WhisperX with the `small` Whisper model** as a Python sidecar script
- Produces word-level timestamps mapped back to each lyric line
- Runs as a one-time background job per song — model unloads after completion
- Model size: ~465MB. Peak RAM during processing: ~2GB.
- Processing time: roughly 1–2 minutes per song on a mid-range machine
- Handles Japanese and other non-Latin scripts reasonably well
- Best results when run on isolated `vocals.wav` rather than full mix

**Recommended flow:**
```
Download audio (yt-dlp)
  → Remove vocals (Demucs) → vocals.wav + instrumental.wav
  → Auto-align (WhisperX on vocals.wav) → word-level timestamps
  → Review and adjust timestamps manually if needed
```

### Reference Playback
- Play reference audio for a specific line (seeks to `audio_start_ms`, plays to `audio_end_ms`)
- Toggle between full mix and instrumental-only playback
- Loop a single line on repeat
- Playback speed control (1x, 0.75x, 0.5x)
- Seamless transition between lines during full playback

### Recording
- Record your own take per line
- Record entire song in one continuous take (desktop)
- Replay your recording per line
- Compile individual line recordings into a full song recording — desktop only (v1.5)

### Progress Tracking
- Per-line status tracking
- Song-level progress bar
- "Last practiced" timestamp per song

---

## Data Model

```
Song
├── id
├── title
├── artist
├── genre
├── reference_file_path      # local path to original downloaded audio
├── vocals_file_path         # local path to Demucs vocals stem (null if not processed)
├── instrumental_file_path   # local path to Demucs instrumental stem (null if not processed)
├── reference_url            # original YouTube URL or source
├── duration_ms
├── overall_progress         # derived from line statuses
├── created_at
└── last_practiced_at

Line
├── id
├── song_id                  # FK → Song
├── position                 # order in song
├── segments_json            # structured JSON with word-level annotation segments
├── phonetic_text            # full-line phonetic pronunciation (plain text)
├── notes                    # freeform line-level notes
├── status                   # not_started | learning | mastered
├── audio_start_ms           # milliseconds into reference audio where line begins
├── audio_end_ms             # milliseconds where line ends
└── updated_at               # used for last-write-wins sync conflict resolution

HighlightType                # user-defined annotation vocabulary
├── id
├── name                     # e.g. "Falsetto", "Whisper", "Belt", "Breath"
├── color_hex                # e.g. "#DBEAFE"
└── created_at

Recording
├── id
├── song_id                  # FK → Song
├── line_id                  # FK → Line (null if full-song recording)
├── file_path                # absolute local path
├── cloud_path               # path in GDrive / Dropbox / S3 (null if not synced)
├── duration_ms
├── is_full_song             # boolean
└── created_at
```

---

## Sidecar Scripts

Tauri apps are primarily Rust + React. But some tasks are better handled by Python — specifically audio processing libraries like Demucs and WhisperX which have no Rust equivalents.

A **sidecar** is an external binary or script that ships bundled inside the app and gets spawned as a subprocess by the Rust backend when needed. The user never sees it — to them it's just the app doing a thing.

In Reprise, three tools run as sidecars:

| Sidecar | Language | Triggered by |
|---|---|---|
| yt-dlp | Python (prebuilt binary) | User pastes YouTube URL |
| Demucs | Python script | User clicks "Remove vocals" |
| WhisperX | Python script | User clicks "Auto-align lyrics" |

Each sidecar runs in the background, reports progress back to the UI, then exits and unloads from memory. The Rust backend manages spawning and communication:

```rust
// Simplified example — spawning WhisperX
Command::new("python3")
    .args(["sidecars/whisperx_align.py", "--audio", vocals_path, "--lyrics", lyrics_path])
    .stdout(Stdio::piped())
    .spawn()
```

The Python sidecar scripts live in a `sidecars/` folder inside the Tauri app bundle:

```
apps/desktop/src-tauri/
└── sidecars/
    ├── whisperx_align.py    # takes vocals.wav + lyrics, returns timestamps JSON
    └── demucs_split.py      # takes audio file, returns vocals.wav + instrumental.wav
```

**Dependency management:** The Python dependencies (demucs, whisperx, torch) need to be installed on the user's machine. The app will check for them on first launch and prompt the user to run an install script if missing. This is a known trade-off of using Python sidecars — acceptable for a desktop power tool, less ideal for a consumer app.

---

## Tech Stack

### Desktop (Tauri)
| Layer | Choice | Reason |
|---|---|---|
| App framework | Tauri | Native OS performance, direct audio hardware access, small binary |
| Frontend | React + TypeScript | Familiar, handles all UI and state |
| State management | Zustand | Lightweight, well-suited for audio playback state |
| Local database | SQLite (via tauri-plugin-sql) | Zero-latency, offline-capable local cache |
| Audio engine | Rust / cpal | Low-latency recording and playback, precise timestamp seeking |
| Audio processing | Rust / dasp (v2+) | Speed manipulation, waveform rendering, eventually effects |
| File compilation | Rust / hound or symphonia | Stitch line recordings into full song |
| Audio download | yt-dlp (sidecar binary) | User pastes YouTube URL, app downloads audio silently |
| Vocal removal | Demucs htdemucs_ft (Python sidecar) | Separates vocals and instrumental stems locally |
| Lyric alignment | WhisperX small (Python sidecar) | Word-level timestamp alignment, runs once per song |

### Mobile (React Native)
| Layer | Choice | Reason |
|---|---|---|
| App framework | React Native + Expo | Cross-platform iOS/Android, familiar React model |
| Frontend | React + TypeScript | Shared component logic with desktop where possible |
| State management | Zustand | Same library as desktop |
| Local database | SQLite (via expo-sqlite) | Offline-capable local cache |
| Audio engine | expo-av | Handles playback, recording, speed control |

### Shared / Cloud
| Layer | Choice | Reason |
|---|---|---|
| Structured data sync | Supabase (Postgres) | Syncs songs, lines, annotations, timestamps across devices |
| Auth | Supabase Auth | Email/password + Google OAuth, works on both clients |
| Audio file sync | Google Drive / Dropbox / S3 | User-owned storage — app never holds audio files |
| Lyrics fetch (v2+) | Musixmatch API | Auto-fetch lyrics by song title + artist |

---

## Architecture Overview

```
Desktop (Tauri)                        Mobile (React Native + Expo)
├── React UI                           ├── React UI
├── Zustand state                      ├── Zustand state
├── SQLite (local cache)               ├── SQLite (local cache)
├── Rust audio engine (cpal)           ├── expo-av audio engine
├── Sidecars                           └── Syncs ↕
│   ├── yt-dlp
│   ├── demucs_split.py
│   └── whisperx_align.py
└── Syncs ↕

            Supabase (structured data + auth)
            ├── Songs, Lines, Annotations
            ├── Timestamps, Progress, HighlightTypes
            └── Recording metadata (paths, duration)

            User Cloud Storage (GDrive / Dropbox / S3)
            └── reference.wav, vocals.wav, instrumental.wav,
                line_001.wav, full_take_01.wav
```

### Sync Behaviour
- Both clients operate fully **offline-first** — all reads/writes hit local SQLite first
- Sync to Supabase happens in the background when online, never blocking the UI
- **Conflict resolution: last-write-wins** via `updated_at` timestamp on every row
- Audio files sync lazily — downloaded to local storage only when needed
- Reference audio downloaded once per device, not re-synced

### Local File Structure (Desktop)
```
~/Reprise/
└── [Song Title]/
      ├── reference.wav        # original downloaded audio
      ├── vocals.wav           # Demucs vocal stem
      ├── instrumental.wav     # Demucs instrumental stem
      ├── line_001.wav         # line recording takes
      ├── line_002.wav
      └── full_take_01.wav     # compiled full song take
```

---

## The Core Practice Loop

```
Add song
  → Paste YouTube URL → yt-dlp downloads reference.wav
  → Input lyrics line by line
  → [Optional] Remove vocals → Demucs → vocals.wav + instrumental.wav
  → [Optional] Auto-align → WhisperX on vocals.wav → timestamps per line
  → Annotate lines: highlight words (falsetto, whisper, etc.), add phonetic notes

Practice a line
  → Click/tap line → audio seeks to audio_start_ms
  → Toggle: full mix or instrumental only
  → Plays line on loop at chosen speed
  → Read markup annotations while listening
  → Record your own take
  → Replay and compare
  → Mark line as Learning / Mastered

Song progress updates as lines are mastered
Data syncs to Supabase in background
```

---

## Feature Roadmap

| Phase | Features |
|---|---|
| MVP | Song library, manual lyrics input, tap-to-mark timestamps, rich lyric markup editor, line-by-line reference playback with speed control, line recording, progress tracking — desktop only |
| v1.5 | Vocal removal (Demucs), auto-align (WhisperX), mobile app, cross-device sync, waveform marker view, compile line recordings into full song, audio file manager |
| v2 | Auto lyrics fetch (Musixmatch), pitch curve visualization (CREPE sidecar), pitch accuracy comparison between original vocal stem and user recording, waveform display per line |
| v3+ | Multi-track recording, VST plugin support, collaboration, cloud storage provider selection UI |

---

## Monorepo Structure

```
reprise/
├── apps/
│   ├── desktop/              # Tauri app
│   │   ├── src/              # React frontend
│   │   └── src-tauri/        # Rust backend
│   │       └── sidecars/     # Python sidecar scripts
│   │           ├── demucs_split.py
│   │           └── whisperx_align.py
│   └── mobile/               # React Native + Expo
├── packages/
│   ├── shared/               # Shared TypeScript types, constants, validators
│   └── ui/                   # Shared React components (if any)
├── supabase/                 # Migrations, RLS policies, edge functions
├── docs/                     # Planning docs
└── package.json              # pnpm workspace root
```

---

## Project Name
**Reprise** — to return to a passage and make it yours.
