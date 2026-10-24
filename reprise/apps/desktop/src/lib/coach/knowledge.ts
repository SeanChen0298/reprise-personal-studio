// What the coach knows and remembers.
//   Per song   → <song folder>/coach.json (+ a readable coach.md): the song card,
//                lasting insights, and the recent conversation.
//   The singer → C:/Reprise/coach-profile.json: facts about their voice and habits.
// Songs without a folder yet fall back to the local DB (meta).

import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { localDb } from "../local-db";
import type { CoachTurn } from "./providers";
import type { HighlightType } from "../highlight-config";
import type { Line, Recording, Section, Song } from "../../types/song";

const REPRISE_ROOT = "C:/Reprise";
const PROFILE_PATH = `${REPRISE_ROOT}/coach-profile.json`;
/** Turns kept in the saved conversation (older ones live on as "remember" insights). */
const MAX_SAVED_TURNS = 40;
/** Memory is a fixed size: the coach must merge or replace items once it's full. */
export const MAX_SINGER_FACTS = 20;
export const MAX_SONG_MEMORY = 15;

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

export interface SongKnowledge {
  card: SongCard | null;
  card_sources: { title: string; url: string }[];
  card_made_at?: string;
  /** Lasting insights about this song, approved by the singer. */
  memory: string[];
  chat: (CoachTurn & {
    at: string;
    sources?: { title: string; url: string }[];
    /** How the answer was made: model, time to first words, total time (ms). */
    model?: string;
    first_ms?: number;
    ms?: number;
    /** Search was wanted but not available on the model used. */
    no_search?: boolean;
  })[];
}

export interface SingerProfile {
  facts: string[];
}

const EMPTY: SongKnowledge = { card: null, card_sources: [], memory: [], chat: [] };

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function loadKnowledge(song: Song): Promise<SongKnowledge> {
  try {
    if (song.audio_folder) {
      const path = `${song.audio_folder}/coach.json`;
      if (await exists(path)) return withCard({ ...EMPTY, ...JSON.parse(await readTextFile(path)) });
      return { ...EMPTY };
    }
    const v = (await localDb.getMeta(`coach:${song.id}`)) as SongKnowledge | undefined;
    return v ? withCard({ ...EMPTY, ...v }) : { ...EMPTY };
  } catch (err) {
    console.warn("[coach] couldn't read song knowledge:", err);
    return { ...EMPTY };
  }
}

function withCard(k: SongKnowledge): SongKnowledge {
  return { ...k, card: k.card ? normaliseCard(k.card as unknown as Record<string, unknown>) : null };
}

export async function saveKnowledge(song: Song, k: SongKnowledge): Promise<void> {
  const trimmed: SongKnowledge = { ...k, chat: k.chat.slice(-MAX_SAVED_TURNS) };
  if (!song.audio_folder) {
    await localDb.setMeta(`coach:${song.id}`, trimmed);
    return;
  }
  if (!(await exists(song.audio_folder))) await mkdir(song.audio_folder, { recursive: true });
  await writeTextFile(`${song.audio_folder}/coach.json`, JSON.stringify(trimmed, null, 2));
  // A readable copy next to the audio, for you (and for moving the song by hand).
  await writeTextFile(`${song.audio_folder}/coach.md`, knowledgeMarkdown(song, trimmed));
}

export async function loadProfile(): Promise<SingerProfile> {
  try {
    if (await exists(PROFILE_PATH)) return { facts: [], ...JSON.parse(await readTextFile(PROFILE_PATH)) };
  } catch (err) {
    console.warn("[coach] couldn't read singer profile:", err);
  }
  return { facts: [] };
}

export async function saveProfile(p: SingerProfile): Promise<void> {
  if (!(await exists(REPRISE_ROOT))) await mkdir(REPRISE_ROOT, { recursive: true });
  await writeTextFile(PROFILE_PATH, JSON.stringify(p, null, 2));
}

