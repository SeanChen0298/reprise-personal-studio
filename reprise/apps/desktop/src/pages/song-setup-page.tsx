import { useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";

export function SongSetupPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const downloadSongAudio = useSongStore((s) => s.downloadSongAudio);
  const separateSongStems = useSongStore((s) => s.separateSongStems);

  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  const isDownloaded = song.download_status === "done";
  const isDownloading = song.download_status === "downloading";
  const hasError = song.download_status === "error";

  const stemsDone = song.stem_status === "done";
  const stemsProcessing = song.stem_status === "processing";
  const stemsError = song.stem_status === "error";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => navigate(`/song/${id}`)}
            className="flex items-center gap-[6px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Song
          </button>
          <button
            onClick={() => navigate(`/song/${id}`)}
            className="flex items-center gap-[5px] px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Done
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-8">
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
                    onClick={() => separateSongStems(song.id)}
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
                      onClick={() => separateSongStems(song.id)}
                      disabled={!isDownloaded}
                      className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 disabled:opacity-50 flex-shrink-0"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      {stemsError ? "Retry" : "Separate"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Additional Files Section (Coming Soon) */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Additional files
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              <div className="p-6 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface)] text-center opacity-60">
                <div className="text-[var(--text-muted)] mb-2">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="text-[13px] font-medium text-[var(--text-secondary)] mb-1">Drag & drop audio files here</div>
                <div className="text-[11.5px] text-[var(--text-muted)]">Coming soon — Supports MP3, WAV, FLAC, OGG</div>
              </div>
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2.5 p-3.5 bg-[var(--theme-light)] border border-[#BFDBFE] rounded-[9px] mt-6">
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
        </main>
      </div>
    </div>
  );
}
