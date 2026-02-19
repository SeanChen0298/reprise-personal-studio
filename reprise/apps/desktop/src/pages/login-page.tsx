import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthLayout } from "../layouts/auth-layout";
import { useAuthStore } from "../stores/auth-store";

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

export function LoginPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) navigate("/home", { replace: true });
  }, [user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Incorrect email or password. Please try again.");
      return;
    }
    try {
      await signInWithEmail(email, password);
    } catch {
      setError("Incorrect email or password. Please try again.");
    }
  }

  const leftContent = (
    <>
      <div className="font-serif text-4xl leading-[1.18] tracking-[-0.8px] text-white mb-10">
        Pick up right
        <br />
        where you <em className="italic text-[#93C5FD]">left off</em>.
      </div>

      {/* Mock "Last practiced" card */}
      <div className="bg-white/5 border border-white/[0.08] rounded-xl p-[18px] px-5 mb-3">
        <div className="text-[10.5px] font-medium tracking-[0.07em] uppercase text-white/30 mb-3.5">
          Last practiced
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-[rgba(37,99,235,0.6)] to-[rgba(147,197,253,0.3)] shrink-0 flex items-center justify-center text-sm">
            ♪
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-white/85 mb-0.5 truncate">
              Prema
            </div>
            <div className="text-xs text-white/35 font-light">Fujii Kaze</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 h-[3px] bg-white/[0.08] rounded-sm overflow-hidden">
            <div className="h-full w-[62%] bg-gradient-to-r from-[#2563EB] to-[#93C5FD] rounded-sm" />
          </div>
          <div className="text-[11px] text-white/35 font-medium shrink-0">
            62% mastered
          </div>
        </div>
      </div>

      {/* Second card */}
      <div className="bg-white/5 border border-white/[0.08] rounded-xl p-[18px] px-5 opacity-50">
        <div className="text-[10.5px] font-medium tracking-[0.07em] uppercase text-white/30 mb-3.5">
          Also in progress
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-[rgba(124,58,237,0.5)] to-[rgba(196,181,253,0.2)] shrink-0 flex items-center justify-center text-sm">
            ♪
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-white/85 mb-0.5 truncate">
              Blinding Lights
            </div>
            <div className="text-xs text-white/35 font-light">The Weeknd</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 h-[3px] bg-white/[0.08] rounded-sm overflow-hidden">
            <div className="h-full w-[28%] bg-gradient-to-r from-[#7C3AED] to-[#C4B5FD] rounded-sm" />
          </div>
          <div className="text-[11px] text-white/35 font-medium shrink-0">
            28% mastered
          </div>
        </div>
      </div>
    </>
  );

  return (
    <AuthLayout leftContent={leftContent}>
      <div className="font-serif text-[27px] tracking-[-0.5px] mb-1">
        Welcome back
      </div>
      <div className="text-[13.5px] text-[var(--text-muted)] mb-7 font-light">
        Sign in to continue practicing.
      </div>

      <button
        onClick={() => signInWithGoogle()}
        className="w-full py-[11px] rounded-[9px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] font-medium cursor-pointer flex items-center justify-center gap-[9px] hover:border-[#aaa] hover:bg-[#f5f5f5] transition-all mb-5"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-[var(--border-subtle)]" />
        <span className="text-xs text-[var(--text-muted)]">or</span>
        <div className="flex-1 h-px bg-[var(--border-subtle)]" />
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
            Email address
          </label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
              clearError();
            }}
            className={`w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all placeholder:text-[var(--text-muted)] ${
              error && !email
                ? "border-[#DC2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.09)]"
                : "border-[var(--border)] focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]"
            }`}
          />
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-[5px]">
            <span className="text-[12.5px] font-medium text-[var(--text-secondary)]">
              Password
            </span>
            <Link
              to="/forgot-password"
              className="text-xs text-[var(--text-muted)] no-underline hover:text-[var(--text-primary)] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
              clearError();
            }}
            className={`w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all placeholder:text-[var(--text-muted)] ${
              error && !password
                ? "border-[#DC2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.09)]"
                : "border-[var(--border)] focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]"
            }`}
          />
          {error && (
            <div className="text-xs text-[#DC2626] mt-[5px]">{error}</div>
          )}
        </div>

        <button
          type="submit"
          className="w-full py-[11px] rounded-[9px] bg-[var(--accent)] text-white font-sans text-[13.5px] font-medium cursor-pointer mt-1.5 hover:opacity-[0.82] hover:-translate-y-px transition-all"
        >
          Log in
        </button>
      </form>

      <div className="text-center mt-[22px] text-[13px] text-[var(--text-muted)]">
        No account yet?{" "}
        <Link
          to="/signup"
          className="text-[var(--text-primary)] font-medium no-underline border-b border-[var(--border)] hover:border-[var(--text-primary)] transition-colors"
        >
          Sign up free
        </Link>
      </div>
    </AuthLayout>
  );
}
