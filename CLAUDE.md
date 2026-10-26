# CLAUDE.md — Reprise Agent Reference

## Project
Reprise — personal vocal practice studio. **Desktop app** (Tauri v2 + React) plus a **phone app** (Expo / React Native) that syncs with it over the home Wi-Fi; **local-first**: no auth, no cloud database. The only online parts are YouTube (yt-dlp), LRCLIB lyrics and the **optional coach**, which calls Gemini or Claude with the user's own API key. All data lives in a local NoSQL database (Dexie/IndexedDB) on the machine; audio files live on local disk under `C:/Reprise/`.

> History: the app previously synced to Supabase (Postgres + Auth) and Google Drive, with an older React Native app on top. That was removed; the current phone app (`apps/mobile-rn`, rebuilt Oct 2026) talks only to the desktop on the local network. (An old Supabase cloud project may still exist remotely, but nothing references it.)

---

## Monorepo Layout (pnpm workspaces)

```
reprise/
├── apps/desktop/          Tauri v2 + React 19 + Vite 6   ← the app
│   ├── src/               React frontend (pages, components, hooks, stores, lib)
│   └── src-tauri/         Rust binary, capabilities, sidecars (Python scripts)
├── packages/shared/       Shared TS types (Song/Line/Recording/Section) + furigana
├── apps/mobile-rn/        Expo SDK 53 phone app — installed with npm, OUTSIDE the pnpm workspace
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
song_start_ms?: number        // set for sung-along takes: song position at the take's first sample
backing?: 'original'|'vocal'|'instrumental'
analysis?: TakeAnalysis       // breath / high-note review (lib/take-analysis.ts)
created_at, updated_at
```

### Other collections: `sections` (start/end line_order), `suggestions` (Discover page, keyed by YouTube video id), `meta` (migration flag, misc)

### Line status progression (behavior-based, not user-set)
```
new → listened (play_count ≥ 1) → annotated (annotation added) →
practiced (play_count ≥ 10) → recorded (recording saved) → best_take_set
```

---

## Desktop Key Files

```
src/app.tsx        Routes; calls song-store loadAllData() on mount (boots to /library)
src/pages/         library-page, discover-page, import-url/add-song, lyrics-input-page (bulk import/paste), settings-page,
                   workspace/ (the song workspace — see below)
src/components/    sidebar, full-waveform, pitch-curve, annotated-text, song-setup-panel, take-entry, take-review-panel, protected-route (pass-through)
src/hooks/         use-line-player (core playback), use-recorder, use-waveform-data, use-pitch-data
src/stores/        song-store (master), preferences-store, task-queue-store, queue-store, history-store (undo/redo)
src/lib/           local-db.ts (Dexie data layer), audio-download.ts (yt-dlp), audio-analysis.ts (torchcrepe),
                   whisperx-align.ts, backup.ts (JSON export/import),
                   suggestions.ts (Discover: YouTube Mix-based suggestions via yt-dlp),
                   vocal-map.ts + take-analysis.ts + take-review.ts (breath / high-note take review)
```

