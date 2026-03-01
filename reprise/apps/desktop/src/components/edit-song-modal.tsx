import { useRef, useState } from "react";
import type { Song } from "../types/song";

interface Props {
  open: boolean;
  song: Song;
  onSave: (data: { title: string; artist: string; bpm?: number; language?: string; tags: string[]; notes?: string }) => void;
  onClose: () => void;
}

export function EditSongModal({ open, song, onSave, onClose }: Props) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const [bpm, setBpm] = useState(song.bpm?.toString() ?? "");
  const [language, setLanguage] = useState(song.language ?? "");
  const [tags, setTags] = useState<string[]>(song.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(song.notes ?? "");
  const tagsWrapRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

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

  function handleSave() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      artist: artist.trim(),
      bpm: bpm ? parseInt(bpm, 10) : undefined,
      language: language.trim() || undefined,
      tags,
      notes: notes.trim() || undefined,
    });
  }

  const inputClass =
    "w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg)] rounded-[12px] border border-[var(--border)] shadow-2xl w-full max-w-[520px] max-h-[85vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="font-serif text-[20px] tracking-[-0.3px] mb-1">Edit Song Details</h2>
          <p className="text-[13px] text-[var(--text-muted)]">Update song metadata.</p>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">
              Song title<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prema" className={inputClass} />
          </div>

          {/* Artist */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">Artist</label>
            <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Fujii Kaze" className={inputClass} />
          </div>

          {/* BPM + Language */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-[5px]">
              <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">BPM</label>
              <input type="number" min={20} max={300} value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="e.g. 120" className={inputClass} />
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">Language</label>
              <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. Japanese" className={inputClass} />
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">Tags</label>
            <div
              ref={tagsWrapRef}
              onClick={() => tagsWrapRef.current?.querySelector<HTMLInputElement>("input")?.focus()}
              className="flex flex-wrap gap-[6px] px-[10px] py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] min-h-[38px] cursor-text focus-within:border-[var(--theme)] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all"
            >
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 px-[9px] py-[3px] rounded-[5px] bg-[#F0F0F0] text-[12.5px] font-medium text-[var(--text-primary)]">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="flex items-center text-[var(--text-muted)] hover:text-red-600 transition-colors bg-transparent border-none cursor-pointer">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
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
            <span className="text-[11px] text-[var(--text-muted)]">Press Enter to add.</span>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[12.5px] font-medium text-[var(--text-secondary)]">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any personal notes about this song..."
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button
            onClick={onClose}
            className="px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="px-5 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
