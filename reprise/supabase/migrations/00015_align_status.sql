-- Migration 00015: Add align_status and align_error to songs table
-- Tracks WhisperX auto-alignment job progress per song.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS align_status text NOT NULL DEFAULT 'idle'
    CONSTRAINT songs_align_status_check
      CHECK (align_status IN ('idle', 'processing', 'done', 'error')),
  ADD COLUMN IF NOT EXISTS align_error text;
