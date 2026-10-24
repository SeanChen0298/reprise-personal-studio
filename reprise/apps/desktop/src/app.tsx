import { useEffect } from "react";
import { emptyTakeTrash } from "./lib/take-trash";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { useSongStore } from "./stores/song-store";
import { useTaskQueueProcessor } from "./hooks/use-task-queue-processor";
import { useAutoProcess } from "./hooks/use-auto-process";
import { useSuggestionsPreload } from "./hooks/use-suggestions-preload";
import { ProtectedRoute } from "./components/protected-route";
import { LibraryPage } from "./pages/library-page";
import { ImportUrlPage } from "./pages/import-url-page";
import { AddSongPage } from "./pages/add-song-page";
import { LyricsInputPage } from "./pages/lyrics-input-page";
import { WorkspacePage } from "./pages/workspace/workspace-page";
import { SettingsPage } from "./pages/settings-page";
import { DiscoverPage } from "./pages/discover-page";

/** Old per-task song pages all live in the song workspace now. */
function ToWorkspace({ setup = false }: { setup?: boolean }) {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/song/${id}${setup ? "?setup=1" : ""}`} replace />;
}

export function App() {
  const loadAllData = useSongStore((s) => s.loadAllData);

  // Load all songs/lines/recordings/sections from the local DB on startup.
  // (Previously triggered by auth-store.initialize(), which is now removed.)
  useEffect(() => {
    loadAllData();
    // Files of takes deleted last time (undo history doesn't survive a restart).
    void emptyTakeTrash();
  }, [loadAllData]);

  useTaskQueueProcessor();
  useAutoProcess();
  useSuggestionsPreload();

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
          path="/discover"
          element={
            <ProtectedRoute>
              <DiscoverPage />
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
        <Route path="/song/:id" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} />
        <Route path="/song/:id/setup" element={<ToWorkspace setup />} />
        <Route path="/song/:id/practice" element={<ToWorkspace />} />
        <Route path="/song/:id/timestamps" element={<ToWorkspace />} />
        <Route
          path="/song/:id/lyrics"
          element={
            <ProtectedRoute>
              <LyricsInputPage />
            </ProtectedRoute>
          }
        />
        <Route path="/song/:id/recordings" element={<ToWorkspace />} />
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
