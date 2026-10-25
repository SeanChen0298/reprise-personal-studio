/**
 * Background hook (mounted at the app root): while phone sync is on, runs the
 * sync server, keeps the library snapshot fresh and imports what the phone sends.
 */
import { useEffect } from "react";
import { hostname } from "@tauri-apps/plugin-os";
import { importInbox, lastPull, serverStatus, startServer, stopServer, writeSnapshot } from "../lib/phone-sync";
import { usePhoneSyncStore } from "../stores/phone-sync-store";
import { useSongStore } from "../stores/song-store";
import { useHighlightStore } from "../lib/highlight-config";

/** Wait this long after a change before rewriting the snapshot. */
const DEBOUNCE_MS = 1500;
/** Also rewrite now and then — coach cards are files, not store changes. */
const REFRESH_MS = 30_000;
const INBOX_MS = 3000;

export function usePhoneSync() {
  const enabled = usePhoneSyncStore((s) => s.enabled);
  const token = usePhoneSyncStore((s) => s.token);
  const port = usePhoneSyncStore((s) => s.port);
  const hasLoaded = useSongStore((s) => s.hasLoaded);

  useEffect(() => {
    const { setRuntime } = usePhoneSyncStore.getState();
    if (!enabled) {
      stopServer().then((status) => setRuntime({ status, error: null })).catch(() => {});
      return;
    }
    // Never serve an empty library just because it hasn't been read yet.
    if (!hasLoaded) return;
    let cancelled = false;
    let host = "Desktop";
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writing = false;
    let again = false;

    const write = async () => {
      if (writing) {
        again = true;
        return;
      }
      writing = true;
      try {
        await writeSnapshot(host);
      } catch (err) {
        console.warn("[phone-sync] snapshot failed:", err);
      } finally {
        writing = false;
        if (again && !cancelled) {
          again = false;
          void write();
        }
      }
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void write(), DEBOUNCE_MS);
    };

    (async () => {
      try {
        host = (await hostname()) ?? host;
      } catch {
        /* keep default */
      }
      try {
        await write();
        const status = await startServer(token, port);
        if (!cancelled) setRuntime({ status, error: null });
      } catch (err) {
        if (!cancelled) setRuntime({ error: err instanceof Error ? err.message : String(err) });
      }
    })();

    const unsubSongs = useSongStore.subscribe((s, prev) => {
      if (s.songs !== prev.songs || s.lines !== prev.lines || s.sections !== prev.sections || s.recordings !== prev.recordings) soon();
    });
    const unsubHl = useHighlightStore.subscribe(soon);
    const refresh = setInterval(() => void write(), REFRESH_MS);
    let importing = false;
    const inbox = setInterval(async () => {
      if (importing) return;
      importing = true;
      try {
        const got = await importInbox();
        if (got.takes || got.edits) setRuntime({ lastImport: { at: Date.now(), ...got } });
        setRuntime({ lastPull: await lastPull(), status: await serverStatus() });
      } catch (err) {
        console.warn("[phone-sync] inbox failed:", err);
      } finally {
        importing = false;
      }
    }, INBOX_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(refresh);
      clearInterval(inbox);
      unsubSongs();
      unsubHl();
    };
  }, [enabled, token, port, hasLoaded]);
}
