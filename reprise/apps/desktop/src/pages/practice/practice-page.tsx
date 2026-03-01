import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSongStore } from "../../stores/song-store";
import { useLinePlayer } from "../../hooks/use-line-player";
import { LineNavigator } from "./line-navigator";
import { PracticeTopbar } from "./practice-topbar";
import { PracticeCenter } from "./practice-center";
import { RecordingsBar } from "./recordings-bar";

export function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((s) => s.id === id));
  const rawLines = useSongStore((s) => (id ? s.lines[id] : undefined));
  const lines = useMemo(
    () => (rawLines ? [...rawLines].sort((a, b) => a.order - b.order) : []),
    [rawLines]
  );

  const [activeTrack, setActiveTrack] = useState<"vocals" | "instrumental" | "reference">("reference");

  // Derive audio path from active track
  const audioPath = useMemo(() => {
    if (!song) return "";
    switch (activeTrack) {
      case "vocals":
        return song.vocals_path ?? song.audio_path ?? "";
      case "instrumental":
        return song.instrumental_path ?? "";
      case "reference":
      default:
        return song.audio_path ?? "";
    }
  }, [activeTrack, song]);

  const player = useLinePlayer({
    audioPath,
    lines,
    initialLineIndex: 0,
  });

  const handleShiftClick = useCallback(
    (index: number) => {
      // Create a range from current line to shift-clicked line
      const current = player.currentLineIndex;
      const start = Math.min(current, index);
      const end = Math.max(current, index);
      if (start === end) {
        // Same line — clear range
        player.setLoopRange(null);
        return;
      }
      player.setLoopRange([start, end]);
      // Auto-enable loop mode when selecting a range
      if (!player.loopEnabled) {
        player.toggleLoop();
      }
      // Seek to range start
      player.goToLine(start);
    },
    [player]
  );

  const handleClearRange = useCallback(() => {
    player.setLoopRange(null);
  }, [player]);

  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }

  if (!song.audio_path || song.download_status !== "done") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center max-w-[360px]">
          <div className="text-[var(--text-muted)] mb-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </div>
          <div className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
            No audio available
          </div>
          <p className="text-[12.5px] text-[var(--text-muted)] mb-4 leading-relaxed">
            Download the reference audio first to start practicing.
          </p>
          <button
            onClick={() => navigate(`/song/${id}/setup`)}
            className="inline-flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity border-none cursor-pointer"
          >
            Go to Audio Setup
          </button>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center max-w-[360px]">
          <div className="text-[var(--text-muted)] mb-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </div>
          <div className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
            No lyrics added yet
          </div>
          <p className="text-[12.5px] text-[var(--text-muted)] mb-4 leading-relaxed">
            Add lyrics to create practice segments you can drill.
          </p>
          <button
            onClick={() => navigate(`/song/${id}/lyrics`)}
            className="inline-flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity border-none cursor-pointer"
          >
            Add lyrics
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <audio ref={player.audioRef} src={player.audioSrc} preload="metadata" />
      <LineNavigator
        song={song}
        lines={lines}
        activeLineIndex={player.currentLineIndex}
        loopRange={player.loopRange}
        onLineClick={(i) => player.goToLine(i)}
        onShiftClick={handleShiftClick}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <PracticeTopbar
          player={player}
          activeTrack={activeTrack}
          onTrackChange={setActiveTrack}
          onClearRange={handleClearRange}
          hasStemSeparation={song.stem_status === "done"}
        />
        <PracticeCenter
          lines={lines}
          activeLineIndex={player.currentLineIndex}
          player={player}
          songId={id!}
        />
        <RecordingsBar />
      </div>
    </div>
  );
}
