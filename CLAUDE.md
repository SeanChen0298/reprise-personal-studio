# Reprise — Personal Practice Studio

## What This Project Is

Reprise is a cross-platform desktop + mobile app for singers who want to learn songs with precision — line by line, word by word. The core loop is: load a reference track, annotate lyrics, practice each line with speed-adjusted playback, record takes, and track progress until every line is mastered.

**Motto:** "Reprise — to return to a passage and make it yours."

**Platform split:**
- Desktop (Tauri): Production client — deep editing, vocal removal, compilation, recording
- Mobile (React Native): Practice companion — on-the-go annotation, playback, line recording

---

## Architecture

### Monorepo Layout

```
reprise/
├── apps/
│   ├── desktop/              # Tauri app (Rust backend + React frontend)
│   │   ├── src/              # React + TypeScript UI
│   │   └── src-tauri/        # Rust core (audio engine, file I/O, sidecar orchestration)
│   │       └── sidecars/     # Bundled Python scripts
│   │           ├── demucs_split.py       # Vocal stem separation
│   │           └── whisperx_align.py     # Word-level lyric alignment
│   └── mobile/               # React Native + Expo (iOS/Android)
├── packages/
│   ├── shared/               # Shared TypeScript types, constants, validators
│   └── ui/                   # Shared React components (used by both apps)
├── supabase/                 # Migrations, RLS policies, edge functions
├── docs/                     # Planning docs and UI design mockups
└── package.json              # pnpm workspace root
```

Package manager: **pnpm** (workspaces).

### Desktop Stack

| Layer | Technology | Role |
|---|---|---|
| App shell | Tauri (Rust) | Native OS access, small binary, hardware audio |
| UI | React + TypeScript | All screens and state |
| State | Zustand | Audio playback and app-wide state |
| Local DB | SQLite (tauri-plugin-sql) | Zero-latency offline cache |
| Audio engine | Rust / cpal | Recording, playback, precise timestamp seeking |
| Audio processing | Rust / dasp | Speed control, waveform rendering |
| File compilation | Rust / hound or symphonia | Stitch line recordings into full song |
| Audio download | yt-dlp (sidecar) | YouTube → local MP3/WAV |
| Vocal removal | Demucs htdemucs_ft (Python sidecar) | Separate vocals and instrumental stems |
| Lyric alignment | WhisperX small (Python sidecar) | Auto word-level timestamp mapping |

### Mobile Stack

| Layer | Technology | Role |
|---|---|---|
| App shell | React Native + Expo | iOS and Android |
| State | Zustand | Same library as desktop |
| Local DB | SQLite (expo-sqlite) | Offline cache |
| Audio | expo-av | Playback, recording, speed control |

### Cloud / Sync

| Concern | Technology |
|---|---|
| Data sync | Supabase (Postgres) |
| Auth | Supabase Auth (email + Google OAuth) |
| Audio file sync | Google Drive / Dropbox / S3 (user-owned) |

**Offline-first:** Both clients work fully offline with local SQLite. Background sync to Supabase when online. Conflict resolution: last-write-wins via `updated_at`.

### Database Schema (key entities)

- **Song** — title, artist, genre, file paths (reference / vocals / instrumental), duration, progress
- **Line** — position, word-level annotated segments (JSON), status (`not_started` → `learning` → `mastered`), audio timestamps (`start_ms`, `end_ms`)
- **HighlightType** — user-defined annotation vocabulary (label + color), e.g. "Falsetto", "Whisper", "Belt"
- **Recording** — file path, duration, cloud path, associated line or song

---

## Core Features

### Song Library
- Add songs (title, artist, genre)
- Song-level progress bar (% of lines mastered)
- Last-practiced timestamp

### Lyrics & Lines
- Input lyrics manually (v2: auto-fetch via Musixmatch API)
- Break lyrics into individual line units
- Per-line status: Not Started → Learning → Mastered

### Rich Lyric Annotation
- Word and syllable-level inline highlighting with semantic types
- User-defined highlight vocabulary with custom colors
- Breath marks, pause indicators, spacing markers
- Line-level text notes

Segment format example:
```json
[
  { "text": "Hikaru", "type": "normal" },
  { "text": "nara",   "type": "falsetto" },
  { "text": " ",      "type": "breath" },
  { "text": "sotto",  "type": "whisper" }
]
```

### Reference Audio Management
- Paste YouTube URL → auto-download via yt-dlp sidecar
- Local MP3 / WAV / FLAC file support
- Audio file manager with replace/re-download

### Vocal Removal (Demucs)
- One-time per song; produces `vocals.wav` and `instrumental.wav`
- Toggle full mix vs. instrumental-only during practice

### Timestamp Mapping (Line-to-Audio Sync)
- MVP: tap-to-mark (user taps at each line start)
- v1.5: waveform marker drag view
- v1.5: auto-align via WhisperX on isolated vocals

### Reference Playback
- Seek to `start_ms`, play to `end_ms` for the active line
- Loop single line, toggle full mix ↔ instrumental
- Speed control: 0.5x, 0.75x, 1x

### Recording
- Record takes per line
- Record full song in one continuous take (desktop)
- Compile line recordings into full song (desktop, v1.5+)

### Progress Tracking
- Per-line status
- Song-level progress bar
- Last-practiced timestamp per song

---

## Design System

- **Fonts:** DM Serif Display (headers), DM Sans (body)
- **Themes:** Light base with switchable accent colors — Blue, Midnight, Violet, Emerald, Red, Amber
- **UI files:** [reprise/docs/designs/](reprise/docs/designs/) — HTML mockups for landing, signup, login, forgot-password, and desktop app views

---

## Feature Roadmap

| Phase | Scope |
|---|---|
| MVP | Song library, manual lyrics, tap-to-mark timestamps, lyric markup editor, line playback with speed control, line recording, progress tracking (desktop) |
| v1.5 | Vocal removal (Demucs), auto-align (WhisperX), mobile app, cross-device sync, waveform marker view, compile recordings |
| v2 | Auto lyrics fetch (Musixmatch), pitch visualization (CREPE sidecar), pitch accuracy comparison |
| v3+ | Multi-track recording, VST support, collaboration, cloud storage provider UI |

---

## Project Status

Early stage — monorepo scaffolded, design mockups complete, sidecar script shells created. Core app code (React frontend, Tauri Rust backend, shared packages, Supabase setup) not yet implemented.
