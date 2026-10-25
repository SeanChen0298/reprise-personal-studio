import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { useTaskQueueStore } from "../stores/task-queue-store";
import { isValidYouTubeUrl, fetchYouTubeMetadata, cleanYouTubeUrl, parseYouTubeVideoId } from "../lib/youtube";
import { guessLanguage, parseSongTitle, searchYouTube, thumbnailUrl, titleKey, type SearchResult } from "../lib/suggestions";
import { searchLyrics } from "../lib/lrclib";
import type { YouTubeMetadata } from "../types/song";

type FetchStatus = "idle" | "loading" | "done" | "error";
/** synced = LRCLIB has timed lyrics of this upload's length; lyrics = only other lengths / plain. */
type LyricsHint = "checking" | "synced" | "lyrics" | "none";

function formatDuration(ms: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ImportUrlPage() {
  const navigate = useNavigate();
  const setImportDraft = useSongStore((s) => s.setImportDraft);
  const addSong = useSongStore((s) => s.addSong);
  const songs = useSongStore((s) => s.songs);

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [metadata, setMetadata] = useState<YouTubeMetadata | null>(null);

  // Search
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const [selected, setSelected] = useState(0);
  const [lyricsHints, setLyricsHints] = useState<Record<string, LyricsHint>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRun = useRef(0);

  const libraryIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of songs) {
      const vid = s.youtube_url ? parseYouTubeVideoId(s.youtube_url) : null;
      if (vid) m.set(vid, s.id);
    }
    return m;
  }, [songs]);

  const isUrl = isValidYouTubeUrl(url.trim());

  async function handleFetch() {
    const trimmed = url.trim();
    setErrorMsg("");
    setStatus("loading");
    setMetadata(null);
    setResults(null);

    try {
      const data = await fetchYouTubeMetadata(trimmed);
      setMetadata(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch video info.");
      setStatus("error");
    }
  }

  async function handleSearch() {
    const q = url.trim();
    const run = ++searchRun.current;
    setErrorMsg("");
    setMetadata(null);
    setStatus("loading");
    setSearchedFor(q);
    setSelected(0);
    setLyricsHints({});
    try {
      const found = await searchYouTube(q);
      if (run !== searchRun.current) return;
      setResults(found);
      setStatus("done");
      checkLyrics(found, run);
    } catch (err) {
      if (run !== searchRun.current) return;
      setResults(null);
      setErrorMsg(err instanceof Error ? err.message : "YouTube search failed.");
      setStatus("error");
    }
  }

  /** One LRCLIB lookup per distinct song; each upload is matched by its own length. */
  async function checkLyrics(found: SearchResult[], run: number) {
    const groups = new Map<string, SearchResult[]>();
    for (const r of found.filter((x) => !x.unlikely).slice(0, 8)) {
      const k = titleKey(r.rawTitle, r.channel);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    setLyricsHints(Object.fromEntries([...groups.values()].flat().map((r) => [r.videoId, "checking" as LyricsHint])));
    for (const group of groups.values()) {
      let hint: (r: SearchResult) => LyricsHint;
      try {
        const cands = await searchLyrics({ title: group[0].title, artist: group[0].artist });
        hint = (r) =>
          cands.some((c) => c.synced && c.durationMs && r.durationMs && Math.abs(c.durationMs - r.durationMs) <= 3000)
            ? "synced"
            : cands.length > 0
              ? "lyrics"
              : "none";
      } catch {
        hint = () => "none";
      }
      if (run !== searchRun.current) return;
      setLyricsHints((h) => ({ ...h, ...Object.fromEntries(group.map((r) => [r.videoId, hint(r)])) }));
    }
  }

  function handleSubmit() {
    const q = url.trim();
    if (!q) {
      setErrorMsg("Type a song to search, or paste a YouTube link.");
      return;
    }
    if (isUrl) return handleFetch();
    if (q === searchedFor && results && results[selected]) return addResult(results[selected]);
    return handleSearch();
  }

  /** Straight into the library; the queue downloads it (and finds lyrics), like Discover. */
  async function addResult(r: SearchResult) {
    const existing = libraryIds.get(r.videoId);
    if (existing) return navigate(`/song/${existing}`);
    setAdding(r.videoId);
    try {
      const song = await addSong({
        title: r.title || r.rawTitle,
        artist: r.artist || r.channel,
        youtube_url: `https://www.youtube.com/watch?v=${r.videoId}`,
        thumbnail_url: thumbnailUrl(r.videoId),
        duration_ms: r.durationMs || undefined,
        language: guessLanguage({ raw_title: r.rawTitle, channel: r.channel }),
        tags: [],
        user_id: undefined,
      });
      useTaskQueueStore.getState().enqueue(song.id, song.title, "download");
      setAdded({ id: song.id, title: song.title });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't add the song.");
    } finally {
      setAdding(null);
    }
  }

  /** Fill in the details on the Add Song form first. */
  function editFirst(r: SearchResult) {
    const youtube_url = `https://www.youtube.com/watch?v=${r.videoId}`;
    setImportDraft({
      metadata: { video_id: r.videoId, youtube_url, title: r.rawTitle, author: r.channel, thumbnail_url: thumbnailUrl(r.videoId) },
      title: r.title || r.rawTitle,
      artist: r.artist || r.channel,
      bpm: "",
      language: "",
      tags: [],
      notes: "",
    });
    navigate("/add-song");
  }

  function handleContinue() {
    if (!metadata) return;
    // Pre-populate the draft with fetched metadata, tidied from the raw YouTube title
    const { title, artist } = parseSongTitle(metadata.title, metadata.author);
    setImportDraft({
      metadata,
      title: title || metadata.title,
      artist: artist || metadata.author,
      bpm: "",
      language: "",
      tags: [],
      notes: "",
    });
    navigate("/add-song");
  }

  function handleClear() {
    setUrl("");
    setMetadata(null);
    setResults(null);
    setSearchedFor("");
    setStatus("idle");
    setErrorMsg("");
    inputRef.current?.focus();
  }

  // Keyboard outside the box: W/S (or arrows) pick, Enter adds, Shift+Enter edits first, / searches again.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (!results?.length) return;
      if (e.code === "KeyS" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(results.length - 1, i + 1));
      } else if (e.code === "KeyW" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && results[selected]) {
        e.preventDefault();
        if (e.shiftKey) editFirst(results[selected]);
        else addResult(results[selected]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const showError = errorMsg && (status === "error" || status === "idle" || status === "done");

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => navigate("/library")}
            className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Library
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto flex justify-center px-7 py-12">
          <div className="w-full max-w-[620px] animate-fade-up">
            <h1 className="font-serif text-[24px] tracking-[-0.5px] mb-1">
              Add a song
            </h1>
            <p className="text-[13.5px] text-[var(--text-muted)] font-light mb-7 leading-relaxed">
              Search YouTube by song and artist, or paste a YouTube link.
            </p>

            {/* Search / URL input row */}
            <div className="flex gap-2 mb-2">
              <div className="flex-1 relative flex items-center">
                <span className="absolute left-3 text-[var(--text-muted)] pointer-events-none flex items-center">
                  {isUrl ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  )}
                </span>
                <input
                  ref={inputRef}
                  autoFocus
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text").trim();
                    if (!isValidYouTubeUrl(pasted)) return;
                    e.preventDefault();
                    setUrl(cleanYouTubeUrl(pasted));
                    if (errorMsg) setErrorMsg("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey && results?.[selected] && url.trim() === searchedFor) editFirst(results[selected]);
                      else handleSubmit();
                    } else if (e.key === "ArrowDown" && results?.length) {
                      e.preventDefault();
                      setSelected((i) => Math.min(results.length - 1, i + 1));
                    } else if (e.key === "ArrowUp" && results?.length) {
                      e.preventDefault();
                      setSelected((i) => Math.max(0, i - 1));
                    } else if (e.key === "Escape") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder="lulu. Mrs. GREEN APPLE  —  or a YouTube link"
                  disabled={status === "loading" && isUrl}
                  className={[
                    "w-full pl-[38px] pr-3 py-[10px] rounded-[9px] border-[1.5px] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all",
                    showError
                      ? "border-red-500 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.09)]"
                      : "border-[var(--border)] focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]",
                  ].join(" ")}
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={status === "loading"}
                className="flex items-center gap-[6px] px-5 py-[10px] rounded-[9px] bg-[var(--accent)] text-white text-[13.5px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {status === "loading" ? (
                  <>
                    <span className="w-[13px] h-[13px] border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {isUrl ? "Fetching" : "Searching"}
                  </>
                ) : isUrl ? (
                  "Fetch"
                ) : (
                  "Search"
                )}
              </button>
            </div>

            {/* Error */}
            {showError && (
              <p className="text-[12px] text-red-600 mb-2">{errorMsg}</p>
            )}

            {/* Hint */}
            {status === "idle" && !errorMsg && (
              <p className="text-[12px] text-[var(--text-muted)] mb-8">
                Enter searches · ↑↓ or W/S pick a result · Enter adds it · Shift+Enter edits the details first · / searches again
              </p>
            )}

            {added && (
              <div className="mt-3 mb-1 px-4 py-[10px] rounded-[9px] bg-[var(--theme-light)] text-[13px] text-[var(--theme-text)] flex items-center gap-3">
                <span className="flex-1 truncate">Added “{added.title}” — downloading, lyrics are looked up after.</span>
                <button
                  onClick={() => navigate(`/song/${added.id}`)}
                  className="text-[12.5px] font-medium bg-transparent border-none cursor-pointer text-[var(--theme-text)] hover:underline"
                >
                  Open
                </button>
              </div>
            )}

            {/* Loading (link) */}
            {status === "loading" && isUrl && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="w-9 h-9 border-[3px] border-[var(--border-subtle)] border-t-[var(--theme)] rounded-full animate-spin" />
                <div className="text-[13.5px] text-[var(--text-secondary)]">
                  Fetching video info...
                </div>
              </div>
            )}

            {/* Loading (search) */}
            {status === "loading" && !isUrl && (
              <div className="flex flex-col gap-2 mt-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex gap-3 p-2 rounded-[9px] animate-pulse">
                    <div className="w-[112px] h-[63px] rounded-[6px] bg-[var(--surface)]" />
                    <div className="flex-1 flex flex-col gap-2 pt-2">
                      <div className="h-[12px] w-2/3 rounded bg-[var(--surface)]" />
                      <div className="h-[10px] w-1/3 rounded bg-[var(--surface)]" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search results */}
            {status === "done" && results && (
              <div ref={listRef} className="flex flex-col gap-1 mt-4">
                {results.length === 0 && (
                  <p className="text-[13px] text-[var(--text-muted)] py-6 text-center">Nothing found on YouTube for “{searchedFor}”.</p>
                )}
                {results.map((r, i) => {
                  const inLibrary = libraryIds.has(r.videoId);
                  const hint = lyricsHints[r.videoId];
                  const first = i === results.findIndex((x) => x.unlikely) && i > 0;
                  return (
                    <div key={r.videoId}>
                      {first && (
                        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em] mt-3 mb-1 px-2">
                          Probably not the original
                        </div>
                      )}
                      <div
                        data-index={i}
                        onClick={() => setSelected(i)}
                        onDoubleClick={() => addResult(r)}
                        className={[
                          "group flex gap-3 p-2 rounded-[9px] cursor-pointer transition-colors border-[1.5px]",
                          i === selected
                            ? "bg-[var(--surface)] border-[var(--theme)]"
                            : "border-transparent hover:bg-[var(--surface)]",
                          r.unlikely && i !== selected ? "opacity-60" : "",
                        ].join(" ")}
                      >
                        <div className="relative w-[112px] h-[63px] rounded-[6px] overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#1a1a2e] to-[#0f3460]">
                          <img src={thumbnailUrl(r.videoId)} alt="" className="w-full h-full object-cover" loading="lazy" />
                          {r.durationMs > 0 && (
                            <span className="absolute bottom-1 right-1 text-[10px] font-medium px-[5px] py-[1px] rounded-[4px] bg-black/70 text-white">
                              {formatDuration(r.durationMs)}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate" title={r.rawTitle}>
                            {r.title || r.rawTitle}
                          </div>
                          <div className="text-[12px] text-[var(--text-muted)] truncate">
                            {r.artist}
                            {r.channel && r.channel !== r.artist && <span className="opacity-70"> · {r.channel}</span>}
                          </div>
                          <div className="flex items-center gap-1 mt-1 min-h-[18px]">
                            {inLibrary && (
                              <span className="text-[10.5px] px-2 py-[1px] rounded-full bg-[var(--bg)] text-[var(--text-secondary)]">In library</span>
                            )}
                            {hint === "synced" && (
                              <span
                                className="text-[10.5px] px-2 py-[1px] rounded-full bg-[var(--theme-light)] text-[var(--theme-text)]"
                                title="LRCLIB has timed lyrics for this length — it arrives with line timings"
                              >
                                Timed lyrics
                              </span>
                            )}
                            {hint === "lyrics" && (
                              <span
                                className="text-[10.5px] px-2 py-[1px] rounded-full bg-[var(--bg)] text-[var(--text-muted)]"
                                title="LRCLIB has lyrics, but not timed for this length (another version?) — timing comes from alignment"
                              >
                                Lyrics
                              </span>
                            )}
                            {hint === "checking" && (
                              <span className="text-[10.5px] text-[var(--text-muted)] opacity-70">checking lyrics…</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={[
                            "flex flex-col justify-center gap-1 flex-shrink-0 transition-opacity",
                            i === selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          ].join(" ")}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addResult(r);
                            }}
                            disabled={adding === r.videoId}
                            className="px-3 py-[5px] rounded-[7px] bg-[var(--accent)] text-white text-[12px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none disabled:opacity-50"
                          >
                            {inLibrary ? "Open" : adding === r.videoId ? "Adding…" : "Add"}
                          </button>
                          {!inLibrary && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                editFirst(r);
                              }}
                              className="px-3 py-[4px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            >
                              Edit first
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Preview card (link) */}
            {status === "done" && metadata && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden animate-fade-up mt-4">
                {/* Thumbnail */}
                <div className="relative w-full h-[200px] bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] group">
                  <img
                    src={metadata.thumbnail_url}
                    alt={metadata.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={metadata.youtube_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="#111"
                        style={{ marginLeft: 2 }}
                      >
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </a>
                  </div>
                </div>

                {/* Body */}
                <div className="p-5">
                  <div className="text-[16px] font-medium tracking-[-0.2px] mb-1">
                    {metadata.title}
                  </div>
                  <div className="text-[13px] text-[var(--text-muted)] mb-4">
                    {metadata.author}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleContinue}
                      className="flex items-center gap-[6px] px-5 py-[9px] rounded-[9px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
                    >
                      Continue to edit
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={handleClear}
                      className="px-[18px] py-[9px] rounded-[9px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
                    >
                      Start over
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
