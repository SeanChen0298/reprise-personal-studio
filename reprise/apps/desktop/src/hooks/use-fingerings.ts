import { useCallback, useEffect, useMemo, useState } from "react";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Which fingering (voicing) to use for a chord in a bar, saved per song in
 * chord_fingerings.json. Keyed by bar + chord name, so a pick only ever
 * affects that chord in that bar, and stays put when chord timings are
 * edited. Values are voicing keys like "E shape@3". No pick = the default
 * (first) fingering.
 */
interface FingeringsFile {
  version: 2;
  /** `${barIndex}:${chordName}` -> voicing key */
  byBar: Record<string, string>;
  /** Older files: chord start (ms) -> voicing key. Moved to byBar on load. */
  byTime?: Record<string, string>;
}

export interface Fingerings {
  lookup: (bar: number, shown: string) => string | undefined;
  /** Set (or with null, clear) the pick for a chord in one bar. */
  choose: (bar: number, shown: string, key: string | null) => void;
  /** Older picks keyed by time, still to be moved to bars (see migrate). */
  legacy: Record<string, string>;
  /** Move older time-keyed picks to bars, given which bar / chord each time falls in. */
  migrate: (resolve: (atMs: number) => { bar: number; shown: string } | null) => void;
}

const keyOf = (bar: number, shown: string) => `${bar}:${shown}`;

export function useFingerings(
  songFolder: string | undefined,
  /** Strumming and fingerpicking keep separate fingering picks. */
  space: "strum" | "fingerstyle" = "strum",
): Fingerings {
  const [data, setData] = useState<FingeringsFile>({ version: 2, byBar: {} });
  const path = songFolder
    ? `${songFolder}/${space === "fingerstyle" ? "chord_fingerings.fingerstyle.json" : "chord_fingerings.json"}`
    : undefined;
  const strumPath = songFolder ? `${songFolder}/chord_fingerings.json` : undefined;

  useEffect(() => {
    if (!path) { setData({ version: 2, byBar: {} }); return; }
    let cancelled = false;
    (async () => {
      try {
        // First use of the fingerpicking space starts from a copy of the strumming picks.
        const source = (await exists(path)) ? path : space === "fingerstyle" && strumPath && (await exists(strumPath)) ? strumPath : null;
        const raw = source ? JSON.parse(await readTextFile(source)) : {};
        if (!cancelled) setData({ version: 2, byBar: raw.byBar ?? {}, byTime: raw.byTime });
      } catch (err) {
        console.error("[fingerings] unreadable chord_fingerings.json:", err);
        if (!cancelled) setData({ version: 2, byBar: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [path, space, strumPath]);

  const save = useCallback(
    (next: FingeringsFile) => {
      if (!path) return;
      writeTextFile(path, JSON.stringify(next, null, 2)).catch((err) =>
        console.error("[fingerings] could not save:", err),
      );
    },
    [path],
  );

  const lookup = useCallback((bar: number, shown: string) => data.byBar[keyOf(bar, shown)], [data]);

  const choose = useCallback(
    (bar: number, shown: string, key: string | null) => {
      setData((prev) => {
        const byBar = { ...prev.byBar };
        if (key == null) delete byBar[keyOf(bar, shown)];
        else byBar[keyOf(bar, shown)] = key;
        const next = { ...prev, byBar };
        save(next);
        return next;
      });
    },
    [save],
  );

  const migrate = useCallback(
    (resolve: (atMs: number) => { bar: number; shown: string } | null) => {
      setData((prev) => {
        if (!prev.byTime || Object.keys(prev.byTime).length === 0) return prev;
        const byBar = { ...prev.byBar };
        for (const [at, key] of Object.entries(prev.byTime)) {
          const spot = resolve(Number(at));
          if (spot && !byBar[keyOf(spot.bar, spot.shown)]) byBar[keyOf(spot.bar, spot.shown)] = key;
        }
        const next: FingeringsFile = { version: 2, byBar };
        save(next);
        return next;
      });
    },
    [save],
  );

  return useMemo(
    () => ({ lookup, choose, legacy: data.byTime ?? {}, migrate }),
    [lookup, choose, data.byTime, migrate],
  );
}
