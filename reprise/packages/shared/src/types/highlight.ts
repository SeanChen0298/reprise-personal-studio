export interface HighlightType {
  id: string;
  name: string;
  description: string;
  bg: string;    // background hex, e.g. "#DBEAFE"
  color: string; // text hex, e.g. "#1D4ED8"
}

export const DEFAULT_HIGHLIGHTS: HighlightType[] = [
  { id: "falsetto", name: "Falsetto",    description: "Mark sections that use falsetto technique", bg: "#DBEAFE", color: "#1D4ED8" },
  { id: "whisper",  name: "Whisper",     description: "Soft, breathy vocal sections",               bg: "#DCFCE7", color: "#15803D" },
  { id: "accent",   name: "Accent",      description: "Words or syllables to emphasize",            bg: "#FEE2E2", color: "#B91C1C" },
  { id: "vibrato",  name: "Vibrato",     description: "Sections with intentional vibrato",          bg: "#F5F3FF", color: "#6D28D9" },
  { id: "breath",   name: "Breath mark", description: "Where to take breaths",                      bg: "#FFF7ED", color: "#C2410C" },
];
