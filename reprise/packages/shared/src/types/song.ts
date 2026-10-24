export type DownloadStatus = "idle" | "downloading" | "done" | "error";
export type StemStatus = "idle" | "processing" | "done" | "error";
export type PitchStatus = "idle" | "processing" | "done" | "error";
export type AlignStatus = "idle" | "processing" | "done" | "error";
export type ChordStatus = "idle" | "processing" | "done" | "error";
export type LineStatus = "new" | "listened" | "annotated" | "practiced" | "recorded" | "best_take_set";

export interface Song {
  id: string;
  title: string;
  artist: string;
  youtube_url?: string;
  thumbnail_url?: string;
  thumbnail_b64?: string;
  duration_ms?: number;
  bpm?: number;
  language?: string;
  translation_language?: string;
  tags: string[];
  notes?: string;
  pinned: boolean;
  mastery: number; // 0–100
  audio_path?: string;
  audio_folder?: string;
  download_status?: DownloadStatus;
  download_error?: string;
  vocals_path?: string;
  instrumental_path?: string;
  stem_status?: StemStatus;
  stem_error?: string;
  pitch_data_path?: string;
  pitch_status?: PitchStatus;
  pitch_error?: string;
  align_status?: AlignStatus;
  align_error?: string;
  chord_data_path?: string;
  chord_status?: ChordStatus;
  chord_error?: string;
  // Google Drive file IDs (set by desktop after upload, read by mobile for download)
  drive_audio_file_id?: string;
  drive_vocals_file_id?: string;
  drive_instrumental_file_id?: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
}

export interface Annotation {
  start: number; // char index in custom_text (inclusive)
  end: number;   // char index in custom_text (exclusive)
  type: string;  // highlight type id, e.g. "falsetto"
  furigana_html?: string; // HTML with <ruby> tags, auto-generated for Japanese annotation text
}

export interface Line {
  id: string;
  song_id: string;
  text: string;
  custom_text?: string;
  annotations?: Annotation[];
  order: number;
  start_ms?: number;
  end_ms?: number;
  /** Timing of the sung tokens in the line from alignment: [start_ms, end_ms, characters]. */
  syllable_times?: [number, number, number][];
  status: LineStatus;
  play_count?: number;
  furigana_html?: string; // HTML with <ruby> tags for line.text, auto-generated for language === "ja"
  custom_furigana_html?: string; // HTML with <ruby> tags for custom_text, auto-generated when custom_text is set
  language?: string; // e.g. "en", "ja" — null/undefined means primary/legacy
  created_at: string;
  updated_at: string;
}

export interface YouTubeMetadata {
  video_id: string;
  youtube_url: string;
  title: string;
  author: string;
  thumbnail_url: string;
}

export interface ImportDraft {
  metadata: YouTubeMetadata;
  title: string;
  artist: string;
  bpm: string;
  language: string;
  tags: string[];
  notes: string;
}

export interface Recording {
  id: string;
  line_id: string | null;
  song_id: string;
  file_path: string;
  duration_ms: number;
  is_master_take: boolean;
  is_best_take: boolean;
  note?: string;
  section_id?: string;
  /** Song position (ms) at the take's first sample — set when the take was sung along with the song. */
  song_start_ms?: number;
  /** Which track played while singing. */
  backing?: "original" | "vocal" | "instrumental";
  /** Breath / high-note review of a sung-along take. */
  analysis?: TakeAnalysis;
  created_at: string;
  updated_at: string;
}

export type TakeIssueKind =
  | "ran_out"        // voice stopped well before the phrase ended
  | "fading"         // phrase end much quieter than its start
  | "extra_breath"   // breath taken in the middle of a phrase
  | "late_entry"     // came in late after a quick breath
  | "high_dropped"   // high note mostly not sung
  | "high_cracked"   // voice broke / flipped on a high note
  | "high_flat"      // high note under pitch
  | "high_sharp"
  | "high_unsteady"  // pitch wobbling on a high note
  | "high_pushed";   // high note much louder than usual — likely pushing

export interface TakeIssue {
  kind: TakeIssueKind;
  /** Song timeline position of the problem (ms). */
  song_ms: number;
  line_id?: string;
  /** Human-readable detail, e.g. "stopped 0.6 s early" or "D5, 45 cents flat". */
  detail: string;
}

export interface TakeHalfStats {
  phrases: number;
  breath_issues: number;
  high_notes: number;
  high_issues: number;
}

export interface TakeAnalysis {
  version: number;
  analyzed_at: string;
  /** Measured offset between take and song beyond song_start_ms (latency), ms. */
  lag_ms: number;
  /** -12 when the singer sang an octave below the reference, etc. */
  octave_shift: number;
  /** Song range the take covers (ms). */
  song_from_ms: number;
  song_to_ms: number;
  phrases_checked: number;
  high_notes_checked: number;
  issues: TakeIssue[];
  /** First vs second half of the take, for stamina. */
  halves: [TakeHalfStats, TakeHalfStats];
}

export interface Section {
  id: string;
  song_id: string;
  name: string;
  start_line_order: number;
  end_line_order: number;
  created_at: string;
  updated_at: string;
}
