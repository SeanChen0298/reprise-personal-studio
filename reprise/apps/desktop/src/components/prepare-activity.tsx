// Settings → Audio processing: what the automatic preparation is doing and has done — where each
// song stands with the timing fit, and the recent steps with their results.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useSongStore } from "../stores/song-store";
import { usePrepareStore } from "../stores/prepare-store";
import { fitStatus } from "../hooks/use-auto-process";

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

export function PrepareActivity() {
  const songs = useSongStore((s) => s.songs);
  const lines = useSongStore((s) => s.lines);
  const current = usePrepareStore((s) => s.current);
  const log = usePrepareStore((s) => s.log);
  const clearLog = usePrepareStore((s) => s.clearLog);
  const [showWaiting, setShowWaiting] = useState(false);

  const status = fitStatus(songs, lines);
  const fitted = status.filter((x) => x.state === "fitted").length;
  const next = status.filter((x) => x.state === "next").length;
  const waiting = status.filter((x) => x.state === "waiting");

  return (
    <div id="prepare" className="mt-1 mb-1 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)]">
      <div className="text-[13px] font-medium mb-1">Lyric timing fitted to the vocals</div>
      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
        {fitted} of {status.length} songs checked
        {next > 0 ? ` · ${next} still to go` : ""}
        {waiting.length > 0 && (
          <>
            {" · "}
            <button
              onClick={() => setShowWaiting((v) => !v)}
              className="bg-transparent border-none p-0 text-[12px] text-[var(--theme-text)] cursor-pointer hover:underline"
            >
              {waiting.length} can't be yet
            </button>
          </>
        )}
      </p>
      {showWaiting && waiting.length > 0 && (
        <ul className="mt-2 mb-0 pl-0 list-none text-[11.5px] text-[var(--text-muted)] leading-[1.7]">
          {waiting.map(({ song, why }) => (
            <li key={song.id}>
              <Link to={`/song/${song.id}`} className="text-[var(--text-secondary)] no-underline hover:underline">{song.title}</Link> — {why}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center mt-4 mb-1.5">
        <div className="text-[12px] font-medium flex-1">Recent steps</div>
        {log.length > 0 && (
          <button
            onClick={clearLog}
            className="bg-transparent border-none text-[11px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]"
          >
            Clear
          </button>
        )}
      </div>
      {current && (
        <div className="text-[11.5px] text-[var(--text-secondary)] mb-1">
          Now: {current.step} — {current.title}…
        </div>
      )}
      {log.length === 0 && !current ? (
        <p className="text-[11.5px] text-[var(--text-muted)] m-0">Nothing yet — steps show here as they run.</p>
      ) : (
        <ul className="m-0 pl-0 list-none max-h-[260px] overflow-y-auto">
          {log.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3 py-[5px] border-b border-[var(--border-subtle)] last:border-b-0 text-[11.5px]">
              <span className="w-[62px] flex-shrink-0 text-[var(--text-muted)] tabular-nums">{when(e.at)}</span>
              <span className="flex-1 min-w-0">
                <Link to={`/song/${e.songId}`} className="text-[var(--text-primary)] no-underline hover:underline">{e.title}</Link>
                <span className="text-[var(--text-muted)]"> · {e.step}</span>
                <span className={`block ${e.changed ? "text-[var(--theme-text)]" : "text-[var(--text-muted)]"}`}>{e.result}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
