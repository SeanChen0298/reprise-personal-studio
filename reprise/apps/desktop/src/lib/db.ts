import Database from "@tauri-apps/plugin-sql";

let _dbPromise: Promise<Database> | null = null;

/** Returns the singleton SQLite DB, initialising it on first call. */
export function getDb(): Promise<Database> {
  if (!_dbPromise) {
    _dbPromise = Database.load("sqlite:reprise.db").then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return _dbPromise;
}

async function migrate(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS songs (
      id          TEXT    PRIMARY KEY,
      title       TEXT    NOT NULL,
      artist      TEXT    NOT NULL DEFAULT '',
      youtube_url TEXT,
      thumbnail_url TEXT,
      duration_ms INTEGER,
      bpm         INTEGER,
      language    TEXT,
      tags        TEXT    NOT NULL DEFAULT '[]',
      notes       TEXT,
      pinned      INTEGER NOT NULL DEFAULT 0,
      mastery     REAL    NOT NULL DEFAULT 0,
      user_id     TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lines (
      id        TEXT    PRIMARY KEY,
      song_id   TEXT    NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      text      TEXT    NOT NULL DEFAULT '',
      start_ms  INTEGER,
      end_ms    INTEGER,
      status    TEXT    NOT NULL DEFAULT 'not_started',
      ord       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT   NOT NULL
    )
  `);
}
