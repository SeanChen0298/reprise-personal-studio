import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import {
  fetchLyricsForLanguage,
  SUBTITLE_LANGUAGES,
  buildSongFolder,
} from "../lib/audio-download";
import type { Line } from "../types/song";

type Mode = "lines" | "bulk";

export function LyricsInputPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const storedLines = useSongStore((s) => (id ? s.lines[id] : undefined)) ?? [];
  const setLines = useSongStore((s) => s.setLines);

  const [mode, setMode] = useState<Mode>("lines");
  const [editLines, setEditLines] = useState<{ id: string; text: string }[]>([]);
  const [bulkText, setBulkText] = useState("");
  const [saved, setSaved] = useState(false);

  // Language fetch state
  const [lyricsLang, setLyricsLang] = useState<string>(
    song?.language
      ? SUBTITLE_LANGUAGES.find(
          (l) => l.label.toLowerCase() === song.language?.toLowerCase()
        )?.code ?? "en"
      : "en"
  );
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Initialize from stored lines
  useEffect(() => {
    if (storedLines.length > 0) {
      setEditLines(
        storedLines
          .sort((a, b) => a.order - b.order)
          .map((l) => ({ id: l.id, text: l.text }))
      );
    } else {
      setEditLines([{ id: crypto.randomUUID(), text: "" }]);
    }
  }, []);

  if (!song || !id) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  const bulkLineCount = bulkText
    .split("\n")
    .filter((l) => l.trim()).length;

  function handleAddLine() {
    setEditLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: "" },
    ]);
  }

  function handleInsertAfter(index: number) {
    setEditLines((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, { id: crypto.randomUUID(), text: "" });
      return next;
    });
  }

  function handleDeleteLine(index: number) {
    setEditLines((prev) => {
      if (prev.length <= 1) return [{ id: crypto.randomUUID(), text: "" }];
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleLineChange(index: number, text: string) {
    setEditLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, text } : line))
    );
  }

  function handleApplyBulk() {
    const lines = bulkText
      .split("\n")
      .filter((l) => l.trim())
      .map((text) => ({ id: crypto.randomUUID(), text: text.trim() }));
    if (lines.length === 0) return;
    setEditLines(lines);
    setMode("lines");
  }

  async function handleFetchLyrics() {
    if (!song?.youtube_url) return;
    setFetching(true);
    setFetchError(null);

    try {
      const songFolder = song.audio_folder ?? buildSongFolder(song.title, song.artist);
      const lyrics = await fetchLyricsForLanguage(
        song.youtube_url,
        songFolder,
        lyricsLang
      );
      setEditLines(
        lyrics.map((text) => ({ id: crypto.randomUUID(), text }))
      );
      setMode("lines");
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch lyrics"
      );
    } finally {
      setFetching(false);
    }
  }

  function handleSave() {
    const now = new Date().toISOString();
    const newLines: Line[] = editLines
      .filter((l) => l.text.trim())
      .map((l, i) => {
        // Preserve existing line data if possible
        const existing = storedLines.find((sl) => sl.id === l.id);
        return {
          id: l.id,
          song_id: id!,
          text: l.text.trim(),
          order: i,
          start_ms: existing?.start_ms,
          end_ms: existing?.end_ms,
          status: existing?.status ?? ("not_started" as const),
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
      });

    setLines(id!, newLines);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate(`/song/${id}`)}
              className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Song Detail
            </button>
            <span className="text-[11.5px] text-[var(--text-muted)] bg-[var(--bg)] border border-[var(--border-subtle)] px-2.5 py-0.5 rounded-full">
              {editLines.filter((l) => l.text.trim()).length} lines
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Save lyrics
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-7">
          <div className="max-w-[640px] mx-auto animate-fade-up">
            {/* Song header */}
            <div className="flex items-center gap-3.5 mb-5">
              <div className="w-12 h-12 rounded-[9px] bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] flex-shrink-0 flex items-center justify-center overflow-hidden">
                {song.thumbnail_url ? (
                  <img src={song.thumbnail_url} alt={song.title} className="w-full h-full object-cover" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#93C5FD" strokeWidth="1.5">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                )}
              </div>
              <div>
                <div className="font-serif text-[20px] tracking-[-0.4px]">{song.title}</div>
                <div className="text-[12.5px] text-[var(--text-muted)]">{song.artist}</div>
              </div>
            </div>

            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed font-light mb-5">
              Add lyrics line by line. Each line will become a separate practice segment you can drill individually.
            </p>

            {/* Import from YouTube section */}
            {song.youtube_url && (
              <div className="flex items-center gap-2 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] mb-5">
                <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)] flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Import from YouTube
                </div>
                <select
                  value={lyricsLang}
                  onChange={(e) => setLyricsLang(e.target.value)}
                  className="px-2.5 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-[var(--bg)] text-[12.5px] text-[var(--text-primary)] font-sans outline-none focus:border-[var(--theme)] transition-colors cursor-pointer"
                >
                  {SUBTITLE_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleFetchLyrics}
                  disabled={fetching}
                  className="flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white text-[12px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 flex-shrink-0"
                >
                  {fetching ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Fetching...
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      Fetch lyrics
                    </>
                  )}
                </button>
                {fetchError && (
                  <span className="text-[11px] text-red-500 ml-1 truncate" title={fetchError}>
                    {fetchError}
                  </span>
                )}
              </div>
            )}

            {/* Mode tabs */}
            <div className="flex gap-0 border-b border-[var(--border)] mb-5">
              <button
                onClick={() => setMode("lines")}
                className={[
                  "flex items-center gap-[5px] px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors bg-transparent cursor-pointer",
                  mode === "lines"
                    ? "text-[var(--text-primary)] border-[var(--accent)]"
                    : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                Line by line
              </button>
              <button
                onClick={() => setMode("bulk")}
                className={[
                  "flex items-center gap-[5px] px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors bg-transparent cursor-pointer",
                  mode === "bulk"
                    ? "text-[var(--text-primary)] border-[var(--accent)]"
                    : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                </svg>
                Bulk paste
              </button>
            </div>

            {/* Line by line mode */}
            {mode === "lines" && (
              <div>
                <div className="flex flex-col gap-1">
                  {editLines.map((line, i) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[9px] focus-within:border-[var(--theme)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all"
                    >
                      <div className="text-[var(--text-muted)] cursor-grab flex-shrink-0 flex items-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" />
                          <circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" />
                        </svg>
                      </div>
                      <span className="w-[22px] text-center text-[11px] font-medium text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={line.text}
                        onChange={(e) => handleLineChange(i, e.target.value)}
                        placeholder="Enter lyric line..."
                        className="flex-1 border-none outline-none bg-transparent font-sans text-[14px] text-[var(--text-primary)] min-w-0 placeholder:text-[var(--text-muted)]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleInsertAfter(i);
                          }
                        }}
                      />
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => handleInsertAfter(i)}
                          title="Insert line below"
                          className="w-[26px] h-[26px] rounded-[5px] border-none bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteLine(i)}
                          title="Delete line"
                          className="w-[26px] h-[26px] rounded-[5px] border-none bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-red-600 hover:bg-red-50 transition-all"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add line button */}
                <button
                  onClick={handleAddLine}
                  className="w-full flex items-center justify-center gap-[5px] py-2.5 mt-1 border-2 border-dashed border-[var(--border)] rounded-[9px] bg-transparent cursor-pointer text-[12.5px] font-medium text-[var(--text-muted)] hover:border-[var(--theme)] hover:bg-[var(--theme-light)] hover:text-[var(--theme-text)] transition-all"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add line
                </button>
              </div>
            )}

            {/* Bulk paste mode */}
            {mode === "bulk" && (
              <div>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"Paste full lyrics here...\n\nEach line will become a separate lyric line.\nEmpty lines will be ignored."}
                  rows={14}
                  className="w-full min-h-[320px] p-4 rounded-[var(--radius)] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[14px] leading-[1.8] outline-none resize-y focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                />
                <p className="text-[11.5px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  Tip: Paste lyrics from a lyrics website. Each newline becomes a separate line. Empty lines are ignored.
                </p>
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-[5px] text-[12.5px] text-[var(--text-secondary)]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 6h16M4 12h16M4 18h10" />
                    </svg>
                    {bulkLineCount} lines detected
                  </div>
                  <button
                    onClick={handleApplyBulk}
                    disabled={bulkLineCount === 0}
                    className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    Apply to editor
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Save toast */}
      {saved && (
        <div className="fixed bottom-7 left-1/2 -translate-x-1/2 bg-[var(--accent)] text-white px-5 py-[10px] rounded-[9px] text-[13px] font-medium flex items-center gap-2 shadow-xl animate-fade-up z-50">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Lyrics saved!
        </div>
      )}
    </div>
  );
}
