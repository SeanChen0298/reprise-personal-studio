import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSongStore } from "./stores/song-store";
import { useTaskQueueProcessor } from "./hooks/use-task-queue-processor";
import { useAutoProcess } from "./hooks/use-auto-process";
import { ProtectedRoute } from "./components/protected-route";
import { LibraryPage } from "./pages/library-page";
import { ImportUrlPage } from "./pages/import-url-page";
import { AddSongPage } from "./pages/add-song-page";
import { SongDetailPage } from "./pages/song-detail-page";
import { SongSetupPage } from "./pages/song-setup-page";
import { LyricsInputPage } from "./pages/lyrics-input-page";
import { SettingsPage } from "./pages/settings-page";
import { PracticePage } from "./pages/practice";
import { TimestampPage } from "./pages/timestamp-page";
import { RecordingsPage } from "./pages/recordings-page";

export function App() {
  const loadAllData = useSongStore((s) => s.loadAllData);

  // Load all songs/lines/recordings/sections from the local DB on startup.
  // (Previously triggered by auth-store.initialize(), which is now removed.)
  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useTaskQueueProcessor();
  useAutoProcess();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />

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
          path="/song/:id"
          element={
            <ProtectedRoute>
              <SongDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/song/:id/setup"
          element={
            <ProtectedRoute>
              <SongSetupPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/song/:id/practice"
          element={
            <ProtectedRoute>
              <PracticePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/song/:id/timestamps"
          element={
            <ProtectedRoute>
              <TimestampPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/song/:id/lyrics"
          element={
            <ProtectedRoute>
              <LyricsInputPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/song/:id/recordings"
          element={
            <ProtectedRoute>
              <RecordingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
