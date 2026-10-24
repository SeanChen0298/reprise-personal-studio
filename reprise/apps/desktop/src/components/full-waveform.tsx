import { useCallback, useEffect, useRef } from "react";

interface Band {
  /** Fraction 0–1 of total duration where this band starts / ends */
  start: number;
  end: number;
  label: string;
}

interface Props {
  /** Normalized amplitude peaks (0–1) */
  peaks: number[];
  /** Playhead position as fraction 0–1 of total duration */
  progress: number;
  /** Labelled stretches (e.g. song sections) drawn as alternating bands */
  bands?: Band[];
  /** One stretch to emphasise (e.g. the selected line) */
  highlight?: { start: number; end: number } | null;
  /** Click-to-seek callback (fraction 0–1) */
  onSeek: (fraction: number) => void;
  /** Height class (default 64 px). */
  heightClass?: string;
}

export function FullWaveform({ peaks, progress, bands = [], highlight, onSeek, heightClass = "h-[64px]" }: Props) {
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
    const theme = style.getPropertyValue("--theme").trim() || "#2563EB";
    const muted = style.getPropertyValue("--text-muted").trim() || "#9CA3AF";
    const labelH = bands.length ? 12 : 0;
    const waveTop = labelH;
    const waveH = h - labelH;

    // Section bands: faint alternating fill, a hairline at each start, name above.
    bands.forEach((band, i) => {
      const x = band.start * w;
      const bw = Math.max(1, (band.end - band.start) * w);
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(127,127,127,0.07)";
        ctx.fillRect(x, waveTop, bw, waveH);
      }
      ctx.fillStyle = "rgba(127,127,127,0.35)";
      ctx.fillRect(x, 0, 1, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 3, 0, Math.max(0, bw - 6), labelH);
      ctx.clip();
      ctx.font = "600 9px 'DM Sans', sans-serif";
      ctx.fillStyle = muted;
      ctx.fillText(band.label.toUpperCase(), x + 4, 9);
      ctx.restore();
    });

    // Selected line.
    if (highlight) {
      ctx.fillStyle = theme;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(highlight.start * w, waveTop, Math.max(2, (highlight.end - highlight.start) * w), waveH);
      ctx.globalAlpha = 1;
    }

    // Bars, centred vertically; played part in the theme colour.
    const barCount = peaks.length;
    const gap = 1;
    const barWidth = Math.max(1, (w - gap * (barCount - 1)) / barCount);
    const playedX = progress * w;
    const mid = waveTop + waveH / 2;
    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap);
      const barH = Math.max(2, peaks[i] * waveH * 0.9);
      ctx.fillStyle = x + barWidth / 2 <= playedX ? theme : "rgba(127,127,127,0.35)";
      ctx.beginPath();
      ctx.roundRect(x, mid - barH / 2, barWidth, barH, 1);
      ctx.fill();
    }

    // Playhead.
    ctx.fillStyle = theme;
    ctx.fillRect(Math.round(playedX) - 1, waveTop, 2, waveH);
  }, [peaks, progress, bands, highlight]);

  if (peaks.length === 0) return null;

  return (
    <div ref={containerRef} className={`${heightClass} relative cursor-pointer`} onClick={handleClick}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
