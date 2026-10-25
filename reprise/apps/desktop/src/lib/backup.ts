// Local DB backup: export the entire Dexie database to a JSON file and restore
// it. Because the local store lives in the WebView2 IndexedDB (not a portable
// file), this gives a one-click, copyable backup of the whole library.

import { dexie, type Row } from "./local-db";
import { useHighlightStore } from "./highlight-config";
import { useSymbolStore } from "./symbol-config";

export interface BackupCounts {
  songs: number;
  lines: number;
  recordings: number;
  sections: number;
}

export interface BackupFile extends BackupCounts {
  format: "reprise-backup";
  version: 1;
  exportedAt: string;
  data: {
    songs: Row[];
    lines: Row[];
    recordings: Row[];
    sections: Row[];
  };
  /**
   * Local settings that rows depend on: the highlight and symbol types marks
   * refer to by id. (Coach keys are never included.)
   */
  settings?: Record<string, string>;
}

/** localStorage keys copied into a backup — never "reprise-coach" (API keys). */
const SETTINGS_KEYS = ["reprise-highlights", "reprise-symbols", "reprise-preferences"];

function readSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTINGS_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v) out[k] = v;
    } catch {
      /* unavailable */
    }
  }
  return out;
}

/** Gather every collection and trigger a download of a timestamped JSON file. */
export async function exportBackup(): Promise<BackupCounts> {
  const [songs, lines, recordings, sections] = await Promise.all([
    dexie.songs.toArray(),
    dexie.lines.toArray(),
    dexie.recordings.toArray(),
    dexie.sections.toArray(),
  ]);

  const backup: BackupFile = {
    format: "reprise-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    songs: songs.length,
    lines: lines.length,
    recordings: recordings.length,
    sections: sections.length,
    data: { songs, lines, recordings, sections },
    settings: readSettings(),
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reprise-backup-${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return { songs: songs.length, lines: lines.length, recordings: recordings.length, sections: sections.length };
}

/** Restore a backup (upsert by id). Existing rows with matching ids are overwritten. */
export async function importBackupFromText(text: string): Promise<BackupCounts> {
  const parsed = JSON.parse(text) as Partial<BackupFile>;
  if (parsed.format !== "reprise-backup" || !parsed.data) {
    throw new Error("Not a valid Reprise backup file.");
  }
  const { songs = [], lines = [], recordings = [], sections = [] } = parsed.data;

  await dexie.transaction(
    "rw",
    [dexie.songs, dexie.lines, dexie.recordings, dexie.sections],
    async () => {
      if (songs.length) await dexie.songs.bulkPut(songs);
      if (lines.length) await dexie.lines.bulkPut(lines);
      if (recordings.length) await dexie.recordings.bulkPut(recordings);
      if (sections.length) await dexie.sections.bulkPut(sections);
    }
  );

  // Highlight / symbol types: add the backup's ones this machine doesn't have
  // (by id), so restored marks keep their look. Preferences only on a fresh machine.
  for (const [k, v] of Object.entries(parsed.settings ?? {})) {
    if (!SETTINGS_KEYS.includes(k)) continue;
    try {
      const cur = localStorage.getItem(k);
      if (!cur || k === "reprise-preferences") {
        if (!cur) localStorage.setItem(k, v);
        continue;
      }
      const mine = JSON.parse(cur) as { state?: Record<string, unknown> };
      const theirs = JSON.parse(v) as { state?: Record<string, unknown> };
      const listKey = k === "reprise-highlights" ? "highlights" : "symbols";
      const a = (mine.state?.[listKey] ?? []) as { id: string }[];
      const b = (theirs.state?.[listKey] ?? []) as { id: string }[];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const have = new Set(a.map((x) => x.id));
      const merged = [...a, ...b.filter((x) => !have.has(x.id))];
      if (merged.length !== a.length) {
        localStorage.setItem(k, JSON.stringify({ ...mine, state: { ...mine.state, [listKey]: merged } }));
      }
    } catch {
      /* skip a malformed entry */
    }
  }
  await Promise.all([useHighlightStore.persist.rehydrate(), useSymbolStore.persist.rehydrate()]);

  return { songs: songs.length, lines: lines.length, recordings: recordings.length, sections: sections.length };
}

/** Open a file picker, then restore the chosen backup. Resolves null if cancelled. */
export async function importBackupViaPicker(): Promise<BackupCounts | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then(importBackupFromText)
        .then(resolve)
        .catch(reject);
    };
    input.click();
  });
}
