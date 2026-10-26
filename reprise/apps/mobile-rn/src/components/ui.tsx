// The app's few building blocks, so every screen is made of the same pieces:
// Button (solid / soft / plain), Chip, Segmented, Card, Label. Filled shapes, no outlines.
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";
import type { Theme } from "../lib/theme";

export type Tone = { solid: string; onSolid: string; soft: string; tint: string };

/** The app accent as a tone (screens about one song pass the song's palette instead). */
export const accentTone = (t: Theme): Tone => ({ solid: t.accent, onSolid: t.onAccent, soft: t.themeSoft, tint: t.themeText });

export function Button({
  label,
  onPress,
  t,
  tone,
  kind = "solid",
  icon,
  danger,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  t: Theme;
  tone?: Tone;
  kind?: "solid" | "soft" | "plain";
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = tone ?? accentTone(t);
  const bg = kind === "solid" ? (danger ? t.danger : c.solid) : kind === "soft" ? (danger ? `${t.danger}1A` : c.soft) : "transparent";
  const fg = kind === "solid" ? (danger ? "#fff" : c.onSolid) : danger ? t.danger : kind === "soft" ? c.tint : t.textSecondary;
  return (
    <PressableScale
      haptic
      scaleTo={0.95}
      onPress={onPress}
      disabled={disabled}
      style={[
        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 42, paddingHorizontal: kind === "plain" ? 6 : 18, borderRadius: 21, backgroundColor: bg, opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      {icon}
      <Text style={{ fontSize: 14.5, fontWeight: kind === "plain" ? "500" : "600", color: fg }}>{label}</Text>
    </PressableScale>
  );
}

export function Chip({ children, t, tone = "neutral" }: { children: ReactNode; t: Theme; tone?: "neutral" | "voice" | Tone }) {
  const bg = tone === "neutral" ? (t.dark ? "#FFFFFF12" : "#0000000A") : tone === "voice" ? t.voiceSoft : tone.soft;
  const fg = tone === "neutral" ? t.textSecondary : tone === "voice" ? t.voice : tone.tint;
  return (
    <Text style={{ fontSize: 12, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, overflow: "hidden", color: fg, backgroundColor: bg }}>
      {children}
    </Text>
  );
}

/** A choice of a few options in one track; the picked one sits on a raised pill. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  t,
  label = (v) => String(v),
  stretch,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  t: Theme;
  label?: (v: T) => string;
  stretch?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", padding: 3, borderRadius: 12, backgroundColor: t.dark ? "#FFFFFF0D" : "#0000000A", alignSelf: stretch ? "stretch" : "flex-start" }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <PressableScale
            key={String(o)}
            haptic
            scaleTo={0.94}
            onPress={() => onChange(o)}
            style={{ flex: stretch ? 1 : undefined, alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: on ? t.raised : "transparent", elevation: on ? 1 : 0 }}
          >
            <Text style={{ fontSize: 13, fontWeight: on ? "600" : "400", color: on ? t.text : t.muted }}>{label(o)}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export function Card({ children, t, style }: { children: ReactNode; t: Theme; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ borderRadius: 18, backgroundColor: t.surface, padding: 16 }, style]}>{children}</View>;
}

export function Label({ children, t, style }: { children: ReactNode; t: Theme; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1.1, color: t.muted, textTransform: "uppercase" }}>{children}</Text>
    </View>
  );
}
