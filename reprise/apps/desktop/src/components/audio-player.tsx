import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

interface AudioPlayerProps {
  audioPath: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ audioPath }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);

  // Loop state
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);

  const audioSrc = convertFileSrc(audioPath);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (loopEnabled && loopA != null) {
        audio.currentTime = loopA;
        audio.play();
      } else {
        setPlaying(false);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, [loopEnabled, loopA]);

  // Loop enforcement
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !loopEnabled || loopA == null || loopB == null) return;

    const check = () => {
      if (audio.currentTime >= loopB) {
        audio.currentTime = loopA;
      }
    };

    audio.addEventListener("timeupdate", check);
    return () => audio.removeEventListener("timeupdate", check);
  }, [loopEnabled, loopA, loopB]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = seekRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = parseFloat(e.target.value);
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  };

  const handleSetA = () => {
    setLoopA(currentTime);
    if (loopB != null && currentTime >= loopB) setLoopB(null);
  };

  const handleSetB = () => {
    setLoopB(currentTime);
    if (loopA != null && currentTime <= loopA) setLoopA(null);
  };

  const handleClearLoop = () => {
    setLoopA(null);
    setLoopB(null);
    setLoopEnabled(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const loopAPos = loopA != null && duration > 0 ? (loopA / duration) * 100 : null;
  const loopBPos = loopB != null && duration > 0 ? (loopB / duration) * 100 : null;

  return (
    <div className="bg-[var(--surface)] border-t border-[var(--border)] px-7 py-4">
      <audio ref={audioRef} src={audioSrc} preload="metadata" />

      {/* Seek bar */}
      <div
        ref={seekRef}
        onClick={handleSeek}
        className="relative h-[6px] bg-[var(--border-subtle)] rounded-[3px] cursor-pointer mb-3 group"
      >
        {/* Loop region highlight */}
        {loopEnabled && loopAPos != null && loopBPos != null && (
          <div
            className="absolute top-0 h-full bg-[var(--theme-light)] rounded-[3px]"
            style={{ left: `${loopAPos}%`, width: `${loopBPos - loopAPos}%` }}
          />
        )}
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-[var(--theme)] to-[#93C5FD] rounded-[3px] transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
        {/* Loop markers */}
        {loopAPos != null && (
          <div
            className="absolute top-[-3px] w-[3px] h-[12px] bg-[var(--theme)] rounded-sm"
            style={{ left: `${loopAPos}%` }}
          />
        )}
        {loopBPos != null && (
          <div
            className="absolute top-[-3px] w-[3px] h-[12px] bg-[var(--theme)] rounded-sm"
            style={{ left: `${loopBPos}%` }}
          />
        )}
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[12px] h-[12px] rounded-full bg-white border-2 border-[var(--theme)] shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%`, marginLeft: "-6px" }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-[var(--accent)] text-white flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums min-w-[80px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Loop controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSetA}
            className={[
              "px-2 py-1 rounded text-[10.5px] font-medium border transition-all",
              loopA != null
                ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-[#BFDBFE]"
                : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[#888]",
            ].join(" ")}
          >
            A {loopA != null ? formatTime(loopA) : ""}
          </button>
          <button
            onClick={handleSetB}
            className={[
              "px-2 py-1 rounded text-[10.5px] font-medium border transition-all",
              loopB != null
                ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-[#BFDBFE]"
                : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[#888]",
            ].join(" ")}
          >
            B {loopB != null ? formatTime(loopB) : ""}
          </button>
          <button
            onClick={() => {
              if (loopA != null && loopB != null) {
                setLoopEnabled(!loopEnabled);
              }
            }}
            disabled={loopA == null || loopB == null}
            className={[
              "w-7 h-7 rounded flex items-center justify-center transition-all",
              loopEnabled
                ? "bg-[var(--theme)] text-white"
                : "bg-transparent text-[var(--text-muted)] border border-[var(--border)] hover:border-[#888] disabled:opacity-40",
            ].join(" ")}
            title="Toggle loop"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
          </button>
          {(loopA != null || loopB != null) && (
            <button
              onClick={handleClearLoop}
              className="text-[10.5px] text-[var(--text-muted)] hover:text-red-500 transition-colors bg-transparent border-none cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Speed */}
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[10.5px] text-[var(--text-muted)] w-[32px] text-right tabular-nums">
            {speed.toFixed(1)}x
          </span>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={speed}
            onChange={handleSpeedChange}
            className="w-[60px] h-1 accent-[var(--theme)]"
          />
        </div>

        {/* Volume */}
        <div className="flex items-center gap-1.5 ml-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {volume > 0.5 && <path d="M19.07 4.93a10 10 0 010 14.14" />}
            {volume > 0 && <path d="M15.54 8.46a5 5 0 010 7.07" />}
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={handleVolumeChange}
            className="w-[60px] h-1 accent-[var(--theme)]"
          />
        </div>
      </div>
    </div>
  );
}
