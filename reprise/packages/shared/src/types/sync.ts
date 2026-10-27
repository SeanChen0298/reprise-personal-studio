// Phone sync over the home Wi-Fi: what the desktop serves and what the phone sends back.
import type { HighlightType } from "./highlight";
import type { Line, Recording, Section, Song } from "./song";
import type { SongCard } from "../lib/song-card";
import type { Warmup } from "../lib/warmup";

/** A file on the desktop the phone can download (GET /file?path=…). */
export interface SyncFileRef {
  path: string;
  size: number;
  /** Last modified (ms since epoch) — a changed file is downloaded again. */
  mtime: number;
}

export interface SyncSongFiles {
  audio?: SyncFileRef;
  vocals?: SyncFileRef;
  instrumental?: SyncFileRef;
}

/** What the phone shows of the coach's work on a song (never the chat or API keys). */
export interface SyncCoach {
  card: SongCard | null;
  card_made_at?: string;
  memory: string[];
  /** The coach's warm-up for this song. */
  warmup?: Warmup | null;
}

/** What the original singer does on a line (from the desktop's vocal map) — the lyric sheet's "song hints". */
export interface SyncLineHint {
  /** A long phrase without a breath in the original (ms). */
  long_ms?: number;
  /** One of the song's highest notes, e.g. "D5". */
  high?: string;
}

/** GET /library — the whole library as the desktop has it. */
export interface SyncSnapshot {
  format: "reprise-sync";
  version: 1;
  generated_at: string;
  /** The desktop's name, shown on the phone. */
  host: string;
  songs: Song[];
  lines: Line[];
  sections: Section[];
  recordings: Recording[];
  highlights: HighlightType[];
  coach: Record<string, SyncCoach>;
  files: Record<string, SyncSongFiles>;
  /** Singer facts the coach keeps. */
  singer_facts: string[];
  /** Song id → the colour of its artwork (#rrggbb), which the phone tints the song with. */
  colors?: Record<string, string>;
  /** Song id → black bars in its thumbnail: fraction of the height at the top (and the bottom), and the thumbnail's width / height. */
  letterbox?: Record<string, { bars: number; aspect: number }>;
  /** Song id → line id → song hints. */
  hints?: Record<string, Record<string, SyncLineHint>>;
  /** Song id → when it was last practised on the computer. */
  practiced?: Record<string, string>;
  /** The desktop's accent theme (blue / violet / …), so the phone looks the same. */
  theme?: string;
}

/** A take recorded on the phone: uploaded audio first, then this as `<id>.take.json`. */
export interface PhoneTake {
  type: "take";
  id: string;
  song_id: string;
  /** Uploaded audio file name in the inbox. */
  file: string;
  duration_ms: number;
  song_start_ms?: number;
  backing?: Recording["backing"];
  section_id?: string;
  note?: string;
  created_at: string;
}

/** Edits made on the phone (`changes-<time>.json`); newer `updated_at` wins. */
export interface PhoneChanges {
  type: "changes";
  lines: { id: string; song_id: string; note?: string | null; register?: string | null; placement?: string | null; updated_at: string }[];
  recordings: { id: string; song_id: string; note?: string | null; is_best_take?: boolean; updated_at: string }[];
  /** Song id → when it was last practised on the phone. */
  practiced: Record<string, string>;
}
