// Local NoSQL database (Dexie / IndexedDB) — the offline replacement for Supabase.
//
// The desktop app loads every row into memory once (Zustand) and mutates
// optimistically, so this layer only needs simple per-collection CRUD plus a
// few song-scoped helpers. Rows are stored in exactly the shape the existing
// `*ToDbRow` converters in song-store.ts emit, so those converters are reused
// unchanged.
//
// Methods return a `{ data, error }` result mirroring the old Supabase client
// so the store's `if (error) { reload; throw }` flow is preserved verbatim.

import Dexie, { type Table } from "dexie";

export type Row = Record<string, unknown>;
export type MetaRow = { key: string; value: unknown };

export type Result<T = null> = { data: T; error: unknown };

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}
function fail(error: unknown): Result<never> {
  return { data: undefined as never, error };
}

class RepriseDB extends Dexie {
  songs!: Table<Row, string>;
  lines!: Table<Row, string>;
  recordings!: Table<Row, string>;
  sections!: Table<Row, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("reprise");
    this.version(1).stores({
      songs: "id, created_at",
      lines: "id, song_id, language, [song_id+language]",
      recordings: "id, song_id, line_id",
      sections: "id, song_id",
      meta: "key",
    });
  }
}

export const dexie = new RepriseDB();

export const localDb = {
  // ---- bulk reads (used by loadAllData) --------------------------------
  async getAllSongs(): Promise<Row[]> {
    return dexie.songs.orderBy("created_at").toArray();
  },
  async getAllLines(): Promise<Row[]> {
    return dexie.lines.toArray();
  },
  async getAllRecordings(): Promise<Row[]> {
    return dexie.recordings.toArray();
  },
  async getAllSections(): Promise<Row[]> {
    return dexie.sections.toArray();
  },

  // ---- songs -----------------------------------------------------------
  async insertSong(row: Row): Promise<Result> {
    try {
      await dexie.songs.add(row);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async updateSong(id: string, patch: Row): Promise<Result> {
    try {
      await dexie.songs.update(id, patch);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  /** Deletes a song and all of its lines/recordings/sections atomically. */
  async deleteSongCascade(id: string): Promise<Result> {
    try {
      await dexie.transaction(
        "rw",
        dexie.songs,
        dexie.lines,
        dexie.recordings,
        dexie.sections,
        async () => {
          await dexie.songs.delete(id);
          await dexie.lines.where("song_id").equals(id).delete();
          await dexie.recordings.where("song_id").equals(id).delete();
          await dexie.sections.where("song_id").equals(id).delete();
        }
      );
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },

  // ---- lines -----------------------------------------------------------
  async insertLine(row: Row): Promise<Result> {
    try {
      await dexie.lines.put(row);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async insertLines(rows: Row[]): Promise<Result<{ id: string }[]>> {
    try {
      await dexie.lines.bulkPut(rows);
      return ok(rows.map((r) => ({ id: r.id as string })));
    } catch (e) {
      return fail(e);
    }
  },
  async updateLine(id: string, patch: Row): Promise<Result> {
    try {
      await dexie.lines.update(id, patch);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async deleteLine(id: string): Promise<Result> {
    try {
      await dexie.lines.delete(id);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  /** Deletes every line of a song. */
  async deleteLinesForSong(songId: string): Promise<Result> {
    try {
      await dexie.lines.where("song_id").equals(songId).delete();
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  /** Deletes lines of a song with a specific language tag. */
  async deleteLinesForSongLanguage(songId: string, language: string): Promise<Result> {
    try {
      await dexie.lines.where("[song_id+language]").equals([songId, language]).delete();
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  /**
   * Deletes all lines of a song EXCEPT those whose language equals `keepLanguage`.
   * Null/undefined-language (legacy primary) lines are deleted, matching the old
   * `language.is.null,language.neq.X` Postgres filter.
   */
  async deleteLinesForSongExceptLanguage(songId: string, keepLanguage: string): Promise<Result> {
    try {
      await dexie.lines
        .where("song_id")
        .equals(songId)
        .and((row) => (row as Row).language !== keepLanguage)
        .delete();
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },

  // ---- recordings ------------------------------------------------------
  async insertRecording(row: Row): Promise<Result> {
    try {
      await dexie.recordings.add(row);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async updateRecording(id: string, patch: Row): Promise<Result> {
    try {
      await dexie.recordings.update(id, patch);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async deleteRecording(id: string): Promise<Result> {
    try {
      await dexie.recordings.delete(id);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },

  // ---- sections --------------------------------------------------------
  async insertSection(row: Row): Promise<Result> {
    try {
      await dexie.sections.add(row);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async updateSection(id: string, patch: Row): Promise<Result> {
    try {
      await dexie.sections.update(id, patch);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },
  async deleteSection(id: string): Promise<Result> {
    try {
      await dexie.sections.delete(id);
      return ok(null);
    } catch (e) {
      return fail(e);
    }
  },

  // ---- meta (migration flag, misc) ------------------------------------
  async getMeta(key: string): Promise<unknown> {
    const row = await dexie.meta.get(key);
    return row?.value;
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    await dexie.meta.put({ key, value });
  },
};
