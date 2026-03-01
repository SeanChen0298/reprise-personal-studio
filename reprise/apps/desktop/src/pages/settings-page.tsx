import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { exists } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import { Sidebar } from "../components/sidebar";
import { useAuthStore } from "../stores/auth-store";
import { checkYtDlpInstalled, checkPythonInstalled, checkFfmpegInstalled, checkDemucsInstalled, COOKIES_PATH } from "../lib/audio-download";
import { useHighlightStore } from "../lib/highlight-config";

type Tab = "highlights" | "account" | "preferences" | "downloads";

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
  const highlights = useHighlightStore((s) => s.highlights);
  const addHighlight = useHighlightStore((s) => s.addHighlight);
  const removeHighlight = useHighlightStore((s) => s.removeHighlight);
  const [newHighlightName, setNewHighlightName] = useState("");
  const [activeTheme, setActiveTheme] = useState("blue");
  const [speed, setSpeed] = useState(100);
  const [autoPlay, setAutoPlay] = useState(true);
  const [loopMode, setLoopMode] = useState("3");
  const [countIn, setCountIn] = useState("2");
  const [showWaveforms, setShowWaveforms] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [autoSync, setAutoSync] = useState(true);

  // Downloads tab state
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null | undefined>(undefined);
  const [cookieExists, setCookieExists] = useState<boolean | null>(null);
  const [pythonVersion, setPythonVersion] = useState<string | null | undefined>(undefined);
  const [ffmpegVersion, setFfmpegVersion] = useState<string | null | undefined>(undefined);
  const [demucsStatus, setDemucsStatus] = useState<string | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  const runChecks = useCallback(async () => {
    setChecking(true);
    try {
      const [version, cookieOk, python, ffmpeg, demucs] = await Promise.all([
        checkYtDlpInstalled(),
        exists(COOKIES_PATH),
        checkPythonInstalled(),
        checkFfmpegInstalled(),
        checkDemucsInstalled(),
      ]);
      setYtdlpVersion(version);
      setCookieExists(cookieOk);
      setPythonVersion(python);
      setFfmpegVersion(ffmpeg);
      setDemucsStatus(demucs);
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
    setActiveTheme(key);
    const t = THEME_OPTIONS.find((o) => o.key === key);
    if (t) {
      document.documentElement.style.setProperty("--theme", t.color);
      document.documentElement.style.setProperty("--theme-light", t.light);
      document.documentElement.style.setProperty("--theme-text", t.text);
    }
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
              {tabDef(
                "downloads",
                "Downloads",
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
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
                      <div
                        key={h.id}
                        className="flex items-center gap-3 px-4 py-3 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow"
                      >
                        <div
                          className="w-7 h-7 rounded-[6px] flex-shrink-0 border border-black/[0.06] cursor-pointer hover:scale-110 transition-transform"
                          style={{ background: h.bg }}
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
                          <button className="w-7 h-7 rounded-[6px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-all">
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
                      onChange={(e) => setCountIn(e.target.value)}
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
                    "Show waveforms in library",
                    "Display audio waveforms on song cards",
                    toggle(showWaveforms, setShowWaveforms),
                  )}

                  {settingRow(
                    "Confirm before deleting songs",
                    "Show a confirmation dialog when removing songs",
                    toggle(confirmDelete, setConfirmDelete),
                  )}

                  {settingRow(
                    "Auto-sync to cloud",
                    "Automatically sync progress and recordings to Supabase",
                    toggle(autoSync, setAutoSync),
                    true,
                  )}
                </div>
              </div>
            )}

            {/* ═══ DOWNLOADS TAB ═══ */}
            {activeTab === "downloads" && (
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
                  </div>

                  {/* Install instructions */}
                  <div className="mt-4 p-3.5 rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)]">
                    <div className="text-[12.5px] font-medium mb-2">Installation commands</div>
                    <div className="flex flex-col gap-1.5 font-mono text-[12px] text-[var(--text-secondary)]">
                      <div className="px-3 py-1.5 bg-[var(--bg)] rounded">winget install Gyan.FFmpeg</div>
                      <div className="px-3 py-1.5 bg-[var(--bg)] rounded">pip install demucs torchcodec</div>
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
