-- Add furigana column for user-edited (custom) lyric text.
-- Parallel to furigana_html (which covers the original line.text).
ALTER TABLE lines ADD COLUMN custom_furigana_html text;
