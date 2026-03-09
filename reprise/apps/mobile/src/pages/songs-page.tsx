import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Song } from "@reprise/shared";

// Inlined status config — avoids importing from desktop lib
const STATUS_ORDER = [
  "new",
  "listened",
  "annotated",
  "practiced",
  "recorded",
  "best_take_set",
] as const;
type LineStatus = (typeof STATUS_ORDER)[number];

const STATUS_BAR_COLORS: Record<LineStatus, string> = {
  new: "#CBD5E1",
  listened: "#60A5FA",
  annotated: "#F59E0B",
  practiced: "#F97316",
  recorded: "#22C55E",
  best_take_set: "#EAB308",
};

interface LineRow {
  song_id: string;
  status: string;
  language: string | null;
}

function StatusBar({
  lines,
  translationLang,
}: {
  lines: LineRow[];
  translationLang?: string | null;
}) {
  const mainLines = lines.filter(
    (l) => !translationLang || l.language !== translationLang
  );
  const total = mainLines.length;

  if (total === 0) {
    return <div className="h-1.5 w-full rounded-full bg-[var(--color-border)]" />;
  }

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full">
      {STATUS_ORDER.map((status) => {
        const count = mainLines.filter((l) => l.status === status).length;
        if (count === 0) return null;
        return (
          <div
            key={status}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: STATUS_BAR_COLORS[status],
            }}
          />
        );
      })}
    </div>
  );
}

function MasteryRing({ value }: { value: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width="34" height="34" viewBox="0 0 28 28" className="shrink-0">
      <circle cx="14" cy="14" r={r} fill="none" stroke="#2a2a40" strokeWidth="2.5" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="var(--color-theme-light)"
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
        fontSize="5.5"
        fontWeight="600"
        fill="var(--color-text)"
      >
        {value}%
      </text>
    </svg>
  );
}

function SongRow({
  song,
  lines,
  onClick,
}: {
  song: Song;
  lines: LineRow[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 active:bg-[var(--color-surface)] text-left"
    >
      {/* Thumbnail */}
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]">
        {song.thumbnail_url ? (
          <img
            src={song.thumbnail_url}
            alt={song.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg
              width="22"
              height="22"
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
        {song.pinned && (
          <div className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-theme)]">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
              <path d="M16 3H8l0 10-3 3h7v5h2v-5h7l-3-3V3z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-[var(--color-text)]">
              {song.title}
            </p>
            <p className="truncate text-[12px] text-[var(--color-text-muted)]">
              {song.artist}
            </p>
          </div>
          <MasteryRing value={song.mastery} />
        </div>
        <div className="mt-2">
          <StatusBar lines={lines} translationLang={song.translation_language} />
        </div>
      </div>

      {/* Chevron */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

export default function SongsPage() {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [linesBySong, setLinesBySong] = useState<Record<string, LineRow[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: songsData } = await supabase
        .from("songs")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (!songsData) {
        setLoading(false);
        return;
      }

      setSongs(songsData as Song[]);

      if (songsData.length > 0) {
        const { data: linesData } = await supabase
          .from("lines")
          .select("song_id, status, language")
          .in(
            "song_id",
            (songsData as Array<{ id: string }>).map((s) => s.id)
          );

        if (!cancelled && linesData) {
          const grouped: Record<string, LineRow[]> = {};
          for (const l of linesData) {
            if (!grouped[l.song_id]) grouped[l.song_id] = [];
            grouped[l.song_id].push(l as LineRow);
          }
          setLinesBySong(grouped);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const pinned = songs.filter((s: Song) => s.pinned);
  const rest = songs.filter((s: Song) => !s.pinned);
  const ordered = [...pinned, ...rest];

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-theme)] border-t-transparent" />
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-surface)]">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="1.5"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <p className="text-base font-semibold text-[var(--color-text)]">No songs yet</p>
        <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
          Import songs from the desktop app to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="px-4 pb-3"
        style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}
      >
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Library</h1>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
          {ordered.length} {ordered.length === 1 ? "song" : "songs"}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
        {ordered.map((song) => (
          <SongRow
            key={song.id}
            song={song}
            lines={linesBySong[song.id] ?? []}
            onClick={() => navigate(`/practice/${song.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
