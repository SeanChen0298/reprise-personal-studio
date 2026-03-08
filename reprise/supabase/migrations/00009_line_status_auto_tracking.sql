-- Migration: Replace manual line status with automatic behavior-tracked status
-- Safe to run on existing data — maps old values to closest new equivalents

-- 1. Add play_count column (default 0, non-null)
ALTER TABLE lines ADD COLUMN IF NOT EXISTS play_count integer NOT NULL DEFAULT 0;

-- 2. Rename old status enum and create new one
--    Postgres does not support removing enum values, so we change the column type.

-- 2a. Convert status column to text temporarily
ALTER TABLE lines ALTER COLUMN status TYPE text;

-- Drop existing check constraint before updating values
ALTER TABLE lines DROP CONSTRAINT IF EXISTS lines_status_check;

-- 2b. Map old status values to new equivalents
--   not_started → new        (nothing done)
--   learning    → listened   (closest equivalent: played at least once)
--   mastered    → practiced  (closest equivalent: drilled many times)
UPDATE lines SET status = 'new'       WHERE status = 'not_started';
UPDATE lines SET status = 'listened'  WHERE status = 'learning';
UPDATE lines SET status = 'practiced' WHERE status = 'mastered';

-- 2c. Drop old enum type if it exists, create new one
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_status') THEN
    -- Re-create with new values
    ALTER TYPE line_status RENAME TO line_status_old;
  END IF;
END
$$;

CREATE TYPE line_status_new AS ENUM (
  'new',
  'listened',
  'annotated',
  'practiced',
  'recorded',
  'best_take_set'
);

-- 2d. Drop existing default before casting
ALTER TABLE lines 
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE line_status_new USING status::line_status_new,
  ALTER COLUMN status SET DEFAULT 'new'::line_status_new;

-- 2f. Drop old enum if it was renamed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_status_old') THEN
    DROP TYPE line_status_old;
  END IF;
END
$$;

-- 3. Rename new enum to canonical name (or keep as-is if no old enum existed)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_status_new') THEN
    ALTER TYPE line_status_new RENAME TO line_status;
  END IF;
END
$$;
