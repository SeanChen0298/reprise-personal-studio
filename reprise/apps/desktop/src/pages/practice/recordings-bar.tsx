import { useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Line, Section } from "../../types/song";
import { useSongStore } from "../../stores/song-store";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { formatMs } from "../../lib/status-config";

interface Props {
  songId: string;
  activeLineId: string | undefined;
  activeLineOrder?: number;
  sections?: Section[];
  /** Called to start backing track playback from a given ms position (for A/B) */
  onABPlay?: (startMs: number) => void;
  /** Called to stop backing track playback (for A/B) */
  onABStop?: () => void;
}

export function RecordingsBar({ songId, activeLineId, activeLineOrder, sections, onABPlay, onABStop }: Props) {
  const allRecordings = useSongStore((s) => s.recordings[songId]);
  const allLines = useSongStore((s) => s.lines[songId]);

  // Find section containing the active line
  const activeSection = useMemo(() => {
    if (activeLineOrder == null || !sections) return null;
    return sections.find(
      (s) => activeLineOrder >= s.start_line_order && activeLineOrder <= s.end_line_order
    ) ?? null;
  }, [activeLineOrder, sections]);

  const recordings = useMemo(() => {
    const recs = allRecordings ?? [];
    if (!activeLineId) return [];
    return recs.filter(
      (r) =>
        r.line_id === activeLineId ||
        (activeSection && r.section_id === activeSection.id)
    );
  }, [allRecordings, activeLineId, activeSection]);
  const removeRecording = useSongStore((s) => s.removeRecording);
  const toggleMasterTake = useSongStore((s) => s.toggleMasterTake);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [abPlayingId, setAbPlayingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlay = (filePath: string, id: string) => {
    // Stop A/B mode if active
    if (abPlayingId) {
      handleABStop();
    }

    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(convertFileSrc(filePath));
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
  };

  const handleABPlay = (filePath: string, id: string, lineId: string) => {
    // If already in A/B for this recording, stop it
    if (abPlayingId === id) {
      handleABStop();
      return;
    }

    // Stop any solo playback
    if (playingId) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    // Stop previous A/B
    if (abPlayingId) {
      audioRef.current?.pause();
      onABStop?.();
    }

    // Find the line's start_ms for synced playback
    const line = (allLines ?? []).find((l: Line) => l.id === lineId);
    const startMs = line?.start_ms ?? 0;

    // Play the recording
    const audio = new Audio(convertFileSrc(filePath));
    audio.onended = () => {
      setAbPlayingId(null);
      onABStop?.();
    };
    audio.play();
    audioRef.current = audio;
    setAbPlayingId(id);

    // Start backing track from the same position
    onABPlay?.(startMs);
  };

  const handleABStop = () => {
    audioRef.current?.pause();
    setAbPlayingId(null);
    onABStop?.();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { remove } = await import("@tauri-apps/plugin-fs");
      const rec = recordings.find((r) => r.id === deleteTarget);
      if (rec) {
        await remove(rec.file_path).catch(() => {});
      }
    } catch {
      // file may already be gone
    }
    removeRecording(songId, deleteTarget);
    setDeleteTarget(null);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] font-medium tracking-[0.09em] uppercase text-[var(--text-muted)]">
          Your recordings
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {recordings.length} take{recordings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {recordings.length === 0 ? (
        <div className="text-[12.5px] text-[var(--text-muted)] py-4 text-center">
          No recordings yet — hit the red button!
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className={`flex items-center gap-3 px-3 py-[6px] rounded-[6px] transition-colors group ${
                abPlayingId === rec.id ? "bg-[var(--theme-light)]" : "hover:bg-[var(--bg)]"
              }`}
            >
              {/* Play/Pause */}
              <button
                onClick={() => handlePlay(rec.file_path, rec.id)}
                className="w-7 h-7 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] transition-all flex-shrink-0"
              >
                {playingId === rec.id ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>

              {/* A/B Compare button */}
              <button
                onClick={() => handleABPlay(rec.file_path, rec.id, rec.line_id)}
                title={abPlayingId === rec.id ? "Stop A/B comparison" : "A/B compare with backing track"}
                className={`text-[9px] font-bold px-[6px] py-[2px] rounded-[4px] border cursor-pointer transition-all flex-shrink-0 ${
                  abPlayingId === rec.id
                    ? "bg-[var(--theme)] text-white border-[var(--theme)]"
                    : "bg-transparent text-[var(--text-muted)] border-[var(--border)] opacity-0 group-hover:opacity-80 hover:!opacity-100 hover:border-[var(--theme)] hover:text-[var(--theme)]"
                }`}
              >
                A/B
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {rec.section_id && (
                  <span className="text-[9.5px] font-medium px-[5px] py-[1px] rounded-[3px] bg-[var(--theme-light)] text-[var(--theme-text)] flex-shrink-0">
                    {sections?.find((s) => s.id === rec.section_id)?.name ?? "Section"}
                  </span>
                )}
                <span className="text-[12px] text-[var(--text-secondary)] tabular-nums">
                  {formatDate(rec.created_at)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                  {formatMs(rec.duration_ms)}
                </span>
              </div>

              {/* Master take star */}
              <button
                onClick={() => toggleMasterTake(songId, rec.id)}
                title={rec.is_master_take ? "Master take" : "Set as master take"}
                className={`w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent transition-all ${
                  rec.is_master_take
                    ? "text-amber-400"
                    : "text-[var(--text-muted)] opacity-0 group-hover:opacity-60 hover:!opacity-100"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={rec.is_master_take ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>

              {/* Delete */}
              <button
                onClick={() => setDeleteTarget(rec.id)}
                title="Delete recording"
                className="w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent text-[var(--text-muted)] opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:!text-red-500 transition-all"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete recording?"
        message="This recording will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
