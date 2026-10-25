import Svg, { Circle, Line as SvgLine, Path, Polygon, Polyline, Rect } from "react-native-svg";

type P = { size?: number; color: string; strokeWidth?: number };

const stroke = (color: string, w = 2) => ({ stroke: color, strokeWidth: w, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const PlayIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polygon points="7 4 20 12 7 20 7 4" fill={color} />
  </Svg>
);

export const PauseIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
    <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
  </Svg>
);

export const PrevIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polygon points="19 20 9 12 19 4 19 20" fill={color} />
    <SvgLine x1="5" y1="19" x2="5" y2="5" {...stroke(color, 2.5)} />
  </Svg>
);

export const NextIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polygon points="5 4 15 12 5 20 5 4" fill={color} />
    <SvgLine x1="19" y1="5" x2="19" y2="19" {...stroke(color, 2.5)} />
  </Svg>
);

export const LoopIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polyline points="17 1 21 5 17 9" {...stroke(color, strokeWidth)} />
    <Path d="M3 11V9a4 4 0 014-4h14" {...stroke(color, strokeWidth)} />
    <Polyline points="7 23 3 19 7 15" {...stroke(color, strokeWidth)} />
    <Path d="M21 13v2a4 4 0 01-4 4H3" {...stroke(color, strokeWidth)} />
  </Svg>
);

export const MicIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" {...stroke(color, strokeWidth)} />
    <Path d="M19 10v2a7 7 0 01-14 0v-2" {...stroke(color, strokeWidth)} />
    <SvgLine x1="12" y1="19" x2="12" y2="23" {...stroke(color, strokeWidth)} />
  </Svg>
);

export const StopIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="6" width="12" height="12" rx="2" fill={color} />
  </Svg>
);

export const BackIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M15 18l-6-6 6-6" {...stroke(color, strokeWidth ?? 2.2)} />
  </Svg>
);

export const SettingsIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="3" {...stroke(color, strokeWidth)} />
    <Path
      d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
      {...stroke(color, strokeWidth ?? 1.8)}
    />
  </Svg>
);

export const DownloadIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" {...stroke(color, strokeWidth)} />
    <Polyline points="7 10 12 15 17 10" {...stroke(color, strokeWidth)} />
    <SvgLine x1="12" y1="15" x2="12" y2="3" {...stroke(color, strokeWidth)} />
  </Svg>
);

export const NoteIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 20h9" {...stroke(color, strokeWidth)} />
    <Path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" {...stroke(color, strokeWidth)} />
  </Svg>
);

export const ChevronIcon = ({ size = 20, color, strokeWidth, up }: P & { up?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={up ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} {...stroke(color, strokeWidth)} />
  </Svg>
);

export const StarIcon = ({ size = 20, color, filled }: P & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polygon
      points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
      fill={filled ? color : "none"}
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  </Svg>
);

export const SyncIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M21 12a9 9 0 01-15.5 6.2L3 16" {...stroke(color, strokeWidth)} />
    <Path d="M3 12a9 9 0 0115.5-6.2L21 8" {...stroke(color, strokeWidth)} />
    <Polyline points="21 3 21 8 16 8" {...stroke(color, strokeWidth)} />
    <Polyline points="3 21 3 16 8 16" {...stroke(color, strokeWidth)} />
  </Svg>
);

export const TrashIcon = ({ size = 20, color, strokeWidth }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Polyline points="3 6 5 6 21 6" {...stroke(color, strokeWidth)} />
    <Path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" {...stroke(color, strokeWidth)} />
  </Svg>
);
