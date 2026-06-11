// ONE-TIME migration: pull all data from cloud Supabase into the local Dexie DB.
//
// Run this ONCE, while still signed in to the cloud account, BEFORE Supabase is
// removed from the build. It is exposed on `window.__repriseMigrate()` in dev
// (see main.tsx) — open the app's devtools console and call it.
//
// This whole file is deleted in the final cleanup phase.

import { supabase } from "./supabase";
import { dexie, type Row } from "./local-db";
import { usePreferencesStore } from "../stores/preferences-store";
import { useHighlightStore, type HighlightType } from "./highlight-config";
import { useSymbolStore, type VocalSymbol } from "./symbol-config";

const PAGE = 1000;

async function fetchAll(table: string): Promise<Row[]> {
  // RLS scopes SELECT to the signed-in user, so no explicit user filter needed.
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    const res = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => { range: (a: number, b: number) => Promise<{ data: Row[] | null; error: unknown }> };
      };
    })
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (res.error) throw res.error;
    const data = res.data ?? [];
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function migratePreferences(): Promise<void> {
  try {
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{ data: { preferences?: unknown } | null }>;
        };
      };
    })
      .from("profiles")
      .select("preferences")
      .maybeSingle();

    const p = data?.preferences as
      | { theme?: string; showWaveform?: boolean; highlights?: HighlightType[]; symbols?: VocalSymbol[] }
      | undefined;
    if (!p) return;

    if (p.theme) usePreferencesStore.getState().setTheme(p.theme);
    if (typeof p.showWaveform === "boolean") usePreferencesStore.getState().setShowWaveform(p.showWaveform);
    if (Array.isArray(p.highlights) && p.highlights.length > 0) useHighlightStore.getState().setHighlights(p.highlights);
    if (Array.isArray(p.symbols) && p.symbols.length > 0) useSymbolStore.getState().setSymbols(p.symbols);
  } catch (err) {
    console.warn("[migrate] preferences migration skipped:", err);
  }
}

export interface MigrationResult {
  songs: number;
  lines: number;
  recordings: number;
  sections: number;
}

export async function migrateFromSupabase(email?: string, password?: string): Promise<MigrationResult> {
  // RLS scopes every SELECT to the signed-in user, so we must have a session.
  // Auth UI is gone, so sign in programmatically here (one-time).
  if (email && password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error(
      "Not signed in to Supabase. Run: await window.__repriseMigrate('you@email.com', 'your-password')"
    );
  }
  console.log("[migrate] signed in as", user.email);

  const already = await dexie.meta.get("migrated");
  if (already) {
    console.warn("[migrate] already migrated at", already.value, "— wipe the 'reprise' IndexedDB to re-run.");
  }

  console.log("[migrate] fetching from Supabase…");
  const [songs, lines, recordings, sections] = await Promise.all([
    fetchAll("songs"),
    fetchAll("lines"),
    fetchAll("recordings"),
    fetchAll("sections"),
  ]);

  console.log("[migrate] writing to local DB…", {
    songs: songs.length,
    lines: lines.length,
    recordings: recordings.length,
    sections: sections.length,
  });

  await dexie.transaction(
    "rw",
    [dexie.songs, dexie.lines, dexie.recordings, dexie.sections, dexie.meta],
    async () => {
      await dexie.songs.bulkPut(songs);
      await dexie.lines.bulkPut(lines);
      await dexie.recordings.bulkPut(recordings);
      await dexie.sections.bulkPut(sections);
      await dexie.meta.put({ key: "migrated", value: new Date().toISOString() });
    }
  );

  await migratePreferences();

  const result: MigrationResult = {
    songs: songs.length,
    lines: lines.length,
    recordings: recordings.length,
    sections: sections.length,
  };
  console.log("[migrate] DONE", result, "— reload the app to see your data.");
  return result;
}
