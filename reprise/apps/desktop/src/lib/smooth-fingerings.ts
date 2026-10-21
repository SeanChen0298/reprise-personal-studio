/**
 * smooth-fingerings.ts
 *
 * Choose fingerings for a whole progression instead of chord by chord: the
 * cheapest path through every chord's fingering options, where moving the
 * hand along the neck costs, and fingers that can stay on the same string
 * and fret earn a little back. A Viterbi pass (shortest path) over the song.
 * Spots the player has chosen by hand are fixed; the path goes around them.
 */

import type { ChordShape } from "./chord-shapes";

export interface PlanItem {
  /** Chord start (ms) — identifies the spot. */
  at: number;
  /** Chord name as fingered (capo shape when a capo is shown). */
  shown: string;
}

/** Where the hand sits for a fingering: lowest fretted fret, open shapes at ~1. */
function handPosition(v: ChordShape): number {
  const fretted = v.frets.filter((f): f is number => f != null && f > 0);
  return fretted.length ? Math.min(...fretted) : 1;
}

/** Cost of a fingering on its own: prefer the standard shapes, root in the bass, lower positions. */
function ownCost(v: ChordShape, index: number): number {
  let c = index * 0.04;
  if (v.kind.endsWith("in bass")) c += 0.6;      // inversions only when they really help
  if (v.kind === "Top strings") c += 0.5;
  const pos = handPosition(v);
  if (pos > 7) c += (pos - 7) * 0.06;
  return c;
}

/** Cost of moving from one fingering to the next. */
function moveCost(a: ChordShape, b: ChordShape): number {
  let c = Math.abs(handPosition(a) - handPosition(b)) * 0.35;
  for (let s = 0; s < 6; s++) {
    const fa = a.frets[s], fb = b.frets[s];
    if (fa != null && fb != null && fa > 0 && fa === fb) c -= 0.12;  // a finger can stay put
  }
  return c;
}

/**
 * Pick a fingering index for every item.
 * `fixed(item)` returns an index the player chose (spot or song-wide), or undefined.
 */
export function planFingerings(
  items: PlanItem[],
  voicingsOf: (shown: string) => ChordShape[],
  fixed: (item: PlanItem) => number | undefined,
): Map<number, number> {
  const plan = new Map<number, number>();
  const options = items.map((item) => {
    const all = voicingsOf(item.shown);
    const pin = fixed(item);
    const idx = pin != null && pin < all.length ? [pin] : all.map((_, i) => i);
    return { all, idx };
  });
  if (items.length === 0) return plan;

  // cost[i][k], back[i][k] over the candidate list of item i.
  let prevCost = options[0].idx.map((i) => ownCost(options[0].all[i], i));
  const back: number[][] = [options[0].idx.map(() => -1)];
  for (let n = 1; n < items.length; n++) {
    const cur = options[n], prev = options[n - 1];
    const costs: number[] = [];
    const from: number[] = [];
    for (const i of cur.idx) {
      const v = cur.all[i];
      let best = Infinity, arg = 0;
      prev.idx.forEach((j, k) => {
        const c = prevCost[k] + (prev.all[j] && v ? moveCost(prev.all[j], v) : 0);
        if (c < best) { best = c; arg = k; }
      });
      costs.push(best + (v ? ownCost(v, i) : 0));
      from.push(arg);
    }
    prevCost = costs;
    back.push(from);
  }

  let k = prevCost.indexOf(Math.min(...prevCost));
  for (let n = items.length - 1; n >= 0; n--) {
    plan.set(items[n].at, options[n].idx[k] ?? 0);
    k = back[n][k];
  }
  return plan;
}
