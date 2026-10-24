import { useEffect, useState } from "react";
import { useSongStore } from "../stores/song-store";
import type { PitchStatus, AlignStatus, ChordStatus } from "../types/song";
import { useTaskQueueStore } from "../stores/task-queue-store";
import { backUpAndClearChordWork, readChordSettings, saveChordSettings } from "../lib/chord-analysis";
import { ConfirmDialog } from "./confirm-dialog";

/** Audio download, stems, pitch, chords and alignment for one song (the workspace's Setup drawer). */
export function SongSetupPanel({ songId: id }: { songId: string }) {
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const downloadSongAudio = useSongStore((s) => s.downloadSongAudio);
  const markStaleAnalysesAsFailed = useSongStore((s) => s.markStaleAnalysesAsFailed);
  const enqueue = useTaskQueueStore((s) => s.enqueue);
  const queueTasks = useTaskQueueStore((s) => s.tasks);
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));

  const [alignModel, setAlignModel] = useState("medium");

  // Per-song chord analysis option: analyse on separated drums / bass / other.
  const songFolder = song?.audio_folder;
  const [separateDrums, setSeparateDrums] = useState(false);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  useEffect(() => {
    if (!songFolder) return;
    let cancelled = false;
    readChordSettings(songFolder).then((s) => { if (!cancelled) setSeparateDrums(s.use_stems === true); });
    return () => { cancelled = true; };
  }, [songFolder]);

  useEffect(() => {
    markStaleAnalysesAsFailed();
  }, [markStaleAnalysesAsFailed]);

  // ── Early return — all hooks are above this line ───────────────────────────
  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  // ── Derived values (not hooks, safe after early return) ────────────────────
  const isDownloaded = song.download_status === "done";
  const isDownloading = song.download_status === "downloading";
  const hasError = song.download_status === "error";

  const stemsDone = song.stem_status === "done";
  const stemsProcessing = song.stem_status === "processing";
  const stemsError = song.stem_status === "error";

  const pitchStatus: PitchStatus = song.pitch_status ?? "idle";
  const pitchDone = pitchStatus === "done";
  const pitchProcessing = pitchStatus === "processing";
  const pitchError = pitchStatus === "error";

  const stemQueued = queueTasks.some((t) => t.songId === song.id && t.type === "stems");
  const pitchQueued = queueTasks.some((t) => t.songId === song.id && t.type === "pitch");

  const chordStatus: ChordStatus = song.chord_status ?? "idle";
  const chordDone = chordStatus === "done";
  const chordProcessing = chordStatus === "processing";
  const chordError = chordStatus === "error";
  const chordQueued = queueTasks.some((t) => t.songId === song.id && t.type === "chords");

  const lines = rawLines ?? [];
  const translationLang = song.translation_language;
  const primaryLineCount = lines.filter((l) => !translationLang || l.language !== translationLang).length;
  const alignStatus: AlignStatus = song.align_status ?? "idle";
  const alignDone = alignStatus === "done";
  const alignProcessing = alignStatus === "processing";
  const alignError = alignStatus === "error";
  const alignQueued = queueTasks.some((t) => t.songId === song.id && t.type === "align");
  const canAlign = primaryLineCount > 0 && (isDownloaded || stemsDone);

  return (
    <div className="px-6 py-6">
          <div className="max-w-[640px] mx-auto animate-fade-up">
            {/* Song header */}
            <div className="flex items-center gap-4 mb-7">
              <div className="w-14 h-14 rounded-[10px] bg-gradient-to-br from-[#DBEAFE] to-[#BFDBFE] flex-shrink-0 flex items-center justify-center overflow-hidden">
                {song.thumbnail_url ? (
                  <img src={song.thumbnail_url} alt={song.title} className="w-full h-full object-cover" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                )}
              </div>
              <div>
                <div className="font-serif text-[22px] tracking-[-0.4px]">{song.title}</div>
                <div className="text-[13px] text-[var(--text-muted)]">{song.artist}</div>
              </div>
            </div>

            <p className="text-[13.5px] text-[var(--text-muted)] font-light leading-relaxed mb-7">
              Manage the audio files for this song. Download reference audio from YouTube, or generate separate vocal and instrumental tracks using Demucs.
            </p>

            {/* Reference Audio Section */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Reference audio
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              {isDownloaded ? (
                <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                  <div className="w-10 h-10 rounded-[9px] bg-[var(--theme-light)] text-[var(--theme-text)] flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                      <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                      audio.m4a
                    </div>
                    <div className="text-[11.5px] text-[var(--text-muted)] flex items-center gap-2">
                      Downloaded from YouTube
                    </div>
                  </div>
                  <div className="flex items-center gap-[6px] flex-shrink-0">
                    <button className="px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all flex items-center gap-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      Preview
                    </button>
                    <button
                      onClick={() => downloadSongAudio(song.id)}
                      className="px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all flex items-center gap-1"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                      Replace
                    </button>
                  </div>
                </div>
              ) : isDownloading ? (
                <div className="flex items-center gap-3.5 p-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-[var(--radius)]">
                  <div className="w-10 h-10 rounded-[9px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-[#92400E] mb-[6px]">Downloading audio...</div>
                    <div className="h-1 bg-[#FDE68A] rounded-sm overflow-hidden">
                      <div className="h-full w-[65%] bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-sm animate-pulse" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                  <div className="w-10 h-10 rounded-[9px] bg-[var(--accent-light)] text-[var(--text-muted)] flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium flex items-center gap-[6px] text-[var(--text-muted)]">
                      <span className="w-[6px] h-[6px] rounded-full bg-[var(--border)] flex-shrink-0" />
                      No audio downloaded
                    </div>
                    <div className="text-[11.5px] text-[var(--text-muted)]">
                      {hasError ? (
                        <span className="text-red-500">{song.download_error}</span>
                      ) : (
                        "Download from YouTube to start practicing"
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => downloadSongAudio(song.id)}
                    disabled={!song.youtube_url}
                    className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 disabled:opacity-50"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    Download
                  </button>
                </div>
              )}
            </div>

            {/* Separated Tracks Section (Demucs) */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Separated tracks (Demucs)
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              {stemsProcessing ? (
                /* Processing state */
                <div className="flex items-center gap-3.5 p-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-[var(--radius)]">
                  <div className="w-10 h-10 rounded-[9px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-[#92400E] mb-[6px]">Separating tracks with Demucs...</div>
                    <div className="h-1 bg-[#FDE68A] rounded-sm overflow-hidden">
                      <div className="h-full w-[65%] bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-sm animate-pulse" />
                    </div>
                    <div className="text-[11px] text-[#B45309] mt-1.5">This may take a minute. Processing locally on your machine.</div>
                  </div>
                </div>
              ) : stemsDone ? (
                /* Done state - show both tracks */
                <div className="flex flex-col gap-1.5">
                  {/* Vocals */}
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                    <div className="w-10 h-10 rounded-[9px] bg-[#DCFCE7] text-[#15803D] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                        <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                        <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                        vocals.wav
                      </div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">Isolated vocal track</div>
                    </div>
                  </div>

                  {/* Instrumental */}
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                    <div className="w-10 h-10 rounded-[9px] bg-[#FFF7ED] text-[#C2410C] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                        <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                        no_vocals.wav
                      </div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">Instrumental (no vocals)</div>
                    </div>
                  </div>

                  {/* Re-separate button */}
                  <button
                    onClick={() => enqueue(song.id, song.title, "stems")}
                    disabled={stemQueued || stemsProcessing}
                    className="mt-1 self-start px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center gap-1"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                    </svg>
                    Re-separate
                  </button>
                </div>
              ) : (
                /* Idle / error state */
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#DCFCE7] text-[#15803D] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                        <path d="M19 10v2a7 7 0 01-14 0v-2" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[var(--text-muted)]">Vocals & Instrumental</div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">
                        {stemsError ? (
                          <span className="text-red-500">{song.stem_error}</span>
                        ) : (
                          "Separate audio into vocal and instrumental tracks"
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => enqueue(song.id, song.title, "stems")}
                      disabled={!isDownloaded || stemQueued || stemsProcessing}
                      className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 disabled:opacity-50 flex-shrink-0"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      {stemQueued ? "Queued" : stemsError ? "Retry" : "Separate"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Pitch Analysis Section (torchcrepe) */}
            {stemsDone && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                    Pitch analysis (torchcrepe)
                  </span>
                  <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                </div>

                {pitchProcessing ? (
                  <div className="flex items-center gap-3.5 p-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-[#92400E] mb-[6px]">Analyzing vocal pitch...</div>
                      <div className="h-1 bg-[#FDE68A] rounded-sm overflow-hidden">
                        <div className="h-full w-[65%] bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-sm animate-pulse" />
                      </div>
                      <div className="text-[11px] text-[#B45309] mt-1.5">Running torchcrepe on the vocals track.</div>
                    </div>
                  </div>
                ) : pitchDone ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                      <div className="w-10 h-10 rounded-[9px] bg-[#EDE9FE] text-[#7C3AED] flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                          pitch.csv
                        </div>
                        <div className="text-[11.5px] text-[var(--text-muted)]">Vocal pitch data for practice visualization</div>
                      </div>
                    </div>
                    <button
                      onClick={() => enqueue(song.id, song.title, "pitch")}
                      disabled={pitchQueued || pitchProcessing}
                      className="mt-1 self-start px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center gap-1 disabled:opacity-50"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      {pitchQueued ? "Queued" : "Re-analyze"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#EDE9FE] text-[#7C3AED] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[var(--text-muted)]">Pitch Curve Data</div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">
                        {pitchError ? (
                          <span className="text-red-500">{song.pitch_error}</span>
                        ) : (
                          "Analyze vocals to show pitch curve in practice view"
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => enqueue(song.id, song.title, "pitch")}
                      disabled={pitchQueued || pitchProcessing}
                      className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      {pitchQueued ? "Queued" : pitchError ? "Retry" : "Analyze"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chord Analysis Section */}
            {stemsDone && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                    Chord analysis
                  </span>
                  <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                </div>

                {(chordDone || chordError) && (
                  <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-[8px] bg-[var(--bg)] border border-[var(--border-subtle)]">
                    <span className="text-[11.5px] text-[var(--text-muted)] leading-snug">
                      Start over: back up this song's chord corrections and fingering picks, then analyse again from scratch.
                    </span>
                    <button
                      onClick={() => setConfirmStartOver(true)}
                      disabled={chordProcessing || chordQueued}
                      className="flex-shrink-0 px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all disabled:opacity-50 cursor-pointer"
                    >
                      Start over
                    </button>
                  </div>
                )}
                <ConfirmDialog
                  open={confirmStartOver}
                  title="Start this song's chords over?"
                  message="Your chord corrections, fingering picks, tab note edits and analysis options for this song are moved to a backup folder inside the song folder (nothing is deleted), and the chords are analysed again from scratch."
                  confirmLabel="Start over"
                  onCancel={() => setConfirmStartOver(false)}
                  onConfirm={async () => {
                    setConfirmStartOver(false);
                    if (!song.audio_folder) return;
                    await backUpAndClearChordWork(song.audio_folder);
                    setSeparateDrums(false);
                    enqueue(song.id, song.title, "chords");
                  }}
                />

                <label className="flex items-start gap-2.5 mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={separateDrums}
                    disabled={chordProcessing || chordQueued || !song.audio_folder}
                    onChange={async (e) => {
                      const on = e.target.checked;
                      setSeparateDrums(on);
                      await saveChordSettings(`${song.audio_folder}/chords.json`, { use_stems: on });
                      // Already analysed: re-run so the change takes effect.
                      if (chordDone || chordError) enqueue(song.id, song.title, "chords");
                    }}
                    className="mt-[3px] accent-[var(--theme)]"
                  />
                  <span className="text-[12.5px] leading-snug">
                    Separate drums first
                    <span className="block text-[11.5px] text-[var(--text-muted)]">
                      For drum-heavy songs: chords from the instruments, beats from the drums, bass from the bass,
                      strum pattern from the guitar/keys. First run takes about a minute. Changing it re-analyses.
                    </span>
                  </span>
                </label>

                {chordProcessing ? (
                  <div className="flex items-center gap-3.5 p-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-[#92400E] mb-[6px]">Analyzing chords...</div>
                      <div className="h-1 bg-[#FDE68A] rounded-sm overflow-hidden">
                        <div className="h-full w-[65%] bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-sm animate-pulse" />
                      </div>
                      <div className="text-[11px] text-[#B45309] mt-1.5">Reading chords from the instrumental (or separated instruments, if turned on for this song).</div>
                    </div>
                  </div>
                ) : chordDone ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                      <div className="w-10 h-10 rounded-[9px] bg-[#FFEDD5] text-[#C2410C] flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                          chords.json
                        </div>
                        <div className="text-[11.5px] text-[var(--text-muted)]">Chord data for the play-along view</div>
                      </div>
                    </div>
                    <button
                      onClick={() => enqueue(song.id, song.title, "chords")}
                      disabled={chordQueued || chordProcessing}
                      className="mt-1 self-start px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center gap-1 disabled:opacity-50"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      {chordQueued ? "Queued" : "Re-analyze"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#FFEDD5] text-[#C2410C] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[var(--text-muted)]">Chord Data</div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">
                        {chordError ? (
                          <span className="text-red-500">{song.chord_error}</span>
                        ) : (
                          "Analyze the instrumental to get chords for playing along"
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => enqueue(song.id, song.title, "chords")}
                      disabled={chordQueued || chordProcessing}
                      className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                      {chordQueued ? "Queued" : chordError ? "Retry" : "Analyze"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Timestamp Alignment Section (WhisperX) */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Timestamp alignment (WhisperX)
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              {/* Requirements — only shown when not yet met */}
              {!canAlign && (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[11px] text-[var(--text-muted)]">Needs:</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${primaryLineCount > 0 ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]"}`}>
                    <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${primaryLineCount > 0 ? "bg-[#22C55E]" : "bg-[var(--border)]"}`} />
                    {primaryLineCount > 0 ? `${primaryLineCount} lyrics` : "Lyrics"}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${isDownloaded || stemsDone ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]"}`}>
                    <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isDownloaded || stemsDone ? "bg-[#22C55E]" : "bg-[var(--border)]"}`} />
                    Audio
                  </span>
                </div>
              )}

              {alignProcessing ? (
                  <div className="flex items-center gap-3.5 p-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-[#92400E] mb-[6px]">Aligning timestamps with WhisperX…</div>
                      <div className="h-1 bg-[#FDE68A] rounded-sm overflow-hidden">
                        <div className="h-full w-[65%] bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-sm animate-pulse" />
                      </div>
                      <div className="text-[11px] text-[#B45309] mt-1.5">
                        First run downloads models (~3 GB). Processing locally on your machine.
                      </div>
                    </div>
                  </div>
                ) : alignDone ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3.5 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow">
                      <div className="w-10 h-10 rounded-[9px] bg-[#DCFCE7] text-[#15803D] flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium flex items-center gap-[6px]">
                          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] flex-shrink-0" />
                          Timestamps aligned
                        </div>
                        <div className="text-[11.5px] text-[var(--text-muted)]">
                          {song.align_error ?? `${primaryLineCount} lines have start/end times from WhisperX`}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <select
                        value={alignModel}
                        onChange={(e) => setAlignModel(e.target.value)}
                        disabled={alignQueued || alignProcessing}
                        className="h-[28px] px-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text-secondary)] disabled:opacity-50 cursor-pointer"
                      >
                        <option value="tiny">tiny (fastest)</option>
                        <option value="base">base</option>
                        <option value="small">small</option>
                        <option value="medium">medium</option>
                        <option value="large-v2">large-v2 (slowest)</option>
                      </select>
                      <button
                        onClick={() => enqueue(song.id, song.title, "align", { model: alignModel })}
                        disabled={alignQueued || alignProcessing}
                        className="px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center gap-1 disabled:opacity-50"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                        </svg>
                        {alignQueued ? "Queued" : "Re-align"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                    <div className="w-10 h-10 rounded-[9px] bg-[var(--theme-light)] text-[var(--theme-text)] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-[var(--text-muted)]">Auto-align Timestamps</div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">
                        {alignError ? (
                          <span className="text-red-500">{song.align_error}</span>
                        ) : stemsDone ? (
                          "Use WhisperX to align all lyrics to the vocals stem"
                        ) : (
                          "Use WhisperX to align all lyrics to the audio"
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <select
                        value={alignModel}
                        onChange={(e) => setAlignModel(e.target.value)}
                        disabled={!canAlign || alignQueued || alignProcessing}
                        className="h-[28px] px-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text-secondary)] disabled:opacity-50 cursor-pointer"
                      >
                        <option value="tiny">tiny (fastest)</option>
                        <option value="base">base</option>
                        <option value="small">small</option>
                        <option value="medium">medium</option>
                        <option value="large-v2">large-v2 (slowest)</option>
                      </select>
                      <button
                        onClick={() => enqueue(song.id, song.title, "align", { model: alignModel })}
                        disabled={!canAlign || alignQueued || alignProcessing}
                        className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 disabled:opacity-50"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {alignQueued ? "Queued" : alignError ? "Retry" : "Align"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

            {/* Info note */}
            <div className="flex items-start gap-2.5 p-3.5 bg-[var(--theme-light)] border border-[#BFDBFE] rounded-[9px] mt-6 mb-6">
              <div className="text-[var(--theme-text)] flex-shrink-0 mt-0.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <div className="text-[12.5px] text-[var(--theme-text)] leading-relaxed">
                <strong className="font-semibold">Demucs separation</strong> runs locally on your machine using Python. Requires Python 3.11, FFmpeg, and Demucs to be installed. Check Settings → Downloads for installation status.
              </div>
            </div>
          </div>
    </div>
  );
}
