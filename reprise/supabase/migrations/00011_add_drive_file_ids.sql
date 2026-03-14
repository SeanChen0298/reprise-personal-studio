-- Add Google Drive file ID columns to songs table
-- These are populated by the desktop app after uploading to Google Drive,
-- and read by the mobile app to download audio files.

alter table public.songs
  add column if not exists drive_audio_file_id       text,
  add column if not exists drive_vocals_file_id      text,
  add column if not exists drive_instrumental_file_id text;

comment on column public.songs.drive_audio_file_id        is 'Google Drive file ID for audio.m4a';
comment on column public.songs.drive_vocals_file_id       is 'Google Drive file ID for vocals.wav';
comment on column public.songs.drive_instrumental_file_id is 'Google Drive file ID for no_vocals.wav';