function knowledgeMarkdown(song: Song, k: SongKnowledge): string {
  const out: string[] = [`# ${song.title} — ${song.artist}`, ""];
  if (k.card) {
    const c = k.card;
    out.push(`> ${c.summary}`, "", `**Mood:** ${c.mood}`, "", "## Story");
    if (c.arc.length) for (const a of c.arc) out.push(`- ${a.lines ? `**${a.lines}** ` : ""}${a.text}`);
    else out.push(c.story);
    out.push("", "## Sections");
    for (const s of c.sections) {
      const v = s.voice ? ` · ${[s.voice.register, s.voice.placement].filter(Boolean).join(", ")}` : "";
      out.push(`- **${s.name}** (${s.mood}${v}) — ${s.intent}${s.voice?.image ? ` _Imagine: ${s.voice.image}_` : ""}`);
    }
    out.push("", `## ${c.singer.name}'s voice`, c.singer.style);
    for (const t of c.singer.techniques) out.push(`- ${t}`);
    if (c.techniques.length) {
      out.push("", "## Techniques");
      for (const t of c.techniques) {
        out.push(`- **${t.name}**${t.lines ? ` (${t.lines})` : ""} — ${[t.register, t.placement].filter(Boolean).join(", ")}. Imagine: ${t.image} Drill: ${t.drill}`);
      }
    }
    out.push("", "## Practice focus");
    for (const p of c.practice_focus) out.push(`- ${p}`);
    if (k.card_sources.length) {
      out.push("", "## Sources");
      for (const s of k.card_sources) out.push(`- [${s.title}](${s.url})`);
    }
    out.push("");
  }
  if (k.memory.length) {
    out.push("## What we've learned", ...k.memory.map((m) => `- ${m}`), "");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Context sent to the coach
// ---------------------------------------------------------------------------

export function buildContext(opts: {
  song: Song;
  lines: Line[];
  translationById: Map<string, string>;
  sections: Section[];
  highlights: HighlightType[];
  takes: Recording[];
  knowledge: SongKnowledge;
  profile: SingerProfile;
}): string {
  const { song, lines, translationById, sections, highlights, takes, knowledge, profile } = opts;
  const hl = new Map(highlights.map((h) => [h.id, h.name]));
  const out: string[] = [];
  out.push(`SONG: ${song.title} — ${song.artist}${song.language ? ` (${song.language})` : ""}`);
  out.push(
    "",
    `ABOUT THE SINGER (memory ${profile.facts.length}/${MAX_SINGER_FACTS}${profile.facts.length >= MAX_SINGER_FACTS ? " — FULL: merge or replace, don't add" : ""}):`,
    ...(profile.facts.length ? profile.facts.map((f, i) => `P${i + 1}. ${f}`) : ["(nothing yet)"]),
  );
  if (knowledge.card) {
    const c = knowledge.card;
    out.push("", "SONG CARD (written earlier):", `Summary: ${c.summary}`, `Mood: ${c.mood}`);
    if (c.arc.length) out.push(`Arc: ${c.arc.map((a) => `${a.lines} ${a.text}`).join(" / ")}`);
    else if (c.story) out.push(`Story: ${c.story}`);
    for (const s of c.sections) {
      const v = s.voice ? ` [${[s.voice.register, s.voice.placement].filter(Boolean).join(", ")}]` : "";
      out.push(`- ${s.name}: ${s.mood}${v} — ${s.intent}`);
    }
    out.push(`Original singer: ${c.singer.name} — ${c.singer.style}`);
    for (const t of c.techniques) out.push(`Technique: ${t.name} (${t.lines}) — ${t.register}, ${t.placement}`);
  }
  out.push(
    "",
    `WHAT WE'VE LEARNED ABOUT THIS SONG (memory ${knowledge.memory.length}/${MAX_SONG_MEMORY}${knowledge.memory.length >= MAX_SONG_MEMORY ? " — FULL: merge or replace, don't add" : ""}):`,
    ...(knowledge.memory.length ? knowledge.memory.map((m, i) => `S${i + 1}. ${m}`) : ["(nothing yet)"]),
  );

  out.push("", "LYRICS (L# = line number; my marks in [brackets]; my notes after ✎):");
  let current: Section | undefined;
  lines.forEach((l, i) => {
    const sec = sections.find((s) => l.order >= s.start_line_order && l.order <= s.end_line_order);
    if (sec && sec !== current) {
      current = sec;
      out.push(`## ${sec.name}`);
    }
    const text = l.custom_text ?? l.text;
    const marks = (l.annotations ?? [])
      .map((a) => `${hl.get(a.type) ?? a.type}: "${text.slice(a.start, a.end) || "·"}"`)
      .join("; ");
    const tr = translationById.get(l.id);
    out.push(
      `L${i + 1}: ${text}` +
        (tr ? `  /  ${tr}` : "") +
        (marks ? `  [${marks}]` : "") +
        (l.note ? `  ✎ ${l.note}` : ""),
    );
  });

  const recent = takes.slice(0, 5).filter((t) => t.notes?.length || t.analysis || t.note);
  if (recent.length) {
    out.push("", "RECENT TAKES (newest first):");
    for (const t of recent) out.push(describeTake(t, lines));
  }
  return out.join("\n");
}

/** One take, in words: your notes, then the rough automatic check. */
export function describeTake(t: Recording, lines: Line[]): string {
  const when = new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const out = [`Take ${when}${t.note ? ` — "${t.note}"` : ""}`];
  for (const n of [...(t.notes ?? [])].sort((a, b) => a.take_ms - b.take_ms)) {
    out.push(`  my note at ${Math.floor(n.take_ms / 60000)}:${String(Math.floor(n.take_ms / 1000) % 60).padStart(2, "0")}: ${n.text}`);
  }
  const a = t.analysis;
  if (a) {
    out.push(`  automatic check (rough): ${a.phrases_checked} phrases, ${a.high_notes_checked} high notes checked`);
    for (const i of a.issues.slice(0, 8)) {
      const idx = i.line_id ? lines.findIndex((l) => l.id === i.line_id) : -1;
      out.push(`  - ${idx >= 0 ? `L${idx + 1}` : "?"}: ${i.kind.replace(/_/g, " ")} — ${i.detail}`);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Reading replies
// ---------------------------------------------------------------------------

export interface CoachProposals {
  line_notes: { line: number; note: string }[];
  remember_song: string[];
  remember_singer: string[];
  /** Rewrite memory items by id ("S2" / "P3"). */
  update_song: { id: string; text: string }[];
  update_singer: { id: string; text: string }[];
  /** Remove memory items by id. */
  forget_song: string[];
  forget_singer: string[];
}

/** "P3" → index 2 (or -1). */
export function memoryIndex(id: string, prefix: "P" | "S"): number {
  const m = id.trim().toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`));
  return m ? Number(m[1]) - 1 : -1;
}

/** Split a reply into what to show and what it proposes to save. */
export function parseReply(text: string): { body: string; proposals: CoachProposals | null } {
  const m = text.match(/```reprise\s*([\s\S]*?)```/);
  if (!m) return { body: text, proposals: null };
  const body = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  try {
    const raw = JSON.parse(m[1]);
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
    const updates = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((u): u is { id: string; text: string } => !!u && typeof u.id === "string" && typeof u.text === "string")
        : [];
    const proposals: CoachProposals = {
      line_notes: Array.isArray(raw.line_notes)
        ? raw.line_notes.filter((n: unknown) => n && typeof (n as { line: unknown }).line === "number" && typeof (n as { note: unknown }).note === "string")
        : [],
      remember_song: strs(raw.remember_song),
      remember_singer: strs(raw.remember_singer),
      update_song: updates(raw.update_song),
      update_singer: updates(raw.update_singer),
      forget_song: strs(raw.forget_song),
      forget_singer: strs(raw.forget_singer),
    };
    const any = Object.values(proposals).some((v) => v.length > 0);
    return { body, proposals: any ? proposals : null };
  } catch {
    return { body, proposals: null };
  }
}

/** The song card from a reply that should be JSON (tolerates fences / stray prose). */
export function parseSongCard(text: string): SongCard | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normaliseCard(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
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
