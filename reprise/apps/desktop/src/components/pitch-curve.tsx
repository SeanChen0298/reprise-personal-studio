import { useCallback, useEffect, useRef } from "react";
import type { PitchDisplayPoint } from "../hooks/use-pitch-data";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(semitone: number): string {
  const note = Math.round(semitone);
  const name = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

function isNatural(note: number): boolean {
  const idx = ((note % 12) + 12) % 12;
  return ![1, 3, 6, 8, 10].includes(idx);
}

interface NoteSegment {
  semitone: number;
  startMs: number;
  endMs: number;
}

function quantizeToNotes(points: PitchDisplayPoint[]): NoteSegment[] {
  if (points.length === 0) return [];

  const segments: NoteSegment[] = [];
  let segNote = Math.round(points[0].semitone);
  let segStart = points[0].time_ms;
  let segEnd = points[0].time_ms;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const note = Math.round(p.semitone);
    const gap = p.time_ms - points[i - 1].time_ms;

    if (note === segNote && gap <= 80) {
      segEnd = p.time_ms;
    } else {
      if (segEnd - segStart >= 40) {
        segments.push({ semitone: segNote, startMs: segStart, endMs: segEnd });
      }
      segNote = note;
      segStart = p.time_ms;
      segEnd = p.time_ms;
    }
  }
  if (segEnd - segStart >= 40) {
    segments.push({ semitone: segNote, startMs: segStart, endMs: segEnd });
  }

  return segments;
}

interface Props {
  points: PitchDisplayPoint[];
  progress: number;
  onSeek: (fraction: number) => void;
  startMs: number;
  endMs: number;
}

export function PitchCurve({ points, progress, onSeek, startMs, endMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const labelMargin = 32;
      const graphW = rect.width - labelMargin;
      const clickX = e.clientX - rect.left - labelMargin;
      onSeek(Math.max(0, Math.min(1, clickX / graphW)));
    },
    [onSeek],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

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
    const borderSubtle = style.getPropertyValue("--border-subtle").trim() || "#e5e7eb";
    const textMuted = style.getPropertyValue("--text-muted").trim() || "#9ca3af";

    // No pitch data — simple progress bar fallback
    if (points.length === 0) {
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(0, 0, progress * w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = themeColor;
      ctx.fillRect(progress * w - 1, 0, 2, h);
      return;
    }

    const duration = endMs - startMs;
    if (duration <= 0) return;

    // --- Y-axis range ---
    const semitones = points.map((p) => p.semitone);
    const dataMin = Math.min(...semitones);
    const dataMax = Math.max(...semitones);
    const dataMid = (dataMin + dataMax) / 2;
    const dataSpan = dataMax - dataMin;
    const minSpan = 8;
    const span = Math.max(dataSpan + 4, minSpan);
    const yMin = Math.floor(dataMid - span / 2);
    const yMax = Math.ceil(dataMid + span / 2);
    const yRange = yMax - yMin || 1;

    const labelMargin = 32;
    const graphW = w - labelMargin;

    const toX = (timeMs: number) => labelMargin + ((timeMs - startMs) / duration) * graphW;
    // toY returns the top of the semitone row (y increases downward)
    const rowH = h / yRange;
    const toRowTop = (semi: number) => h - ((semi - yMin + 1) / yRange) * h;

    // --- Progress fill ---
    const progressX = labelMargin + progress * graphW;
    ctx.fillStyle = themeColor;
    ctx.globalAlpha = 0.06;
    ctx.fillRect(labelMargin, 0, progress * graphW, h);
    ctx.globalAlpha = 1;

    // --- Grid lines and Y-axis labels ---
    const minNote = Math.ceil(yMin);
    const maxNote = Math.floor(yMax);

    const minLabelSpacing = 16;
    const naturalNotes: number[] = [];
    for (let note = minNote; note <= maxNote; note++) {
      if (isNatural(note)) naturalNotes.push(note);
    }

    let labelStep = 1;
    if (naturalNotes.length > 1) {
      const avgSpacing = h / naturalNotes.length;
      if (avgSpacing < minLabelSpacing) {
        labelStep = Math.ceil(minLabelSpacing / avgSpacing);
      }
    }

    for (let note = minNote; note <= maxNote; note++) {
      const y = toRowTop(note) + rowH; // bottom of this note's row = top of row below
      if (y < 1 || y > h - 1) continue;
      const natural = isNatural(note);
      ctx.strokeStyle = borderSubtle;
      ctx.lineWidth = natural ? 0.8 : 0.3;
      ctx.globalAlpha = natural ? 0.9 : 0.4;
      ctx.beginPath();
      ctx.moveTo(labelMargin, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = "9px 'DM Sans', sans-serif";
    ctx.fillStyle = textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let li = 0; li < naturalNotes.length; li++) {
      if (li % labelStep !== 0) continue;
      const note = naturalNotes[li];
      const y = toRowTop(note) + rowH / 2;
      if (y > 8 && y < h - 8) {
        ctx.globalAlpha = 0.7;
        ctx.fillText(noteName(note), labelMargin - 5, y);
        ctx.globalAlpha = 1;
      }
    }

    // --- Y-axis border line ---
    ctx.strokeStyle = borderSubtle;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(labelMargin, 0);
    ctx.lineTo(labelMargin, h);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- Discrete note bars ---
    const segments = quantizeToNotes(points);
    const barPad = 2;

    for (const seg of segments) {
      const x = toX(seg.startMs);
      const barW = Math.max(2, toX(seg.endMs) - x);
      const y = toRowTop(seg.semitone) + barPad;
      const barH = Math.max(2, rowH - barPad * 2);

      const isPast = toX(seg.endMs) <= progressX;
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = isPast ? 0.85 : 0.38;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- Playback cursor ---
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [points, progress, startMs, endMs]);

  return (
    <div
      ref={containerRef}
      className="h-[120px] relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
