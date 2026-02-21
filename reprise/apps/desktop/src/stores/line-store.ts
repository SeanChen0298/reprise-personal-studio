import { create } from "zustand";
import type { Line } from "../types/song";
import { getDb } from "../lib/db";

const IS_TAURI = typeof window !== "undefined" && "__TAURI__" in window;

interface LineRow {
  id: string;
  song_id: string;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  status: string;
  ord: number;
  updated_at: string;
}

function rowToLine(row: LineRow): Line {
  return {
    id: row.id,
    song_id: row.song_id,
    text: row.text,
    start_ms: row.start_ms ?? undefined,
    end_ms: row.end_ms ?? undefined,
    status: row.status as Line["status"],
    order: row.ord,
    updated_at: row.updated_at,
  };
}

function lineInsertParams(line: Line) {
  return [
    line.id,
    line.song_id,
    line.text,
    line.start_ms ?? null,
    line.end_ms ?? null,
    line.status,
    line.order,
    line.updated_at,
  ];
}

interface LineStore {
  linesBySong: Record<string, Line[]>;

  /** Load lines for a song from SQLite. No-op in browser mode. */
  loadLines: (songId: string) => Promise<void>;

  /** Bulk-replace all lines for a song (used after lyrics editing). */
  setLines: (songId: string, lines: Line[]) => void;

  addLine: (songId: string, text?: string) => void;
  updateLine: (songId: string, lineId: string, text: string) => void;
  removeLine: (songId: string, lineId: string) => void;
  reorderLines: (songId: string, lines: Line[]) => void;
  getLines: (songId: string) => Line[];
}

export const useLineStore = create<LineStore>()((set, get) => ({
  linesBySong: {},

  async loadLines(songId) {
    if (!IS_TAURI) return;
    try {
      const db = await getDb();
      const rows = await db.select<LineRow[]>(
        "SELECT * FROM lines WHERE song_id=?1 ORDER BY ord ASC",
        [songId]
      );
      set((s) => ({
        linesBySong: { ...s.linesBySong, [songId]: rows.map(rowToLine) },
      }));
    } catch (e) {
      console.error("[line-store] loadLines failed:", e);
    }
  },

  setLines(songId, lines) {
    set((s) => ({ linesBySong: { ...s.linesBySong, [songId]: lines } }));
    if (IS_TAURI) {
      getDb()
        .then(async (db) => {
          await db.execute("DELETE FROM lines WHERE song_id=?1", [songId]);
          for (const line of lines) {
            await db.execute(
              `INSERT INTO lines (id, song_id, text, start_ms, end_ms, status, ord, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
              lineInsertParams(line)
            );
          }
        })
        .catch((e) =>
          console.error("[line-store] setLines persist failed:", e)
        );
    }
  },

  addLine(songId, text = "") {
    const existing = get().linesBySong[songId] ?? [];
    const now = new Date().toISOString();
    const newLine: Line = {
      id: crypto.randomUUID(),
      song_id: songId,
      text,
      status: "not_started",
      order: existing.length,
      updated_at: now,
    };
    set((s) => ({
      linesBySong: {
        ...s.linesBySong,
        [songId]: [...(s.linesBySong[songId] ?? []), newLine],
      },
    }));
    if (IS_TAURI) {
      getDb()
        .then((db) =>
          db.execute(
            `INSERT INTO lines (id, song_id, text, start_ms, end_ms, status, ord, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
            lineInsertParams(newLine)
          )
        )
        .catch((e) =>
          console.error("[line-store] addLine persist failed:", e)
        );
    }
  },

  updateLine(songId, lineId, text) {
    const now = new Date().toISOString();
    set((s) => ({
      linesBySong: {
        ...s.linesBySong,
        [songId]: (s.linesBySong[songId] ?? []).map((l) =>
          l.id === lineId ? { ...l, text, updated_at: now } : l
        ),
      },
    }));
    if (IS_TAURI) {
      getDb()
        .then((db) =>
          db.execute(
            "UPDATE lines SET text=?1, updated_at=?2 WHERE id=?3",
            [text, now, lineId]
          )
        )
        .catch((e) =>
          console.error("[line-store] updateLine persist failed:", e)
        );
    }
  },

  removeLine(songId, lineId) {
    set((s) => ({
      linesBySong: {
        ...s.linesBySong,
        [songId]: (s.linesBySong[songId] ?? [])
          .filter((l) => l.id !== lineId)
          .map((l, i) => ({ ...l, order: i })),
      },
    }));
    if (IS_TAURI) {
      getDb()
        .then((db) =>
          db.execute("DELETE FROM lines WHERE id=?1", [lineId])
        )
        .catch((e) =>
          console.error("[line-store] removeLine persist failed:", e)
        );
    }
  },

  reorderLines(songId, lines) {
    const now = new Date().toISOString();
    const reordered = lines.map((l, i) => ({ ...l, order: i, updated_at: now }));
    set((s) => ({
      linesBySong: { ...s.linesBySong, [songId]: reordered },
    }));
    if (IS_TAURI) {
      getDb()
        .then(async (db) => {
          for (const line of reordered) {
            await db.execute(
              "UPDATE lines SET ord=?1, updated_at=?2 WHERE id=?3",
              [line.order, now, line.id]
            );
          }
        })
        .catch((e) =>
          console.error("[line-store] reorderLines persist failed:", e)
        );
    }
  },

  getLines: (songId) => get().linesBySong[songId] ?? [],
}));
