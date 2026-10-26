// The song's fingerpicking draft as a score (alphaTex, alphaTab's text format): guitar tab in
// eighth notes, chord names where they change, section names, and the lyrics under the beats
// they're sung on. A starting template — alphaTab renders it like a printed fingerstyle score.

import type { Line } from "../types/song";
import type { ChordAnalysis } from "./chord-analysis";
import type { PickEvent } from "./fingerpicking";
import { characterTimes } from "./lyric-timing";

export interface ScoreSection {
  name: string;
  start_line_order: number;
}

const quote = (s: string) => `"${s.replace(/"/g, "'").replace(/\\/g, "/")}"`;

export function scoreTex(opts: {
  title: string;
  artist?: string;
  analysis: ChordAnalysis;
  picking: PickEvent[];
  lines: Line[];
  sections: ScoreSection[];
  /** Chord name as shown (capo shapes, spelling). */
  chordName: (label: string) => string;
  capo: number;
}): string {
  const { analysis, picking, lines, sections } = opts;
  const bars = analysis.bars ?? [];
  const chords = analysis.chords ?? [];
  const meter = analysis.time_signature?.beats_per_bar ?? 4;

  const events = new Map<string, PickEvent>();
  for (const e of picking) events.set(`${e.bar}:${e.slot}`, e);

  // Where in which bar a time falls: [bar index, eighth-note slot].
  const slotOf = (t: number): [number, number] | null => {
    const i = bars.findIndex((b) => t >= b.start_ms - 1 && t < b.end_ms);
    if (i < 0) return null;
    const b = bars[i];
    const slots = Math.max(1, b.beats * 2);
    const k = Math.round(((t - b.start_ms) / Math.max(1, b.end_ms - b.start_ms)) * slots);
    return k >= slots ? (i + 1 < bars.length ? [i + 1, 0] : [i, slots - 1]) : [i, Math.max(0, k)];
  };

  // Chord names, lyrics and section names, by bar and slot.
  const chordAt = new Map<string, string>();
  for (const c of chords) {
    if (c.label === "N") continue;
    const at = slotOf(c.start_ms + 1);
    if (at) chordAt.set(`${at[0]}:${at[1]}`, opts.chordName(c.label));
  }
  const lyricAt = new Map<string, string>();
  const sectionAt = new Map<number, string>();
  const timed = lines.filter((l) => l.start_ms != null).sort((a, b) => a.start_ms! - b.start_ms!);
  timed.forEach((l, i) => {
    const chars = Array.from(l.custom_text ?? l.text);
    const end = l.end_ms ?? timed[i + 1]?.start_ms ?? l.start_ms! + 4000;
    const times = characterTimes({ ...l, end_ms: end }, chars.length);
    chars.forEach((ch, k) => {
      const at = slotOf(times[k]);
      if (!at) return;
      const key = `${at[0]}:${at[1]}`;
      lyricAt.set(key, (lyricAt.get(key) ?? "") + ch);
    });
    const sec = sections.find((s) => s.start_line_order === l.order);
    const at = slotOf(l.start_ms!);
    if (sec && at && !sectionAt.has(at[0])) sectionAt.set(at[0], sec.name);
  });

  const out: string[] = [];
  out.push(`\\title ${quote(opts.title)}`);
  if (opts.artist) out.push(`\\artist ${quote(opts.artist)}`);
  if (analysis.tempo_bpm) out.push(`\\tempo ${Math.round(analysis.tempo_bpm)}`);
  out.push(`\\track "Guitar"`, `\\staff {tabs}`, `\\tuning (E4 B3 G3 D3 A2 E2)`);
  if (opts.capo > 0) out.push(`\\capo ${opts.capo}`);

  let ts = meter;
  const barTexts: string[] = [];
  bars.forEach((bar, bi) => {
    const parts: string[] = [];
    if (bar.beats !== ts && bar.beats > 0) {
      ts = bar.beats;
      parts.push(`\\ts ${ts} 4`);
    }
    if (sectionAt.has(bi)) parts.push(`\\section ${quote(sectionAt.get(bi)!)}`);
    // A picked note rings until the next one, so it's written that long (eighth, quarter, dotted
    // quarter, half…) — not as an eighth note plus rests. Empty stretches become one rest.
    const beats: string[] = [];
    const slots = Math.max(1, bar.beats * 2);
    const starts: number[] = [];
    for (let k = 0; k < slots; k++) if (k === 0 || events.get(`${bi}:${k}`)?.notes.length) starts.push(k);
    starts.forEach((k, i) => {
      let left = (starts[i + 1] ?? slots) - k;
      const e = events.get(`${bi}:${k}`);
      const notes = e?.notes ?? [];
      const head = notes.length === 0 ? "r" : notes.length === 1 ? `${notes[0].fret}.${notes[0].string}` : `(${notes.map((n) => `${n.fret}.${n.string}`).join(" ")})`;
      // Chord names and lyrics of the slots this note covers go on it.
      const keys = Array.from({ length: left }, (_, j) => `${bi}:${k + j}`);
      const chord = keys.map((key) => chordAt.get(key)).find(Boolean);
      const words = keys.map((key) => lyricAt.get(key) ?? "").join("");
      let first = true;
      while (left > 0) {
        // Longest written value that fits: 8 = whole, 6 = dotted half, 4 = half, 3 = dotted quarter, 2 = quarter, 1 = eighth.
        const len = [8, 6, 4, 3, 2, 1].find((n) => n <= left)!;
        const value = { 8: "1", 6: "2", 4: "2", 3: "4", 2: "4", 1: "8" }[len];
        const props: string[] = [];
        if (len === 6 || len === 3) props.push("d");
        if (first && chord) props.push(`ch ${quote(chord)}`);
        if (first && words) props.push(`lyrics ${quote(words)}`);
        // The rest of a long note is tied on; after a rest, more rest.
        const note = first || notes.length === 0 ? head : notes.length === 1 ? `-.${notes[0].string}` : `(${notes.map((n) => `-.${n.string}`).join(" ")})`;
        beats.push(`${note}.${value}${props.length ? `{${props.join(" ")}}` : ""}`);
        left -= len;
        first = false;
      }
    });
    parts.push(beats.join(" "));
    barTexts.push(parts.join(" "));
  });
  out.push(barTexts.join(" |\n"));
  return out.join("\n");
}
