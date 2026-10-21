/**
 * guitar-synth.ts
 *
 * A small offline guitar sound for chord previews and the play-along guide.
 * Each note is synthesised with the Karplus-Strong plucked-string algorithm
 * (a burst of noise fed through a short, slightly lossy delay loop), so no
 * samples or downloads are needed. Rendered notes are cached per pitch.
 *
 * All scheduling times are AudioContext seconds; callers convert from ms.
 */

const NOTE_SECONDS = 2.2;
const DECAY = 0.9965;        // loop loss per period; lower = shorter ring
const BRIGHTNESS = 0.55;     // 0..1, lowpass on the initial pluck noise

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const bufferCache = new Map<number, AudioBuffer>();

/** One voice per string so a new note damps the previous one, like a real guitar. */
const ringing = new Map<number, { gain: GainNode; source: AudioBufferSourceNode }>();

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.7;
    // Soften the top end a little; raw Karplus-Strong is quite bright.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 5200;
    master.connect(tone).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, master: master! };
}

function renderNote(midi: number): AudioBuffer {
  const cached = bufferCache.get(midi);
  if (cached) return cached;

  const { ctx } = audio();
  const sr = ctx.sampleRate;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const period = Math.max(2, Math.round(sr / freq));
  const length = Math.floor(sr * NOTE_SECONDS);
  const buffer = ctx.createBuffer(1, length, sr);
  const out = buffer.getChannelData(0);

  // Initial pluck: filtered noise, one period long.
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const noise = Math.random() * 2 - 1;
    prev = prev + BRIGHTNESS * (noise - prev);
    out[i] = prev;
  }
  // Delay loop: average neighbouring samples one period back, with a little loss.
  for (let i = period; i < length; i++) {
    out[i] = DECAY * 0.5 * (out[i - period] + out[Math.max(i - period - 1, 0)]);
  }
  // Remove DC offset and normalise.
  let mean = 0;
  for (let i = 0; i < period; i++) mean += out[i];
  mean /= period;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    out[i] -= mean * Math.exp(-i / (sr * 0.05));
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;

  bufferCache.set(midi, buffer);
  return buffer;
}

/** Current AudioContext time in seconds (creates the context on first use). */
export function synthNow(): number {
  return audio().ctx.currentTime;
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
  const start = Math.max(when, ctx.currentTime);

  const previous = ringing.get(stringIndex);
  if (previous) {
    previous.gain.gain.setTargetAtTime(0, start, 0.015);
    previous.source.stop(start + 0.12);
  }

  const source = ctx.createBufferSource();
  source.buffer = renderNote(midi);
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
  const spread = (options.spreadMs ?? 14) / 1000;
  const velocity = options.velocity ?? (direction === "down" ? 0.55 : 0.4);

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
