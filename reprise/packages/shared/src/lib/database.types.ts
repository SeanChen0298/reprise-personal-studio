export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      songs: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          artist: string;
          youtube_url: string | null;
          thumbnail_url: string | null;
          thumbnail_b64: string | null;
          duration_ms: number | null;
          bpm: number | null;
          language: string | null;
          tags: string[];
          notes: string | null;
          pinned: boolean;
          mastery: number;
          audio_path: string | null;
          audio_folder: string | null;
          vocals_path: string | null;
          instrumental_path: string | null;
          pitch_data_path: string | null;
          download_status: string;
          download_error: string | null;
          stem_status: string;
          stem_error: string | null;
          pitch_status: string;
          pitch_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          title: string;
          artist: string;
          youtube_url?: string | null;
          thumbnail_url?: string | null;
          thumbnail_b64?: string | null;
          duration_ms?: number | null;
          bpm?: number | null;
          language?: string | null;
          tags?: string[];
          notes?: string | null;
          pinned?: boolean;
          mastery?: number;
          audio_path?: string | null;
          audio_folder?: string | null;
          vocals_path?: string | null;
          instrumental_path?: string | null;
          pitch_data_path?: string | null;
          download_status?: string;
          download_error?: string | null;
          stem_status?: string;
          stem_error?: string | null;
          pitch_status?: string;
          pitch_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          artist?: string;
          youtube_url?: string | null;
          thumbnail_url?: string | null;
          thumbnail_b64?: string | null;
          duration_ms?: number | null;
          bpm?: number | null;
          language?: string | null;
          tags?: string[];
          notes?: string | null;
          pinned?: boolean;
          mastery?: number;
          audio_path?: string | null;
          audio_folder?: string | null;
          vocals_path?: string | null;
          instrumental_path?: string | null;
          pitch_data_path?: string | null;
          download_status?: string;
          download_error?: string | null;
          stem_status?: string;
          stem_error?: string | null;
          pitch_status?: string;
          pitch_error?: string | null;
          updated_at?: string;
        };
      };
      lines: {
        Row: {
          id: string;
          song_id: string;
          user_id: string;
          text: string;
          custom_text: string | null;
          annotations: Json;
          order: number;
          start_ms: number | null;
          end_ms: number | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          song_id: string;
          user_id: string;
          text: string;
          custom_text?: string | null;
          annotations?: Json;
          order: number;
          start_ms?: number | null;
          end_ms?: number | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          text?: string;
          custom_text?: string | null;
          annotations?: Json;
          order?: number;
          start_ms?: number | null;
          end_ms?: number | null;
          status?: string;
          updated_at?: string;
        };
      };
      sections: {
        Row: {
          id: string;
          song_id: string;
          user_id: string;
          name: string;
          start_line_order: number;
          end_line_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          song_id: string;
          user_id: string;
          name: string;
          start_line_order: number;
          end_line_order: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          start_line_order?: number;
          end_line_order?: number;
          updated_at?: string;
        };
      };
      recordings: {
        Row: {
          id: string;
          song_id: string;
          line_id: string;
          user_id: string;
          file_path: string;
          duration_ms: number;
          is_master_take: boolean;
          section_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          song_id: string;
          line_id: string;
          user_id: string;
          file_path: string;
          duration_ms: number;
          is_master_take?: boolean;
          section_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          file_path?: string;
          duration_ms?: number;
          is_master_take?: boolean;
          section_id?: string | null;
          updated_at?: string;
        };
      };
    };
  };
}
