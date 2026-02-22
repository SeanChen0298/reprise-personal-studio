import { useNavigate } from "react-router-dom";
import { Sidebar } from "../components/sidebar";
import { useSongStore } from "../stores/song-store";
import type { Song } from "../types/song";

function MasteryRing({ value }: { value: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r={r} fill="none" stroke="#E4E4E4" strokeWidth="2.5" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="#2563EB"
        strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
      />
      <text
        x="14"
        y="14"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="6"
        fontWeight="600"
        fill="#111"
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

function SongCard({ song, onPin, onClick }: { song: Song; onPin: (id: string) => void; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* Thumbnail */}
      <div className="relative w-full aspect-video bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] overflow-hidden">
        {song.thumbnail_url ? (
          <img
            src={song.thumbnail_url}
            alt={song.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        {/* Pin button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(song.id);
          }}
          className={[
            "absolute top-2 right-2 w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all",
            song.pinned
              ? "bg-[var(--theme)] text-white opacity-100"
              : "bg-black/40 text-white opacity-0 group-hover:opacity-100",
          ].join(" ")}
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
            <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">
              {song.title}
            </div>
            <div className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">
              {song.artist}
            </div>
          </div>
          <MasteryRing value={song.mastery} />
        </div>
        {song.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {song.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="text-[10.5px] px-2 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
              >
                {tag}
              </span>
            ))}
          </div>
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

export function LibraryPage() {
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);
  const togglePin = useSongStore((s) => s.togglePin);

  const pinned = songs.filter((s) => s.pinned);
  const rest = songs.filter((s) => !s.pinned);
  const ordered = [...pinned, ...rest];

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="h-[54px] px-7 flex items-center justify-between bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
          <span className="text-[14px] font-medium">Library</span>
          <button
            onClick={() => navigate("/import")}
            className="flex items-center gap-[6px] px-4 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity"
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
            Add song
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-7 py-7">
          {ordered.length === 0 ? (
            <EmptyState onAdd={() => navigate("/import")} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {ordered.map((song) => (
                <SongCard
                  key={song.id}
                  song={song}
                  onPin={togglePin}
                  onClick={() => navigate(`/song/${song.id}`)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
