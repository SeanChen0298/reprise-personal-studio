import { useCallback, useEffect, useMemo, useState } from "react";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Which fingering (voicing) to use for each chord, saved per song in
 * chord_fingerings.json next to the chords. A choice applies either to one
 * spot in the song (by chord start time) or to every chord of that name in
 * the song. Values are voicing keys like "E shape@3".
 */
interface FingeringsFile {
  version: 1;
  /** One chord occurrence: chord start (ms, as a string) -> voicing key. */
  byTime: Record<string, string>;
  /** Every chord with this (shown) name in the song -> voicing key. */
  byChord: Record<string, string>;
}

const EMPTY: FingeringsFile = { version: 1, byTime: {}, byChord: {} };

export interface Fingerings {
  /** The chosen voicing key for a chord name, at a spot in the song if given. */
  lookup: (shown: string, atMs?: number) => string | undefined;
  /** Whether this spot has its own choice (rather than the song-wide one). */
  hasOwn: (atMs: number) => boolean;
  /**
   * Choose a voicing: at one spot (`atMs`) or for every chord of this name
   * (`atMs` undefined). `key` null = back to the default.
   */
  choose: (shown: string, key: string | null, atMs?: number) => void;
}

export function useFingerings(songFolder: string | undefined): Fingerings {
  const [data, setData] = useState<FingeringsFile>(EMPTY);
  const path = songFolder ? `${songFolder}/chord_fingerings.json` : undefined;

  useEffect(() => {
    if (!path) { setData(EMPTY); return; }
    let cancelled = false;
    (async () => {
      try {
        const file = (await exists(path)) ? (JSON.parse(await readTextFile(path)) as FingeringsFile) : EMPTY;
        if (!cancelled) setData({ ...EMPTY, ...file });
      } catch (err) {
        console.error("[fingerings] unreadable chord_fingerings.json:", err);
        if (!cancelled) setData(EMPTY);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  const lookup = useCallback(
    (shown: string, atMs?: number) =>
      (atMs != null ? data.byTime[String(atMs)] : undefined) ?? data.byChord[shown],
    [data],
  );

  const hasOwn = useCallback((atMs: number) => String(atMs) in data.byTime, [data]);

  const choose = useCallback(
    (shown: string, key: string | null, atMs?: number) => {
      setData((prev) => {
        const next: FingeringsFile = { ...prev, byTime: { ...prev.byTime }, byChord: { ...prev.byChord } };
        if (atMs != null) {
          if (key == null) delete next.byTime[String(atMs)];
          else next.byTime[String(atMs)] = key;
        } else {
          if (key == null) delete next.byChord[shown];
          else next.byChord[shown] = key;
        }
        if (path) {
          writeTextFile(path, JSON.stringify(next, null, 2)).catch((err) =>
            console.error("[fingerings] could not save:", err),
          );
        }
        return next;
      });
    },
    [path],
  );

  // Stable object: consumers (the guide guitar's scheduler, the picking
  // part) must only re-run when a fingering actually changes, not on every
  // render — re-running the guide stops the notes that are ringing.
  return useMemo(() => ({ lookup, hasOwn, choose }), [lookup, hasOwn, choose]);
}
