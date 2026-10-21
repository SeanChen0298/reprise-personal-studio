import type { ChordShape } from "../lib/chord-shapes";

interface ChordDiagramProps {
  shape: ChordShape;
  /** Width in px; height scales with it. */
  size?: number;
  showFingers?: boolean;
}

const FRETS_SHOWN = 5;

/**
 * Standard chord box: strings vertical (low E on the left), frets
 * horizontal, nut on top. x = muted, o = open, numbers = fingers.
 */
export function ChordDiagram({ shape, size = 96, showFingers = true }: ChordDiagramProps) {
  const fretted = shape.frets.filter((f): f is number => f != null && f > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 1;
  const baseFret = maxFret <= FRETS_SHOWN - 1 ? 1 : minFret;

  const padX = 14, padTop = 18, padBottom = 6;
  const width = size;
  const gridW = width - padX * 2;
  const stringGap = gridW / 5;
  const fretGap = stringGap * 1.15;
  const gridH = fretGap * FRETS_SHOWN;
  const height = padTop + gridH + padBottom;

  const x = (stringIdx: number) => padX + stringIdx * stringGap;           // 0 = low E
  const y = (fret: number) => padTop + (fret - baseFret + 0.5) * fretGap;  // centre of fret space
  const dotR = stringGap * 0.36;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-[var(--text-primary)]">
      {/* Frets */}
      {Array.from({ length: FRETS_SHOWN + 1 }).map((_, i) => (
        <line
          key={`f${i}`}
          x1={padX} x2={padX + gridW}
          y1={padTop + i * fretGap} y2={padTop + i * fretGap}
          stroke="currentColor"
          strokeOpacity={i === 0 && baseFret === 1 ? 0.9 : 0.25}
          strokeWidth={i === 0 && baseFret === 1 ? 3 : 1}
        />
      ))}
      {/* Strings */}
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`s${i}`} x1={x(i)} x2={x(i)} y1={padTop} y2={padTop + gridH} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
      ))}
      {/* Base fret label for shapes up the neck */}
      {baseFret > 1 && (
        <text x={padX - 4} y={padTop + fretGap * 0.5 + 3.5} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
          {baseFret}fr
        </text>
      )}
      {/* Open / muted markers */}
      {shape.frets.map((f, i) =>
        f == null ? (
          <text key={`m${i}`} x={x(i)} y={padTop - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.55}>×</text>
        ) : f === 0 ? (
          <circle key={`o${i}`} cx={x(i)} cy={padTop - 9} r={3} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2} />
        ) : null,
      )}
      {/* Barre */}
      {shape.barre && (
        <rect
          x={x(6 - shape.barre.fromString) - dotR}
          y={y(shape.barre.fret) - dotR}
          width={x(6 - shape.barre.toString) - x(6 - shape.barre.fromString) + dotR * 2}
          height={dotR * 2}
          rx={dotR}
          fill="var(--theme)"
        />
      )}
      {/* Finger dots */}
      {shape.frets.map((f, i) => {
        if (f == null || f === 0) return null;
        const onBarre = shape.barre && f === shape.barre.fret && shape.fingers[i] === 1;
        return (
          <g key={`d${i}`}>
            {!onBarre && <circle cx={x(i)} cy={y(f)} r={dotR} fill="var(--theme)" />}
            {showFingers && shape.fingers[i] > 0 && !onBarre && (
              <text x={x(i)} y={y(f) + 3.3} textAnchor="middle" fontSize={9} fontWeight={600} fill="white">
                {shape.fingers[i]}
              </text>
            )}
          </g>
        );
      })}
      {showFingers && shape.barre && (
        <text
          x={x(6 - shape.barre.fromString)}
          y={y(shape.barre.fret) + 3.3}
          textAnchor="middle" fontSize={9} fontWeight={600} fill="white"
        >
          1
        </text>
      )}
    </svg>
  );
}
