import { useMemo } from "react";
import { useSongStore } from "../stores/song-store";
import { usePreferencesStore } from "../stores/preferences-store";
import type { Song } from "../types/song";

/** "today", "yesterday", "3 days ago", "2 weeks ago"… */
export function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

interface Recent {
  song: Song;
  at: string;
  /** What happened last: a take, or listening / marking up. */
  kind: "take" | "practice" | "added";
}

/** Songs by the last time you did something with them (played lines, recorded), newest first. */
export function useRecentSongs(): Recent[] {
  const songs = useSongStore((s) => s.songs);
  const recordings = useSongStore((s) => s.recordings);
  const lastPracticed = usePreferencesStore((s) => s.lastPracticed);
  return useMemo(() => {
    const out: Recent[] = [];
    for (const song of songs) {
      const takes = recordings[song.id] ?? [];
      const lastTake = takes.reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null);
      const practiced = lastPracticed[song.id] ?? null;
      if (lastTake && (!practiced || lastTake >= practiced)) out.push({ song, at: lastTake, kind: "take" });
      else if (practiced) out.push({ song, at: practiced, kind: "practice" });
    }
    out.sort((a, b) => b.at.localeCompare(a.at));
    if (out.length === 0) {
      // Nothing practised yet: the newest song is the obvious place to start.
      const newest = [...songs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (newest) out.push({ song: newest, at: newest.created_at, kind: "added" });
    }
    return out;
  }, [songs, recordings, lastPracticed]);
}

function Thumb({ song, className }: { song: Song; className: string }) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] ${className}`}>
      {song.thumbnail_url && <img src={song.thumbnail_url} alt="" className="w-full h-full object-cover" />}
    </div>
  );
}

/**
 * The top of the library: the song you were last working on, big, with one
 * clear action — and the few before it. Everything else is the grid below.
 */
export function LibraryHero({ recent, onOpen }: { recent: Recent[]; onOpen: (song: Song) => void }) {
  const recordings = useSongStore((s) => s.recordings);
  const [main, ...rest] = recent;
  if (!main) return null;
  const { song } = main;
  const lastNote = (recordings[song.id] ?? [])
    .filter((r) => r.note?.trim())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.note?.trim();
  const when =
    main.kind === "take"
      ? `Last take ${timeAgo(main.at)}`
      : main.kind === "practice"
        ? `Last practised ${timeAgo(main.at)}`
        : `Added ${timeAgo(main.at)}`;

  return (
    <section className="mb-9 flex gap-6 items-stretch animate-fade-up">
      <div
        onClick={() => onOpen(song)}
        className="group flex-1 min-w-0 flex gap-6 p-4 rounded-[14px] bg-[var(--surface)] border border-[var(--border-subtle)] hover:border-[var(--border)] hover:shadow-sm transition-all cursor-pointer"
      >
        <Thumb song={song} className="w-[46%] max-w-[420px] aspect-video rounded-[10px] flex-shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col justify-center py-2">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--theme)] font-medium mb-2">
            {main.kind === "added" ? "Start here" : "Pick up where you left off"}
          </div>
          <h2 className="font-serif text-[30px] leading-[1.1] tracking-[-0.6px] text-[var(--text-primary)] truncate" title={song.title}>
            {song.title}
          </h2>
          <div className="text-[14px] text-[var(--text-muted)] mt-1 truncate">{song.artist}</div>
          <div className="text-[12.5px] text-[var(--text-secondary)] mt-4">{when}</div>
          {lastNote && (
            <div className="text-[12.5px] text-[var(--text-secondary)] italic mt-1 line-clamp-2" title={lastNote}>
              “{lastNote}”
            </div>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(song);
              }}
              className="flex items-center gap-[7px] px-5 py-[9px] rounded-[9px] bg-[var(--accent)] text-white text-[13.5px] font-medium hover:opacity-85 transition-opacity border-none cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
              {main.kind === "added" ? "Open" : "Continue"}
            </button>
            <span className="text-[11.5px] text-[var(--text-muted)]">Enter</span>
          </div>
        </div>
      </div>

      {rest.length > 0 && (
        <div className="w-[240px] flex-shrink-0 flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)] font-medium mb-2 px-2">Recently</div>
          <div className="flex flex-col gap-[2px]">
            {rest.slice(0, 4).map((r) => (
              <button
                key={r.song.id}
                onClick={() => onOpen(r.song)}
                className="flex items-center gap-3 p-2 rounded-[9px] bg-transparent border-none cursor-pointer text-left hover:bg-[var(--surface)] transition-colors"
              >
                <Thumb song={r.song} className="w-[64px] aspect-video rounded-[5px] flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] text-[var(--text-primary)] truncate">{r.song.title}</div>
                  <div className="text-[11.5px] text-[var(--text-muted)] truncate">{timeAgo(r.at)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
