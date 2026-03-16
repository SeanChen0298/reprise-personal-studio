// Mobile entry point — excludes Node.js-only exports (kuromoji/furigana).
export type { AuthStatus } from "./types/auth";
export type {
  DownloadStatus,
  StemStatus,
  PitchStatus,
  LineStatus,
  Song,
  Annotation,
  Line,
  YouTubeMetadata,
  ImportDraft,
  Recording,
  Section,
} from "./types/song";
export type { HighlightType } from "./types/highlight";
export { DEFAULT_HIGHLIGHTS } from "./types/highlight";
export type { Json, Database } from "./lib/database.types";
export { createSupabaseClient } from "./lib/supabase";
// generateFurigana intentionally omitted — requires kuromoji (Node.js only)
