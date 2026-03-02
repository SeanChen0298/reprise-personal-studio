import { useCallback, useEffect, useRef } from "react";

interface Region {
  /** Fraction 0–1 of total duration where this region starts */
  start: number;
  /** Fraction 0–1 of total duration where this region ends */
  end: number;
  label: string;
  isCurrent?: boolean;
}

interface Props {
  /** Normalized amplitude peaks (0–1) */
  peaks: number[];
  /** Playhead position as fraction 0–1 of total duration */
  progress: number;
  /** Timestamped line regions to overlay */
  regions: Region[];
  /** Click-to-seek callback (fraction 0–1) */
  onSeek: (fraction: number) => void;
}

export function FullWaveform({ peaks, progress, regions, onSeek }: Props) {
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
    if (!canvas || !container || peaks.length === 0) return;

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

    // Draw region backgrounds
    for (const region of regions) {
      const x = region.start * w;
      const rw = (region.end - region.start) * w;
      ctx.fillStyle = region.isCurrent
        ? "rgba(37,99,235,0.12)"
        : "rgba(37,99,235,0.06)";
      ctx.fillRect(x, 0, rw, h);

      // Region left border
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = region.isCurrent ? 1 : 0.5;
      ctx.fillRect(x, 0, 2, h);
      ctx.globalAlpha = 1;

      // Region label
      ctx.font = "600 9px 'DM Sans', sans-serif";
      ctx.fillStyle = themeColor;
      ctx.globalAlpha = 0.8;
      ctx.fillText(region.label, x + 6, 11);
      ctx.globalAlpha = 1;
    }

    // Draw waveform bars
    const barCount = peaks.length;
    const gap = 1;
    const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);
    const playedX = progress * w;

    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap);
      const amplitude = peaks[i];
      const barHeight = Math.max(2, amplitude * h * 0.85);
      const y = h - barHeight; // Bottom-aligned like the design

      const barMidX = x + barWidth / 2;
      if (barMidX <= playedX) {
        ctx.fillStyle = themeColor;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = "#E8E8E8";
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      ctx.fill();
    }

    // Playhead line + circle
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#111111";
    ctx.fillRect(playedX - 1, 0, 2, h);
    ctx.beginPath();
    ctx.arc(playedX, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  }, [peaks, progress, regions]);

  if (peaks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="h-[64px] relative cursor-pointer"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
