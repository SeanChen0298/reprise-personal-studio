import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSongStore } from "../stores/song-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { computeSongProgress } from "../lib/status-config";
import type { Song, Line } from "../types/song";

export interface SongGroup {
  key: string;
  label: string;
  songs: Song[];
  collapsed: boolean;
}

export type SortedGroupedResult =
  | { type: "flat"; songs: Song[] }
  | { type: "grouped"; groups: SongGroup[] };

function sortSongs(
  songs: Song[],
  sort: string,
  songOrder: Record<string, number>,
  allLines: Record<string, Line[]>,
): Song[] {
  const arr = [...songs];
  switch (sort) {
    case "title":
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case "artist":
      return arr.sort((a, b) => a.artist.localeCompare(b.artist));
    case "mastery":
      return arr.sort((a, b) =>
        computeSongProgress(allLines[b.id] ?? []) - computeSongProgress(allLines[a.id] ?? [])
      );
    case "date_added":
      return arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case "custom":
    default: {
      return arr.sort((a, b) => {
        const oa = songOrder[a.id] ?? Infinity;
        const ob = songOrder[b.id] ?? Infinity;
        if (oa !== ob) return oa - ob;
        // Fall back to created_at for songs without a custom position
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    }
  }
}

function lastPracticedBucket(iso: string | undefined): "today" | "week" | "older" {
  if (!iso) return "older";
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1 && then.getDate() === now.getDate()) return "today";
  if (diffDays < 7) return "week";
  return "older";
}

export function useSortedGroupedSongs(): SortedGroupedResult {
  const allSongs = useSongStore((s) => s.songs);
  const allLines = useSongStore((s) => s.lines);
  const { librarySort, libraryGroup, songOrder, lastPracticed, collapsedGroups } =
    usePreferencesStore(useShallow((s) => ({
      librarySort: s.librarySort,
      libraryGroup: s.libraryGroup,
      songOrder: s.songOrder,
      lastPracticed: s.lastPracticed,
      collapsedGroups: s.collapsedGroups,
    })));

  return useMemo(() => {
    // Pinned always float to the top within their group
    const pinned = allSongs.filter((s) => s.pinned);
    const rest = allSongs.filter((s) => !s.pinned);

    const effectiveSort = libraryGroup !== "none" && librarySort === "custom"
      ? "date_added"   // custom reorder unavailable while grouping
      : librarySort;

    const sortedPinned = sortSongs(pinned, effectiveSort, songOrder, allLines);
    const sortedRest = sortSongs(rest, effectiveSort, songOrder, allLines);
    const sorted = [...sortedPinned, ...sortedRest];

    if (libraryGroup === "none") {
      return { type: "flat", songs: sorted };
    }

    if (libraryGroup === "artist") {
      const map = new Map<string, Song[]>();
      for (const song of sorted) {
        const key = (song.artist || "Unknown Artist").trim();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(song);
      }
      const groups: SongGroup[] = [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, songs]) => ({
          key,
          label: key,
          songs,
          collapsed: collapsedGroups[key] ?? false,
        }));
      return { type: "grouped", groups };
    }

    // last_practiced grouping
    const buckets: Record<"today" | "week" | "older", Song[]> = {
      today: [],
      week: [],
      older: [],
    };
    for (const song of sorted) {
      buckets[lastPracticedBucket(lastPracticed[song.id])].push(song);
    }
    const bucketDefs: Array<{ key: "today" | "week" | "older"; label: string }> = [
      { key: "today", label: "Today" },
      { key: "week", label: "This week" },
      { key: "older", label: "Older" },
    ];
    const groups: SongGroup[] = bucketDefs
      .filter(({ key }) => buckets[key].length > 0)
      .map(({ key, label }) => ({
        key,
        label,
        songs: buckets[key],
        collapsed: collapsedGroups[key] ?? false,
      }));

    return { type: "grouped", groups };
  }, [allSongs, allLines, librarySort, libraryGroup, songOrder, lastPracticed, collapsedGroups]);
}
