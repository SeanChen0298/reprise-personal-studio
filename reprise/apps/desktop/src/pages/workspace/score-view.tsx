// The fingerpicking draft as a printed-style guitar score (alphaTab): tab with rhythm, chord
// names, sections and the lyrics under the beats. Follows the song while it plays (the bar being
// played is marked and kept in view); click a note to play from there. Export as Guitar Pro to
// edit it further in Guitar Pro / MuseScore / TuxGuitar.

import { useEffect, useRef, useState } from "react";
import * as alphaTab from "@coderline/alphatab";
import type { ChordAnalysis } from "../../lib/chord-analysis";

export function ScoreView({ tex, analysis, currentBar, isPlaying, onSeek, fileName }: {
  tex: string;
  analysis: ChordAnalysis;
  /** The bar being played (index into analysis.bars), -1 for none. */
  currentBar: number;
  isPlaying: boolean;
  onSeek: (ms: number) => void;
  fileName: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [marker, setMarker] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const barsRef = useRef(analysis.bars ?? []);
  barsRef.current = analysis.bars ?? [];

  // One alphaTab instance per page.
  useEffect(() => {
    if (!hostRef.current) return;
    const api = new alphaTab.AlphaTabApi(hostRef.current, {
      core: { fontDirectory: "/alphatab/font/", useWorkers: false, engine: "svg" },
      display: { layoutMode: alphaTab.LayoutMode.Page, staveProfile: alphaTab.StaveProfile.Tab, scale: 1 },
      player: { enablePlayer: false },
      notation: {
        elements: new Map([
          [alphaTab.NotationElement.GuitarTuning, false],
          [alphaTab.NotationElement.TrackNames, false],
        ]),
      },
    } as unknown as alphaTab.Settings);
    apiRef.current = api;
    api.renderFinished.on(() => setRendered((n) => n + 1));
    api.error.on((e) => setError(e instanceof Error ? e.message : String(e)));
    // Click a note (or rest): play the song from there.
    api.beatMouseDown.on((beat) => {
      const bar = barsRef.current[beat.voice.bar.index];
      if (!bar) return;
      const slots = Math.max(1, bar.beats * 2);
      seekRef.current(bar.start_ms + ((bar.end_ms - bar.start_ms) * beat.index) / slots);
    });
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    setError(null);
    try {
      api.tex(tex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tex]);

  // Mark the bar being played, and keep it in view while playing.
  useEffect(() => {
    const api = apiRef.current;
    const host = hostRef.current;
    const b = currentBar >= 0 ? api?.renderer.boundsLookup?.findMasterBarByIndex(currentBar) : null;
    if (!b || !host) {
      setMarker(null);
      return;
    }
    const r = b.visualBounds;
    setMarker({ x: r.x, y: r.y, w: r.w, h: r.h });
    if (isPlaying) {
      const scroller = host.closest("[data-score-scroll]") as HTMLElement | null;
      if (scroller) {
        const top = host.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + r.y;
        if (top < scroller.scrollTop + 40 || top + r.h > scroller.scrollTop + scroller.clientHeight - 40) {
          scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight * 0.3), behavior: "smooth" });
        }
      }
    }
  }, [currentBar, rendered, isPlaying]);

  const exportGp = () => {
    const api = apiRef.current;
    if (!api?.score) return;
    const data = new alphaTab.exporter.Gp7Exporter().export(api.score, api.settings);
    // Like the backup export: a download (saved to Downloads).
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.gp`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="flex items-center gap-3 mb-3">
        <p className="text-[12px] text-[var(--text-muted)] flex-1">
          A first draft from the chords and the fingerpicking pattern — click a note to play the song from there.
        </p>
        <button
          onClick={exportGp}
          title="Save as a Guitar Pro file (to Downloads), to edit in Guitar Pro, MuseScore or TuxGuitar"
          className="px-3 py-[5px] rounded-[6px] border border-[var(--border)] bg-transparent text-[12px] text-[var(--text-secondary)] cursor-pointer hover:border-[var(--theme)] hover:text-[var(--theme)]"
        >
          Export Guitar Pro…
        </button>
      </div>
      {error && <p className="text-[12.5px] text-red-500 mb-2">Couldn't draw the score: {error}</p>}
      {/* A white page in both themes: scores read best as print. */}
      <div className="relative rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-4 overflow-hidden">
        <div className="relative">
          {marker && (
            <div
              className="absolute pointer-events-none rounded-[4px] bg-[var(--theme)] opacity-[0.12] transition-all duration-150"
              style={{ left: marker.x, top: marker.y, width: marker.w, height: marker.h }}
            />
          )}
          <div ref={hostRef} />
        </div>
      </div>
    </div>
  );
}
