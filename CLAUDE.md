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
- **Song:** Metadata, file paths (vocals/inst/ref), bpm, mastery %.
- **Line:** `start_ms`, `end_ms`, `status` (not_started/learning/mastered).
- **Annotation:** JSON array: `[{ text: string, type: HighlightType }]`.
- **Recording:** `line_id`, `file_path`, `is_master_take`.

## Current Roadmap
- **MVP:** Manual lyrics, tap-to-mark timestamps, desktop playback/recording.
- **v1.5:** Sidecar integration (Demucs/WhisperX), Mobile app sync.