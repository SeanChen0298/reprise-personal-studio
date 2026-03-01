import { useCallback, useEffect, useRef } from "react";
import type { PitchDisplayPoint } from "../hooks/use-pitch-data";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(semitone: number): string {
  const note = Math.round(semitone);
  const name = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
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
      const fraction = (e.clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(1, fraction)));
    },
    [onSeek],
  );

  // Render the pitch curve on canvas
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

    // If no pitch data, draw simple progress bar fallback
    if (points.length === 0) {
      // Progress fill
      const style = getComputedStyle(container);
      const themeColor = style.getPropertyValue("--theme").trim() || "#2563EB";
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(0, 0, progress * w, h);

      // Cursor
      ctx.globalAlpha = 1;
      ctx.fillStyle = themeColor;
      ctx.fillRect(progress * w - 1, 0, 2, h);
      return;
    }

    const duration = endMs - startMs;
    if (duration <= 0) return;

    // Compute Y range from data
    const semitones = points.map((p) => p.semitone);
    const minSemi = Math.min(...semitones);
    const maxSemi = Math.max(...semitones);
    const padding = 2;
    const yMin = minSemi - padding;
    const yMax = maxSemi + padding;
    const yRange = yMax - yMin || 1;

    const toX = (timeMs: number) => ((timeMs - startMs) / duration) * w;
    const toY = (semi: number) => h - ((semi - yMin) / yRange) * h;

    const style = getComputedStyle(container);
    const themeColor = style.getPropertyValue("--theme").trim() || "#2563EB";

    // Progress fill
    ctx.fillStyle = themeColor;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(0, 0, progress * w, h);
    ctx.globalAlpha = 1;

    // Draw note grid lines (light horizontal lines at each semitone)
    ctx.strokeStyle = style.getPropertyValue("--border-subtle").trim() || "#e5e7eb";
    ctx.lineWidth = 0.5;
    const minNote = Math.ceil(yMin);
    const maxNote = Math.floor(yMax);
    for (let note = minNote; note <= maxNote; note++) {
      const y = toY(note);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw note labels on right edge
    ctx.font = "9px sans-serif";
    ctx.fillStyle = style.getPropertyValue("--text-muted").trim() || "#9ca3af";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let note = minNote; note <= maxNote; note++) {
      // Only label natural notes (no sharps) to avoid clutter
      const noteIdx = ((note % 12) + 12) % 12;
      if ([1, 3, 6, 8, 10].includes(noteIdx)) continue;
      const y = toY(note);
      if (y > 8 && y < h - 8) {
        ctx.fillText(noteName(note), w - 3, y);
      }
    }

    // Draw pitch curve
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = toX(p.time_ms);
      const y = toY(p.semitone);

      // Break the line if there's a large gap (> 50ms) between points
      const gap = i > 0 ? p.time_ms - points[i - 1].time_ms : 0;
      if (gap > 50 || !started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Playback cursor
    const cursorX = progress * w;
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, h);
    ctx.stroke();
  }, [points, progress, startMs, endMs]);

  return (
    <div
      ref={containerRef}
      className="h-[56px] bg-[var(--border-subtle)] rounded-[4px] relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
