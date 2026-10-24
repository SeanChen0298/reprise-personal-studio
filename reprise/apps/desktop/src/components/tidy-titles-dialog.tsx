import { useEffect, useMemo, useState } from "react";
import { parseSongTitle } from "../lib/suggestions";
import type { Song } from "../types/song";

export interface TitleFix {
  songId: string;
  oldTitle: string;
  oldArtist: string;
  title: string;
  artist: string;
}

/** Songs whose stored title/artist look like raw YouTube titles, with the cleaned version. */
export function findTitleFixes(songs: Song[]): TitleFix[] {
  const fixes: TitleFix[] = [];
  for (const s of songs) {
    if (!s.youtube_url) continue;
    const { title, artist } = parseSongTitle(s.title, s.artist ?? "");
    if (!title || (title === s.title && artist === s.artist)) continue;
    fixes.push({ songId: s.id, oldTitle: s.title, oldArtist: s.artist ?? "", title, artist });
  }
  return fixes;
}

export function TidyTitlesDialog({
  open,
  songs,
  onApply,
  onClose,
}: {
  open: boolean;
  songs: Song[];
  onApply: (fixes: TitleFix[]) => Promise<void>;
  onClose: () => void;
}) {
  const proposed = useMemo(() => (open ? findTitleFixes(songs) : []), [open, songs]);
  const [rows, setRows] = useState<(TitleFix & { checked: boolean })[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setRows(proposed.map((f) => ({ ...f, checked: true })));
  }, [open, proposed]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = rows.filter((r) => r.checked && r.title.trim());
  const update = (i: number, patch: Partial<TitleFix & { checked: boolean }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-[var(--surface)] rounded-[12px] border border-[var(--border)] shadow-2xl w-full max-w-[720px] max-h-[80vh] flex flex-col animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-[var(--border-subtle)]">
          <h2 className="text-[16px] font-medium tracking-[-0.2px]">Tidy up song titles</h2>
          <p className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-relaxed">
            These look like raw YouTube titles. Check the new title and artist (you can edit them), untick any you
            want to keep as they are, then apply.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {rows.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)] py-8 text-center">All titles already look clean.</p>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.songId}
                className={`flex items-start gap-3 py-[10px] border-b border-[var(--border-subtle)] last:border-b-0 ${
                  r.checked ? "" : "opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) => update(i, { checked: e.target.checked })}
                  className="mt-[7px] w-4 h-4 accent-[var(--theme)] cursor-pointer flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] text-[var(--text-muted)] truncate" title={`${r.oldTitle} — ${r.oldArtist}`}>
                    {r.oldTitle} <span className="opacity-60">— {r.oldArtist}</span>
                  </div>
                  <div className="flex gap-2 mt-[4px]">
                    <input
                      value={r.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      disabled={!r.checked}
                      className="flex-[3] min-w-0 px-2 py-[4px] rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--theme)]"
                    />
                    <input
                      value={r.artist}
                      onChange={(e) => update(i, { artist: e.target.value })}
                      disabled={!r.checked}
                      className="flex-[2] min-w-0 px-2 py-[4px] rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--theme)]"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-[12px] text-[var(--text-muted)]">
            {rows.length > 0 && `${selected.length} of ${rows.length} selected`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-[7px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[13px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await onApply(selected.map(({ checked: _, ...f }) => ({ ...f, title: f.title.trim(), artist: f.artist.trim() })));
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || selected.length === 0}
              className="px-4 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : `Rename ${selected.length || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
