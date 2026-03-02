import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { AudioPlayer } from "../components/audio-player";
import { useSongStore } from "../stores/song-store";
import { STATUS_CONFIG, formatMs } from "../lib/status-config";
import { EditSongModal } from "../components/edit-song-modal";
import { ConfirmDialog } from "../components/confirm-dialog";

export function SongDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const updateSong = useSongStore((s) => s.updateSong);
  const removeSong = useSongStore((s) => s.removeSong);
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));
  const lines = useMemo(
    () => (rawLines ? [...rawLines].sort((a, b) => a.order - b.order) : []),
    [rawLines]
  );
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  const masteredCount = lines.filter((l) => l.status === "mastered").length;
  const learningCount = lines.filter((l) => l.status === "learning").length;
  const notStartedCount = lines.filter((l) => l.status === "not_started").length;
  const masteryPct = lines.length > 0 ? Math.round((masteredCount / lines.length) * 100) : song.mastery;
  const hasAudio = song.download_status === "done" && song.audio_path;

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => navigate("/library")}
            className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Library
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit details
            </button>
            <button
              onClick={() => navigate(`/song/${id}/lyrics`)}
              className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Edit lyrics
            </button>
            <button
              onClick={() => navigate(`/song/${id}/timestamps`)}
              className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              Timestamps
            </button>
            <button
              onClick={() => navigate(`/song/${id}/setup`)}
              className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
              Audio setup
            </button>
            {hasAudio && (
              <button
                onClick={() => navigate(`/song/${id}/practice`)}
                className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Practice
              </button>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-7">
          <div className="max-w-[760px] mx-auto animate-fade-up">
            {/* Song Hero */}
            <div className="flex gap-5 mb-7">
              <div className="w-[100px] h-[100px] rounded-[var(--radius)] bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] flex-shrink-0 flex items-center justify-center overflow-hidden relative group cursor-pointer">
                {song.thumbnail_url ? (
                  <img src={song.thumbnail_url} alt={song.title} className="w-full h-full object-cover" />
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                )}
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-[42px] h-[42px] rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#111" style={{ marginLeft: 2 }}>
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-center gap-[6px] flex-1">
                <span className="text-[12.5px] text-[var(--text-muted)]">{song.artist}</span>
                <div className="font-serif text-[24px] tracking-[-0.5px]">{song.title}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-medium px-2.5 py-[3px] rounded-full bg-[var(--theme-light)] text-[var(--theme-text)] flex items-center gap-1">
                    {masteryPct}% mastered
                  </span>
                  {lines.length > 0 && (
                    <span className="text-[11px] font-medium px-2.5 py-[3px] rounded-full bg-[var(--accent-light)] text-[var(--text-secondary)] flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 6h16M4 12h16M4 18h10" />
                      </svg>
                      {lines.length} lines
                    </span>
                  )}
                  {song.bpm && (
                    <span className="text-[11px] font-medium px-2.5 py-[3px] rounded-full bg-[#F5F3FF] text-[#6D28D9]">
                      {song.bpm} BPM
                    </span>
                  )}
                  {song.duration_ms && (
                    <span className="text-[11.5px] text-[var(--text-muted)]">
                      {formatMs(song.duration_ms)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Section */}
            {lines.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em]">
                    Overall mastery
                  </span>
                  <span className="text-[13px] font-medium text-[var(--theme-text)]">
                    {masteryPct}%
                  </span>
                </div>
                <div className="h-[6px] bg-[var(--border-subtle)] rounded-[3px] overflow-hidden mb-2">
                  <div
                    className="h-full rounded-[3px] bg-gradient-to-r from-[var(--theme)] to-[#93C5FD] transition-[width] duration-500"
                    style={{ width: `${masteryPct}%` }}
                  />
                </div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-[5px] text-[11.5px] text-[var(--text-muted)]">
                    <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
                    <span className="font-medium text-[var(--text-secondary)]">{masteredCount}</span> mastered
                  </div>
                  <div className="flex items-center gap-[5px] text-[11.5px] text-[var(--text-muted)]">
                    <span className="w-2 h-2 rounded-full bg-[var(--theme)]" />
                    <span className="font-medium text-[var(--text-secondary)]">{learningCount}</span> learning
                  </div>
                  <div className="flex items-center gap-[5px] text-[11.5px] text-[var(--text-muted)]">
                    <span className="w-2 h-2 rounded-full bg-[var(--border)]" />
                    <span className="font-medium text-[var(--text-secondary)]">{notStartedCount}</span> not started
                  </div>
                </div>
              </div>
            )}

            {/* Lines Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Lines
                </span>
                {lines.length > 0 && (
                  <span className="text-[10.5px] text-[var(--text-muted)] flex-shrink-0">
                    {lines.length} total
                  </span>
                )}
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              {lines.length === 0 ? (
                <div className="text-center py-12 bg-[var(--surface)] border-2 border-dashed border-[var(--border)] rounded-[var(--radius)]">
                  <div className="text-[var(--text-muted)] mb-3">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                      <path d="M4 6h16M4 12h16M4 18h10" />
                    </svg>
                  </div>
                  <div className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
                    No lyrics added yet
                  </div>
                  <p className="text-[12.5px] text-[var(--text-muted)] mb-4 leading-relaxed">
                    Add lyrics to create practice segments you can drill individually.
                  </p>
                  <button
                    onClick={() => navigate(`/song/${id}/lyrics`)}
                    className="inline-flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add lyrics
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {lines.map((line, i) => {
                    const cfg = STATUS_CONFIG[line.status];
                    return (
                      <div
                        key={line.id}
                        className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] border border-[var(--border)] rounded-[9px] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:border-[#C8C8C8] transition-all cursor-pointer"
                      >
                        <span className="w-6 text-center text-[11px] font-medium text-[var(--text-muted)] tabular-nums flex-shrink-0">
                          {i + 1}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{
                            background: cfg.dot,
                            border: line.status === "not_started" ? "1px solid #D1D1D1" : "none",
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] leading-[1.5] text-[var(--text-primary)] truncate">
                            {line.text}
                          </div>
                          {(line.start_ms != null && line.end_ms != null) && (
                            <div className="text-[10.5px] text-[var(--text-muted)] tabular-nums mt-0.5">
                              {formatMs(line.start_ms)} — {formatMs(line.end_ms)}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: cfg.tagBg, color: cfg.tagColor }}
                          >
                            {cfg.label}
                          </span>
                          <button className="w-7 h-7 rounded-[6px] bg-[var(--accent)] text-white flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Download prompt if no audio */}
            {!hasAudio && song.youtube_url && (
              <div className="flex items-start gap-2.5 p-3.5 bg-[var(--theme-light)] border border-[#BFDBFE] rounded-[9px] mt-6">
                <div className="text-[var(--theme-text)] flex-shrink-0 mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </div>
                <div className="flex-1 text-[12.5px] text-[var(--theme-text)] leading-relaxed">
                  <strong className="font-semibold">Audio not downloaded yet.</strong>{" "}
                  Go to{" "}
                  <button
                    onClick={() => navigate(`/song/${id}/setup`)}
                    className="underline font-medium bg-transparent border-none text-[var(--theme-text)] cursor-pointer"
                  >
                    Audio Setup
                  </button>{" "}
                  to download the reference audio from YouTube.
                </div>
              </div>
            )}

            {/* Danger zone */}
            <div className="mt-10 pt-5 border-t border-[var(--border-subtle)]">
              <button
                onClick={() => setShowDelete(true)}
                className="flex items-center gap-[5px] px-3.5 py-[6px] rounded-[7px] border-[1.5px] border-red-200 bg-transparent text-[12.5px] font-medium text-red-600 hover:border-red-400 hover:bg-red-50 transition-all cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Delete song
              </button>
            </div>
          </div>
        </main>

        {/* Audio Player (sticky bottom) */}
        {hasAudio && <AudioPlayer audioPath={song.audio_path!} />}
      </div>

      {/* Edit song modal */}
      <EditSongModal
        open={showEdit}
        song={song}
        onClose={() => setShowEdit(false)}
        onSave={(data) => {
          updateSong(id!, { ...data, updated_at: new Date().toISOString() });
          setShowEdit(false);
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDelete}
        title="Delete song"
        message={`Are you sure you want to delete "${song.title}"? This will remove all lyrics, annotations, and practice data. This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setShowDelete(false)}
        onConfirm={() => {
          removeSong(id!);
          navigate("/library");
        }}
      />
    </div>
  );
}
