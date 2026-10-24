import { useEffect } from "react";
import { useSongStore } from "../stores/song-store";
import { useSuggestionsStore } from "../stores/suggestions-store";

/** Build a batch in the background when we're running low, at most this often. */
const REFRESH_AFTER_HOURS = 12;
const LOW_WATER_MARK = 6;
/** Let startup (data load, task queue) settle before hitting YouTube. */
const STARTUP_DELAY_MS = 15_000;

/**
 * Preloads Discover suggestions after app start so the page is ready when
 * opened. Mounted once at the app root.
 */
export function useSuggestionsPreload() {
  const songsLoading = useSongStore((s) => s.isLoading);
  const songCount = useSongStore((s) => s.songs.length);
  const ready = !songsLoading && songCount > 0;

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(async () => {
      const store = useSuggestionsStore.getState();
      await store.load();
      const fresh = useSuggestionsStore.getState().suggestions.filter((s) => s.status === "new").length;
      const hours = await store.hoursSinceLastBatch();
      if (fresh < LOW_WATER_MARK && (hours === null || hours >= REFRESH_AFTER_HOURS)) {
        console.log("[suggestions] preloading a batch in the background");
        store.generate();
      }
    }, STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);
}
