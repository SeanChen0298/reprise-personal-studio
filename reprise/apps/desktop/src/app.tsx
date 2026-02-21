import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/auth-store";
import { ProtectedRoute } from "./components/protected-route";
import { LandingPage } from "./pages/landing-page";
import { LoginPage } from "./pages/login-page";
import { SignupPage } from "./pages/signup-page";
import { ForgotPasswordPage } from "./pages/forgot-password-page";
import { LibraryPage } from "./pages/library-page";
import { ImportUrlPage } from "./pages/import-url-page";
import { AddSongPage } from "./pages/add-song-page";
import { LyricsPage } from "./pages/lyrics-page";

export function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Legacy /home → redirect to /library */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Navigate to="/library" replace />
            </ProtectedRoute>
          }
        />

        <Route
          path="/library"
          element={
            <ProtectedRoute>
              <LibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/import"
          element={
            <ProtectedRoute>
              <ImportUrlPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/add-song"
          element={
            <ProtectedRoute>
              <AddSongPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lyrics/:songId"
          element={
            <ProtectedRoute>
              <LyricsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
