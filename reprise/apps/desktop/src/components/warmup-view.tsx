// The coach's warm-up for a song: drills in order, each with why (for which lines), how, a
// picture to imagine, and — when it has a note pattern — ▶ to play the notes to sing along with.

import { useEffect, useRef, useState } from "react";
import { drillDurationMs, renderDrill, type Warmup, type WarmupDrill } from "@reprise/shared";
import { WithLineRefs } from "./song-card-view";
import { usePreferencesStore } from "../stores/preferences-store";

// The drill tone is made loud for phone speakers; on the computer's speakers half of the song's
// level sits about as loud as the song itself.
const DESKTOP_LEVEL = 0.5;

export function WarmupView({ warmup }: { warmup: Warmup }) {
  const [playing, setPlaying] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  // Follows the song's playback volume (the transport's volume control), also while it plays.
  const volume = usePreferencesStore((s) => s.playbackVolume);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume * DESKTOP_LEVEL;
  }, [volume]);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPlaying(null);
    setProgress(0);
  };
  useEffect(() => stop, []);

  const play = (i: number, d: WarmupDrill) => {
    const was = playing;
    stop();
    if (was === i) return;
    const bytes = renderDrill(d, 44100);
    if (!bytes) return;
    url.current = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
    const a = new Audio(url.current);
    a.volume = volume * DESKTOP_LEVEL;
    audio.current = a;
    a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    a.onended = stop;
    setPlaying(i);
    void a.play();
  };

  return (
    <div>
      {warmup.focus && (
        <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed mb-3">
          <WithLineRefs text={warmup.focus} />
          <span className="text-[var(--text-muted)]"> · about {warmup.minutes} min</span>
        </p>
      )}
      <ol className="flex flex-col gap-3 m-0 pl-0 list-none">
        {warmup.drills.map((d, i) => {
          const playable = !!d.pattern?.length;
          const voice = [d.register, d.placement].filter(Boolean).join(" · ");
          return (
            <li key={i} className="flex gap-3">
              <span className="w-[18px] flex-shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums pt-[2px]">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{d.name}</span>
                  <span className="text-[10.5px] text-[var(--text-muted)]">
                    {d.minutes} min{d.syllable ? ` · “${d.syllable}”` : ""}
                  </span>
                  {playable && (
                    <button
                      onClick={() => play(i, d)}
                      title={playing === i ? "Stop" : `Play the notes (${d.from} up to ${d.to}, ${Math.round(drillDurationMs(d) / 1000)} s)`}
                      className="ml-auto flex-shrink-0 flex items-center gap-[5px] px-2 py-[2px] rounded-full border border-[var(--border)] bg-transparent text-[11px] text-[var(--text-secondary)] cursor-pointer hover:border-[var(--theme)] hover:text-[var(--theme)]"
                    >
                      {playing === i ? (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                      ) : (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                      )}
                      {d.from}–{d.to}
                    </button>
                  )}
                </div>
                {playing === i && (
                  <div className="h-[2px] mt-1 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                    <div className="h-full bg-[var(--theme)]" style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
                {d.purpose && (
                  <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-[3px] mb-0">
                    <WithLineRefs text={d.purpose} />
                  </p>
                )}
                <p className="text-[12px] text-[var(--text-primary)] leading-relaxed mt-[3px] mb-0">{d.how}</p>
                {(d.image || voice) && (
                  <p className="text-[11.5px] text-[var(--text-muted)] leading-relaxed mt-[3px] mb-0">
                    {voice && <span className="text-[var(--theme-text)]">{voice}</span>}
                    {voice && d.image ? " — " : ""}
                    {d.image && <em>{d.image}</em>}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
