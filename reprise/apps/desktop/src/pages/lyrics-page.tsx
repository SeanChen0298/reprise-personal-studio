import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { useLineStore } from "../stores/line-store";
import type { Line } from "../types/song";

type EditLine = { id: string; text: string };

function parseLyricsToLines(raw: string): EditLine[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((text) => ({ id: crypto.randomUUID(), text }));
}

function buildLines(editLines: EditLine[], songId: string): Line[] {
  const now = new Date().toISOString();
  return editLines.map((l, i) => ({
    id: l.id,
    song_id: songId,
    text: l.text,
    status: "not_started" as const,
    order: i,
    updated_at: now,
  }));
}

export function LyricsPage() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();

  const song = useSongStore((s) => s.songs.find((s) => s.id === songId));
  const draft = useSongStore((s) => s.importDraft);
  const setImportDraft = useSongStore((s) => s.setImportDraft);

  const existingLines = useLineStore((s) =>
    songId ? (s.linesBySong[songId] ?? []) : []
  );
  const setLines = useLineStore((s) => s.setLines);

  const [localLines, setLocalLines] = useState<EditLine[]>([]);
  const [mode, setMode] = useState<"lines" | "bulk">("lines");
  const [bulkText, setBulkText] = useState("");
  const [saved, setSaved] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Input refs for auto-focus
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if song not found
  useEffect(() => {
    if (!song && songId) navigate("/library", { replace: true });
  }, [song, songId, navigate]);

  // Initialize lines: prefer existing stored lines, fall back to draft lyrics
  useEffect(() => {
    if (!songId) return;
    if (existingLines.length > 0) {
      const sorted = [...existingLines].sort((a, b) => a.order - b.order);
      setLocalLines(sorted.map((l) => ({ id: l.id, text: l.text })));
    } else if (draft?.lyrics) {
      setLocalLines(parseLyricsToLines(draft.lyrics));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  function handleSave() {
    if (!songId) return;
    const lines = buildLines(localLines, songId);
    setLines(songId, lines);
    setImportDraft(null);
    setSaved(true);
    setTimeout(() => navigate("/library"), 900);
  }

  function handleDiscard() {
    setImportDraft(null);
    navigate("/library");
  }

  function updateLineText(id: string, text: string) {
    setLocalLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, text } : l))
    );
  }

  function removeLine(id: string) {
    setLocalLines((prev) => prev.filter((l) => l.id !== id));
  }

  function addLine(afterIndex?: number) {
    const newLine: EditLine = { id: crypto.randomUUID(), text: "" };
    if (afterIndex === undefined) {
      setLocalLines((prev) => [...prev, newLine]);
      // Focus happens via useEffect watching localLines length
    } else {
      setLocalLines((prev) => {
        const next = [...prev];
        next.splice(afterIndex + 1, 0, newLine);
        return next;
      });
    }
    // Focus the new input on next render
    setTimeout(() => {
      const idx = afterIndex === undefined ? localLines.length : afterIndex + 1;
      inputRefs.current[idx]?.focus();
    }, 30);
  }

  function handleLineKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    id: string
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLine(index);
    } else if (
      e.key === "Backspace" &&
      localLines[index].text === "" &&
      localLines.length > 1
    ) {
      e.preventDefault();
      removeLine(id);
      setTimeout(() => {
        inputRefs.current[Math.max(0, index - 1)]?.focus();
      }, 20);
    }
  }

  function applyBulkText() {
    const parsed = parseLyricsToLines(bulkText);
    if (parsed.length === 0) return;
    setLocalLines(parsed);
    setMode("lines");
  }

  // Drag handlers
  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...localLines];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    setLocalLines(next);
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  const bulkLineCount = bulkText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;

  if (!song) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/add-song`)}
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
              Song Details
            </button>
            <span className="text-[11.5px] text-[var(--text-muted)] bg-[var(--bg)] border border-[var(--border-subtle)] px-[9px] py-[2px] rounded-full">
              {localLines.length} {localLines.length === 1 ? "line" : "lines"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              className="px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            >
              Discard
            </button>
            <button
              disabled
              title="Coming soon"
              className="flex items-center gap-[5px] px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Set timestamps
            </button>
            <button
              onClick={handleSave}
              disabled={saved}
              className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {saved ? (
                <>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Saved!
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
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Save lyrics
                </>
              )}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-8 pb-16">
          <div
            className="max-w-[640px] mx-auto"
            style={{ animation: "fadeUp 0.4s ease both" }}
          >
            {/* Song header */}
            <div className="flex items-center gap-3.5 mb-5">
              <div className="w-12 h-12 rounded-[9px] overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] flex items-center justify-center">
                {song.thumbnail_url ? (
                  <img
                    src={song.thumbnail_url}
                    alt={song.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#93C5FD"
                    strokeWidth="1.5"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                )}
              </div>
              <div>
                <div className="font-serif text-[20px] tracking-[-0.4px]">
                  {song.title}
                </div>
                <div className="text-[12.5px] text-[var(--text-muted)]">
                  {song.artist}
                </div>
              </div>
            </div>

            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed mb-5 font-light">
              Add lyrics line by line. Each line becomes a separate practice
              segment you can drill individually.
            </p>

            {/* Mode tabs */}
            <div className="flex border-b border-[var(--border)] mb-5">
              <button
                onClick={() => setMode("lines")}
                className={[
                  "flex items-center gap-[5px] px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors bg-transparent border-x-0 border-t-0 cursor-pointer",
                  mode === "lines"
                    ? "text-[var(--text-primary)] border-b-[var(--accent)]"
                    : "text-[var(--text-muted)] border-b-transparent hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                Line by line
              </button>
              <button
                onClick={() => setMode("bulk")}
                className={[
                  "flex items-center gap-[5px] px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors bg-transparent border-x-0 border-t-0 cursor-pointer",
                  mode === "bulk"
                    ? "text-[var(--text-primary)] border-b-[var(--accent)]"
                    : "text-[var(--text-muted)] border-b-transparent hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
                Bulk paste
              </button>
            </div>

            {/* Line by line panel */}
            {mode === "lines" && (
              <div>
                <div className="flex flex-col gap-1">
                  {localLines.map((line, index) => (
                    <div
                      key={line.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={[
                        "flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border rounded-[9px] transition-all",
                        dragOverIndex === index && dragIndex !== index
                          ? "border-[var(--theme)] shadow-[0_0_0_3px_rgba(37,99,235,0.09)]"
                          : "border-[var(--border)]",
                        dragIndex === index ? "opacity-40" : "",
                        "focus-within:border-[var(--theme)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]",
                      ].join(" ")}
                    >
                      {/* Drag handle */}
                      <span className="text-[var(--text-muted)] cursor-grab flex items-center flex-shrink-0 hover:text-[var(--text-secondary)] transition-colors">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <circle cx="9" cy="5" r="1.5" />
                          <circle cx="15" cy="5" r="1.5" />
                          <circle cx="9" cy="12" r="1.5" />
                          <circle cx="15" cy="12" r="1.5" />
                          <circle cx="9" cy="19" r="1.5" />
                          <circle cx="15" cy="19" r="1.5" />
                        </svg>
                      </span>

                      {/* Line number */}
                      <span className="w-[22px] text-center text-[11px] font-medium text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                        {index + 1}
                      </span>

                      {/* Text input */}
                      <input
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        type="text"
                        value={line.text}
                        onChange={(e) => updateLineText(line.id, e.target.value)}
                        onKeyDown={(e) => handleLineKeyDown(e, index, line.id)}
                        placeholder={`Line ${index + 1}…`}
                        className="flex-1 border-none outline-none font-sans text-[14px] text-[var(--text-primary)] bg-transparent min-w-0 placeholder:text-[var(--text-muted)]"
                      />

                      {/* Delete button */}
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="w-[26px] h-[26px] rounded-[5px] border-none bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-red-600 hover:bg-[#FEF2F2] transition-colors flex-shrink-0"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add line row */}
                <button
                  type="button"
                  onClick={() => addLine()}
                  className="w-full mt-1 flex items-center justify-center px-3 py-[10px] border-2 border-dashed border-[var(--border)] rounded-[9px] cursor-pointer hover:border-[var(--theme)] hover:bg-[var(--theme-light)] transition-all bg-transparent group"
                >
                  <span className="flex items-center gap-[5px] text-[12.5px] font-medium text-[var(--text-muted)] group-hover:text-[var(--theme-text)] transition-colors">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add line
                  </span>
                </button>
              </div>
            )}

            {/* Bulk paste panel */}
            {mode === "bulk" && (
              <div>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={
                    "Paste full lyrics here...\n\nEach line will become a separate lyric line.\nEmpty lines will be ignored."
                  }
                  className="w-full min-h-[320px] px-4 py-4 rounded-[var(--radius)] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[14px] leading-[1.8] outline-none resize-y transition-all focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] placeholder:text-[var(--text-muted)]"
                />
                <p className="text-[11.5px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  Tip: Paste lyrics from a lyrics website. Each newline becomes a
                  separate line. Empty lines are ignored.
                </p>
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-[5px] text-[12.5px] text-[var(--text-secondary)]">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M4 6h16M4 12h16M4 18h10" />
                    </svg>
                    {bulkLineCount} {bulkLineCount === 1 ? "line" : "lines"}{" "}
                    detected
                  </div>
                  <button
                    onClick={applyBulkText}
                    disabled={bulkLineCount === 0}
                    className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
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
        <div className="fixed bottom-7 left-1/2 -translate-x-1/2 bg-[var(--accent)] text-white px-5 py-[10px] rounded-[9px] text-[13px] font-medium flex items-center gap-2 shadow-xl z-50">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Lyrics saved!
        </div>
      )}
    </div>
  );
}
