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
  tags: string[];
  notes?: string;
  pinned: boolean;
  mastery: number; // 0–100
  created_at: string;
  updated_at: string;
  user_id?: string;
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
