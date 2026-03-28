import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useQueueStore } from "../stores/queue-store";
import { useWaveformData } from "../hooks/use-waveform-data";
import { useSortedGroupedSongs } from "../hooks/use-sorted-grouped-songs";
import { QueuePlayerBar } from "../components/queue-player-bar";
import { computeSongProgress } from "../lib/status-config";
import type { Song } from "../types/song";
import type { SongGroup } from "../hooks/use-sorted-grouped-songs";

function MasteryRing({ value }: { value: number }) {
  const r = 12;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="flex-shrink-0">
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke="var(--theme)"
        strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
      />
      <text
        x="17"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="6.5"
        fontWeight="600"
        fill="var(--text-primary)"
      >
        {value}%
      </text>
    </svg>
  );
}

function DownloadBadge({ status }: { status?: string }) {
  if (status === "downloading") {
    return (
      <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        Downloading
      </div>
    );
  }
  if (status === "done") {
    return (
      <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-[#22C55E] text-[10px] font-medium">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Ready
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-red-400 text-[10px] font-medium">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        Error
      </div>
    );
  }
  return null;
}

function SongCard({
  song, mastery, onPin, onClick, onContextMenu, onEnqueue,
  draggable, dragOver, onDragStart, onDragOver, onDragEnd, onDrop,
}: {
  song: Song;
  mastery: number;
  onPin: (id: string) => void;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, song: Song) => void;
  onEnqueue?: (song: Song) => void;
  draggable?: boolean;
  dragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, song) : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      className={`group bg-[var(--surface)] border rounded-[var(--radius)] overflow-hidden hover:shadow-md transition-all cursor-pointer ${
        dragOver ? "border-[var(--theme)] shadow-md" : "border-[var(--border)]"
      } ${draggable ? "select-none" : ""}`}
    >
      {/* Thumbnail */}
      <div className="relative w-full aspect-video bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] overflow-hidden">
        {song.thumbnail_url ? (
          <img src={song.thumbnail_url} alt={song.title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        {/* Queue button */}
        {onEnqueue && (
          <button
            onClick={(e) => { e.stopPropagation(); onEnqueue(song); }}
            className="absolute top-2 left-2 w-[26px] h-[26px] rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border-none cursor-pointer"
            title="Add to queue"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        )}
        {/* Pin button */}
        <button
          onClick={(e) => { e.stopPropagation(); onPin(song.id); }}
          className={`absolute top-2 right-2 w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all border-none cursor-pointer ${
            song.pinned ? "bg-[var(--theme)] text-white opacity-100" : "bg-black/40 text-white opacity-0 group-hover:opacity-100"
          }`}
          title={song.pinned ? "Unpin" : "Pin"}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 3L8 3L8 13L5 16L12 16L12 21L12 16L19 16L16 13L16 3Z" />
          </svg>
        </button>
        <DownloadBadge status={song.download_status} />
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">{song.title}</div>
            <div className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">{song.artist}</div>
          </div>
          <MasteryRing value={mastery} />
        </div>
        {song.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {song.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[10.5px] px-2 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List-view row with inline waveform
// ---------------------------------------------------------------------------

function ListWaveform({ audioSrc, progress }: { audioSrc: string; progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const { peaks } = useWaveformData(audioSrc || undefined, undefined, undefined, 180, true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(container);
    const themeColor = style.getPropertyValue("--theme").trim() || "#2563EB";

    const floorY = Math.round(h * 0.62);
    const upperZone = floorY;
    const lowerZone = h - floorY;

    const barCount = peaks.length;
    const slotW = w / barCount;
    const gap = Math.min(1.5, slotW * 0.25);
    const barWidth = slotW - gap;
    const progressX = progress * w;
    const hBoost = hovered ? 1.2 : 1.0;

    for (let i = 0; i < barCount; i++) {
      const x = i * slotW;
      const amplitude = peaks[i];
      const isPast = x + barWidth / 2 <= progressX;

      // Upper bar
      const upperH = Math.max(2, amplitude * upperZone * 0.96);
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = Math.min(1, (isPast ? 0.92 : 0.42) * hBoost);
      ctx.beginPath();
      ctx.roundRect(x, floorY - upperH, barWidth, upperH, [1, 1, 0, 0]);
      ctx.fill();

      // Reflection
      const lowerH = Math.max(1, amplitude * lowerZone * 0.72);
      ctx.globalAlpha = Math.min(1, (isPast ? 0.44 : 0.16) * hBoost);
      ctx.beginPath();
      ctx.roundRect(x, floorY, barWidth, lowerH, [0, 0, 1, 1]);
      ctx.fill();
    }

    // Floor line
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = themeColor;
    ctx.fillRect(0, floorY, w, 1);

    // Progress cursor
    if (progress > 0 && progress < 1) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = themeColor;
      ctx.fillRect(progressX - 0.75, 0, 1.5, h);
    }

    // Saturation gradient: white overlay stronger at top → transparent at floor
    // Makes bar tips lighter/desaturated, base stays full color
    const satGrad = ctx.createLinearGradient(0, 0, 0, floorY);
    satGrad.addColorStop(0.0, `rgba(255,255,255,${hovered ? 0.2 : 0.42})`);
    satGrad.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, floorY);

  }, [peaks, progress, hovered]);

  if (peaks.length === 0) {
    return (
      <div className="h-[46px] flex items-center">
        <div className="w-full h-[1px] bg-[var(--border-subtle)] opacity-30" />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div ref={containerRef} className="h-[46px] relative overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}

function SongListRow({
  song, mastery, isPlaying, progress, onPlay, onSeek, onClick, onPin, onEnqueue, onContextMenu,
}: {
  song: Song;
  mastery: number;
  isPlaying: boolean;
  progress: number;
  onPlay: (song: Song) => void;
  onSeek: (song: Song, fraction: number) => void;
  onClick: () => void;
  onPin: (id: string) => void;
  onEnqueue?: (song: Song) => void;
  onContextMenu?: (e: React.MouseEvent, song: Song) => void;
}) {
  const audioSrc = song.audio_path ? convertFileSrc(song.audio_path) : "";

  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioSrc) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    onSeek(song, Math.max(0, Math.min(1, fraction)));
  }, [audioSrc, song, onSeek]);

  return (
    <div
      className="group flex items-center gap-4 px-1 py-2 rounded-[8px] hover:bg-[var(--surface)] transition-colors"
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, song) : undefined}
    >
      {/* Thumbnail — landscape 16:9 */}
      <div
        onClick={onClick}
        className="relative w-[136px] flex-shrink-0 rounded-[6px] overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] cursor-pointer"
        style={{ aspectRatio: "16/9" }}
      >
        {song.thumbnail_url ? (
          <img src={song.thumbnail_url} alt={song.title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1">
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">

        {/* Row 1: play btn + title + mastery ring */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(song); }}
            disabled={!audioSrc}
            className="w-[32px] h-[32px] flex-shrink-0 rounded-full bg-[var(--text-primary)] text-[var(--bg)] flex items-center justify-center border-none cursor-pointer hover:opacity-75 transition-opacity disabled:opacity-25 disabled:cursor-not-allowed"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>
          <span
            onClick={onClick}
            className="flex-1 text-[15px] font-semibold text-[var(--text-primary)] truncate cursor-pointer hover:text-[var(--theme)] transition-colors"
          >
            {song.title}
          </span>
          <MasteryRing value={mastery} />
        </div>

        {/* Row 2: artist, indented to align with title */}
        <div className="pl-[44px]">
          <span className="text-[12px] text-[var(--text-muted)] truncate">
            {song.artist}
          </span>
        </div>

        {/* Row 3: waveform */}
        <div onClick={handleWaveformClick} className={`mt-0.5 ${audioSrc ? "cursor-pointer" : ""}`}>
          <ListWaveform audioSrc={audioSrc} progress={isPlaying ? progress : 0} />
        </div>

        {/* Row 4: tags + action buttons */}
        <div className="flex items-center gap-2 mt-0.5">
          {song.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[var(--bg)] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
          <div className="flex-1" />
          {onEnqueue && (
            <button
              onClick={(e) => { e.stopPropagation(); onEnqueue(song); }}
              className="w-[28px] h-[28px] rounded-[5px] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-all bg-transparent cursor-pointer hover:text-[var(--theme)] hover:border-[var(--theme)]"
              title="Add to queue"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onPin(song.id); }}
            className={`w-[28px] h-[28px] rounded-[5px] border flex items-center justify-center transition-all cursor-pointer bg-transparent ${
              song.pinned
                ? "border-[var(--theme)] text-[var(--theme)] opacity-100"
                : "border-[var(--border)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100"
            }`}
            title={song.pinned ? "Unpin" : "Pin"}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 3L8 3L8 13L5 16L12 16L12 21L12 16L19 16L16 13L16 3Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24">
      <div className="w-[72px] h-[72px] rounded-full bg-[var(--theme-light)] flex items-center justify-center mb-5">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--theme)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
      <h2 className="font-serif text-[22px] tracking-[-0.3px] mb-2">
        Your library is empty
      </h2>
      <p className="text-[13.5px] text-[var(--text-muted)] text-center max-w-[300px] leading-relaxed mb-6">
        Import a song from YouTube to start practicing. Reprise will fetch the
        metadata automatically.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-5 py-2.5 rounded-[9px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Import from YouTube
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function ContextMenu({
  x, y, song, onClose, onOpen, onEnqueue, onPin,
}: {
  x: number; y: number; song: Song;
  onClose: () => void;
  onOpen: () => void;
  onEnqueue: () => void;
  onPin: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", escHandler);
    });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(y, window.innerHeight - 140),
    left: Math.min(x, window.innerWidth - 180),
    zIndex: 9999,
  };

  const item = (label: string, icon: React.ReactNode, action: () => void, danger = false) => (
    <button
      onClick={() => { action(); onClose(); }}
      className={`w-full flex items-center gap-2 px-3 py-[7px] text-[12px] text-left hover:bg-[var(--bg)] transition-colors cursor-pointer bg-transparent border-none rounded-[4px] ${
        danger ? "text-red-500 hover:text-red-600" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={style}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg py-1 w-[172px]"
    >
      {item("Open", <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>, onOpen)}
      {item("Add to queue", <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg>, onEnqueue)}
      <div className="mx-2 my-1 border-t border-[var(--border)]" />
      {item(song.pinned ? "Unpin" : "Pin", <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3L8 3L8 13L5 16L12 16L12 21L12 16L19 16L16 13L16 3Z"/></svg>, onPin)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group header
// ---------------------------------------------------------------------------

function GroupHeader({ group, onToggle }: { group: SongGroup; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 mb-3 text-left w-full cursor-pointer bg-transparent border-none group"
    >
      <svg
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className={`text-[var(--text-muted)] transition-transform flex-shrink-0 ${group.collapsed ? "" : "rotate-90"}`}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
        {group.label}
      </span>
      <span className="text-[10px] text-[var(--text-muted)] opacity-60">
        {group.songs.length}
      </span>
      <div className="flex-1 h-px bg-[var(--border-subtle)] ml-1" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sort bar
// ---------------------------------------------------------------------------

function SortBar() {
  const librarySort = usePreferencesStore((s) => s.librarySort);
  const libraryGroup = usePreferencesStore((s) => s.libraryGroup);
  const setLibrarySort = usePreferencesStore((s) => s.setLibrarySort);
  const setLibraryGroup = usePreferencesStore((s) => s.setLibraryGroup);

  const canCustomSort = libraryGroup === "none";

  const pill = (label: string, active: boolean, onClick: () => void, disabled = false) => (
    <button
      key={label}
      onClick={onClick}
      disabled={disabled}
      className={`px-[9px] py-[3px] rounded-full text-[11px] font-medium transition-colors cursor-pointer border-none ${
        active
          ? "bg-[var(--theme-light)] text-[var(--theme-text)]"
          : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      } ${disabled ? "opacity-35 cursor-not-allowed" : ""}`}
    >
      {label}
    </button>
  );

  return (
    <div className="px-7 py-2 flex items-center gap-4 flex-shrink-0">
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)] mr-2">Sort</span>
        {pill("Custom", librarySort === "custom", () => setLibrarySort("custom"), !canCustomSort)}
        {pill("Title", librarySort === "title", () => setLibrarySort("title"))}
        {pill("Artist", librarySort === "artist", () => setLibrarySort("artist"))}
        {pill("Mastery", librarySort === "mastery", () => setLibrarySort("mastery"))}
        {pill("Date added", librarySort === "date_added", () => setLibrarySort("date_added"))}
      </div>
      <div className="w-px h-4 bg-[var(--border)]" />
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)] mr-2">Group</span>
        {pill("None", libraryGroup === "none", () => setLibraryGroup("none"))}
        {pill("Artist", libraryGroup === "artist", () => setLibraryGroup("artist"))}
        {pill("Last practiced", libraryGroup === "last_practiced", () => setLibraryGroup("last_practiced"))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fade wrapper — snaps to invisible on key change, then fades in new content
// ---------------------------------------------------------------------------

function FadeWrapper({ children, fadeKey }: { children: React.ReactNode; fadeKey: string }) {
  const [visible, setVisible] = useState(true);
  const keyRef = useRef(fadeKey);

  useEffect(() => {
    if (fadeKey === keyRef.current) return;
    keyRef.current = fadeKey;
    setVisible(false);
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [fadeKey]);

  return (
    <div style={{ opacity: visible ? 1 : 0, transition: visible ? "opacity 200ms ease" : "none" }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function LibraryPage() {
  const navigate = useNavigate();
  const togglePin = useSongStore((s) => s.togglePin);
  const markStaleAnalysesAsFailed = useSongStore((s) => s.markStaleAnalysesAsFailed);
  const libraryView = usePreferencesStore((s) => s.libraryView);
  const setLibraryView = usePreferencesStore((s) => s.setLibraryView);
  const libraryGroup = usePreferencesStore((s) => s.libraryGroup);
  const librarySort = usePreferencesStore((s) => s.librarySort);
  const setSongOrder = usePreferencesStore((s) => s.setSongOrder);
  const setGroupCollapsed = usePreferencesStore((s) => s.setGroupCollapsed);
  const enqueue = useQueueStore((s) => s.enqueue);
  const queueIsPlaying = useQueueStore((s) => s.isPlaying);
  const allLines = useSongStore((s) => s.lines);

  const sortedGrouped = useSortedGroupedSongs();
  const flatSongs = sortedGrouped.type === "flat" ? sortedGrouped.songs : sortedGrouped.groups.flatMap((g) => g.songs);

  useEffect(() => {
    markStaleAnalysesAsFailed();
  }, [markStaleAnalysesAsFailed]);

  // ── List-view playback (preview only — no play_count side effects) ────────
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlay = useCallback((song: Song) => {
    const audio = audioRef.current;
    if (!audio || !song.audio_path) return;
    // Mute queue playback when list preview starts
    if (useQueueStore.getState().isPlaying) {
      useQueueStore.getState().setIsPlaying(false);
    }
    if (playingId === song.id) {
      audio.paused ? audio.play() : audio.pause();
      if (!audio.paused) setPlayingId(null);
      return;
    }
    audio.src = convertFileSrc(song.audio_path);
    audio.currentTime = 0;
    setProgress(0);
    setPlayingId(song.id);
    audio.play().catch(() => {});
  }, [playingId]);

  const handleSeek = useCallback((song: Song, fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !song.audio_path) return;
    if (playingId !== song.id) {
      handlePlay(song);
      // seek after load
      audio.addEventListener("canplay", () => { audio.currentTime = audio.duration * fraction; }, { once: true });
    } else {
      audio.currentTime = audio.duration * fraction;
    }
  }, [playingId, handlePlay]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onTimeUpdate = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
    };
    const onEnded = () => { setPlayingId(null); setProgress(0); };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  // Stop list preview when queue starts playing
  useEffect(() => {
    if (queueIsPlaying) {
      audioRef.current?.pause();
      setPlayingId(null);
      setProgress(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueIsPlaying]);

  // ── Drag-to-reorder (custom sort only) ─────────────────────────────────────
  const dragSongIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, songId: string) => {
    dragSongIdRef.current = songId;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, songId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(songId);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragSongIdRef.current = null;
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragSongIdRef.current;
    if (!sourceId || sourceId === targetId) { setDragOverId(null); return; }

    // Build new order from current flat list
    const ids = flatSongs.map((s) => s.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragOverId(null); return; }

    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, sourceId);

    const newOrder: Record<string, number> = {};
    reordered.forEach((id, i) => { newOrder[id] = i; });
    setSongOrder(newOrder);
    setDragOverId(null);
  }, [flatSongs, setSongOrder]);

  // ── Context menu ─────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; song: Song } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, song: Song) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, song });
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────────
  const canDrag = libraryGroup === "none" && librarySort === "custom";

  const renderGrid = (songs: Song[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
      {songs.map((song) => (
        <SongCard
          key={song.id}
          song={song}
          mastery={computeSongProgress(allLines[song.id] ?? [])}
          onPin={togglePin}
          onClick={() => navigate(`/song/${song.id}`)}
          onContextMenu={handleContextMenu}
          onEnqueue={enqueue}
          draggable={canDrag}
          dragOver={dragOverId === song.id}
          onDragStart={canDrag ? (e) => handleDragStart(e, song.id) : undefined}
          onDragOver={canDrag ? (e) => handleDragOver(e, song.id) : undefined}
          onDragEnd={canDrag ? handleDragEnd : undefined}
          onDrop={canDrag ? (e) => handleDrop(e, song.id) : undefined}
        />
      ))}
    </div>
  );

  const renderList = (songs: Song[]) => (
    <div className="flex flex-col gap-1 max-w-[880px]">
      {songs.map((song) => (
        <SongListRow
          key={song.id}
          song={song}
          mastery={computeSongProgress(allLines[song.id] ?? [])}
          isPlaying={playingId === song.id}
          progress={playingId === song.id ? progress : 0}
          onPlay={handlePlay}
          onSeek={handleSeek}
          onClick={() => navigate(`/song/${song.id}`)}
          onPin={togglePin}
          onEnqueue={enqueue}
          onContextMenu={handleContextMenu}
        />
      ))}
    </div>
  );

  const renderContent = () => {
    if (flatSongs.length === 0) return <EmptyState onAdd={() => navigate("/import")} />;

    if (sortedGrouped.type === "flat") {
      return libraryView === "list" ? renderList(sortedGrouped.songs) : renderGrid(sortedGrouped.songs);
    }

    // Grouped
    return (
      <div className="flex flex-col gap-6">
        {sortedGrouped.groups.map((group) => (
          <div key={group.key}>
            <GroupHeader group={group} onToggle={() => setGroupCollapsed(group.key, !group.collapsed)} />
            {!group.collapsed && (
              libraryView === "list" ? renderList(group.songs) : renderGrid(group.songs)
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between flex-shrink-0">
          <span className="text-[14px] font-medium">Library</span>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex items-center gap-[2px] bg-[var(--bg)] border border-[var(--border)] rounded-[7px] p-[3px]">
              <button
                onClick={() => setLibraryView("grid")}
                title="Grid view"
                className={`w-[26px] h-[26px] rounded-[5px] flex items-center justify-center transition-colors cursor-pointer border-none ${
                  libraryView === "grid"
                    ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
                    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" />
                  <rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" />
                </svg>
              </button>
              <button
                onClick={() => setLibraryView("list")}
                title="List view"
                className={`w-[26px] h-[26px] rounded-[5px] flex items-center justify-center transition-colors cursor-pointer border-none ${
                  libraryView === "list"
                    ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
                    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>

            <button
              onClick={() => navigate("/import")}
              className="flex items-center gap-[6px] px-4 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity cursor-pointer border-none"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add song
            </button>
          </div>
        </header>

        <SortBar />

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-7" style={{ scrollbarWidth: "none" }}>
          <FadeWrapper fadeKey={`${librarySort}|${libraryGroup}|${libraryView}`}>
            {renderContent()}
          </FadeWrapper>
        </main>

        <QueuePlayerBar />
      </div>

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          song={contextMenu.song}
          onClose={() => setContextMenu(null)}
          onOpen={() => navigate(`/song/${contextMenu.song.id}`)}
          onEnqueue={() => enqueue(contextMenu.song)}
          onPin={() => togglePin(contextMenu.song.id)}
        />
      )}
    </div>
  );
}
