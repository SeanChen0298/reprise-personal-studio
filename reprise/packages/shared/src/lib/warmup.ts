// A warm-up for one song, written by the coach: a few short drills, in order, each aimed at what
// this song asks of the voice (its range, its high notes, its long phrases, its vowels). A drill
// can carry a note pattern — sung on a syllable from a start note, moved up a half step each
// time — which both apps play with the same small synth (renderDrill → WAV).

export interface WarmupDrill {
  name: string;
  minutes: number;
  /** Why this drill, for this song (names lines like L19). */
  purpose: string;
  /** The lines it prepares, e.g. "L19, L22". */
  lines?: string;
  /** How to do it, in one to three short sentences. */
  how: string;
  /** A picture to imagine. */
  image?: string;
  /** What to sing it on: "lip trill", "ng", "nay", "mum", "oo"… */
  syllable?: string;
  register?: string;
  placement?: string;
  /** The note pattern, as semitones above the start note (e.g. 0 2 4 5 7 5 4 2 0). */
  pattern?: number[];
  /** Start note of the first and of the last repetition (e.g. "C3" → "G3"); up a half step each time. */
  from?: string;
  to?: string;
  /** Slide between the pattern's notes (sirens) instead of separate notes. */
  glide?: boolean;
  /** Notes per minute (default 150). */
  tempo?: number;
}

export interface Warmup {
  /** One sentence: what this warm-up prepares in this song. */
  focus: string;
  minutes: number;
  drills: WarmupDrill[];
}

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#4" / "Db4" / "c4" → MIDI number (C4 = 60), or null. */
export function noteToMidi(name: string | undefined): number | null {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)(-?\d)\s*$/.exec(name ?? "");
  if (!m) return null;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return NOTE_PC[m[1].toUpperCase()] + acc + (Number(m[3]) + 1) * 12;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiToNote(midi: number): string {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

/**
 * Read a warm-up from the coach's JSON (or a saved one), dropping what doesn't make sense.
 * `topNote`: the song's highest sung note — a pattern never goes more than a half step above it.
 */
export function normaliseWarmup(raw: unknown, topNote?: number | null): Warmup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const drills: WarmupDrill[] = (Array.isArray(r.drills) ? r.drills : [])
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => {
      const drill: WarmupDrill = {
        name: str(d.name),
        minutes: Math.max(0.5, Math.min(5, num(d.minutes) ?? 1.5)),
        purpose: str(d.purpose),
        how: str(d.how),
      };
      for (const k of ["lines", "image", "syllable", "register", "placement"] as const) if (str(d[k])) drill[k] = str(d[k]);
      const pattern = Array.isArray(d.pattern) ? d.pattern.map(num).filter((x): x is number => x != null && Math.abs(x) <= 24).map(Math.round) : [];
      let from = noteToMidi(str(d.from));
      let to = noteToMidi(str(d.to)) ?? from;
      if (pattern.length >= 2 && from != null && to != null) {
        if (to < from) [from, to] = [to, from];
        // Keep the top of the pattern within the song's range (+ a half step).
        const span = Math.max(...pattern);
        if (topNote != null) to = Math.min(to, topNote + 1 - span);
        // Too high even at the start: one repetition, as high as the song allows.
        if (to < from) from = to;
        if (to - from > 14) to = from + 14;
        if (to >= 24) {
          drill.pattern = pattern;
          drill.from = midiToNote(from);
          drill.to = midiToNote(to);
          if (d.glide === true) drill.glide = true;
          const tempo = num(d.tempo);
          if (tempo) drill.tempo = Math.max(60, Math.min(260, Math.round(tempo)));
        }
      }
      return drill;
    })
    .filter((d) => d.name && d.how);
  if (!drills.length) return null;
  return {
    focus: str(r.focus),
    minutes: Math.round(num(r.minutes) ?? drills.reduce((a, d) => a + d.minutes, 0)),
    drills,
  };
}

/** The drill's notes in order: [midi, start s, length s] — one repetition per start note, a rest between. */
export function drillNotes(d: WarmupDrill): { midi: number; at: number; len: number; glideTo?: number }[] {
  const from = noteToMidi(d.from);
  const to = noteToMidi(d.to) ?? from;
  if (!d.pattern?.length || from == null || to == null) return [];
  const beat = 60 / (d.tempo ?? 150);
  const out: { midi: number; at: number; len: number; glideTo?: number }[] = [];
  let t = 0;
  for (let root = from; root <= to; root++) {
    // The start note first, a little longer, so you can find it.
    out.push({ midi: root, at: t, len: beat * 1.6 });
    t += beat * 2.2;
    if (d.glide) {
      for (let i = 0; i + 1 < d.pattern.length; i++) {
        const len = beat * 2;
        out.push({ midi: root + d.pattern[i], at: t, len, glideTo: root + d.pattern[i + 1] });
        t += len;
      }
    } else {
      d.pattern.forEach((p, i) => {
        const last = i === d.pattern!.length - 1;
        out.push({ midi: root + p, at: t, len: last ? beat * 1.8 : beat * 0.92 });
        t += last ? beat * 1.8 : beat;
      });
    }
    t += beat * 1.4;
  }
  return out;
}

/** How long the drill's notes take, in ms. */
export function drillDurationMs(d: WarmupDrill): number {
  const n = drillNotes(d);
  return n.length ? Math.round((n[n.length - 1].at + n[n.length - 1].len + 0.3) * 1000) : 0;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** The drill as a mono 16-bit WAV: a soft, piano-like tone (sung-along guide, not an instrument). */
export function renderDrill(d: WarmupDrill, sampleRate = 22050): Uint8Array | null {
  const notes = drillNotes(d);
  if (!notes.length) return null;
  const total = Math.ceil((notes[notes.length - 1].at + notes[notes.length - 1].len + 0.4) * sampleRate);
  const buf = new Float32Array(total);
  for (const n of notes) {
    const start = Math.floor(n.at * sampleRate);
    const len = Math.floor(n.len * sampleRate);
    const f0 = hz(n.midi);
    const f1 = n.glideTo != null ? hz(n.glideTo) : f0;
    let phase = 0;
    const tail = Math.floor(0.12 * sampleRate);
    for (let i = 0; i < len + tail && start + i < total; i++) {
      const x = i / sampleRate;
      const f = n.glideTo != null ? f0 * Math.pow(f1 / f0, Math.min(1, i / len)) : f0;
      phase += (2 * Math.PI * f) / sampleRate;
      // Attack 15 ms, gentle decay, release over the tail.
      const env =
        Math.min(1, x / 0.015) *
        (n.glideTo != null ? 0.8 : 0.55 + 0.45 * Math.exp(-x * 3)) *
        (i > len ? Math.max(0, 1 - (i - len) / tail) : 1);
      buf[start + i] += env * (0.6 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase));
    }
  }
  return wav(buf, sampleRate);
}

function wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] * 0.7)) * 32767, true);
  return bytes;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Base64 of bytes (the phone writes the WAV with it). */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b == null ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c == null ? "=" : B64[c & 63];
  }
  return out;
}
