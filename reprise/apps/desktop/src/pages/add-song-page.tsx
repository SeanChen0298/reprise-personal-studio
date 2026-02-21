import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";

export function AddSongPage() {
  const navigate = useNavigate();
  const draft = useSongStore((s) => s.importDraft);
  const setImportDraft = useSongStore((s) => s.setImportDraft);
  const addSong = useSongStore((s) => s.addSong);

  // Redirect if no draft (user navigated here directly)
  useEffect(() => {
    if (!draft) navigate("/import", { replace: true });
  }, [draft, navigate]);

  const [title, setTitle] = useState(draft?.title ?? "");
  const [artist, setArtist] = useState(draft?.artist ?? "");
  const [bpm, setBpm] = useState(draft?.bpm ?? "");
  const [language, setLanguage] = useState(draft?.language ?? "");
  const [tags, setTags] = useState<string[]>(draft?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const tagsWrapRef = useRef<HTMLDivElement>(null);

  // Sync fields when draft changes (in case of remount)
  useEffect(() => {
    if (draft) {
      setTitle(draft.title);
      setArtist(draft.artist);
      setBpm(draft.bpm);
      setLanguage(draft.language);
      setTags(draft.tags);
      setNotes(draft.notes);
    }
  }, [draft]);

  function addTag(raw: string) {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  async function handleSave() {
    if (!draft || !title.trim()) return;
    setSaving(true);

    const song = addSong({
      title: title.trim(),
      artist: artist.trim(),
      youtube_url: draft.metadata.youtube_url,
      thumbnail_url: draft.metadata.thumbnail_url,
      bpm: bpm ? parseInt(bpm, 10) : undefined,
      language: language.trim() || undefined,
      tags,
      notes: notes.trim() || undefined,
      user_id: undefined,
    });

    // Keep the draft so the lyrics page can read its lyrics field
    setSaving(false);
    setSaved(true);
    setTimeout(() => navigate(`/lyrics/${song.id}`), 800);
  }

  function handleDiscard() {
    setImportDraft(null);
    navigate("/library");
  }

  if (!draft) return null;

  const { metadata } = draft;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => navigate("/import")}
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
            Back to Import
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              className="px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saved || !title.trim()}
              className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
                  Save song
                </>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-7 py-8">
          <div className="max-w-[720px] mx-auto animate-fade-up">
            {/* Heading */}
            <h1 className="font-serif text-[24px] tracking-[-0.5px] mb-1">
              Add Song
            </h1>
            <p className="text-[13.5px] text-[var(--text-muted)] font-light mb-6">
              Review and edit the details before adding to your library.
            </p>

            {/* Source badge */}
            <div className="inline-flex items-center gap-[6px] text-[11.5px] font-medium text-[var(--theme-text)] bg-[var(--theme-light)] px-3 py-[5px] rounded-full mb-6">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              Imported from YouTube
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-[220px_1fr] gap-7 mb-7">
              {/* Thumbnail */}
              <div className="flex flex-col gap-2.5">
                <div className="w-[220px] h-[220px] rounded-[var(--radius)] overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] relative group cursor-pointer">
                  {metadata.thumbnail_url && (
                    <img
                      src={metadata.thumbnail_url}
                      alt={metadata.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-[6px] opacity-0 group-hover:opacity-100 transition-opacity rounded-[var(--radius)]">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                    <span className="text-[11.5px] font-medium text-white">
                      Replace thumbnail
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] text-center">
                  Click to upload a custom image, or keep the YouTube thumbnail.
                </p>
              </div>

              {/* Fields */}
              <div className="flex flex-col gap-4">
                {/* Title */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                    Song title
                    <span className="text-red-500 ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Prema"
                    className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                  />
                </div>

                {/* Artist */}
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                    Artist
                  </label>
                  <input
                    type="text"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="e.g. Fujii Kaze"
                    className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                  />
                </div>

                {/* BPM + Language row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                      BPM
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={300}
                      value={bpm}
                      onChange={(e) => setBpm(e.target.value)}
                      placeholder="e.g. 120"
                      className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                    />
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Beats per minute (optional)
                    </span>
                  </div>

                  <div className="flex flex-col gap-[5px]">
                    <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                      Language
                    </label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="e.g. Japanese"
                      className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section divider */}
            <div className="flex items-center gap-2 my-4">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                Additional details
              </span>
              <div className="flex-1 h-px bg-[var(--border-subtle)]" />
            </div>

            <div className="flex flex-col gap-4 mt-4">
              {/* Tags */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                  Tags
                </label>
                <div
                  ref={tagsWrapRef}
                  onClick={() =>
                    tagsWrapRef.current
                      ?.querySelector<HTMLInputElement>("input")
                      ?.focus()
                  }
                  className="flex flex-wrap gap-[6px] px-[10px] py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] min-h-[38px] cursor-text focus-within:border-[var(--theme)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all"
                >
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[5px] bg-[#F0F0F0] text-[12.5px] font-medium text-[var(--text-primary)]"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="flex items-center text-[var(--text-muted)] hover:text-red-600 transition-colors bg-transparent border-none cursor-pointer"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder={tags.length === 0 ? "Add a tag..." : ""}
                    className="border-none outline-none bg-transparent font-sans text-[13px] text-[var(--text-primary)] flex-1 min-w-[80px] placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Press Enter to add. Tags help you filter songs later.
                </span>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any personal notes about this song (vocal range, difficulty, etc.)"
                  rows={3}
                  className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)] resize-y"
                />
              </div>

              {/* YouTube URL (read-only) */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
                  YouTube URL
                </label>
                <input
                  type="url"
                  value={metadata.youtube_url}
                  readOnly
                  className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] font-sans text-[13.5px] outline-none cursor-not-allowed"
                />
                <span className="text-[11px] text-[var(--text-muted)]">
                  Source link (read-only)
                </span>
              </div>
            </div>

            {/* Bottom actions */}
            <div className="flex items-center justify-between pt-5 mt-6 border-t border-[var(--border-subtle)]">
              <div>
                {/* Placeholder for future Audio setup button */}
                <button className="flex items-center gap-[6px] px-4 py-2 rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[#F0F0F0] transition-all">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                  </svg>
                  Audio setup
                </button>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || saved || !title.trim()}
                className="flex items-center gap-[6px] px-[22px] py-[9px] rounded-[9px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
                    Save to library
                  </>
                )}
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Save toast */}
      {saved && (
        <div className="fixed bottom-7 left-1/2 -translate-x-1/2 bg-[var(--accent)] text-white px-5 py-[10px] rounded-[9px] text-[13px] font-medium flex items-center gap-2 shadow-xl animate-fade-up z-50">
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
          Song saved to library!
        </div>
      )}
    </div>
  );
}
