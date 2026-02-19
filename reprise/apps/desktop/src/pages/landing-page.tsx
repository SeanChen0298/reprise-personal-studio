import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

const FEATURES = [
  {
    icon: "♪",
    title: "Line-by-line practice",
    desc: "Break any song into lines. Loop, slow down, and drill each one until it's yours before moving on.",
  },
  {
    icon: "✍️",
    title: "Rich lyric annotation",
    desc: "Highlight words with custom tags — falsetto, whisper, breath marks. Your personal shorthand, built into the score.",
  },
  {
    icon: "⏱",
    title: "Timestamp sync",
    desc: "Map each line to its exact moment in the reference audio. Playback jumps to the right place every time.",
  },
  {
    icon: "🎙",
    title: "Studio-style recording",
    desc: "Record line by line or all at once. Compile your best takes into a full song when you're ready.",
  },
  {
    icon: "🎛",
    title: "Vocal removal",
    desc: "Strip the original vocal from any song. Practice against the instrumental only — no competing voice in your ear.",
  },
  {
    icon: "⚡",
    title: "Auto-align lyrics",
    desc: "Drop in your lyrics and let WhisperX map every line to its exact timestamp automatically. No manual tapping needed.",
  },
  {
    icon: "📈",
    title: "Visible progress",
    desc: "Track each line from not started to mastered. Watch the song fill up as you go — progress you can actually see.",
  },
  {
    icon: "🎯",
    title: "Pitch accuracy analysis",
    desc: "Compare your pitch curve against the original vocal. See exactly where you were sharp, flat, or drifted — line by line.",
  },
  {
    icon: "☁️",
    title: "Sync across devices",
    desc: "Desktop for production. Mobile for practice on the go. Your songs, annotations, and recordings stay in sync.",
  },
];

const THEME_SWATCHES = [
  { color: "#2563EB", light: "#EFF6FF", text: "#1D4ED8", label: "Blue" },
  { color: "#111111", light: "#F5F5F5", text: "#111111", label: "Midnight" },
  { color: "#7C3AED", light: "#F5F3FF", text: "#6D28D9", label: "Violet" },
  { color: "#059669", light: "#ECFDF5", text: "#047857", label: "Emerald" },
  { color: "#DC2626", light: "#FEF2F2", text: "#B91C1C", label: "Red" },
  { color: "#D97706", light: "#FFFBEB", text: "#B45309", label: "Amber" },
];

