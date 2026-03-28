import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import { Sidebar } from "../components/sidebar";
import { useAuthStore } from "../stores/auth-store";
import { checkYtDlpInstalled, checkPythonInstalled, checkFfmpegInstalled, checkDemucsInstalled, COOKIES_PATH } from "../lib/audio-download";
import { isDesktopPlatform } from "../lib/platform";
import { checkTorchcrepeInstalled } from "../lib/audio-analysis";
import { useHighlightStore } from "../lib/highlight-config";
import { usePreferencesStore } from "../stores/preferences-store";
import { useAudioDevices } from "../hooks/use-audio-devices";
import { getStoredToken, getValidAccessToken, purgeDriveAll, clearToken, startDriveOAuth } from "../lib/google-drive";
import { useSongStore } from "../stores/song-store";
import { useDriveSyncStore } from "../stores/drive-sync-store";
import { supabase } from "../lib/supabase";

type Tab = "highlights" | "account" | "preferences" | "downloads" | "audio";

const THEME_OPTIONS = [
  { key: "blue", color: "#2563EB", label: "Blue", light: "#EFF6FF", text: "#1D4ED8" },
  { key: "midnight", color: "#111111", label: "Midnight", light: "#F5F5F5", text: "#111111" },
  { key: "violet", color: "#7C3AED", label: "Violet", light: "#F5F3FF", text: "#6D28D9" },
  { key: "emerald", color: "#059669", label: "Emerald", light: "#ECFDF5", text: "#047857" },
  { key: "red", color: "#DC2626", label: "Red", light: "#FEF2F2", text: "#B91C1C" },
  { key: "amber", color: "#D97706", label: "Amber", light: "#FFFBEB", text: "#B45309" },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";

  const [activeTab, setActiveTab] = useState<Tab>("highlights");
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => { isDesktopPlatform().then(setIsDesktop); }, []);
  const highlights = useHighlightStore((s) => s.highlights);
  const addHighlight = useHighlightStore((s) => s.addHighlight);
  const updateHighlight = useHighlightStore((s) => s.updateHighlight);
  const removeHighlight = useHighlightStore((s) => s.removeHighlight);
  const [newHighlightName, setNewHighlightName] = useState("");
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);
  const activeTheme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const [speed, setSpeed] = useState(100);
  const [autoPlay, setAutoPlay] = useState(true);
  const [loopMode, setLoopMode] = useState("3");
  const countInEnabled = usePreferencesStore((s) => s.countInEnabled);
  const setCountInEnabled = usePreferencesStore((s) => s.setCountInEnabled);
  const countIn = countInEnabled ? "2" : "none";
  const recordingPlaybackGain = usePreferencesStore((s) => s.recordingPlaybackGain);
  const setRecordingPlaybackGain = usePreferencesStore((s) => s.setRecordingPlaybackGain);
  const autoSyncDrive = usePreferencesStore((s) => s.autoSyncDrive);
  const setAutoSyncDrive = usePreferencesStore((s) => s.setAutoSyncDrive);
  const autoDemucs = usePreferencesStore((s) => s.autoDemucs);
  const setAutoDemucs = usePreferencesStore((s) => s.setAutoDemucs);
  const autoPitch = usePreferencesStore((s) => s.autoPitch);
  const setAutoPitch = usePreferencesStore((s) => s.setAutoPitch);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [autoSync, setAutoSync] = useState(true);

  // Google Drive connection
  const [driveConnected, setDriveConnected] = useState(() => !!getStoredToken());
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveConnectError, setDriveConnectError] = useState<string | null>(null);

  const handleDriveConnect = useCallback(async () => {
    setDriveConnecting(true);
    setDriveConnectError(null);
    try {
      await startDriveOAuth();
      setDriveConnected(true);
    } catch (err) {
      setDriveConnectError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setDriveConnecting(false);
    }
  }, []);

  const handleDriveDisconnect = useCallback(() => {
    clearToken();
    setDriveConnected(false);
    setDriveConnectError(null);
  }, []);

  // Google Drive bulk reset
  const songs = useSongStore((s) => s.songs);
  const setResetInProgress = useDriveSyncStore((s) => s.setResetInProgress);
  const [driveResetStatus, setDriveResetStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [driveResetMsg, setDriveResetMsg] = useState<string | null>(null);

  const handleFullDriveReset = useCallback(async () => {
    const confirmed = window.confirm(
      "⚠️ Delete ALL Reprise files from Google Drive and reset sync?\n\n" +
      "This will:\n" +
      "  • Permanently delete every audio file uploaded by Reprise from your Drive\n" +
      "  • Clear all Drive file IDs from every song in your library\n" +
      "  • The mobile app will lose access to all audio until you re-sync\n\n" +
      "Files on your local machine are NOT affected.\n\n" +
      "This cannot be undone. Continue?"
    );
    if (!confirmed) return;

    setDriveResetStatus("running");
    setDriveResetMsg("Connecting to Drive…");
    // Block auto-sync for the entire duration of the reset
    setResetInProgress(true);
    try {
      // 1. Delete everything from Drive
      if (!getStoredToken()) throw new Error("Google Drive is not connected. Connect Drive first.");
      console.log("[drive-reset] Getting access token…");
      const accessToken = await getValidAccessToken();

      console.log("[drive-reset] Purging Drive folder…");
      setDriveResetMsg("Deleting files from Drive…");
      const deleted = await purgeDriveAll(accessToken);
      console.log("[drive-reset] Purge done, deleted:", deleted);

      // 2. Clear drive IDs from all songs in DB (single bulk update)
      setDriveResetMsg("Clearing sync records…");
      const songIds = songs.map((s) => s.id);
      console.log("[drive-reset] Clearing DB for", songIds.length, "songs…");
      if (songIds.length > 0) {
        const { error } = await supabase
          .from("songs")
          .update({ drive_audio_file_id: null, drive_vocals_file_id: null, drive_instrumental_file_id: null })
          .in("id", songIds);
        if (error) throw error;
      }

      // 3. Reload store so UI reflects cleared IDs immediately
      console.log("[drive-reset] Reloading store…");
      await useSongStore.getState().loadAllData();

      setDriveResetStatus("done");
      setDriveResetMsg(`Done. ${deleted} item${deleted !== 1 ? "s" : ""} deleted from Drive. Auto-sync will re-upload your files.`);
      console.log("[drive-reset] Complete.");
    } catch (err) {
      console.error("[drive-reset] Error:", err);
      setDriveResetStatus("error");
      setDriveResetMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      // Re-enable auto-sync now that Drive is clean and IDs are reset
      setResetInProgress(false);
    }
  }, [songs, setResetInProgress]);

  // Audio I/O tab
  const audioDevices = useAudioDevices();
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelStreamRef = useRef<MediaStream | null>(null);
  const audioLevelCtxRef = useRef<AudioContext | null>(null);
  const audioLevelRafRef = useRef<number>(0);
  const [testState, setTestState] = useState<"idle" | "recording" | "playing">("idle");
  const testRecorderRef = useRef<MediaRecorder | null>(null);
  const testChunksRef = useRef<Blob[]>([]);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const testCtxRef = useRef<AudioContext | null>(null);

  // Start/stop live level meter when audio tab is active
  useEffect(() => {
    if (activeTab !== "audio") {
      cancelAnimationFrame(audioLevelRafRef.current);
      audioLevelStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioLevelStreamRef.current = null;
      audioLevelCtxRef.current?.close().catch(() => {});
      audioLevelCtxRef.current = null;
      setAudioLevel(0);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const constraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(audioDevices.selectedInputId ? { deviceId: { exact: audioDevices.selectedInputId } } : {}),
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        audioLevelStreamRef.current = stream;
        const ctx = new AudioContext();
        audioLevelCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          setAudioLevel(sum / (data.length * 255));
          audioLevelRafRef.current = requestAnimationFrame(tick);
        };
        audioLevelRafRef.current = requestAnimationFrame(tick);
      } catch { /* permission denied */ }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(audioLevelRafRef.current);
      audioLevelStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioLevelStreamRef.current = null;
      audioLevelCtxRef.current?.close().catch(() => {});
      audioLevelCtxRef.current = null;
      setAudioLevel(0);
    };
  }, [activeTab, audioDevices.selectedInputId]);

  const handleTestMic = useCallback(async () => {
    if (testState === "recording") {
      testRecorderRef.current?.stop();
      return;
    }
    if (testState === "playing") {
      testAudioRef.current?.pause();
      testCtxRef.current?.close().catch(() => {});
      testCtxRef.current = null;
      setTestState("idle");
      return;
    }
    try {
      const constraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(audioDevices.selectedInputId ? { deviceId: { exact: audioDevices.selectedInputId } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      testChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      testRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) testChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(testChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const ctx = new AudioContext();
        testCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = usePreferencesStore.getState().recordingPlaybackGain;
        const compressor = ctx.createDynamicsCompressor();
        source.connect(gain);
        gain.connect(compressor);
        compressor.connect(ctx.destination);
        testAudioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); setTestState("idle"); ctx.close().catch(() => {}); testCtxRef.current = null; };
        setTestState("playing");
        audio.play().catch(() => { setTestState("idle"); ctx.close().catch(() => {}); testCtxRef.current = null; });
      };
      recorder.start(100);
      setTestState("recording");
      // Auto-stop after 5 seconds
      setTimeout(() => { if (testRecorderRef.current?.state === "recording") testRecorderRef.current.stop(); }, 5000);
    } catch { setTestState("idle"); }
  }, [testState, audioDevices.selectedInputId]);

  // Downloads tab state
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null | undefined>(undefined);
  const [cookieExists, setCookieExists] = useState<boolean | null>(null);
  const [pythonVersion, setPythonVersion] = useState<string | null | undefined>(undefined);
  const [ffmpegVersion, setFfmpegVersion] = useState<string | null | undefined>(undefined);
  const [demucsStatus, setDemucsStatus] = useState<string | null | undefined>(undefined);
  const [torchcrepeStatus, setTorchcrepeStatus] = useState<string | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  const runChecks = useCallback(async () => {
    setChecking(true);
    try {
      const [version, cookieOk, python, ffmpeg, demucs, torchcrepe] = await Promise.all([
        checkYtDlpInstalled(),
        exists(COOKIES_PATH),
        checkPythonInstalled(),
        checkFfmpegInstalled(),
        checkDemucsInstalled(),
        checkTorchcrepeInstalled(),
      ]);
      setYtdlpVersion(version);
      setCookieExists(cookieOk);
      setPythonVersion(python);
      setFfmpegVersion(ffmpeg);
      setDemucsStatus(demucs);
      setTorchcrepeStatus(torchcrepe);
    } catch {
      setYtdlpVersion(null);
      setCookieExists(false);
      setPythonVersion(null);
      setFfmpegVersion(null);
      setDemucsStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  function handleAddHighlight() {
    const name = newHighlightName.trim();
    if (!name) return;
    addHighlight(name);
    setNewHighlightName("");
  }

  function handleDeleteHighlight(id: string) {
    removeHighlight(id);
  }

  function handleThemeChange(key: string) {
    setTheme(key);
  }

  const tabDef = (key: Tab, label: string, icon: React.ReactNode) => (
    <button
      key={key}
      onClick={() => setActiveTab(key)}
      className={[
        "flex items-center gap-[6px] px-[18px] py-[9px] text-[13px] font-medium border-b-2 transition-colors cursor-pointer bg-transparent select-none",
        activeTab === key
          ? "text-[var(--text-primary)] border-[var(--accent)]"
          : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );

  const sectionHeader = (title: string) => (
    <div className="flex items-center gap-2 mb-3.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] flex-shrink-0">
        {title}
      </span>
      <div className="flex-1 h-px bg-[var(--border-subtle)]" />
    </div>
  );

  const toggle = (checked: boolean, onChange: (v: boolean) => void) => (
    <label className="relative w-[38px] h-[22px] flex-shrink-0 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="opacity-0 w-0 h-0 absolute"
      />
      <span
        className="absolute inset-0 rounded-[12px] transition-colors duration-200"
        style={{ background: checked ? "var(--theme)" : "var(--border)" }}
      >
        <span
          className="absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-200"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </span>
    </label>
  );

  const settingRow = (
    label: string,
    desc: string,
    control: React.ReactNode,
    isLast = false,
  ) => (
    <div
      className={[
        "flex items-center justify-between py-3.5",
        isLast ? "" : "border-b border-[var(--border-subtle)]",
      ].join(" ")}
    >
      <div className="flex-1">
        <div className="text-[13px] font-medium mb-0.5">{label}</div>
        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">{desc}</div>
      </div>
      {control}
    </div>
  );

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
            Back to Library
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-8 pb-16">
          <div className="max-w-[640px] mx-auto animate-fade-up">
            <h1 className="font-serif text-[24px] tracking-[-0.5px] mb-1">Settings</h1>
            <p className="text-[13.5px] text-[var(--text-muted)] font-light mb-6">
              Manage your highlights, account, and app preferences.
            </p>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-[var(--border)] mb-7">
              {tabDef(
                "highlights",
                "Highlights",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>,
              )}
              {tabDef(
                "account",
                "Account",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>,
              )}
              {tabDef(
                "preferences",
                "Preferences",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>,
              )}
              {isDesktop && tabDef(
                "downloads",
                "Downloads",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>,
              )}
              {tabDef(
                "audio",
                "Audio I/O",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>,
              )}
            </div>

            {/* ═══ HIGHLIGHTS TAB ═══ */}
            {activeTab === "highlights" && (
              <div>
                <div className="mb-7">
                  {sectionHeader("Annotation highlight types")}

                  <div className="flex flex-col gap-1.5">
                    {highlights.map((h) => (
                      <div key={h.id}>
                        <div
                          className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow"
                        >
                          <div
                            className="w-7 h-7 rounded-[6px] flex-shrink-0 border border-black/[0.06] cursor-pointer hover:scale-110 transition-transform"
                            style={{ background: h.bg }}
                            onClick={() => setEditingHighlightId(editingHighlightId === h.id ? null : h.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-medium mb-px">{h.name}</div>
                            {h.description && (
                              <div className="text-[11.5px] text-[var(--text-muted)]">{h.description}</div>
                            )}
                          </div>
                          <span
                            className="text-[12px] px-2.5 py-0.5 rounded font-medium flex-shrink-0"
                            style={{ background: h.bg, color: h.color }}
                          >
                            sample text
                          </span>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => setEditingHighlightId(editingHighlightId === h.id ? null : h.id)}
                              className={`w-7 h-7 rounded-[6px] border bg-transparent cursor-pointer flex items-center justify-center transition-all ${
                                editingHighlightId === h.id
                                  ? "border-[var(--theme)] text-[var(--theme)]"
                                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)]"
                              }`}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteHighlight(h.id)}
                              className="w-7 h-7 rounded-[6px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:text-[#DC2626] hover:border-[#FECACA] hover:bg-[#FEF2F2] transition-all"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Inline color editor */}
                        {editingHighlightId === h.id && (
                          <div className="mt-1 ml-10 p-3 bg-[var(--bg)] border border-[var(--border-subtle)] rounded-[8px] flex flex-col gap-2.5">
                            {/* Name */}
                            <div className="flex items-center gap-2">
                              <label className="text-[11.5px] text-[var(--text-muted)] w-[80px] flex-shrink-0">Name</label>
                              <input
                                type="text"
                                value={h.name}
                                onChange={(e) => updateHighlight(h.id, { name: e.target.value })}
                                className="flex-1 px-2.5 py-[5px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--theme)] transition-colors"
                              />
                            </div>
                            {/* Background color */}
                            <div className="flex items-center gap-2">
                              <label className="text-[11.5px] text-[var(--text-muted)] w-[80px] flex-shrink-0">Background</label>
                              <div className="flex items-center gap-2 flex-1">
                                <input
                                  type="color"
                                  value={h.bg}
                                  onChange={(e) => updateHighlight(h.id, { bg: e.target.value })}
                                  className="w-7 h-7 rounded-[4px] border border-[var(--border)] cursor-pointer p-0 bg-transparent"
                                />
                                <input
                                  type="text"
                                  value={h.bg}
                                  onChange={(e) => updateHighlight(h.id, { bg: e.target.value })}
                                  className="w-[90px] px-2 py-[5px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[12px] text-[var(--text-secondary)] font-mono outline-none focus:border-[var(--theme)] transition-colors"
                                />
                              </div>
                            </div>
                            {/* Text color */}
                            <div className="flex items-center gap-2">
                              <label className="text-[11.5px] text-[var(--text-muted)] w-[80px] flex-shrink-0">Text color</label>
                              <div className="flex items-center gap-2 flex-1">
                                <input
                                  type="color"
                                  value={h.color}
                                  onChange={(e) => updateHighlight(h.id, { color: e.target.value })}
                                  className="w-7 h-7 rounded-[4px] border border-[var(--border)] cursor-pointer p-0 bg-transparent"
                                />
                                <input
                                  type="text"
                                  value={h.color}
                                  onChange={(e) => updateHighlight(h.id, { color: e.target.value })}
                                  className="w-[90px] px-2 py-[5px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[12px] text-[var(--text-secondary)] font-mono outline-none focus:border-[var(--theme)] transition-colors"
                                />
                              </div>
                            </div>
                            {/* Preview */}
                            <div className="flex items-center gap-2">
                              <label className="text-[11.5px] text-[var(--text-muted)] w-[80px] flex-shrink-0">Preview</label>
                              <span
                                className="text-[13px] px-3 py-1 rounded-[5px] font-medium"
                                style={{ background: h.bg, color: h.color }}
                              >
                                {h.name || "sample text"}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add new */}
                  <div className="flex gap-2 mt-3">
                    <input
                      type="text"
                      value={newHighlightName}
                      onChange={(e) => setNewHighlightName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddHighlight()}
                      placeholder="New highlight name..."
                      className="flex-1 px-[13px] py-2 rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                    />
                    <button
                      onClick={handleAddHighlight}
                      className="flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium border-none cursor-pointer hover:opacity-80 hover:-translate-y-px transition-all"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ ACCOUNT TAB ═══ */}
            {activeTab === "account" && (
              <div>
                {/* Profile */}
                <div className="mb-7">
                  {sectionHeader("Profile")}

                  <div className="flex items-center gap-4 mb-6">
                    <div className="relative w-14 h-14 rounded-full bg-[var(--accent)] text-white text-[18px] font-semibold flex items-center justify-center flex-shrink-0 cursor-pointer group">
                      {initials}
                      <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[var(--surface)] border-[1.5px] border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] group-hover:border-[var(--theme)] group-hover:text-[var(--theme)] transition-colors">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-[15px] font-medium mb-0.5">
                        {user?.email?.split("@")[0] ?? "User"}
                      </div>
                      <div className="text-[12.5px] text-[var(--text-muted)]">
                        {user?.email ?? ""}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                        Display name
                      </label>
                      <input
                        type="text"
                        defaultValue={user?.email?.split("@")[0] ?? ""}
                        className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                        Email
                      </label>
                      <input
                        type="email"
                        defaultValue={user?.email ?? ""}
                        className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                  </div>

                  <button className="flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium border-none cursor-pointer hover:opacity-80 hover:-translate-y-px transition-all">
                    Save changes
                  </button>
                </div>

                {/* Password */}
                <div className="mb-7">
                  {sectionHeader("Password")}

                  <div className="mb-4">
                    <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                      Current password
                    </label>
                    <input
                      type="password"
                      placeholder="Enter current password"
                      className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                        New password
                      </label>
                      <input
                        type="password"
                        placeholder="New password"
                        className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                        Confirm new password
                      </label>
                      <input
                        type="password"
                        placeholder="Confirm password"
                        className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13.5px] outline-none focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] transition-all placeholder:text-[var(--text-muted)]"
                      />
                    </div>
                  </div>

                  <button className="flex items-center gap-[5px] px-4 py-2 rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-secondary)] text-[13px] font-medium cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all">
                    Update password
                  </button>
                </div>

                {/* Danger zone */}
                <div className="mb-7">
                  {sectionHeader("Danger zone")}

                  <div className="p-[18px_20px] border border-[#FECACA] rounded-[var(--radius)] bg-[#FEF2F2]">
                    <div className="text-[13px] font-medium text-[#991B1B] mb-1">Delete account</div>
                    <div className="text-[12px] text-[#B91C1C] leading-[1.6] mb-3.5">
                      Permanently delete your account and all data. This action cannot be undone. All your songs, recordings, and progress will be lost.
                    </div>
                    <button className="flex items-center gap-[5px] px-4 py-2 rounded-[7px] border-[1.5px] border-[#FECACA] bg-transparent text-[#DC2626] text-[13px] font-medium cursor-pointer hover:bg-[#FEF2F2] hover:border-[#DC2626] transition-all">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" />
                      </svg>
                      Delete my account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ PREFERENCES TAB ═══ */}
            {activeTab === "preferences" && (
              <div>
                {/* Theme color */}
                <div className="mb-7">
                  {sectionHeader("Theme color")}

                  <div className="flex gap-2.5">
                    {THEME_OPTIONS.map((t) => (
                      <div key={t.key} className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => handleThemeChange(t.key)}
                          className={[
                            "w-8 h-8 rounded-full cursor-pointer border-[2.5px] hover:scale-[1.12] transition-transform relative",
                            activeTheme === t.key
                              ? "border-[var(--text-primary)]"
                              : "border-transparent",
                          ].join(" ")}
                          style={{ background: t.color }}
                        >
                          {activeTheme === t.key && (
                            <span className="absolute inset-1 rounded-full border-2 border-white" />
                          )}
                        </button>
                        <span className="text-[11px] text-[var(--text-muted)] mt-1">{t.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Playback defaults */}
                <div className="mb-7">
                  {sectionHeader("Playback defaults")}

                  {settingRow(
                    "Default playback speed",
                    "Speed when opening a song for the first time",
                    <div className="flex items-center gap-3 w-[180px]">
                      <input
                        type="range"
                        min="50"
                        max="100"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        className="flex-1 h-1 bg-[var(--border)] rounded-sm outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.2)] [&::-webkit-slider-thumb]:cursor-pointer"
                      />
                      <span className="text-[12px] font-medium text-[var(--text-secondary)] min-w-[36px] text-right">
                        {(speed / 100).toFixed(1)}x
                      </span>
                    </div>,
                  )}

                  {settingRow(
                    "Auto-play next line",
                    "Automatically advance to the next line during practice",
                    toggle(autoPlay, setAutoPlay),
                  )}

                  {settingRow(
                    "Loop mode",
                    "Default loop behavior when practicing a line",
                    <select
                      value={loopMode}
                      onChange={(e) => setLoopMode(e.target.value)}
                      className="px-3 py-[7px] pr-8 rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] outline-none appearance-none cursor-pointer focus:border-[var(--theme)] transition-colors flex-shrink-0"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 10px center",
                      }}
                    >
                      <option value="forever">Loop forever</option>
                      <option value="3">Loop 3 times</option>
                      <option value="5">Loop 5 times</option>
                      <option value="none">No loop</option>
                    </select>,
                  )}

                  {settingRow(
                    "Count-in before recording",
                    "Play a metronome count before recording starts",
                    <select
                      value={countIn}
                      onChange={(e) => setCountInEnabled(e.target.value !== "none")}
                      className="px-3 py-[7px] pr-8 rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] outline-none appearance-none cursor-pointer focus:border-[var(--theme)] transition-colors flex-shrink-0"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 10px center",
                      }}
                    >
                      <option value="none">None</option>
                      <option value="1">1 bar</option>
                      <option value="2">2 bars</option>
                      <option value="4">4 bars</option>
                    </select>,
                    true,
                  )}
                </div>

                {/* General */}
                <div className="mb-7">
                  {sectionHeader("General")}

                  {settingRow(
                    "Confirm before deleting songs",
                    "Show a confirmation dialog when removing songs",
                    toggle(confirmDelete, setConfirmDelete),
                  )}

                  {settingRow(
                    "Auto-sync audio to Google Drive",
                    "Automatically upload audio files to Drive when a song finishes downloading or processing. Requires Google Drive to be connected in the song setup page.",
                    toggle(autoSyncDrive, setAutoSyncDrive),
                  )}

                  {settingRow(
                    "Auto-sync to cloud",
                    "Automatically sync progress and recordings to Supabase",
                    toggle(autoSync, setAutoSync),
                    true,
                  )}
                </div>

                {/* Audio processing */}
                <div className="mb-7">
                  {sectionHeader("Audio processing")}

                  {settingRow(
                    "Auto stem separation (Demucs)",
                    "Automatically run Demucs on every downloaded song. Jobs are queued and processed one at a time.",
                    toggle(autoDemucs, setAutoDemucs),
                  )}

                  {settingRow(
                    "Auto pitch analysis (torchcrepe)",
                    "Automatically run pitch analysis after stem separation completes. Queued with Demucs jobs.",
                    toggle(autoPitch, setAutoPitch),
                    true,
                  )}
                </div>

                {/* Google Drive connection */}
                <div className="mb-7">
                  {sectionHeader("Google Drive")}
                  <div className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${driveConnected ? "bg-[#DCFCE7]" : "bg-[var(--bg)]"}`}>
                      <svg width="16" height="16" viewBox="0 0 87.3 78" fill={driveConnected ? "#15803D" : "var(--text-muted)"} xmlns="http://www.w3.org/2000/svg">
                        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 0 0 2.1 8zM43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L.65 49.4A15.92 15.92 0 0 0 0 53h27.5zM73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0 0 88.3 53H60.8l5.85 11.5zM43.65 25L57.4 1.2C56.05.45 54.5 0 52.85 0H35.45c-1.65 0-3.2.45-4.55 1.2zM59.8 53H27.5l-13.75 23.8c1.35.8 2.9 1.2 4.55 1.2h50.7c1.65 0 3.2-.45 4.55-1.2zM60.8 53l-16.95-29.5-16.95 29.5zM73.55 76.8z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium">
                        {driveConnected ? "Google Drive connected" : "Google Drive not connected"}
                      </div>
                      <div className="text-[11.5px] text-[var(--text-muted)]">
                        {driveConnected ? "Audio files sync between desktop and mobile." : "Connect to sync audio files to mobile."}
                      </div>
                      {driveConnectError && (
                        <div className="text-[11.5px] text-[#DC2626] mt-0.5">{driveConnectError}</div>
                      )}
                    </div>
                    {driveConnected ? (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={handleDriveConnect}
                          disabled={driveConnecting}
                          className="px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] transition-all disabled:opacity-50"
                        >
                          {driveConnecting ? "Connecting…" : "Switch account"}
                        </button>
                        <button
                          onClick={handleDriveDisconnect}
                          className="px-3 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[12px] font-medium text-[var(--text-secondary)] hover:border-[#DC2626] hover:text-[#DC2626] transition-all"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleDriveConnect}
                        disabled={driveConnecting}
                        className="flex-shrink-0 px-3 py-[6px] rounded-[6px] bg-[var(--theme)] text-[var(--theme-text)] text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {driveConnecting ? "Connecting…" : "Connect Drive"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Google Drive danger zone */}
                <div className="mb-7">
                  {sectionHeader("Google Drive — Danger Zone")}
                  <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-[var(--radius)]">
                    <div className="text-[13px] font-medium text-[#991B1B] mb-1">Delete all Drive files & reset sync</div>
                    <p className="text-[12px] text-[#B91C1C] leading-relaxed mb-3">
                      Permanently deletes every audio file Reprise has uploaded to your Google Drive and clears all sync records.
                      The mobile app will lose access to all audio until you re-sync each song.
                      Your local files are not affected.
                    </p>
                    <button
                      onClick={handleFullDriveReset}
                      disabled={driveResetStatus === "running"}
                      className="px-3 py-[6px] rounded-[6px] bg-[#DC2626] text-white text-[12px] font-medium hover:bg-[#B91C1C] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {driveResetStatus === "running" ? (
                        <>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                            <circle cx="12" cy="12" r="10" /><path d="M12 6v6" />
                          </svg>
                          Deleting…
                        </>
                      ) : "Delete all & reset"}
                    </button>
                    {driveResetMsg && (
                      <p className={`mt-2 text-[11.5px] leading-relaxed ${driveResetStatus === "error" ? "text-[#DC2626]" : "text-[#15803D]"}`}>
                        {driveResetMsg}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ AUDIO I/O TAB ═══ */}
            {activeTab === "audio" && (
              <div>
                {/* Input device */}
                <div className="mb-7">
                  {sectionHeader("Microphone (input)")}
                  <select
                    value={audioDevices.selectedInputId}
                    onChange={(e) => audioDevices.setSelectedInputId(e.target.value)}
                    className="w-full px-3 py-[9px] pr-8 rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] outline-none appearance-none cursor-pointer focus:border-[var(--theme)] transition-colors"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                    }}
                  >
                    <option value="">System default</option>
                    {audioDevices.inputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                    ))}
                  </select>

                  {/* Live input level meter */}
                  <div className="mt-4">
                    <div className="text-[11.5px] text-[var(--text-muted)] mb-2">Input level</div>
                    <div className="flex items-end gap-[3px] h-[28px]">
                      {Array.from({ length: 20 }, (_, i) => {
                        const threshold = (i + 1) / 20;
                        const active = audioLevel >= threshold;
                        const color = i >= 17 ? "#DC2626" : i >= 13 ? "#F59E0B" : "#22C55E";
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-[2px] transition-all duration-75"
                            style={{
                              height: `${8 + i * 1.1}px`,
                              backgroundColor: active ? color : "var(--border)",
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Output device */}
                <div className="mb-7">
                  {sectionHeader("Speaker (output)")}
                  <select
                    value={audioDevices.selectedOutputId}
                    onChange={(e) => audioDevices.setSelectedOutputId(e.target.value)}
                    className="w-full px-3 py-[9px] pr-8 rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-[13px] outline-none appearance-none cursor-pointer focus:border-[var(--theme)] transition-colors"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                    }}
                  >
                    <option value="">System default</option>
                    {audioDevices.outputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                    ))}
                  </select>
                </div>

                {/* Recording playback gain */}
                <div className="mb-7">
                  {sectionHeader("Recording playback")}
                  {settingRow(
                    "Playback gain",
                    "Boost volume when listening back to your recordings",
                    <div className="flex items-center gap-3 w-[200px]">
                      <input
                        type="range"
                        min="2"
                        max="60"
                        step="1"
                        value={Math.round(recordingPlaybackGain * 2)}
                        onChange={(e) => setRecordingPlaybackGain(Number(e.target.value) / 2)}
                        className="flex-1 h-1 bg-[var(--border)] rounded-sm outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.2)] [&::-webkit-slider-thumb]:cursor-pointer"
                      />
                      <span className="text-[12px] font-medium text-[var(--text-secondary)] min-w-[40px] text-right">
                        {recordingPlaybackGain % 1 === 0 ? `${recordingPlaybackGain}x` : `${recordingPlaybackGain.toFixed(1)}x`}
                      </span>
                    </div>,
                    true,
                  )}
                </div>

                {/* Mic test */}
                <div className="mb-7">
                  {sectionHeader("Microphone test")}
                  <p className="text-[13px] text-[var(--text-secondary)] leading-[1.7] mb-4">
                    Record a short clip and play it back immediately to verify your microphone is working correctly.
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleTestMic}
                      className={`flex items-center gap-[6px] px-[18px] py-2 rounded-[7px] text-[13px] font-medium border-none cursor-pointer transition-all ${
                        testState === "recording"
                          ? "bg-[#DC2626] text-white hover:opacity-85 animate-pulse"
                          : testState === "playing"
                          ? "bg-[var(--theme)] text-white hover:opacity-85"
                          : "bg-[var(--accent)] text-white hover:opacity-80 hover:-translate-y-px"
                      }`}
                    >
                      {testState === "recording" ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                          Stop recording
                        </>
                      ) : testState === "playing" ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                          Stop playback
                        </>
                      ) : (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="6" fill="currentColor" />
                          </svg>
                          Test microphone
                        </>
                      )}
                    </button>
                    {testState === "recording" && (
                      <span className="text-[12px] text-[#DC2626] font-medium">
                        Recording… (auto-stops after 5s)
                      </span>
                    )}
                    {testState === "playing" && (
                      <span className="text-[12px] text-[var(--theme-text)] font-medium">
                        Playing back…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ DOWNLOADS TAB ═══ */}
            {isDesktop && activeTab === "downloads" && (
              <div>
                {/* Status checks */}
                <div className="mb-7">
                  {sectionHeader("YouTube downloads")}

                  <div className="flex flex-col gap-1.5">
                    {/* yt-dlp status */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">yt-dlp</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                          Required for downloading audio from YouTube
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {ytdlpVersion === undefined ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : ytdlpVersion ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            v{ytdlpVersion}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Not found
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Cookie file status */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">Cookie file</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5] font-mono">
                          {COOKIES_PATH}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {cookieExists === null ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : cookieExists ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Found
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Missing
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3.5">
                    <button
                      onClick={runChecks}
                      disabled={checking}
                      className="flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium border-none cursor-pointer hover:opacity-80 hover:-translate-y-px transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={checking ? "animate-spin" : ""}>
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                      </svg>
                      {checking ? "Checking..." : "Check status"}
                    </button>
                    <button
                      onClick={() => open("file:///C:/Reprise")}
                      className="flex items-center gap-[5px] px-4 py-2 rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-secondary)] text-[13px] font-medium cursor-pointer hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      Open folder
                    </button>
                  </div>
                </div>

                {/* Cookie setup guide */}
                <div className="mb-7">
                  {sectionHeader("Cookie setup guide")}

                  <p className="text-[13px] text-[var(--text-secondary)] leading-[1.7] mb-4">
                    YouTube requires authentication to avoid bot detection. You need to export your browser cookies so yt-dlp can use them for downloads.
                  </p>

                  <div className="flex flex-col gap-3">
                    {[
                      {
                        step: 1,
                        title: "Install a cookie export extension",
                        desc: 'Install "Get cookies.txt LOCALLY" (or similar Netscape cookie exporter) in Chrome.',
                      },
                      {
                        step: 2,
                        title: "Export cookies from YouTube",
                        desc: "Navigate to youtube.com while logged in, then click the extension to export cookies.",
                      },
                      {
                        step: 3,
                        title: "Save the file",
                        desc: `Save the exported file as cookies.txt in the Reprise folder (${COOKIES_PATH}).`,
                      },
                      {
                        step: 4,
                        title: 'Click "Check status" above',
                        desc: "Verify that the cookie file is detected. You're all set!",
                      },
                    ].map((item) => (
                      <div
                        key={item.step}
                        className="flex gap-3.5 px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-semibold mt-0.5"
                          style={{ background: "var(--theme-light)", color: "var(--theme-text)" }}
                        >
                          {item.step}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium mb-0.5">{item.title}</div>
                          <div className="text-[12px] text-[var(--text-muted)] leading-[1.6]">
                            {item.desc}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 p-3.5 rounded-[var(--radius)] bg-[#FFFBEB] border border-[#FDE68A]">
                    <div className="flex gap-2.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <div className="text-[12px] text-[#92400E] leading-[1.6]">
                        Cookies expire periodically. If downloads start failing with "Sign in to confirm you're not a bot", re-export your cookies by repeating the steps above.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Demucs stem separation */}
                <div className="mb-7">
                  {sectionHeader("Stem separation (Demucs)")}

                  <p className="text-[13px] text-[var(--text-secondary)] leading-[1.7] mb-4">
                    Demucs separates audio into vocal and instrumental tracks. All three dependencies below are required.
                  </p>

                  <div className="flex flex-col gap-1.5">
                    {/* Python */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">Python 3.11</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                          Required runtime for Demucs
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {pythonVersion === undefined ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : pythonVersion ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            v{pythonVersion}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Not found
                          </span>
                        )}
                      </div>
                    </div>

                    {/* FFmpeg */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">FFmpeg</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                          Audio decoder for reading song files
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {ffmpegVersion === undefined ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : ffmpegVersion ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            {ffmpegVersion}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Not found
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Demucs */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">Demucs</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                          AI model for vocal/instrumental separation
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {demucsStatus === undefined ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : demucsStatus ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            {demucsStatus}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Not found
                          </span>
                        )}
                      </div>
                    </div>

                    {/* torchcrepe */}
                    <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
                      <div className="flex-1">
                        <div className="text-[13px] font-medium mb-0.5">torchcrepe</div>
                        <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                          Neural pitch tracker for pitch curve visualization
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {torchcrepeStatus === undefined ? (
                          <span className="text-[12px] text-[var(--text-muted)]">Not checked</span>
                        ) : torchcrepeStatus ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#15803D]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            {torchcrepeStatus}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#DC2626]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Not found
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Install instructions */}
                  <div className="mt-4 p-3.5 rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)]">
                    <div className="text-[12.5px] font-medium mb-2">Installation commands</div>
                    <div className="flex flex-col gap-1.5 font-mono text-[12px] text-[var(--text-secondary)]">
                      <div className="px-3 py-1.5 bg-[var(--bg)] rounded">winget install Gyan.FFmpeg</div>
                      <div className="px-3 py-1.5 bg-[var(--bg)] rounded">pip install demucs soundfile</div>
                      <div className="px-3 py-1.5 bg-[var(--bg)] rounded">pip install torchcrepe</div>
                    </div>
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
