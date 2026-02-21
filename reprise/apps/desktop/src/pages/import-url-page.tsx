import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { isValidYouTubeUrl, fetchYouTubeMetadata } from "../lib/youtube";
import type { YouTubeMetadata } from "../types/song";

type FetchStatus = "idle" | "loading" | "done" | "error";

export function ImportUrlPage() {
  const navigate = useNavigate();
  const setImportDraft = useSongStore((s) => s.setImportDraft);

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [metadata, setMetadata] = useState<YouTubeMetadata | null>(null);

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMsg("Please enter a YouTube URL.");
      return;
    }
    if (!isValidYouTubeUrl(trimmed)) {
      setErrorMsg("Please enter a valid YouTube URL (youtube.com or youtu.be).");
      return;
    }
    setErrorMsg("");
    setStatus("loading");
    setMetadata(null);

    try {
      const data = await fetchYouTubeMetadata(trimmed);
      setMetadata(data);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch video info.");
      setStatus("error");
    }
  }

  function handleContinue() {
    if (!metadata) return;
    setImportDraft({
      metadata,
      title: metadata.title,
      artist: metadata.author,
      bpm: "",
      language: "",
      tags: [],
      notes: "",
      lyrics: metadata.lyrics,
    });
    navigate("/add-song");
  }

  function handleClear() {
    setUrl("");
    setMetadata(null);
    setStatus("idle");
    setErrorMsg("");
  }

  const showError = errorMsg && (status === "error" || status === "idle");

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
          <div className="w-full max-w-[560px] animate-fade-up">
            <h1 className="font-serif text-[24px] tracking-[-0.5px] mb-1">
              Import from YouTube
            </h1>
            <p className="text-[13.5px] text-[var(--text-muted)] font-light mb-7 leading-relaxed">
              Paste a YouTube URL to fetch the song's metadata and thumbnail
              automatically.
            </p>

            {/* URL input row */}
            <div className="flex gap-2 mb-2">
              <div className="flex-1 relative flex items-center">
                <span className="absolute left-3 text-[var(--text-muted)] pointer-events-none flex items-center">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                </span>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={status === "loading"}
                  className={[
                    "w-full pl-[38px] pr-3 py-[10px] rounded-[9px] border-[1.5px] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all",
                    showError
                      ? "border-red-500 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.09)]"
                      : "border-[var(--border)] focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]",
                    status === "loading" ? "opacity-60 cursor-not-allowed" : "",
                  ].join(" ")}
                />
              </div>
              <button
                onClick={handleFetch}
                disabled={status === "loading"}
                className="flex items-center gap-[6px] px-5 py-[10px] rounded-[9px] bg-[var(--accent)] text-white text-[13.5px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {status === "loading" ? (
                  <>
                    <span className="w-[13px] h-[13px] border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Fetching
                  </>
                ) : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                      <polyline points="21 3 21 9 15 9" />
                    </svg>
                    Fetch
                  </>
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
                Supports youtube.com and youtu.be links.
              </p>
            )}

            {/* Loading */}
            {status === "loading" && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="w-9 h-9 border-[3px] border-[var(--border-subtle)] border-t-[var(--theme)] rounded-full animate-spin" />
                <div className="text-[13.5px] text-[var(--text-secondary)]">
                  Fetching video info...
                </div>
                <div className="text-[12px] text-[var(--text-muted)] text-center leading-relaxed">
                  Downloading metadata and thumbnail from YouTube.
                  <br />
                  This may take a few seconds.
                </div>
              </div>
            )}

            {/* Preview card */}
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
