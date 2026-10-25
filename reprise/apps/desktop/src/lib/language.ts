/**
 * Song languages are stored as typed by the user / auto-filled: a name
 * ("Japanese") or a code ("ja", "ja-JP"). Compare them through these.
 */
const NAMES: Record<string, string> = {
  japanese: "ja",
  english: "en",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "zh",
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  italian: "it",
};

/** Base ISO code for a language name or code ("Japanese" → "ja", "ja-JP" → "ja"). */
export function languageCode(language?: string | null): string | undefined {
  if (!language) return undefined;
  const l = language.toLowerCase().trim();
  if (!l) return undefined;
  return NAMES[l] ?? l.split(/[-_]/)[0];
}

export function isJapanese(language?: string | null): boolean {
  return languageCode(language) === "ja";
}
