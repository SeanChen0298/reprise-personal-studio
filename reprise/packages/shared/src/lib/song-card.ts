// The coach's song card — written on the desktop, read on the desktop and the phone.

/** Where a sound sits (resonance) and which register carries it — the coach's fixed vocabulary. */
export const REGISTERS = ["chest", "mix", "head", "falsetto", "breathy"] as const;
export const PLACEMENTS = ["forward", "nasal", "top", "back", "chest"] as const;

export interface VoiceSpec {
  register: string;
  placement: string;
  /** A picture to imagine to find the sound. */
  image: string;
}

export interface SongCard {
  summary: string;
  /** Short, e.g. "resigned → grateful release". */
  mood: string;
  /** The story in steps, each tied to lines. (Older cards have `story` text instead.) */
  arc: { lines: string; text: string }[];
  story: string;
  sections: { name: string; mood: string; intent: string; voice?: VoiceSpec }[];
  singer: { name: string; style: string; techniques: string[] };
  /** Key techniques for this song, each with where, how it should sit, and a drill. */
  techniques: { name: string; lines: string; register: string; placement: string; image: string; drill: string }[];
  practice_focus: string[];
}

/** Accepts new and older card shapes (older saved cards have no arc / voice / techniques). */
export function normaliseCard(raw: Record<string, unknown> | null | undefined): SongCard | null {
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const voice = (v: unknown): VoiceSpec | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const o = v as Record<string, unknown>;
    const spec = { register: str(o.register).toLowerCase(), placement: str(o.placement).toLowerCase(), image: str(o.image) };
    return spec.register || spec.placement || spec.image ? spec : undefined;
  };
  const singer = (raw.singer ?? {}) as Record<string, unknown>;
  return {
    summary: str(raw.summary),
    mood: str(raw.mood),
    arc: objs(raw.arc).map((a) => ({ lines: str(a.lines), text: str(a.text) })).filter((a) => a.text),
    story: str(raw.story),
    sections: objs(raw.sections)
      .map((s) => ({ name: str(s.name), mood: str(s.mood), intent: str(s.intent), voice: voice(s.voice) }))
      .filter((s) => s.name),
    singer: { name: str(singer.name), style: str(singer.style), techniques: arr(singer.techniques) },
    techniques: objs(raw.techniques)
      .map((t) => ({
        name: str(t.name),
        lines: str(t.lines),
        register: str(t.register).toLowerCase(),
        placement: str(t.placement).toLowerCase(),
        image: str(t.image),
        drill: str(t.drill),
      }))
      .filter((t) => t.name),
    practice_focus: arr(raw.practice_focus),
  };
}
