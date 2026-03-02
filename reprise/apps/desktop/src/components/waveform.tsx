import { useCallback, useEffect, useRef } from "react";

interface Props {
  /** Normalized amplitude peaks (0–1) */
  peaks: number[];
  /** Current playback progress within the line (0–1) */
  progress: number;
  /** Click-to-seek callback (fraction 0–1) */
  onSeek: (fraction: number) => void;
}

export function Waveform({ peaks, progress, onSeek }: Props) {
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
    const mutedColor = style.getPropertyValue("--text-muted").trim() || "#9ca3af";

    const barCount = peaks.length;
    const gap = 1.5;
    const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);
    const minBarHeight = 2;
    const progressX = progress * w;

    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap);
      const amplitude = peaks[i];
      const barHeight = Math.max(minBarHeight, amplitude * (h * 0.9));
      const y = (h - barHeight) / 2; // Center vertically

      // Bars before the cursor get theme color, after get muted
      const barMidX = x + barWidth / 2;
      if (barMidX <= progressX) {
        ctx.fillStyle = themeColor;
        ctx.globalAlpha = 0.85;
      } else {
        ctx.fillStyle = mutedColor;
        ctx.globalAlpha = 0.25;
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }

    // Cursor line
    ctx.globalAlpha = 1;
    ctx.fillStyle = themeColor;
    ctx.fillRect(progressX - 0.75, 0, 1.5, h);
  }, [peaks, progress]);

  if (peaks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="h-[40px] bg-[var(--border-subtle)] rounded-[4px] relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
