import { useEffect, useMemo } from "react";
import type { ChordAnalysis } from "../lib/chord-analysis";
import { damp, pluck, setSynthVolume, strum, synthNow } from "../lib/guitar-synth";

/**
 * Play a guide guitar part in time with the song.
 *
 * - "strum": the detected strum pattern on every eighth note, using the
 *   chord sounding at that moment.
 * - "fingerstyle": the notes of the generated fingerstyle arrangement.
 *
 * Timing follows the <audio> element, so it stays in sync at slower
 * practice speeds and after seeking. Uses the standard look-ahead pattern:
 * a timer wakes every 25 ms and schedules anything due in the next 150 ms
 * on the AudioContext clock.
 */

interface GuideEvent {
  t: number;  // song time, ms
  kind: "strum" | "notes";
  direction?: "down" | "up";
  chord?: string;                                // label, for strums
  notes?: { midi: number; string: number }[];    // for fingerstyle
}

const TICK_MS = 25;
const LOOKAHEAD_MS = 150;

function buildEvents(analysis: ChordAnalysis, mode: "strum" | "fingerstyle"): GuideEvent[] {
  const events: GuideEvent[] = [];

  if (mode === "fingerstyle") {
    const fs = analysis.fingerstyle;
    if (fs?.status !== "ok") return events;
    for (const ev of fs.events) {
      events.push({ t: ev.t_ms, kind: "notes", notes: ev.notes.map((n) => ({ midi: n.midi, string: n.string })) });
    }
    return events.sort((a, b) => a.t - b.t);
  }

  const bars = analysis.bars ?? [];
  const beats = analysis.beats_ms ?? [];
  const chords = analysis.chords ?? [];
  const sections = analysis.strumming?.sections ?? [];
  const fallback = analysis.strumming?.main_pattern ?? "D-DU-UDU";
  let ci = 0;
  for (const bar of bars) {
    if (bar.pickup) continue;
    const pattern = sections.find((s) => bar.index >= s.start_bar && bar.index <= s.end_bar)?.pattern ?? fallback;
    for (let k = 0; k < bar.beats; k++) {
      const b = bar.first_beat + k;
      const t0 = beats[b];
      if (t0 == null) continue;
      const t1 = beats[b + 1] ?? bar.end_ms;
      for (let half = 0; half < 2; half++) {
        const stroke = pattern[k * 2 + half];
        if (stroke !== "D" && stroke !== "U") continue;
        const t = half === 0 ? t0 : (t0 + t1) / 2;
        while (ci + 1 < chords.length && chords[ci + 1].start_ms <= t) ci++;
        const label = chords[ci]?.label;
        if (!label || label === "N") continue;
        events.push({ t, kind: "strum", direction: stroke === "D" ? "down" : "up", chord: label });
      }
    }
  }
  return events;
}

/** First index with events[i].t > t. */
function firstAfter(events: GuideEvent[], t: number): number {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function useGuitarGuide(options: {
  analysis: ChordAnalysis | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  enabled: boolean;
  mode: "strum" | "fingerstyle";
  volume: number;
  /** Play this many ms earlier than the detected beat (positive = earlier). */
  offsetMs: number;
  /** MIDI notes to strum for a chord label (already including any capo). */
  chordNotes: (label: string) => number[];
}) {
  const { analysis, audioRef, enabled, mode, volume, offsetMs, chordNotes } = options;
  const events = useMemo(() => (analysis ? buildEvents(analysis, mode) : []), [analysis, mode]);

  useEffect(() => {
    if (enabled) setSynthVolume(volume);
  }, [enabled, volume]);

  useEffect(() => {
    if (!enabled || events.length === 0) return;

    let lastAudioMs: number | null = null;
    let scheduledUpTo: number | null = null;

    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) {
        if (scheduledUpTo !== null) damp();
        lastAudioMs = null;
        scheduledUpTo = null;
        return;
      }
      const t = audio.currentTime * 1000;
      const rate = audio.playbackRate || 1;

      // Starting, or the user jumped: don't replay what was skipped over.
      const jumped = lastAudioMs !== null && (t < lastAudioMs - 50 || t > lastAudioMs + 1000);
      if (scheduledUpTo === null || jumped) {
        if (jumped) damp();
        scheduledUpTo = t - 1;
      }
      lastAudioMs = t;

      const now = synthNow();
      const horizon = t + LOOKAHEAD_MS + Math.max(0, offsetMs);
      for (let i = firstAfter(events, scheduledUpTo); i < events.length && events[i].t <= horizon; i++) {
        const ev = events[i];
        const when = now + Math.max(0, (ev.t - t) / rate - offsetMs) / 1000;
        if (ev.kind === "strum" && ev.chord) {
          strum(chordNotes(ev.chord), { when, direction: ev.direction });
        } else if (ev.notes) {
          for (const n of ev.notes) pluck(n.midi, n.string, when, 0.55);
        }
        scheduledUpTo = ev.t;
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      damp();
    };
  }, [enabled, events, audioRef, chordNotes, offsetMs]);
}
