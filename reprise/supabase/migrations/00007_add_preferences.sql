-- Add user preferences column to profiles
-- Stored as a single jsonb blob for schema flexibility.
-- Shape: { theme, showWaveform, highlights, symbols }
alter table public.profiles
  add column if not exists preferences jsonb;
