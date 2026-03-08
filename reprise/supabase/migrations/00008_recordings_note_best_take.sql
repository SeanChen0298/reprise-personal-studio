-- Allow null line_id for free recordings (not tied to any line/section)
alter table public.recordings
  alter column line_id drop not null;

-- Add optional user note for free recordings
alter table public.recordings
  add column if not exists note text;

-- Add per-recording "best take" star toggle (independent of is_master_take)
alter table public.recordings
  add column if not exists is_best_take boolean not null default false;