const WAVEFORM_HEIGHTS = [
  0.3, 0.5, 0.8, 0.6, 0.9, 0.7, 0.4, 0.6, 1, 0.8, 0.5, 0.7, 0.9, 0.6, 0.4,
  0.8, 0.6, 0.3, 0.7, 0.9, 0.5, 0.8, 0.6, 0.4, 0.7, 1, 0.8, 0.5, 0.6, 0.9,
  0.7, 0.4, 0.6, 0.8, 0.5, 0.3, 0.7, 0.9, 0.6, 0.4,
];

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function LandingPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [scrolled, setScrolled] = useState(false);
  const [activeTheme, setActiveTheme] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (user) navigate("/home", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function applyTheme(index: number) {
    setActiveTheme(index);
    const t = THEME_SWATCHES[index];
    document.documentElement.style.setProperty("--theme", t.color);
    document.documentElement.style.setProperty("--theme-light", t.light);
    document.documentElement.style.setProperty("--theme-text", t.text);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    try {
      await signUpWithEmail(email, password);
    } catch {
      /* error is in store */
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--bg)]">
      {/* ─── NAV ─── */}
      <nav
        ref={navRef}
        className={`fixed top-0 left-0 right-0 z-50 px-12 py-[18px] flex items-center justify-between backdrop-blur-2xl transition-[border-color] duration-300 ${
          scrolled
            ? "border-b border-[var(--border)] bg-[#f9f9f9]/88"
            : "border-b border-transparent bg-[#f9f9f9]/88"
        }`}
      >
        <div className="font-serif text-[21px] text-[var(--text-primary)] flex items-center gap-2 tracking-[-0.3px]">
          Reprise
          <span className="w-[7px] h-[7px] rounded-full bg-[var(--theme)] inline-block mb-0.5" />
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate("/login")}
            className="px-4 py-[7px] rounded-[7px] bg-transparent text-[var(--text-secondary)] font-sans text-sm font-medium cursor-pointer hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-colors"
          >
            Log in
          </button>
          <button
            onClick={() => navigate("/signup")}
            className="px-[18px] py-[7px] rounded-[7px] bg-[var(--accent)] text-white font-sans text-sm font-medium cursor-pointer hover:opacity-80 transition-opacity"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* ─── THEME PICKER ─── */}
      <div className="fixed bottom-7 right-7 z-[200] bg-[var(--surface)] border border-[var(--border)] rounded-[14px] px-4 py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.1)] flex flex-col gap-2.5 min-w-[160px]">
        <div className="text-[11px] font-medium tracking-[0.06em] uppercase text-[var(--text-muted)]">
          Theme colour
        </div>
        <div className="flex gap-2 flex-wrap">
          {THEME_SWATCHES.map((s, i) => (
            <button
              key={s.label}
              title={s.label}
              onClick={() => applyTheme(i)}
              className={`w-[22px] h-[22px] rounded-full cursor-pointer transition-transform hover:scale-[1.15] ${
                activeTheme === i
                  ? "border-2 border-[var(--text-primary)]"
                  : "border-2 border-transparent"
              }`}
              style={{ background: s.color }}
            />
          ))}
        </div>
      </div>

      {/* ─── HERO ─── */}
      <section className="pt-[148px] pb-[100px] px-12 max-w-[1100px] mx-auto grid grid-cols-2 gap-[72px] items-center">
        <div className="animate-fade-up">
          <div className="inline-flex items-center gap-2 text-[11.5px] font-medium tracking-[0.09em] uppercase text-[var(--theme-text)] mb-[22px]">
            <span className="w-[18px] h-[1.5px] bg-[var(--theme)] block" />
            Personal practice studio
          </div>
          <h1 className="font-serif text-[54px] leading-[1.1] tracking-[-1.5px] text-[var(--text-primary)] mb-[22px]">
            Master every
            <br />
            <em className="italic text-[var(--theme)]">line</em> of every
            <br />
            song.
          </h1>
          <p className="text-base leading-[1.75] text-[var(--text-secondary)] font-light mb-[38px] max-w-[400px]">
            Reprise is a focused practice environment for singers learning songs
            line by line — with annotation, reference playback, and recording
            built in.
          </p>
          <div className="flex items-center gap-3.5">
            <button
              onClick={() => navigate("/signup")}
              className="px-[26px] py-3 rounded-[9px] bg-[var(--accent)] text-white font-sans text-sm font-medium cursor-pointer flex items-center gap-2 hover:opacity-[0.82] hover:-translate-y-px transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start practicing
            </button>
            <button className="px-[26px] py-3 rounded-[9px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-primary)] font-sans text-sm font-medium cursor-pointer hover:border-[#aaa] hover:bg-[var(--surface)] transition-all">
              See how it works
            </button>
          </div>
        </div>

        {/* App preview */}
        <div className="animate-fade-up [animation-delay:0.12s]">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden shadow-[0_2px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)]">
            {/* Titlebar */}
            <div className="px-3.5 py-2.5 border-b border-[var(--border-subtle)] flex items-center gap-1.5 bg-[var(--bg)]">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <span className="text-[11.5px] text-[var(--text-muted)] ml-1.5">
                Reprise — Prema
              </span>
            </div>
            {/* Body */}
            <div className="p-[18px]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium mb-0.5">Prema</div>
                  <div className="text-[11.5px] text-[var(--text-muted)]">
                    Fujii Kaze
                  </div>
                </div>
                <div className="text-[10.5px] font-medium text-[var(--theme-text)] bg-[var(--theme-light)] px-[9px] py-[3px] rounded-[20px]">
                  35% mastered
                </div>
              </div>
              <div className="h-0.5 bg-[var(--border-subtle)] rounded-sm mb-4 overflow-hidden">
                <div className="h-full w-[35%] bg-[var(--theme)] rounded-sm" />
              </div>
              {/* Annotation legend */}
              <div className="flex gap-2.5 mb-2.5 flex-wrap">
                <div className="flex items-center gap-[5px] text-[10px] font-medium text-[var(--text-muted)]">
                  <div className="w-2 h-2 rounded-sm bg-[#DBEAFE] border border-[#93C5FD]" />
                  Falsetto
                </div>
                <div className="flex items-center gap-[5px] text-[10px] font-medium text-[var(--text-muted)]">
                  <div className="w-2 h-2 rounded-sm bg-[#DCFCE7] border border-[#86EFAC]" />
                  Whisper
                </div>
                <div className="flex items-center gap-[5px] text-[10px] font-medium text-[var(--text-muted)]">
                  <div className="w-2 h-2 rounded-sm bg-[#FEE2E2] border border-[#FCA5A5]" />
                  Accent
                </div>
              </div>
              {/* Lines */}
              <div className="flex flex-col gap-[5px]">
                <div className="px-[11px] py-[9px] rounded-[7px] border border-[var(--border-subtle)] flex items-center gap-[9px] text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shrink-0" />
                  <span>
                    Don&apos;t you know that{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#DBEAFE] text-[#1D4ED8]">
                      you are love
                    </span>{" "}
                    itself
                  </span>
                </div>
                <div className="px-[11px] py-[9px] rounded-[7px] border border-[var(--theme)] bg-[var(--theme-light)] flex items-center gap-[9px] text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--theme)] shrink-0" />
                  <span>
                    I don&apos;t{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#FEE2E2] text-[#B91C1C]">
                      lie
                    </span>{" "}
                    — I&apos;m all about{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#DBEAFE] text-[#1D4ED8]">
                      the truth
                    </span>
                  </span>
                </div>
                <div className="px-[11px] py-[9px] rounded-[7px] border border-[var(--border-subtle)] flex items-center gap-[9px] text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--border)] border-[1.5px] border-[#ccc] shrink-0" />
                  <span>
                    Follow my{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#DCFCE7] text-[#15803D]">
                      tender heart
                    </span>{" "}
                    and I&apos;ll{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#FEE2E2] text-[#B91C1C]">
                      win
                    </span>
                  </span>
                </div>
                <div className="px-[11px] py-[9px] rounded-[7px] border border-[var(--border-subtle)] flex items-center gap-[9px] text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--border)] border-[1.5px] border-[#ccc] shrink-0" />
                  <span>
                    Filling my{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#DCFCE7] text-[#15803D]">
                      heart
                    </span>{" "}
                    with your{" "}
                    <span className="rounded-[3px] px-0.5 py-px font-medium bg-[#DBEAFE] text-[#1D4ED8]">
                      affection
                    </span>
                  </span>
                </div>
              </div>
              {/* Playback */}
              <div className="mt-3.5 px-3 py-2.5 bg-[var(--bg)] rounded-[9px] flex items-center gap-2.5">
                <div className="w-[30px] h-[30px] rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 cursor-pointer">
                  <svg
                    width="11"
                    height="13"
                    viewBox="0 0 12 14"
                    fill="none"
                  >
                    <path d="M1 1l10 6-10 6V1z" fill="white" />
                  </svg>
                </div>
                <div className="flex-1 h-[26px] flex items-center gap-0.5">
                  {WAVEFORM_HEIGHTS.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-sm ${
                        i < 14
                          ? "bg-[var(--theme)]"
                          : "bg-[var(--border)]"
                      }`}
                      style={{
                        height: `${Math.max(3, h * 24)}px`,
                        animation: `wave 1.1s ease-in-out infinite alternate`,
                        animationDelay: `${(i * 0.045) % 1.1}s`,
                      }}
                    />
                  ))}
                </div>
                <div className="text-[11px] font-medium text-[var(--text-muted)] bg-[var(--border-subtle)] px-[7px] py-[3px] rounded-[5px]">
                  0.75×
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="px-12 py-[72px] max-w-[1100px] mx-auto">
        <div className="text-[11.5px] font-medium tracking-[0.08em] uppercase text-[var(--text-muted)] mb-10 flex items-center gap-3.5 after:content-[''] after:flex-1 after:h-px after:bg-[var(--border-subtle)]">
          What Reprise does
        </div>
        <div className="grid grid-cols-4 gap-px bg-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-[14px] overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[var(--surface)] p-7 px-6">
              <div className="w-[34px] h-[34px] rounded-lg bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center mb-3.5 text-[15px]">
                {f.icon}
              </div>
              <div className="text-sm font-medium mb-[7px]">{f.title}</div>
              <div className="text-[13px] leading-[1.65] text-[var(--text-secondary)] font-light">
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── AUTH SECTION ─── */}
      <section className="px-12 py-[72px] pb-[120px] max-w-[1100px] mx-auto grid grid-cols-2 gap-20 items-center">
        <div>
          <h2 className="font-serif text-[38px] leading-[1.15] tracking-[-1px] mb-3.5">
            Your studio,
            <br />
            wherever you are.
          </h2>
          <p className="text-[15px] leading-[1.72] text-[var(--text-secondary)] font-light">
            Create a free account to sync your songs, annotations, and
            recordings across desktop and mobile. Everything stays on your own
            storage — no subscription needed.
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] p-8 shadow-[0_4px_32px_rgba(0,0,0,0.05)] animate-fade-up [animation-delay:0.1s]">
          <h3 className="font-serif text-[22px] mb-1">Create account</h3>
          <p className="text-[13px] text-[var(--text-muted)] mb-6">
            Free forever. Your data stays yours.
          </p>
          <button
            onClick={() => signInWithGoogle()}
            className="w-full py-[11px] rounded-[9px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] font-medium cursor-pointer flex items-center justify-center gap-[9px] hover:border-[#aaa] hover:bg-[var(--bg)] transition-all mb-[18px]"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <div className="flex items-center gap-3 mb-[18px]">
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
            <span className="text-xs text-[var(--text-muted)]">or</span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          </div>
          <form onSubmit={handleSignUp}>
            <div className="mb-3">
              <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all focus:border-[var(--theme)] focus:bg-[var(--surface)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div className="mb-3">
              <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
                Password
              </label>
              <input
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all focus:border-[var(--theme)] focus:bg-[var(--surface)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-[11px] rounded-[9px] bg-[var(--accent)] text-white font-sans text-[13.5px] font-medium cursor-pointer mt-1 hover:opacity-[0.82] transition-opacity"
            >
              Create account
            </button>
          </form>
          <div className="text-center mt-[18px] text-[12.5px] text-[var(--text-muted)]">
            Already have an account?{" "}
            <a
              onClick={() => navigate("/login")}
              className="text-[var(--text-primary)] font-medium no-underline border-b border-[var(--border)] cursor-pointer hover:border-[var(--text-primary)] transition-colors"
            >
              Log in
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-[var(--border-subtle)] px-12 py-6 flex items-center justify-between">
        <div className="font-serif text-[15px] text-[var(--text-muted)] flex items-center gap-1.5">
          Reprise{" "}
          <span className="w-[5px] h-[5px] rounded-full bg-[var(--theme)] inline-block" />
        </div>
        <div className="text-[12.5px] text-[var(--text-muted)]">
          Built for singers who take their craft seriously.
        </div>
      </footer>
    </div>
  );
}
