import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import type { PitchStatus } from "../types/song";
import {
  clearToken,
  discoverFilesInFolder,
  ensureSongFolder,
  getStoredToken,
  getValidAccessToken,
  startDriveOAuth,
  uploadFileResumable,
  type DriveUploadProgress,
} from "../lib/google-drive";
import { buildDriveFolderName } from "../lib/audio-download";
import { readFile } from "@tauri-apps/plugin-fs";

export function SongSetupPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const downloadSongAudio = useSongStore((s) => s.downloadSongAudio);
  const separateSongStems = useSongStore((s) => s.separateSongStems);
  const analyzeSongPitch = useSongStore((s) => s.analyzeSongPitch);
  const markStaleAnalysesAsFailed = useSongStore((s) => s.markStaleAnalysesAsFailed);

  useEffect(() => {
    markStaleAnalysesAsFailed();
  }, [markStaleAnalysesAsFailed]);

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

  const pitchStatus: PitchStatus = song.pitch_status ?? "idle";
  const pitchDone = pitchStatus === "done";
  const pitchProcessing = pitchStatus === "processing";
  const pitchError = pitchStatus === "error";

  // ── Google Drive sync state ─────────────────────────────────────────────────
  const updateSong = useSongStore((s) => s.updateSong);
  const isDriveConnected = !!getStoredToken();

  type FileUploadState = "idle" | "uploading" | "done" | "error";
  const [audioUpload, setAudioUpload] = useState<FileUploadState>("idle");
  const [vocalsUpload, setVocalsUpload] = useState<FileUploadState>("idle");
  const [instrUpload, setInstrUpload] = useState<FileUploadState>("idle");
  const [audioProgress, setAudioProgress] = useState(0);
  const [vocalsProgress, setVocalsProgress] = useState(0);
  const [instrProgress, setInstrProgress] = useState(0);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(isDriveConnected);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [driveAuthUrl, setDriveAuthUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const uploadingRef = useRef(false);

  // Sync initial upload states from existing Drive file IDs
  useEffect(() => {
    if (song.drive_audio_file_id) setAudioUpload("done");
    if (song.drive_vocals_file_id) setVocalsUpload("done");
    if (song.drive_instrumental_file_id) setInstrUpload("done");
  }, [song.drive_audio_file_id, song.drive_vocals_file_id, song.drive_instrumental_file_id]);

  const connectDrive = useCallback(async () => {
    setConnectingDrive(true);
    setDriveError(null);
    setDriveAuthUrl(null);
    setUrlCopied(false);
    try {
      await startDriveOAuth((url) => setDriveAuthUrl(url));
      setDriveConnected(true);
      setDriveAuthUrl(null);

      // Auto re-discovery: find existing files in Drive and restore file IDs
      try {
        const accessToken = await getValidAccessToken();
        const folderName = buildDriveFolderName(song.title, song.artist, song.id);
        const folderId = await ensureSongFolder(accessToken, folderName);
        const found = await discoverFilesInFolder(accessToken, folderId, [
          "audio.m4a",
          "vocals.wav",
          "no_vocals.wav",
        ]);
        const updates: Record<string, string> = {};
        if (found["audio.m4a"] && !song.drive_audio_file_id)
          updates.drive_audio_file_id = found["audio.m4a"];
        if (found["vocals.wav"] && !song.drive_vocals_file_id)
          updates.drive_vocals_file_id = found["vocals.wav"];
        if (found["no_vocals.wav"] && !song.drive_instrumental_file_id)
          updates.drive_instrumental_file_id = found["no_vocals.wav"];
        if (Object.keys(updates).length > 0) await updateSong(song.id, updates);
      } catch {
        // Re-discovery is best-effort; fall through to show sync button
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDriveError(msg);
    } finally {
      setConnectingDrive(false);
    }
  }, [song.id, song.title, song.artist, song.drive_audio_file_id, song.drive_vocals_file_id, song.drive_instrumental_file_id, updateSong]);

  const disconnectDrive = useCallback(() => {
    const confirmed = window.confirm(
      "Disconnect Google Drive?\n\nYour uploaded files will remain on Drive, but this app will no longer be able to sync until you reconnect."
    );
    if (!confirmed) return;
    clearToken();
    setDriveConnected(false);
  }, []);

  const uploadToDrive = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setDriveError(null);

    try {
      const accessToken = await getValidAccessToken();
      const folderId = await ensureSongFolder(accessToken, buildDriveFolderName(song.title, song.artist, song.id));

      const makeProgress =
        (setter: (v: number) => void) =>
        ({ bytesSent, totalBytes }: DriveUploadProgress) => {
          setter(totalBytes > 0 ? Math.round((bytesSent / totalBytes) * 100) : 0);
        };

      const updates: Partial<typeof song> = {};

      // audio.m4a
      if (song.audio_path && audioUpload !== "done") {
        setAudioUpload("uploading");
        setAudioProgress(0);
        const data = await readFile(song.audio_path);
        const fileId = await uploadFileResumable(
          accessToken,
          data,
          "audio.m4a",
          "audio/mp4",
          folderId,
          makeProgress(setAudioProgress)
        );
        setAudioUpload("done");
        updates.drive_audio_file_id = fileId;
      }

      // vocals.wav
      if (song.vocals_path && vocalsUpload !== "done") {
        setVocalsUpload("uploading");
        setVocalsProgress(0);
        const data = await readFile(song.vocals_path);
        const fileId = await uploadFileResumable(
          accessToken,
          data,
          "vocals.wav",
          "audio/wav",
          folderId,
          makeProgress(setVocalsProgress)
        );
        setVocalsUpload("done");
        updates.drive_vocals_file_id = fileId;
      }

      // no_vocals.wav
      if (song.instrumental_path && instrUpload !== "done") {
        setInstrUpload("uploading");
        setInstrProgress(0);
        const data = await readFile(song.instrumental_path);
        const fileId = await uploadFileResumable(
          accessToken,
          data,
          "no_vocals.wav",
          "audio/wav",
          folderId,
          makeProgress(setInstrProgress)
        );
        setInstrUpload("done");
        updates.drive_instrumental_file_id = fileId;
      }

      if (Object.keys(updates).length > 0) {
        await updateSong(song.id, updates);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDriveError(msg);
      // Reset in-progress states back to idle on error
      setAudioUpload((s) => (s === "uploading" ? "idle" : s));
      setVocalsUpload((s) => (s === "uploading" ? "idle" : s));
      setInstrUpload((s) => (s === "uploading" ? "idle" : s));
    } finally {
      uploadingRef.current = false;
    }
  }, [song, audioUpload, vocalsUpload, instrUpload, updateSong]);

  const hasDriveIds =
    !!song.drive_audio_file_id ||
    !!song.drive_vocals_file_id ||
    !!song.drive_instrumental_file_id;
  const canUpload = isDownloaded || stemsDone;
  const isUploading =
    audioUpload === "uploading" ||
    vocalsUpload === "uploading" ||
    instrUpload === "uploading";

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
                      onClick={() => analyzeSongPitch(song.id)}
                      className="mt-1 self-start px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex items-center gap-1"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      Re-analyze
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
                      onClick={() => analyzeSongPitch(song.id)}
                      className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1 flex-shrink-0"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      {pitchError ? "Retry" : "Analyze"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Google Drive Sync Section */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
                  Mobile sync (Google Drive)
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              {!driveConnected ? (
                /* Not connected */
                <>
                <div className="flex items-center gap-3.5 p-4 bg-[var(--bg)] border border-dashed border-[var(--border)] rounded-[var(--radius)]">
                  <div className="w-10 h-10 rounded-[9px] bg-[var(--accent-light)] flex items-center justify-center flex-shrink-0">
                    {/* Google Drive icon */}
                    <svg width="20" height="17" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text-muted)]">Connect Google Drive</div>
                    <div className="text-[11.5px] text-[var(--text-muted)]">Upload audio files so the Reprise mobile app can download them</div>
                  </div>
                  <button
                    onClick={connectDrive}
                    disabled={connectingDrive}
                    className="px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
                  >
                    {connectingDrive ? (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                          <circle cx="12" cy="12" r="10" /><path d="M12 6v6" />
                        </svg>
                        Waiting for browser…
                      </>
                    ) : "Connect"}
                  </button>
                </div>

                {/* Copyable auth URL — shown while waiting for browser */}
                {connectingDrive && driveAuthUrl && (
                  <div className="mt-2 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-[8px]">
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">
                      Browser didn't open? Copy this link and paste it manually:
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={driveAuthUrl}
                        className="flex-1 text-[10.5px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-2 py-1.5 text-[var(--text-secondary)] truncate outline-none"
                        onFocus={(e) => e.target.select()}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(driveAuthUrl);
                          setUrlCopied(true);
                          setTimeout(() => setUrlCopied(false), 2000);
                        }}
                        className="px-2.5 py-1.5 rounded-[5px] border border-[var(--border)] bg-[var(--bg)] text-[11px] font-medium text-[var(--text-secondary)] hover:border-[#888] transition-all flex-shrink-0"
                      >
                        {urlCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
                </>
              ) : (
                /* Connected — show file upload states */
                <div className="flex flex-col gap-1.5">
                  {/* Connection header */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-[11.5px] text-[#15803D]">
                      <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E]" />
                      Google Drive connected
                    </div>
                    <button
                      onClick={disconnectDrive}
                      className="text-[11px] text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>

                  {/* audio.m4a */}
                  <DriveFileRow
                    label="audio.m4a"
                    sublabel="Reference audio"
                    available={isDownloaded}
                    status={audioUpload}
                    progress={audioProgress}
                    fileId={song.drive_audio_file_id}
                  />

                  {/* vocals.wav */}
                  <DriveFileRow
                    label="vocals.wav"
                    sublabel="Isolated vocals"
                    available={stemsDone}
                    status={vocalsUpload}
                    progress={vocalsProgress}
                    fileId={song.drive_vocals_file_id}
                  />

                  {/* no_vocals.wav */}
                  <DriveFileRow
                    label="no_vocals.wav"
                    sublabel="Instrumental track"
                    available={stemsDone}
                    status={instrUpload}
                    progress={instrProgress}
                    fileId={song.drive_instrumental_file_id}
                  />

                  {/* Error */}
                  {driveError && (
                    <p className="text-[11.5px] text-red-500 mt-1 leading-relaxed">{driveError}</p>
                  )}

                  {/* Upload / Re-upload button */}
                  {canUpload && (
                    <button
                      onClick={uploadToDrive}
                      disabled={isUploading}
                      className="mt-2 self-start px-3 py-[5px] rounded-[6px] bg-[var(--accent)] text-white border-[1.5px] border-[var(--accent)] text-[12px] font-medium hover:opacity-85 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isUploading ? (
                        <>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6" />
                          </svg>
                          Uploading…
                        </>
                      ) : hasDriveIds ? (
                        <>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                          </svg>
                          Re-sync to Drive
                        </>
                      ) : (
                        <>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                          </svg>
                          Sync to Drive
                        </>
                      )}
                    </button>
                  )}

                  {!canUpload && (
                    <p className="text-[11.5px] text-[var(--text-muted)] mt-1">
                      Download reference audio first to enable Drive sync.
                    </p>
                  )}
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
        </main>
      </div>
    </div>
  );
}

// ─── DriveFileRow ─────────────────────────────────────────────────────────────

function DriveFileRow({
  label,
  sublabel,
  available,
  status,
  progress,
  fileId,
}: {
  label: string;
  sublabel: string;
  available: boolean;
  status: "idle" | "uploading" | "done" | "error";
  progress: number;
  fileId?: string;
}) {
  const dot =
    status === "done"
      ? "bg-[#22C55E]"
      : status === "uploading"
      ? "bg-[#F59E0B] animate-pulse"
      : status === "error"
      ? "bg-red-500"
      : "bg-[var(--border)]";

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-[8px] border ${
        available
          ? "bg-[var(--surface)] border-[var(--border)]"
          : "bg-[var(--bg)] border-dashed border-[var(--border)] opacity-50"
      }`}
    >
      <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium">{label}</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {status === "uploading"
            ? `Uploading… ${progress}%`
            : status === "done" && fileId
            ? "Synced to Drive"
            : available
            ? sublabel
            : "Not available yet"}
        </div>
        {status === "uploading" && (
          <div className="mt-1 h-0.5 bg-[var(--border)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
