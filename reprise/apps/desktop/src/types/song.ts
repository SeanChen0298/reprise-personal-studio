export type DownloadStatus = "idle" | "downloading" | "done" | "error";
export type StemStatus = "idle" | "processing" | "done" | "error";
export type PitchStatus = "idle" | "processing" | "done" | "error";
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
  created_at: string;
  updated_at: string;
  user_id?: string;
}

export interface Annotation {
  start: number; // char index in custom_text (inclusive)
  end: number; // char index in custom_text (exclusive)
  type: string; // highlight type id, e.g. "falsetto"
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
  status: LineStatus;
  play_count?: number; // number of times played through in practice mode
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
  line_id: string | null; // null for free recordings (not tied to any line)
  song_id: string;
  file_path: string;
  duration_ms: number;
  is_master_take: boolean;
  is_best_take: boolean;
  note?: string;
  section_id?: string;
  created_at: string;
  updated_at: string;
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
