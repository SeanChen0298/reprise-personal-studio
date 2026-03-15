import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useNavigate } from "react-router-dom";
import { useDriveSyncStore } from "../stores/drive-sync-store";
import { useTaskQueueStore } from "../stores/task-queue-store";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const syncingCount = useDriveSyncStore((s) => s.syncingIds.length);
  const queueTasks = useTaskQueueStore((s) => s.tasks);
  const runningTask = queueTasks.find((t) => t.status === "running");
  const pendingCount = queueTasks.filter((t) => t.status === "pending").length;

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const navItem = (to: string, label: string, icon: React.ReactNode) => {
    const active = location.pathname === to;
    return (
      <Link
        to={to}
        className={[
          "flex items-center gap-[9px] px-[10px] py-2 rounded-[7px] text-[13.5px] font-medium transition-colors no-underline",
          active
            ? "bg-[#F0F0F0] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {icon}
        {label}
      </Link>
    );
  };

  return (
    <aside className="w-[220px] h-screen bg-[var(--surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-[18px] pt-[18px] pb-4 border-b border-[var(--border-subtle)]">
        <div className="font-serif text-[18px] text-[var(--text-primary)] flex items-center gap-[7px]">
          Reprise
          <span className="w-[6px] h-[6px] rounded-full bg-[var(--theme)] inline-block" />
        </div>
      </div>

      {/* Nav */}
      <nav className="px-[10px] py-3 flex flex-col gap-0.5 flex-1">
        {navItem(
          "/library",
          "Library",
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
      </nav>

      {/* Task queue panel */}
      {queueTasks.length > 0 && (
        <div className="px-[10px] py-2.5 border-t border-[var(--border-subtle)]">
          <div className="flex items-start gap-[7px] px-[10px] py-[8px] rounded-[7px] bg-[var(--theme-light)]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--theme-text)"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="flex-shrink-0 mt-[1px] animate-spin"
              style={{ animationDuration: "1.4s" }}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[var(--theme-text)] leading-snug">
                {runningTask?.type === "stems" ? "Separating stems" : "Analyzing pitch"}
              </div>
              <div className="text-[11px] text-[var(--theme-text)] opacity-60 truncate">
                {runningTask?.songTitle ?? queueTasks[0].songTitle}
              </div>
              {pendingCount > 0 && (
                <div className="text-[10.5px] text-[var(--theme-text)] opacity-50 mt-[3px]">
                  +{pendingCount} more in queue
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-[10px] py-3 border-t border-[var(--border-subtle)]">
        {syncingCount > 0 && (
          <div className="flex items-center gap-[7px] px-[10px] py-[7px] mb-1.5 rounded-[7px] bg-[var(--theme-light)]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--theme-text)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 animate-spin"
              style={{ animationDuration: "1.4s" }}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span className="text-[12px] font-medium text-[var(--theme-text)] truncate">
              Syncing {syncingCount} song{syncingCount !== 1 ? "s" : ""} to Drive…
            </span>
          </div>
        )}

        <Link
          to="/settings"
          className="flex items-center gap-[9px] px-[10px] py-2 rounded-[7px] text-[13.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)] transition-colors no-underline mb-1.5"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          Settings
        </Link>

        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-[9px] px-[10px] py-2 rounded-[7px] cursor-pointer hover:bg-[var(--bg)] transition-colors bg-transparent border-none text-left"
        >
          <div className="w-[26px] h-[26px] rounded-full bg-[var(--accent)] text-white text-[10.5px] font-semibold flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
              {user?.email?.split("@")[0] ?? "User"}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] truncate">
              {user?.email ?? ""}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
