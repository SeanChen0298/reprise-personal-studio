import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../layouts/auth-layout";
import { useAuthStore } from "../stores/auth-store";

export function ForgotPasswordPage() {
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setEmailError(true);
      return;
    }
    try {
      await resetPassword(email);
      setSent(true);
    } catch {
      /* error in store */
    }
  }

  async function handleResend() {
    try {
      await resetPassword(email);
      setResent(true);
    } catch {
      /* ignore */
    }
  }

  const leftContent = (
    <>
      <div className="font-serif text-4xl leading-[1.18] tracking-[-0.8px] text-white mb-5">
        We&apos;ve got
        <br />
        you <em className="italic text-[#93C5FD]">covered</em>.
      </div>
      <div className="text-sm text-white/45 leading-[1.7] font-light max-w-[320px] mb-12">
        Reset links expire after 30 minutes. Check your spam folder if you
        don&apos;t see anything in your inbox.
      </div>

      {/* Security note */}
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-[10px] p-4 px-[18px] flex gap-3 items-start">
        <div className="w-8 h-8 rounded-lg bg-[rgba(37,99,235,0.15)] border border-[rgba(147,197,253,0.2)] flex items-center justify-center shrink-0">
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
            <path
              d="M7 1L1.5 3.5V7.5C1.5 10.8 4 13.9 7 15C10 13.9 12.5 10.8 12.5 7.5V3.5L7 1Z"
              stroke="#93C5FD"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path
              d="M4.5 8L6.5 10L9.5 6.5"
              stroke="#93C5FD"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[12.5px] font-medium text-white/70 mb-[3px]">
            Your data stays private
          </div>
          <div className="text-xs text-white/35 leading-[1.55] font-light">
            We never share your email or practice data. Reset links are
            single-use and expire automatically.
          </div>
        </div>
      </div>
    </>
  );

  return (
    <AuthLayout leftContent={leftContent}>
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] no-underline mb-8 hover:text-[var(--text-primary)] transition-colors group"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="group-hover:-translate-x-0.5 transition-transform"
        >
          <path
            d="M9 2L4 7L9 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to log in
      </Link>

      {!sent ? (
        /* ─── FORM STATE ─── */
        <div className="animate-fade-up">
          <div className="font-serif text-[27px] tracking-[-0.5px] mb-1">
            Reset your password
          </div>
          <div className="text-[13.5px] text-[var(--text-muted)] mb-7 font-light leading-[1.6]">
            Enter the email you signed up with and we&apos;ll send you a reset
            link.
          </div>

          <form onSubmit={handleSend}>
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
                  setEmailError(false);
                }}
                className={`w-full px-[13px] py-[9px] rounded-[7px] border-[1.5px] bg-[var(--surface)] text-[var(--text-primary)] font-sans text-[13.5px] outline-none transition-all placeholder:text-[var(--text-muted)] ${
                  emailError
                    ? "border-[#DC2626] shadow-[0_0_0_3px_rgba(220,38,38,0.09)]"
                    : "border-[var(--border)] focus:border-[var(--theme)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.09)]"
                }`}
              />
            </div>

            <button
              type="submit"
              className="w-full py-[11px] rounded-[9px] bg-[var(--accent)] text-white font-sans text-[13.5px] font-medium cursor-pointer mt-1.5 hover:opacity-[0.82] hover:-translate-y-px transition-all"
            >
              Send reset link
            </button>
          </form>

          <div className="text-center mt-[22px] text-[13px] text-[var(--text-muted)]">
            Remembered it?{" "}
            <Link
              to="/login"
              className="text-[var(--text-primary)] font-medium no-underline border-b border-[var(--border)] hover:border-[var(--text-primary)] transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      ) : (
        /* ─── SUCCESS STATE ─── */
        <div className="animate-fade-up">
          <div className="w-[52px] h-[52px] rounded-full bg-[#DCFCE7] border border-[#86EFAC] flex items-center justify-center mb-[22px]">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path
                d="M4 11.5L8.5 16L18 6"
                stroke="#16A34A"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="font-serif text-[27px] tracking-[-0.5px] mb-2">
            Check your inbox
          </div>
          <div className="text-[13.5px] text-[var(--text-secondary)] leading-[1.65] font-light mb-7">
            We sent a reset link to
            <br />
            <span className="inline-block font-medium text-[var(--text-primary)] bg-[var(--border-subtle)] px-2 py-0.5 rounded-[5px] text-[13px]">
              {email}
            </span>
            <br />
            <br />
            Click the link in that email to set a new password. It expires in 30
            minutes.
          </div>

          <Link
            to="/login"
            className="block w-full py-[11px] rounded-[9px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-primary)] font-sans text-[13.5px] font-medium text-center no-underline hover:border-[#aaa] hover:bg-[var(--surface)] transition-all mt-4"
          >
            Back to log in
          </Link>

          <div className="text-[12.5px] text-[var(--text-muted)] mt-5 pt-5 border-t border-[var(--border-subtle)]">
            Didn&apos;t get it? Check your spam or{" "}
            <button
              onClick={handleResend}
              className={`bg-transparent border-0 font-sans text-[12.5px] font-medium cursor-pointer p-0 border-b transition-colors ${
                resent
                  ? "text-[#22C55E] border-b-[#86EFAC] pointer-events-none"
                  : "text-[var(--text-primary)] border-b-[var(--border)] hover:border-b-[var(--text-primary)]"
              }`}
            >
              {resent ? "Sent!" : "resend the link"}
            </button>
            .
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
