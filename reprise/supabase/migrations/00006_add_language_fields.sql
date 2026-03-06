-- Add language field to lines (e.g. "en", "ja") to support multi-language lyrics + translations
alter table public.lines add column language text;

-- Add translation_language field to songs so the practice view knows which lines are translations
alter table public.songs add column translation_language text;

-- Index for filtering lines by (song_id, language) efficiently
create index lines_language_idx on public.lines (song_id, language);
