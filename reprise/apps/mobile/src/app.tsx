import { useEffect } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./stores/auth-store";
import AuthPage from "./pages/auth-page";
import SongsPage from "./pages/songs-page";
import PracticePage from "./pages/practice-page";
import SettingsPage from "./pages/settings-page";

const TABS = [
  {
    to: "/",
    end: true,
    label: "Songs",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13" />
        <circle cx="6" cy="19" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    to: "/practice",
    end: false,
    label: "Practice",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    to: "/settings",
    end: false,
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-6 w-6">
        <circle cx="12" cy="12" r="3" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    ),
  },
] as const;

function TabLayout() {
  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>

      <nav
        className="flex shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map(({ to, end, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex flex-1 flex-col items-center justify-center gap-1 py-3",
                "min-h-[60px] text-xs font-medium transition-colors",
                isActive
                  ? "text-[var(--color-theme-light)]"
                  : "text-[var(--color-text-muted)] active:text-[var(--color-text)]",
              ].join(" ")
            }
          >
            {icon}
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-bg)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-theme)] border-t-transparent" />
    </div>
  );
}

export default function App() {
  const { user, loading, init } = useAuthStore();

  useEffect(() => {
    return init();
  }, [init]);

  if (loading) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <AuthPage />}
        />
        <Route element={user ? <TabLayout /> : <Navigate to="/login" replace />}>
          <Route index element={<SongsPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="practice/:id" element={<PracticePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
