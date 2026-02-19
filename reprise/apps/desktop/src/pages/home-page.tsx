import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center">
      <div className="font-serif text-[21px] text-[var(--text-primary)] flex items-center gap-2 mb-8">
        Reprise
        <span className="w-[7px] h-[7px] rounded-full bg-[var(--theme)] mb-0.5 shrink-0" />
      </div>

      <h1 className="font-serif text-3xl tracking-[-0.5px] mb-3">
        Welcome to Reprise
      </h1>
      <p className="text-sm text-[var(--text-muted)] mb-8">
        Signed in as{" "}
        <span className="font-medium text-[var(--text-primary)]">
          {user?.email}
        </span>
      </p>

      <button
        onClick={handleSignOut}
        className="px-6 py-2.5 rounded-[9px] border-[1.5px] border-[var(--border)] bg-transparent text-[var(--text-primary)] font-sans text-sm font-medium cursor-pointer hover:border-[#aaa] hover:bg-[var(--surface)] transition-all"
      >
        Sign out
      </button>
    </div>
  );
}
