import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-shell";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { useSuggestionsStore } from "../stores/suggestions-store";
import { seedableSongs, type Suggestion } from "../lib/suggestions";

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function SuggestionCard({
  suggestion,
  onAdd,
  onDismiss,
  onMoreLike,
}: {
  suggestion: Suggestion;
  onAdd: () => Promise<void>;
  onDismiss: () => void;
  onMoreLike: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="group bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden hover:shadow-md transition-all animate-fade-up">
      {/* Thumbnail — opens the video on YouTube */}
      <button
        onClick={() => open(suggestion.youtube_url)}
        title="Watch on YouTube"
        className="relative block w-full aspect-video bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] overflow-hidden border-none p-0 cursor-pointer"
      >
        <img src={suggestion.thumbnail_url} alt={suggestion.title} className="w-full h-full object-cover" />
        <span className="absolute bottom-2 right-2 text-[10.5px] font-medium px-[6px] py-[2px] rounded-[4px] bg-black/70 text-white">
          {formatDuration(suggestion.duration_ms)}
        </span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <polygon points="8 5 19 12 8 19 8 5" />
          </svg>
        </span>
      </button>

      <div className="p-3">
        <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate" title={suggestion.raw_title}>
          {suggestion.title}
        </div>
        <div className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">{suggestion.artist}</div>

        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <span
            className="text-[10.5px] px-2 py-0.5 rounded-full bg-[var(--theme-light)] text-[var(--theme-text)]"
            title="Uploaded captions — usually the lyrics"
          >
            Lyrics · {suggestion.caption_langs.slice(0, 4).map((l) => l.toUpperCase()).join(" ")}
          </span>
        </div>

        <button
          onClick={onMoreLike}
          className="block w-full text-left text-[11px] text-[var(--text-muted)] truncate mt-2 bg-transparent border-none p-0 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          title="Get suggestions based only on this song"
        >
          Because you have {suggestion.seed_title}
        </button>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={async () => {
              setAdding(true);
              try {
                await onAdd();
              } finally {
                setAdding(false);
              }
            }}
            disabled={adding}
            className="flex-1 flex items-center justify-center gap-[5px] px-3 py-[6px] rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {adding ? "Adding…" : "Add to library"}
          </button>
          <button
            onClick={onDismiss}
            title="Not interested"
            className="w-[30px] h-[30px] flex items-center justify-center rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[#888] transition-all cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden animate-pulse">
      <div className="w-full aspect-video bg-[var(--bg)]" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-[12px] w-3/4 rounded bg-[var(--bg)]" />
        <div className="h-[10px] w-1/2 rounded bg-[var(--bg)]" />
        <div className="h-[28px] w-full rounded-[7px] bg-[var(--bg)] mt-2" />
      </div>
    </div>
  );
}

export function DiscoverPage() {
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const songsLoading = useSongStore((s) => s.isLoading);
  const { suggestions, loaded, generating, progress, error, seeds, load, generate, dismiss, addToLibrary } =
    useSuggestionsStore();
  const [addedTitle, setAddedTitle] = useState<string | null>(null);

  const seedOptions = useMemo(
    () => seedableSongs(songs).sort((a, b) => a.title.localeCompare(b.title)),
    [songs],
  );
  const visible = useMemo(
    () =>
      suggestions
        .filter((s) => s.status === "new")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [suggestions],
  );

  useEffect(() => {
    load();
  }, [load]);

  // First visit (or everything handled): build a batch straight away.
  useEffect(() => {
    if (loaded && !songsLoading && !generating && !error && visible.length === 0 && seedOptions.length > 0) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, songsLoading]);

  useEffect(() => {
    if (!addedTitle) return;
    const t = setTimeout(() => setAddedTitle(null), 4000);
    return () => clearTimeout(t);
  }, [addedTitle]);

  const basedOn = seeds.length > 0 ? seeds.map((s) => s.title).join(" · ") : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center gap-4 flex-shrink-0">
          <span className="text-[14px] font-medium flex-shrink-0">Discover</span>

          <div className="flex items-center gap-3 ml-auto">
            <select
              value=""
              onChange={(e) => e.target.value && generate({ seedSongId: e.target.value })}
              disabled={generating || seedOptions.length === 0}
              title="Get suggestions based on one song"
              className="max-w-[220px] px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--theme)] transition-colors cursor-pointer disabled:opacity-50"
            >
              <option value="">More like…</option>
              {seedOptions.map((s) => (
                <option key={s.songId} value={s.songId}>
                  {s.title}
                </option>
              ))}
            </select>

            <button
              onClick={() => generate({ fresh: true })}
              disabled={generating || seedOptions.length === 0}
              className="flex items-center gap-[6px] px-4 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={generating ? "animate-spin" : ""}
                style={generating ? { animationDuration: "1.4s" } : undefined}
              >
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              New suggestions
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-7 pb-7" style={{ scrollbarWidth: "none" }}>
          {/* Status line */}
          <div className="min-h-[20px] mb-4 text-[12.5px] text-[var(--text-muted)] flex items-center gap-2">
            {progress ? (
              <span>{progress}</span>
            ) : basedOn ? (
              <span className="truncate">Based on {basedOn}</span>
            ) : (
              <span>Songs with lyrics, picked from YouTube Mixes of your library.</span>
            )}
          </div>

          {addedTitle && (
            <div className="mb-4 px-4 py-[10px] rounded-[9px] bg-[var(--theme-light)] text-[13px] text-[var(--theme-text)] flex items-center gap-3">
              <span className="flex-1 truncate">Added “{addedTitle}” — downloading in the background.</span>
              <button
                onClick={() => navigate("/library")}
                className="text-[12.5px] font-medium bg-transparent border-none cursor-pointer text-[var(--theme-text)] hover:underline"
              >
                Go to library
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 px-4 py-[10px] rounded-[9px] border border-red-500/40 bg-red-500/5 text-[13px] text-red-600 whitespace-pre-line">
              {error}
            </div>
          )}

          {seedOptions.length === 0 && !songsLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <p className="text-[14px] text-[var(--text-primary)]">Suggestions are based on the songs in your library.</p>
              <button
                onClick={() => navigate("/import")}
                className="text-[12.5px] text-[var(--theme)] hover:underline bg-transparent border-none cursor-pointer"
              >
                Import a song from YouTube
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {visible.map((s) => (
                <SuggestionCard
                  key={s.video_id}
                  suggestion={s}
                  onAdd={async () => {
                    const song = await addToLibrary(s.video_id);
                    if (song) setAddedTitle(song.title);
                  }}
                  onDismiss={() => dismiss(s.video_id)}
                  onMoreLike={() => generate({ seedSongId: s.seed_song_id })}
                />
              ))}
              {generating && Array.from({ length: 4 }, (_, i) => <SkeletonCard key={`sk-${i}`} />)}
            </div>
          )}

          {!generating && visible.length === 0 && seedOptions.length > 0 && !error && loaded && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <p className="text-[14px] text-[var(--text-primary)]">You've gone through this batch.</p>
              <button
                onClick={() => generate({ fresh: true })}
                className="text-[12.5px] text-[var(--theme)] hover:underline bg-transparent border-none cursor-pointer"
              >
                Get new suggestions
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
