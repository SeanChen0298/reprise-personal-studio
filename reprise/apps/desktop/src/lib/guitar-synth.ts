/**
 * guitar-synth.ts
 *
 * Guitar sound for chord previews and the play-along guide.
 *
 * Plays real acoustic-guitar samples (FluidR3_GM, CC BY 3.0 — see
 * public/guitar-samples/ATTRIBUTION.txt) bundled with the app, one MP3 per
 * MIDI note 40–84, so it works offline. Until a note's sample has loaded,
 * a Karplus-Strong plucked-string synth stands in for it.
 *
 * All scheduling times are AudioContext seconds; callers convert from ms.
 */

export type GuitarInstrument = "steel" | "nylon";

const SAMPLE_LOW = 40;   // E2
const SAMPLE_HIGH = 84;  // C6
const DEFAULT_MASTER = 0.35;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let instrument: GuitarInstrument = "steel";

const samples = new Map<string, AudioBuffer>();             // `${instrument}:${midi}`
const loading = new Map<GuitarInstrument, Promise<void>>();
const synthCache = new Map<number, AudioBuffer>();

/** One voice per string so a new note damps the previous one, like a real guitar. */
const ringing = new Map<number, { gain: GainNode; source: AudioBufferSourceNode }>();

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = DEFAULT_MASTER;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, master: master! };
}

/** Fetch and decode every note of an instrument (≈0.9 MB). Safe to call repeatedly. */
export function loadInstrument(which: GuitarInstrument = instrument): Promise<void> {
  const existing = loading.get(which);
  if (existing) return existing;
  const { ctx } = audio();
  const task = (async () => {
    const jobs: Promise<void>[] = [];
    for (let midi = SAMPLE_LOW; midi <= SAMPLE_HIGH; midi++) {
      jobs.push(
        fetch(`/guitar-samples/${which}/${midi}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((data) => ctx.decodeAudioData(data))
          .then((buf) => { samples.set(`${which}:${midi}`, buf); })
          .catch((err) => console.warn(`[guitar] sample ${which}/${midi} failed:`, err)),
      );
    }
    await Promise.all(jobs);
  })();
  loading.set(which, task);
  return task;
}

export function setInstrument(which: GuitarInstrument): void {
  instrument = which;
  void loadInstrument(which);
}

/** Karplus-Strong fallback for a note whose sample isn't available. */
function synthNote(midi: number): AudioBuffer {
  const cached = synthCache.get(midi);
  if (cached) return cached;
  const { ctx } = audio();
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / (440 * Math.pow(2, (midi - 69) / 12))));
  const length = Math.floor(sr * 2);
  const buffer = ctx.createBuffer(1, length, sr);
  const out = buffer.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < period; i++) {
    prev += 0.5 * (Math.random() * 2 - 1 - prev);
    out[i] = prev;
  }
  for (let i = period; i < length; i++) {
    out[i] = 0.996 * 0.5 * (out[i - period] + out[Math.max(i - period - 1, 0)]);
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < length; i++) out[i] *= 0.5 / peak;
  synthCache.set(midi, buffer);
  return buffer;
}

/** The buffer for a note and the playback rate needed (for notes outside the sample range). */
function bufferFor(midi: number): { buffer: AudioBuffer; rate: number } {
  const nearest = Math.min(SAMPLE_HIGH, Math.max(SAMPLE_LOW, midi));
  const sample = samples.get(`${instrument}:${nearest}`);
  if (sample) return { buffer: sample, rate: Math.pow(2, (midi - nearest) / 12) };
  return { buffer: synthNote(midi), rate: 1 };
}

/** Current AudioContext time in seconds (creates the context on first use). */
export function synthNow(): number {
  return audio().ctx.currentTime;
}

/** Output latency of the guitar's AudioContext in seconds, when the browser reports it. */
export function synthLatency(): number {
  const { ctx } = audio();
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

export function setSynthVolume(volume: number): void {
  const { master, ctx } = audio();
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), ctx.currentTime, 0.02);
}

/**
 * Play one note on a string at `when` (AudioContext seconds).
 * `stringIndex` is any stable id for the string, used to damp the previous note.
 */
export function pluck(midi: number, stringIndex: number, when: number, velocity = 0.6): void {
  const { ctx, master } = audio();
  void loadInstrument();
  const start = Math.max(when, ctx.currentTime);

  const previous = ringing.get(stringIndex);
  if (previous) {
    previous.gain.gain.setTargetAtTime(0, start, 0.015);
    try { previous.source.stop(start + 0.12); } catch { /* already stopped */ }
  }

  const { buffer, rate } = bufferFor(midi);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = velocity;
  source.connect(gain).connect(master);
  source.start(start);
  source.onended = () => {
    if (ringing.get(stringIndex)?.source === source) ringing.delete(stringIndex);
  };
  ringing.set(stringIndex, { gain, source });
}

/**
 * Strum a chord. `notes` are MIDI numbers, low string first.
 * A down strum hits low → high; an up strum hits only the top strings, high → low.
 */
export function strum(
  notes: number[],
  options: { when?: number; direction?: "down" | "up"; spreadMs?: number; velocity?: number } = {},
): void {
  if (notes.length === 0) return;
  const { ctx } = audio();
  const when = options.when ?? ctx.currentTime + 0.01;
  const direction = options.direction ?? "down";
  const spread = (options.spreadMs ?? 12) / 1000;
  const velocity = options.velocity ?? (direction === "down" ? 0.5 : 0.36);

  // Highest note sits on string 1, the next on string 2, and so on.
  const voiced = notes.map((n, i) => ({ n, s: notes.length - i }));
  const ordered = direction === "down"
    ? voiced
    : voiced.slice(-Math.min(4, voiced.length)).reverse();

  ordered.forEach(({ n, s }, k) => {
    // Later strings in the stroke are a touch quieter.
    pluck(n, s, when + k * spread, velocity * (1 - k * 0.04));
  });
}

/** Let ringing notes fade out quickly (e.g. when playback pauses). */
export function damp(): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const { gain, source } of ringing.values()) {
    gain.gain.setTargetAtTime(0, t, 0.03);
    try { source.stop(t + 0.2); } catch { /* already stopped */ }
  }
  ringing.clear();
}
