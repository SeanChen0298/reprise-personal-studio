import { useCallback, useEffect, useRef } from "react";
import type { PitchDisplayPoint } from "../hooks/use-pitch-data";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(semitone: number): string {
  const note = Math.round(semitone);
  const name = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

/** Check if a MIDI note is a natural note (white key) */
function isNatural(note: number): boolean {
  const idx = ((note % 12) + 12) % 12;
  return ![1, 3, 6, 8, 10].includes(idx);
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

    // --- Y-axis range: snap to natural notes, ensure minimum span ---
    const semitones = points.map((p) => p.semitone);
    const dataMin = Math.min(...semitones);
    const dataMax = Math.max(...semitones);
    const dataMid = (dataMin + dataMax) / 2;
    const dataSpan = dataMax - dataMin;
    // At least 8 semitones visible, with 2-semitone padding on each side
    const minSpan = 8;
    const span = Math.max(dataSpan + 4, minSpan);
    const yMin = Math.floor(dataMid - span / 2);
    const yMax = Math.ceil(dataMid + span / 2);
    const yRange = yMax - yMin || 1;

    // Left margin for Y-axis labels
    const labelMargin = 32;
    const graphW = w - labelMargin;

    const toX = (timeMs: number) => labelMargin + ((timeMs - startMs) / duration) * graphW;
    const toY = (semi: number) => h - ((semi - yMin) / yRange) * h;

    // --- Progress fill ---
    const progressX = labelMargin + progress * graphW;
    ctx.fillStyle = themeColor;
    ctx.globalAlpha = 0.06;
    ctx.fillRect(labelMargin, 0, progress * graphW, h);
    ctx.globalAlpha = 1;

    // --- Grid lines and Y-axis labels ---
    // Draw lines at each natural note, label every natural note that has enough spacing
    const minNote = Math.ceil(yMin);
    const maxNote = Math.floor(yMax);

    // Compute minimum pixel spacing to avoid label cramping
    const minLabelSpacing = 16;
    const naturalNotes: number[] = [];
    for (let note = minNote; note <= maxNote; note++) {
      if (isNatural(note)) naturalNotes.push(note);
    }

    // If too many natural notes, thin them out (show every 2nd or 3rd)
    let labelStep = 1;
    if (naturalNotes.length > 1) {
      const avgSpacing = h / naturalNotes.length;
      if (avgSpacing < minLabelSpacing) {
        labelStep = Math.ceil(minLabelSpacing / avgSpacing);
      }
    }

    for (let note = minNote; note <= maxNote; note++) {
      const y = toY(note);
      if (y < 1 || y > h - 1) continue;

      const natural = isNatural(note);

      // Grid line — natural notes get slightly stronger lines
      ctx.strokeStyle = borderSubtle;
      ctx.lineWidth = natural ? 0.8 : 0.3;
      ctx.globalAlpha = natural ? 0.7 : 0.3;
      ctx.beginPath();
      ctx.moveTo(labelMargin, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Labels on left axis
    ctx.font = "9px 'DM Sans', sans-serif";
    ctx.fillStyle = textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let li = 0; li < naturalNotes.length; li++) {
      if (li % labelStep !== 0) continue;
      const note = naturalNotes[li];
      const y = toY(note);
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

    // --- Pitch curve ---
    // Draw a subtle glow/shadow first, then the main line
    ctx.strokeStyle = themeColor;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Shadow pass
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = toX(p.time_ms);
      const y = toY(p.semitone);
      const gap = i > 0 ? p.time_ms - points[i - 1].time_ms : 0;
      if (gap > 50 || !started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    // Main line
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    started = false;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = toX(p.time_ms);
      const y = toY(p.semitone);
      const gap = i > 0 ? p.time_ms - points[i - 1].time_ms : 0;
      if (gap > 50 || !started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

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

    // Cursor dot at intersection with pitch
    if (points.length > 0) {
      const cursorTimeMs = startMs + progress * duration;
      // Find nearest point
      let closest = points[0];
      let closestDist = Math.abs(closest.time_ms - cursorTimeMs);
      for (const p of points) {
        const d = Math.abs(p.time_ms - cursorTimeMs);
        if (d < closestDist) { closest = p; closestDist = d; }
      }
      if (closestDist < 100) {
        const dotY = toY(closest.semitone);
        ctx.fillStyle = themeColor;
        ctx.beginPath();
        ctx.arc(progressX, dotY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        // White center
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(progressX, dotY, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [points, progress, startMs, endMs]);

  return (
    <div
      ref={containerRef}
      className="h-[120px] bg-[var(--surface)] border border-[var(--border-subtle)] rounded-[6px] relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
