import { useEffect, useState } from "react";
import { loadTakeFeatures, loadVocalMap } from "../lib/take-review";
import { HOP_MS, medianFilter, semitoneToNoteName, type VocalMap } from "../lib/vocal-map";
import type { TakeFeatures } from "../lib/take-analysis";
import type { Recording, Song } from "../types/song";

const W = 340;
const H = 150;
const PAD_L = 30;
const PAD_R = 6;
const PAD_T = 8;
const PAD_B = 18;

function fmt(ms: number) {
  const s = Math.max(0, ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

/** Points → SVG path, breaking the line wherever there's no pitch. */
function path(points: ([number, number] | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Your pitch over the original singer's around one moment of a take, on a
 * note-name scale — to see what "flat", "cracked" or "ran out" looked like.
 */
export function PitchCompare({
  song,
  rec,
  fromMs,
  toMs,
  markFromMs,
  markToMs,
}: {
  song: Song;
  rec: Recording;
  /** Song time span to draw. */
  fromMs: number;
  toMs: number;
  /** Stretch to highlight (the problem). */
  markFromMs?: number;
  markToMs?: number;
}) {
  const [map, setMap] = useState<VocalMap | null>(null);
  const [features, setFeatures] = useState<TakeFeatures | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadVocalMap(song), loadTakeFeatures(rec.file_path)])
      .then(([m, f]) => {
        if (cancelled) return;
        if (!m) setFailed(true);
        setMap(m);
        setFeatures(f);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [song, rec.file_path]);

  if (failed || rec.song_start_ms == null) {
    return <p className="text-[11px] text-[var(--text-muted)] py-2">No pitch chart for this take.</p>;
  }
  if (!map || !features) {
    return <div className="h-[150px] rounded-[8px] bg-[var(--bg)] animate-pulse" />;
  }

  const a = rec.analysis;
  const lagFrames = Math.round((a?.lag_ms ?? 0) / HOP_MS);
  const octave = a?.octave_shift ?? 0;
  const startFrame = Math.round(rec.song_start_ms / HOP_MS);
  const f0 = Math.max(0, Math.floor(fromMs / HOP_MS));
  const f1 = Math.min(map.semitones.length, Math.ceil(toMs / HOP_MS));
  const refSmooth = medianFilter(map.semitones.subarray(f0, f1), 5);
  const youRaw = new Float32Array(f1 - f0).fill(NaN);
  for (let f = f0; f < f1; f++) {
    const t = f - startFrame + lagFrames;
    if (t >= 0 && t < features.semis.length) youRaw[f - f0] = features.semis[t] - octave;
  }
  const youSmooth = medianFilter(youRaw, 5);

  // Vertical range from both lines, padded to whole notes.
  let lo = Infinity;
  let hi = -Infinity;
  for (const arr of [refSmooth, youSmooth]) {
    for (const v of arr) {
      if (Number.isNaN(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) {
    return <p className="text-[11px] text-[var(--text-muted)] py-2">No singing found in this stretch.</p>;
  }
  lo = Math.floor(lo) - 1;
  hi = Math.ceil(hi) + 1;
  if (hi - lo < 6) {
    const mid = (hi + lo) / 2;
    lo = Math.floor(mid - 3);
    hi = Math.ceil(mid + 3);
  }
  const x = (f: number) => PAD_L + ((f - f0) / Math.max(1, f1 - f0)) * (W - PAD_L - PAD_R);
  const y = (semi: number) => PAD_T + (1 - (semi - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const toPts = (arr: Float32Array) => Array.from(arr, (v, i) => (Number.isNaN(v) ? null : ([x(f0 + i), y(v)] as [number, number])));

  // Grid: a line per semitone, labelled on the natural notes.
  const grid: { semi: number; label: string | null }[] = [];
  for (let s = lo; s <= hi; s++) {
    const name = semitoneToNoteName(s);
    grid.push({ semi: s, label: name.includes("#") ? null : name });
  }
  const markX0 = markFromMs != null ? x(markFromMs / HOP_MS) : null;
  const markX1 = markToMs != null ? x(markToMs / HOP_MS) : null;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label="Your pitch compared with the original">
        {markX0 != null && markX1 != null && (
          <rect x={markX0} y={PAD_T} width={Math.max(2, markX1 - markX0)} height={H - PAD_T - PAD_B} fill="rgba(245,158,11,0.14)" />
        )}
        {grid.map(({ semi, label }) => (
          <g key={semi}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(semi)} y2={y(semi)} stroke="var(--border)" strokeWidth={label ? 0.8 : 0.4} strokeDasharray={label ? undefined : "2 3"} />
            {label && (
              <text x={PAD_L - 4} y={y(semi) + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)">
                {label}
              </text>
            )}
          </g>
        ))}
        <path d={path(toPts(refSmooth))} fill="none" stroke="var(--text-muted)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
        <path d={path(toPts(youSmooth))} fill="none" stroke="var(--theme)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <text x={PAD_L} y={H - 4} fontSize="8" fill="var(--text-muted)">{fmt(fromMs)}</text>
        <text x={W - PAD_R} y={H - 4} fontSize="8" fill="var(--text-muted)" textAnchor="end">{fmt(toMs)}</text>
      </svg>
      <div className="flex items-center gap-4 text-[10.5px] text-[var(--text-muted)] mt-[2px]">
        <span className="flex items-center gap-[5px]"><span className="w-[14px] h-[2px] rounded bg-[var(--text-muted)] opacity-70" />Original</span>
        <span className="flex items-center gap-[5px]"><span className="w-[14px] h-[2px] rounded bg-[var(--theme)]" />You{octave !== 0 ? ` (moved ${octave > 0 ? "down" : "up"} an octave to compare)` : ""}</span>
        <span className="flex items-center gap-[5px]"><span className="w-[10px] h-[8px] rounded-[2px]" style={{ background: "rgba(245,158,11,0.3)" }} />the problem</span>
      </div>
    </div>
  );
}
