import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useQueueStore } from "../stores/queue-store";
import { useSortedGroupedSongs } from "../hooks/use-sorted-grouped-songs";
import { QueuePlayerBar } from "../components/queue-player-bar";
import { computeSongProgress } from "../lib/status-config";
import type { Song } from "../types/song";
import type { SongGroup } from "../hooks/use-sorted-grouped-songs";

function masteryColor(value: number): string {
  if (value === 0) return "#9CA3AF";       // gray — untouched
  if (value <= 30) return "#3B82F6";       // blue — early practice
  if (value <= 70) return "#F59E0B";       // amber — halfway
  return "#22C55E";                        // green — mastered
}

function MasteryRing({ value }: { value: number }) {
  const r = 12;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  const color = masteryColor(value);
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="flex-shrink-0">
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke={color}
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
        fontWeight="700"
        fill={value === 0 ? "var(--text-muted)" : color}
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
  onClick: (e: React.MouseEvent) => void;
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
      onClick={(e) => onClick(e)}
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


function SongListRow({
  song, mastery, isPlaying, onPlay, onClick, onPin, onEnqueue, onContextMenu,
}: {
  song: Song;
  mastery: number;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onClick: (e: React.MouseEvent) => void;
  onPin: (id: string) => void;
  onEnqueue?: (song: Song) => void;
  onContextMenu?: (e: React.MouseEvent, song: Song) => void;
}) {
  const audioSrc = song.audio_path ? convertFileSrc(song.audio_path) : "";

  return (
    <div
      className="group flex items-center gap-4 px-3 h-[68px] border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface)] transition-colors"
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, song) : undefined}
    >
      {/* Album art — 48×48, play overlay on hover */}
      <div className="relative w-[48px] h-[48px] flex-shrink-0 rounded-[6px] overflow-hidden cursor-pointer" onClick={(e) => onClick(e)}>
        <div className="w-full h-full bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]">
          {song.thumbnail_url && (
            <img src={song.thumbnail_url} alt="" className="w-full h-full object-cover" />
          )}
          {!song.thumbnail_url && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        {/* Play/pause overlay */}
        {audioSrc && (
          <div
            onClick={(e) => { e.stopPropagation(); onPlay(song); }}
            className={`absolute inset-0 flex items-center justify-center transition-opacity ${
              isPlaying
                ? "bg-black/40 opacity-100"
                : "bg-black/50 opacity-0 group-hover:opacity-100"
            }`}
          >
            {isPlaying ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 2 }}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Song info */}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={(e) => onClick(e)}>
        <div className="text-[14px] font-medium text-[var(--text-primary)] truncate leading-snug hover:text-[var(--theme)] transition-colors">
          {song.title}
        </div>
        <div className="text-[12px] text-[var(--text-muted)] truncate mt-[2px]">
          {song.artist}
        </div>
      </div>

      {/* Tag (first one, hidden on narrow) */}
      {song.tags[0] && (
        <span className="hidden lg:block text-[10.5px] px-2 py-0.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] flex-shrink-0">
          {song.tags[0]}
        </span>
      )}

      {/* Mastery ring */}
      <MasteryRing value={mastery} />

      {/* Hover actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {onEnqueue && (
          <button
            onClick={(e) => { e.stopPropagation(); onEnqueue(song); }}
            className="w-[28px] h-[28px] rounded-[5px] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] bg-transparent cursor-pointer hover:text-[var(--theme)] hover:border-[var(--theme)] transition-colors"
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
          className={`w-[28px] h-[28px] rounded-[5px] border flex items-center justify-center transition-colors cursor-pointer bg-transparent ${
            song.pinned
              ? "border-[var(--theme)] text-[var(--theme)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--theme)] hover:border-[var(--theme)]"
          }`}
          title={song.pinned ? "Unpin" : "Pin"}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 3L8 3L8 13L5 16L12 16L12 21L12 16L19 16L16 13L16 3Z" />
          </svg>
        </button>
        {onContextMenu && (
          <button
            onClick={(e) => { e.stopPropagation(); onContextMenu(e, song); }}
            className="w-[28px] h-[28px] rounded-[5px] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
            title="More"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            </svg>
          </button>
        )}
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
      className={`px-[10px] py-[4px] rounded-full text-[11px] font-medium transition-all cursor-pointer border-none ${
        active
          ? "bg-[var(--text-primary)] text-[var(--bg)] shadow-sm"
          : "bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
      } ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}
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
  const librarySearch = usePreferencesStore((s) => s.librarySearch);
  const setLibrarySearch = usePreferencesStore((s) => s.setLibrarySearch);

  const searchRef = useRef<HTMLInputElement>(null);

  const sortedGrouped = useSortedGroupedSongs();
  const flatSongs = sortedGrouped.type === "flat" ? sortedGrouped.songs : sortedGrouped.groups.flatMap((g) => g.songs);

  // Ctrl+F focuses the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape") searchRef.current?.blur();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filterSongs = useCallback((songs: Song[]) => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.artist?.toLowerCase().includes(q) ||
      s.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [librarySearch]);

  useEffect(() => {
    markStaleAnalysesAsFailed();
  }, [markStaleAnalysesAsFailed]);

  // ── List-view playback (preview only — no play_count side effects) ────────
  const [playingId, setPlayingId] = useState<string | null>(null);
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
    setPlayingId(song.id);
    audio.play().catch(() => {});
  }, [playingId]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onEnded = () => setPlayingId(null);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  // Stop list preview when queue starts playing
  useEffect(() => {
    if (queueIsPlaying) {
      audioRef.current?.pause();
      setPlayingId(null);
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
          onClick={(e) => { if (e.ctrlKey || e.shiftKey) { e.preventDefault(); enqueue(song); } else { navigate(`/song/${song.id}`); } }}
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
    <div className="max-w-[880px]">
      {songs.map((song) => (
        <SongListRow
          key={song.id}
          song={song}
          mastery={computeSongProgress(allLines[song.id] ?? [])}
          isPlaying={playingId === song.id}
          onPlay={handlePlay}
          onClick={(e) => { if (e.ctrlKey || e.shiftKey) { e.preventDefault(); enqueue(song); } else { navigate(`/song/${song.id}`); } }}
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
      const filtered = filterSongs(sortedGrouped.songs);
      if (filtered.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <p className="text-[14px] text-[var(--text-primary)]">No songs match "{librarySearch}"</p>
            <button onClick={() => setLibrarySearch("")} className="text-[12px] text-[var(--theme)] hover:underline bg-transparent border-none cursor-pointer">
              Clear search
            </button>
          </div>
        );
      }
      return libraryView === "list" ? renderList(filtered) : renderGrid(filtered);
    }

    // Grouped
    const groupNodes = sortedGrouped.groups.map((group) => {
      const filtered = filterSongs(group.songs);
      if (filtered.length === 0) return null;
      return (
        <div key={group.key}>
          <GroupHeader group={group} onToggle={() => setGroupCollapsed(group.key, !group.collapsed)} />
          {!group.collapsed && (
            libraryView === "list" ? renderList(filtered) : renderGrid(filtered)
          )}
        </div>
      );
    });

    const anyVisible = groupNodes.some(Boolean);
    if (!anyVisible) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <p className="text-[14px] text-[var(--text-primary)]">No songs match "{librarySearch}"</p>
          <button onClick={() => setLibrarySearch("")} className="text-[12px] text-[var(--theme)] hover:underline bg-transparent border-none cursor-pointer">
            Clear search
          </button>
        </div>
      );
    }

    return <div className="flex flex-col gap-6">{groupNodes}</div>;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center gap-4 flex-shrink-0">
          <span className="text-[14px] font-medium flex-shrink-0">Library</span>

          {/* Search input */}
          <div className="relative flex-1 max-w-[280px]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              placeholder="Search songs, artists, tags…"
              className="w-full pl-[30px] pr-[28px] py-[6px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--theme)] transition-colors"
            />
            {librarySearch && (
              <button
                onClick={() => setLibrarySearch("")}
                className="absolute right-[8px] top-1/2 -translate-y-1/2 w-[16px] h-[16px] flex items-center justify-center rounded-full bg-[var(--text-muted)] text-[var(--bg)] text-[10px] font-bold leading-none cursor-pointer border-none hover:opacity-70 transition-opacity"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 ml-auto">
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
