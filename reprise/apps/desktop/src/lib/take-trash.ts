// Deleted takes keep their audio file until undo can no longer bring them back
// (leaving the song, or the next app start) — so deleting a take is undoable.

import { exists, remove } from "@tauri-apps/plugin-fs";

const KEY = "reprise-take-trash";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function write(paths: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {
    /* worst case the file stays on disk */
  }
}

/** The take is gone from the library; its file waits here in case of undo. */
export function trashTakeFile(path: string) {
  write([...read().filter((p) => p !== path), path]);
}

/** Undo brought the take back — keep its file. */
export function restoreTakeFile(path: string) {
  write(read().filter((p) => p !== path));
}

/** Delete the files of takes that can't be undone any more. */
export async function emptyTakeTrash() {
  const paths = read();
  if (!paths.length) return;
  write([]);
  for (const p of paths) {
    try {
      if (await exists(p)) await remove(p);
    } catch {
      /* already gone or locked — not worth bothering the user */
    }
  }
}
