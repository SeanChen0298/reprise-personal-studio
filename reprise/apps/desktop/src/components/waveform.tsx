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

    // Match pitch curve's label margin so cursors stay aligned
    const labelMargin = 32;
    const graphW = w - labelMargin;

    // The "floor" sits at 62% from top — main bars grow upward, reflection downward
    const floorY = Math.round(h * 0.62);
    const upperZone = floorY;           // pixels available above floor
    const lowerZone = h - floorY;       // pixels available below floor

    const barCount = peaks.length;
    const slotW = graphW / barCount;
    const gap = Math.min(1.5, slotW * 0.25);
    const barWidth = slotW - gap;
    const progressX = labelMargin + progress * graphW;

    for (let i = 0; i < barCount; i++) {
      const x = labelMargin + i * slotW;
      const amplitude = peaks[i];
      const isPast = x + barWidth / 2 <= progressX;
      const color = isPast ? themeColor : mutedColor;

      // ── Main bar (grows upward from floor) ─────────────────────────
      const upperH = Math.max(2, amplitude * upperZone * 0.96);
      ctx.fillStyle = color;
      ctx.globalAlpha = isPast ? 0.85 : 0.22;
      ctx.beginPath();
      ctx.roundRect(x, floorY - upperH, barWidth, upperH, [1, 1, 0, 0]);
      ctx.fill();

      // ── Reflection (grows downward from floor, shorter + faded) ────
      const lowerH = Math.max(1, amplitude * lowerZone * 0.72);
      ctx.fillStyle = color;
      ctx.globalAlpha = isPast ? 0.28 : 0.07;
      ctx.beginPath();
      ctx.roundRect(x, floorY, barWidth, lowerH, [0, 0, 1, 1]);
      ctx.fill();
    }

    // ── Floor line ──────────────────────────────────────────────────
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = mutedColor;
    ctx.fillRect(labelMargin, floorY, graphW, 1);

    // ── Playback cursor ──────────────────────────────────────────────
    ctx.globalAlpha = 1;
    ctx.fillStyle = themeColor;
    ctx.fillRect(progressX - 0.75, 0, 1.5, h);
  }, [peaks, progress]);

  if (peaks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="h-[64px] relative cursor-pointer overflow-hidden"
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}
