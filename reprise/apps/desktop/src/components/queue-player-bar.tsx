import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQueueStore, useCurrentQueueSong } from "../stores/queue-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useLocation } from "react-router-dom";

function formatSecs(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function QueuePlayerBar() {
  const song = useCurrentQueueSong();
  const { queue, currentIndex, isPlaying, setIsPlaying, next, prev, clearQueue, setCurrentIndex, removeFromQueue, reorderQueue } =
    useQueueStore();
  const playbackVolume = usePreferencesStore((s) => s.playbackVolume);
  const location = useLocation();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);

  const dragFromRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const visible = queue.length > 0;

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("durationchange", () => setDuration(audio.duration || 0));
    audio.addEventListener("ended", () => { useQueueStore.getState().next(); });
    audio.addEventListener("error", () => { useQueueStore.getState().next(); });
    return () => { audio.pause(); };
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = playbackVolume;
  }, [playbackVolume]);

  // Load new song when currentIndex changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !song?.audio_path) return;
    audio.src = convertFileSrc(song.audio_path);
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    if (isPlaying) audio.play().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, song?.id]);

  // Sync play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.play().catch(() => {});
    else audio.pause();
  }, [isPlaying]);

  // Pause when navigating away from library
  useEffect(() => {
    if (!location.pathname.startsWith("/library") && location.pathname !== "/") {
      setIsPlaying(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Close queue panel when queue empties
  useEffect(() => {
    if (queue.length === 0) setQueueOpen(false);
  }, [queue.length]);

  const progress = duration > 0 ? currentTime / duration : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  return (
    <div
      className="flex-shrink-0 bg-[var(--surface)] overflow-hidden transition-all duration-300"
      style={{
        maxHeight: visible ? 500 : 0,
        borderTop: visible ? "1px solid var(--border)" : "none",
      }}
    >
      {/* Queue list panel — slides in above transport */}
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: queueOpen ? 320 : 0 }}
      >
        <div
          className="overflow-y-auto border-b border-[var(--border)]"
          style={{ maxHeight: 320, scrollbarWidth: "none" }}
        >
          {queue.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => {
                dragFromRef.current = idx;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragEnd={() => { dragFromRef.current = null; setDragOverIdx(null); }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFromRef.current !== null && dragFromRef.current !== idx) {
                  reorderQueue(dragFromRef.current, idx);
                }
                dragFromRef.current = null;
                setDragOverIdx(null);
              }}
              onClick={() => { setCurrentIndex(idx); setIsPlaying(true); }}
              className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors group/qi select-none ${
                idx === currentIndex
                  ? "bg-[var(--theme-light)]"
                  : dragOverIdx === idx
                    ? "bg-[var(--bg)]"
                    : "hover:bg-[var(--bg)]"
              } ${dragOverIdx === idx && dragFromRef.current !== null ? "border-t-2 border-[var(--theme)]" : ""}`}
            >
              {/* Drag handle */}
              <div className="text-[var(--text-muted)] opacity-0 group-hover/qi:opacity-60 transition-opacity cursor-grab flex-shrink-0">
                <svg width="9" height="12" viewBox="0 0 9 12" fill="currentColor">
                  <circle cx="2" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/>
                  <circle cx="2" cy="6" r="1.2"/><circle cx="7" cy="6" r="1.2"/>
                  <circle cx="2" cy="10" r="1.2"/><circle cx="7" cy="10" r="1.2"/>
                </svg>
              </div>

              {/* Thumbnail */}
              <div className="w-[26px] h-[26px] flex-shrink-0 rounded-[3px] overflow-hidden bg-gradient-to-br from-[#1a1a2e] to-[#0f3460]">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Playing indicator / index */}
              {idx === currentIndex && isPlaying ? (
                <div className="flex gap-[2px] items-end h-[10px] flex-shrink-0">
                  <div className="w-[2px] rounded-full bg-[var(--theme)] animate-pulse" style={{ height: '55%' }} />
                  <div className="w-[2px] rounded-full bg-[var(--theme)] animate-pulse" style={{ height: '100%', animationDelay: '0.15s' }} />
                  <div className="w-[2px] rounded-full bg-[var(--theme)] animate-pulse" style={{ height: '70%', animationDelay: '0.3s' }} />
                </div>
              ) : (
                <span className="text-[10px] tabular-nums text-[var(--text-muted)] flex-shrink-0 w-[14px] text-center">
                  {idx + 1}
                </span>
              )}

              {/* Title + artist */}
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] font-medium truncate ${idx === currentIndex ? "text-[var(--theme)]" : "text-[var(--text-primary)]"}`}>
                  {item.title}
                </div>
                <div className="text-[10.5px] text-[var(--text-muted)] truncate">{item.artist}</div>
              </div>

              {/* Remove */}
              <button
                onClick={(e) => { e.stopPropagation(); removeFromQueue(item.id); }}
                className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[var(--text-muted)] opacity-0 group-hover/qi:opacity-100 transition-all bg-transparent border-none cursor-pointer hover:text-[var(--text-primary)]"
                title="Remove from queue"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Transport bar */}
      <div className="h-[62px] px-5 flex items-center gap-4">
        {/* Thumbnail */}
        <div className="w-[34px] h-[34px] flex-shrink-0 rounded-[4px] overflow-hidden bg-gradient-to-br from-[#1a1a2e] to-[#0f3460]">
          {song?.thumbnail_url ? (
            <img src={song.thumbnail_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>

        {/* Song info */}
        <div className="min-w-0 w-[150px] flex-shrink-0">
          <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{song?.title}</div>
          <div className="text-[10.5px] text-[var(--text-muted)] truncate">{song?.artist}</div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={prev}
            disabled={queue.length <= 1}
            className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors cursor-pointer bg-transparent border-none"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19,20 9,12 19,4" /><rect x="5" y="4" width="3" height="16" />
            </svg>
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-[32px] h-[32px] rounded-full bg-[var(--theme)] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-85 transition-opacity"
          >
            {isPlaying ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 1 }}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
          <button
            onClick={next}
            disabled={queue.length <= 1}
            className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors cursor-pointer bg-transparent border-none"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,4 15,12 5,20" /><rect x="16" y="4" width="3" height="16" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[10px] tabular-nums text-[var(--text-muted)] flex-shrink-0">
            {formatSecs(currentTime)}
          </span>
          <div
            onClick={handleProgressClick}
            className="flex-1 h-[3px] bg-[var(--border)] rounded-full cursor-pointer relative overflow-hidden"
          >
            <div
              className="absolute inset-y-0 left-0 bg-[var(--theme)] rounded-full transition-none"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-[var(--text-muted)] flex-shrink-0">
            {formatSecs(duration)}
          </span>
        </div>

        {/* Queue toggle + count + clear */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10.5px] text-[var(--text-muted)]">
            {currentIndex + 1} / {queue.length}
          </span>
          <button
            onClick={() => setQueueOpen((v) => !v)}
            title={queueOpen ? "Hide queue" : "Show queue"}
            className={`w-[24px] h-[24px] rounded-[5px] flex items-center justify-center transition-colors cursor-pointer border-none ${
              queueOpen
                ? "bg-[var(--theme-light)] text-[var(--theme)]"
                : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
            </svg>
          </button>
          <button
            onClick={clearQueue}
            title="Clear queue"
            className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer bg-transparent border-none"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
