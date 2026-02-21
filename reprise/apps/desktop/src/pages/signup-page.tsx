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

function CheckIcon() {
  return (
    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
      <path
        d="M1 3.5L3.5 6L8 1"
        stroke="#93C5FD"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getPasswordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["", "#EF4444", "#F59E0B", "#22C55E", "#22C55E"];

const FEATURE_LIST = [
  "Line-by-line lyrics with word-level annotations",
  "Vocal removal and slowed reference playback",
  "Record takes and track mastery per line",
  "Syncs across desktop and mobile",
];

export function SignupPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  useEffect(() => {
    if (user) navigate("/home", { replace: true });
  }, [user, navigate]);

  const score = password.length ? getPasswordScore(password) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { needsConfirmation } = await signUpWithEmail(email, password);
      if (needsConfirmation) {
        setConfirmationSent(true);
      }
      // if no confirmation needed, onAuthStateChange fires and useEffect navigates
    } catch {
      /* error is in store */
    } finally {
      setIsLoading(false);
    }
  }

  const leftContent = (
    <>
      <div className="font-serif text-4xl leading-[1.18] tracking-[-0.8px] text-white mb-10">
        Master every <em className="italic text-[#93C5FD]">line</em>
        <br />
        of every song.
      </div>

      <ul className="flex flex-col gap-[18px]">
        {FEATURE_LIST.map((text) => (
          <li
            key={text}
            className="flex items-start gap-3 text-[13.5px] text-white/65 leading-[1.5] font-light"
          >
            <span className="w-[18px] h-[18px] rounded-full bg-[rgba(37,99,235,0.2)] border border-[rgba(147,197,253,0.35)] flex items-center justify-center shrink-0 mt-px">
              <CheckIcon />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </>
  );

  if (confirmationSent) {
    return (
      <AuthLayout leftContent={leftContent}>
        <div className="font-serif text-[27px] tracking-[-0.5px] mb-1">
          Check your email
        </div>
        <div className="text-[13.5px] text-[var(--text-muted)] mb-7 font-light">
          We sent a confirmation link to <strong className="text-[var(--text-primary)]">{email}</strong>. Open it to activate your account.
        </div>
        <div className="text-center mt-[22px] text-[13px] text-[var(--text-muted)]">
          Wrong address?{" "}
          <button
            onClick={() => setConfirmationSent(false)}
            className="text-[var(--text-primary)] font-medium bg-none border-none border-b border-[var(--border)] hover:border-[var(--text-primary)] transition-colors cursor-pointer p-0"
          >
            Go back
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout leftContent={leftContent}>
      <div className="font-serif text-[27px] tracking-[-0.5px] mb-1">
        Create your account
      </div>
      <div className="text-[13.5px] text-[var(--text-muted)] mb-7 font-light">
        Free forever. Your data stays yours.
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

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-[7px] bg-red-50 border border-red-200 text-[13px] text-red-600">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-[5px]">
            Email address
          </label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] placeholder:text-[var(--text-muted)]"
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
            className="w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)] placeholder:text-[var(--text-muted)]"
          />
          {/* Password strength bars */}
          <div className="flex gap-1 mt-[7px]">
            {[1, 2, 3, 4].map((level) => (
              <div
                key={level}
                className="flex-1 h-0.5 rounded-sm transition-colors duration-300"
                style={{
                  background:
                    password.length && level <= score
                      ? STRENGTH_COLORS[score]
                      : "var(--border-subtle)",
                }}
              />
            ))}
          </div>
          {password.length > 0 && (
            <div
              className="text-[11px] mt-[5px] min-h-[14px] transition-colors"
              style={{ color: STRENGTH_COLORS[score] }}
            >
              {STRENGTH_LABELS[score]}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-[11px] rounded-[9px] bg-[var(--accent)] text-white font-sans text-[13.5px] font-medium cursor-pointer mt-1.5 hover:opacity-[0.82] hover:-translate-y-px transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
        >
          {isLoading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <div className="text-[11.5px] text-[var(--text-muted)] mt-[13px] leading-[1.6] text-center">
        By signing up you agree to our{" "}
        <a
          href="#"
          className="text-[var(--text-secondary)] no-underline border-b border-[var(--border)] hover:border-[var(--text-secondary)]"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="#"
          className="text-[var(--text-secondary)] no-underline border-b border-[var(--border)] hover:border-[var(--text-secondary)]"
        >
          Privacy Policy
        </a>
        .
      </div>

      <div className="text-center mt-[22px] text-[13px] text-[var(--text-muted)]">
        Already have an account?{" "}
        <Link
          to="/login"
          className="text-[var(--text-primary)] font-medium no-underline border-b border-[var(--border)] hover:border-[var(--text-primary)] transition-colors"
        >
          Log in
        </Link>
      </div>
    </AuthLayout>
  );
}
