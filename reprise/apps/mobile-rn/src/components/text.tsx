// Text in the app's UI font (Inter, embedded at build time). Android picks custom font weights by
// family name, so fontWeight maps to the matching Inter file. Anything with its own fontFamily
// (lyrics in the serif, titles in Fraunces) keeps it.
// Lyrics with nested spans use React Native's Text directly, so the spans inherit the serif.
import { forwardRef } from "react";
import { StyleSheet, Text as RNText, type TextProps } from "react-native";

const INTER: Record<string, string> = {
  "100": "Inter_400Regular",
  "200": "Inter_400Regular",
  "300": "Inter_400Regular",
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  bold: "Inter_700Bold",
  "800": "Inter_700Bold",
  "900": "Inter_700Bold",
};

/** Display face for titles. */
export const DISPLAY = "Fraunces_600SemiBold";
export const DISPLAY_REGULAR = "Fraunces_400Regular";

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return <RNText ref={ref} style={style} {...rest} />;
  const family = INTER[String(flat.fontWeight ?? "400")] ?? INTER["400"];
  // The weight lives in the family now; leaving fontWeight would make Android fake-bold it.
  return <RNText ref={ref} style={[style, { fontFamily: family, fontWeight: undefined }]} {...rest} />;
});