**Song workspace** (`/song/:id`, `pages/workspace/`): one page for practising, marking up, grouping, timing and recording a song — it replaced the old song detail, setup, timestamps, practice and recordings pages (their URLs redirect here; `/song/:id/lyrics` stays as the bulk lyrics import/paste screen). One `useLinePlayer` transport (track, speed 0.5–1.0, loop line/range); the lyric sheet has a cursor line with a caret/selection driven like a text editor (arrows, Shift-select, mouse drag mapped to character offsets skipping furigana); keys are **left-hand** (right hand stays on the mouse; letters matched by `e.code`): W/S lines (Shift = sections), A/D caret (Shift selects), Ctrl+Enter play line, N note (line, or the open take at its playhead), Q / Shift+Q loop line / section, Alt+W/S speed, number keys mark the selection with highlight types, X unmark, C symbol picker (⤴ ⤵ ~ /, `lib/symbol-config.ts`), F edit text, `#` section, `T` taps the line start at the playhead, Alt+A/D (+Shift) shift start/end, R / Shift+R record line / section, Tab / Shift+Tab takes / line panel, Ctrl+Z / Ctrl+Shift+Z undo/redo (every lyric edit goes through `use-workspace-edits.ts` → `history-store`), Ctrl+E palette, F1 shortcut sheet; arrows / Enter / L / [ ] / Delete / F2 / Ctrl+K / ? still work as alternates. Lyrics are centred; record controls are a dock at the bottom centre (`RecordDock`), and Takes (`use-takes.ts`) / Line details open as a slide-over panel (header toggle, Tab / Shift+Tab; opens itself on a new take's review); translations are matched to lines by time, then by line order; Setup is a drawer (`?setup=1`); the chord lead sheet (`play-along-view.tsx`) is a view toggle. Pure edit helpers (annotation ranges, remapping marks after text edits, section splits) live in `lib/lyric-edits.ts`.

**Coach** (`lib/coach/`, `pages/workspace/coach-panel.tsx`, Settings → Coach): an optional vocal coach with a fixed identity, scope and answer format (`persona.ts` — keep it a vocal coach, not a general assistant). Providers: Gemini (`@google/genai`, default) and Claude (`@anthropic-ai/sdk`, `claude-opus-5-5`, browser mode, server-side refusal fallback), behind one `askCoach()`; model lists are fetched with the user's key. Keys live in `coach-store` (localStorage, never in backups). Web search: off / song card only / when needed with a per-answer cap (Claude `max_uses` exact; Gemini on/off only), daily count shown. Per-song knowledge (song card, approved insights, recent chat) in `<song folder>/coach.json` + readable `coach.md`; the singer profile in `C:/Reprise/coach-profile.json`. Memory is fixed-size (singer facts ≤20 as P#, song insights ≤15 as S#); the coach proposes add / update / forget by id and must merge or replace when full ("Tidy" asks it to consolidate). Answers stream (first-words / total time shown per answer); chat uses low thinking (Gemini 3+ `thinkingLevel: LOW`, Claude effort `low`). Gemini busy (503) retries twice, then a 429/503 goes to the backup model (Settings; default `gemini-2.5-flash`). Claude: refusal `fallbacks` only on Opus 5.x / Sonnet 5.5 / Fable 5.x, and Haiku gets the basic `web_search_20250305` tool. Replies may end with a ```reprise JSON block proposing line notes / song insights / singer facts — nothing is saved without the user approving it. The coach uses a fixed voice vocabulary (register: chest / mix / head / falsetto / breathy; placement: forward / nasal / top / back / chest) and gives every technique point an image to imagine plus a drill. Song card v2 (`SongCard` in `knowledge.ts`, `normaliseCard` accepts old cards) has an arc tied to lines, per-section voice, and techniques; it's shown by `components/song-card-view.tsx`. Above the lyrics there's only a quiet "About this song · mood" line (expands, remembered); each section heading shows its mood / register / placement. Gemma models are listed even without `generateContent` in `supportedActions`, and Settings has "Other model…" to type an id. G toggles the coach; a take's review has "Ask the coach". Line refs the coach writes (L19, L15–22) render as clickable lyric snippets (`LineRefs` / `WithLineRefs` in `song-card-view.tsx`; L# = index in the primary lines + 1). When a song has no sections the coach panel offers "Suggest sections" (`SECTIONS_PROMPT` → `parseSectionPlan`, previewed, added in one undo step via `edits.addSections`). Lines carry the singer's own voice mark (`register` / `placement`, B / Shift+B cycle; shown as a violet chip and sent to the coach). Takes: E plays the open take with the instrumental under it (aligned by `song_start_ms` − `lag_ms`); Alt+R toggles repeat section takes (each try saves at the section end, then the next starts); deleting a take is undoable (`lib/take-trash.ts` keeps the file until you leave the song / next start). The coach can also translate the lyrics ("Translate lyrics" in the coach panel / palette; `translatePrompt` → `parseTranslation`, previewed, saved as the song's translation language — never when the lyrics are already in it; undoable). Song hints off (V) is the focus view: it also hides the About line and the coach's notes under section headings.

**Lyrics sources & check:** a fresh download looks the song up on **LRCLIB** (`lib/lrclib.ts`, free, no key; `searchLyrics` → candidates ranked by synced + length match) and uses synced lyrics whose length is within 3 s of the audio, else YouTube subtitles, else LRCLIB plain lyrics (untimed); the lyrics page has a "Find lyrics online" picker. The workspace's **lyrics check** (`lib/lyrics-check.ts`, shown with song hints, Alt+F jumps to the next one) compares lines with where the singer sings (`VocalMap.singing`: pitched, or within 25 dB of typical stem loudness): first a whole-song offset (e.g. lyrics timed to the album version, the video has an intro → "Shift all lines", one undo step), then gaps of ≥3 s singing with no line ("Add line" inserts a timed line via `edits.insertLine`, prefilled with what WhisperX heard — the sidecar now writes `heard` segments to `align_output.json`; "Not lyrics" dismisses), lines with no singing under them, and lines the alignment placed with confidence < 0.6 (`Line.align_confidence`, cleared when you set the timing). Dismissals are per song in localStorage.

**Take review** (song workspace): "Record" with *Sing along* starts the song and stores `song_start_ms`, so the take can be lined up with the song (latency is measured by matching voicing). The reference **vocal map** comes from `pitch.csv` (phrases = confidently pitched runs, breaths = gaps ≥120 ms, high notes = top of the song's range), with reverb tails trimmed using the vocal stem's loudness. The take is analysed in-browser (YIN pitch + loudness) for breath problems (ran out, fading, mid-phrase breath, late after quick breath) and high-note problems (dropped, cracked, flat/sharp, unsteady, pushed), each relative to the original singer, plus a first-half vs second-half stamina comparison. Pitch accuracy elsewhere is intentionally not scored. The user records whole songs/sections rather than line by line (line-by-line recording was dropped). The cursor line is where the next take starts; Record rewinds to that line minus a 2 s lead-in, runs a count-in (pref `recordCountIn`), and a take started from a section stops at its end. Breath marks are manual (the "Breath mark" highlight type; its number key marks the character before the caret) — automatic breath marks from the reference were removed as unreliable. The lyric sheet's "Song hints" show only high notes and plausible long phrases (6–15 s) from the vocal map.

**`song-store.ts`** — the master store. All persistence goes through `localDb` (in `local-db.ts`), which returns `{ data, error }` results mirroring the old Supabase shape so the optimistic-update-with-rollback flow is preserved. Cascade deletes (song → lines/recordings/sections) are explicit, inside a Dexie transaction.

**`local-db.ts`** — Dexie schema + typed per-collection CRUD (`getAllSongs`, `insertLine`, `deleteSongCascade`, `deleteLinesForSongExceptLanguage`, etc.).

**`use-line-player.ts`** — single-line and range looping, speed 0.5x–1.0x (0.05x steps), auto-advance, `onLinePlayed` callback increments `play_count`.

**`task-queue-store.ts`** — persisted queue for Demucs / torchcrepe / WhisperX. Processed by `use-task-queue-processor.ts`.

---

## Phone app & Wi-Fi sync

- **Desktop side:** Settings → Phone switches on a small HTTP server in the Tauri backend (`src-tauri/src/sync_server.rs`, tiny_http, port 47615). Every request needs the pairing token (`X-Reprise-Token` header or `?token=`); `GET /ping` (also returns `library` = the snapshot's mtime, so the phone pulls only when it changed — an unchanged snapshot isn't rewritten), `GET /library` (serves `C:/Reprise/sync/library.json`), `GET /file?path=` (only files under `C:/Reprise`, audio / json / image types), `POST /upload?name=` (into `C:/Reprise/sync/inbox/`, safe names only). Pairing is a QR code `reprise://pair?h=<ip:port>&t=<token>&n=<host>`; the token lives in `reprise-phone-sync` (localStorage, never in backups). `hooks/use-phone-sync.ts` (app root) rewrites the snapshot (debounced on store changes + every 30 s — coach cards are files) and imports the inbox every 3 s (`lib/phone-sync.ts`): phone takes move into the song's `recordings/` and get their breath / high-note review right away; line notes / voice marks / take notes merge newer-wins; practised times merge. The snapshot (`SyncSnapshot` in `@reprise/shared`) has songs, lines, sections, takes, highlight types, coach card + song memory (never chat or keys), singer facts, file sizes / mtimes, theme and practised times; it's only written after the DB has loaded (never an empty library).
- **Phone side** (`apps/mobile-rn`, expo-router): library (pick-up card + all songs, pull to sync), song screen (lyrics follow the playhead with furigana / highlights / translation / notes / voice marks, tap a line to play, hold for note + voice mark + loop; loop line → section → off; 0.5–1.0× with pitch kept; Original / Backing / Vocals; sung-along takes with lead-in, count-in, section stop — kept even if you leave mid-take; Takes sheet with the desktop's review in plain words; "About this song" = the coach's card), pairing (QR via expo-camera or typed code), settings. The phone checks the computer every 20 s while open (every 4 s while a take waits for its review, then shows "Your take's review"), and keeps the N most recent songs' audio downloaded at home (Settings, default 5). **Play all** (`src/lib/radio.ts`, react-native-track-player — lock screen / notification controls, keeps going with the screen off; service registered in `index.js`, the app entry) plays the downloaded songs (or their backing) round and round; opening a song from its bar pauses it and continues at the same point in the song screen. State: `stores/library-store.ts` keeps the snapshot (`library.json`) and phone-only state (`local.json`: downloads, takes, unacknowledged edits, practised times) in the app's documents folder; sync = upload takes (audio, then `<id>.take.json`) and `changes-*.json`, then pull the library. Shared code comes from `@reprise/shared/core` (no furigana generation), resolved by `metro.config.js` / tsconfig paths.
- **Look & motion (phone):** UI text goes through `src/components/text.tsx` (Inter, weight → font file; titles use `DISPLAY` = Fraunces; lyrics stay in the system serif for Japanese, and `annotated-text.tsx` uses RN's Text so nested spans inherit it). Fonts are embedded by the `expo-font` plugin in app.json. Motion is Reanimated 3 + Gesture Handler: `Sheet` springs up and drags down to close, `PressableScale` for press feedback (+ haptics), the current lyric line eases brighter / larger (no band behind it — keep it subtle), the song screen has the artwork blurred behind its top. react-native-track-player 4.1.2 needs `scripts/patch-track-player.js` (postinstall) on the new architecture, or the app crashes at start.
- **Build:** `cd reprise/apps/mobile-rn && npm install && npx expo prebuild --platform android` (android/ is generated and git-ignored; permissions and cleartext HTTP come from app.json plugins), then `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` → `android/app/build/outputs/apk/release/app-release.apk` (signed with the debug key — personal use). `npx tsc --noEmit` typechecks.

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

## beat_this (Beats, Bar Lines, Time Signature)

Chord analysis (`src-tauri/sidecars/chord_analyze.py`) gets beats and downbeats from the
**beat_this** model (MIT, CPJKU) when installed; it falls back to librosa's tracker otherwise.
`pip install beat-this` (no other changes to the env). The `final0` checkpoint (~81 MB) is cached
at `~/.cache/torch/hub/checkpoints/beat_this-final0.ckpt`. Note: the official download host
(cloud.cp.jku.at) served an expired TLS certificate in Oct 2026 — the checkpoint was fetched
from the official URL with certificate checking off and loads in `weights_only` mode.

Bars come from the model's downbeats (per-bar beat counts, stray 2+2 bar lines merged);
stretches with no steady pulse (intro/outro) become `free` placeholder bars that the guide
guitar and fingerpicking skip.

## BTC (Chord Recognition)

Chords come from **BTC** (Bi-directional Transformer for Chord recognition, ISMIR 2019; 170-chord
vocabulary incl. 7ths, maj7, m7b5, sus, 6ths). Code (MIT) is cloned to
`~/.cache/reprise-models/BTC-ISMIR19` (override with `REPRISE_BTC_DIR`); weights are
`test/btc_model_large_voca.pt` in that repo (**non-commercial licence** — fine for personal use).
Shims in `chord_analyze.py`: `np.float = float`, YAML via `safe_load`.

Per-beat probabilities are averaged over the full mix and the instrumental, then smoothed
(Viterbi, `btc_stickiness` 0.85). If BTC is missing it falls back to the chroma template detector
(`TUNING["chord_model"] = "templates"`). The strum pattern the guide plays is the user's choice per
song (`strum_pattern` in `chord_settings.json`), not detected.

## Furigana

Auto-generated via `kuroshiro` + `kuromoji` analyzer. Output is `<ruby>` HTML stored in `furigana_html` / `custom_furigana_html` on Line rows. Never manually edit furigana HTML — regenerate via `generateFurigana()` in `packages/shared/src/lib/furigana.ts`. The kuromoji dictionary (~17 MB) is bundled at `apps/desktop/public/kuromoji/dict` and served from the app origin, so it works fully offline.

---

## Translation

Machine translation of lyrics (`lib/translate.ts`) runs locally with Helsinki-NLP **Opus-MT** models (`Xenova/opus-mt-<lang>-en`, fp32) through `@huggingface/transformers` (ONNX Runtime Web); a model downloads once on first use. Small Marian models can loop on repeated words, so generation is bounded (`max_new_tokens`, `repetition_penalty`, `no_repeat_ngram_size`) and `collapseRepeats()` trims runs of more than 3 repeats — also applied when translations are displayed, which fixes older saved ones.

---

## Theme System

6 built-in themes: `blue`, `midnight`, `violet`, `emerald`, `red`, `amber`.
CSS variable-based: `--theme`, `--theme-light`, `--theme-text`. Stored in `preferences-store` (localStorage).

---

## What's Built

**Working:** local song library, YouTube import, yt-dlp download, Demucs stems, torchcrepe pitch, WhisperX timestamp alignment, manual lyrics + furigana, song workspace (keyboard-driven annotation with 5 predefined + custom types, sections, tap/nudge timing, undo/redo, command palette), line / section looping at 0.5–1.0×, recording, line status auto-tracking, 6 themes, task queue, section markers, local DB backup/restore, Discover (song suggestions with lyrics), sung-along take review (breath control + high notes) with a breath map in the lyrics.

**Not yet built:** compile recordings → full song, key change / transpose, progress tracking across takes.
