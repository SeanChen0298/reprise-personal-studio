import Svg, { Path, Rect, Circle, Polygon } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
}

export function IconPlay({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="6,3 20,12 6,21" fill={color} />
    </Svg>
  );
}

export function IconPause({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
      <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
    </Svg>
  );
}

export function IconSkipBack({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="19,20 9,12 19,4" fill={color} />
      <Rect x="5" y="4" width="2.5" height="16" rx="1.25" fill={color} />
    </Svg>
  );
}

export function IconSkipForward({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="5,4 15,12 5,20" fill={color} />
      <Rect x="16.5" y="4" width="2.5" height="16" rx="1.25" fill={color} />
    </Svg>
  );
}

export function IconRepeat({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M17 2l4 4-4 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 11V9a4 4 0 014-4h14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 22l-4-4 4-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M21 13v2a4 4 0 01-4 4H3" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconChevronLeft({ size = 24, color = "#1C1C1E" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconChevronRight({ size = 24, color = "#8E8E93" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18l6-6-6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconMusic({ size = 24, color = "#8E8E93" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18V5l12-2v13" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Circle cx="6" cy="18" r="3" stroke={color} strokeWidth="1.5" />
      <Circle cx="18" cy="16" r="3" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

export function IconSettings({ size = 24, color = "#8E8E93" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <Path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
      />
    </Svg>
  );
}

export function IconDownload({ size = 20, color = "#5856D6" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 11l5 5 5-5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 19h16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
