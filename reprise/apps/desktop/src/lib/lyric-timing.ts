import type { Line } from "../types/song";

/**
 * When each character of a lyric line is sung. Uses the aligned syllable
 * timing when it still matches the line (it goes stale if the line's times
 * were edited by hand); otherwise spreads the line evenly over its start–end.
 * The aligned tokens are in reading form (kana), so display characters are
 * mapped by their relative position in the line.
 */
export function characterTimes(line: Line, count: number): number[] {
  const start = line.start_ms!, end = line.end_ms!;
  const tokens = line.syllable_times;
  const fits = tokens && tokens.length > 0 &&
    Math.abs(tokens[0][0] - start) < 400 && Math.abs(tokens[tokens.length - 1][1] - end) < 3500;
  if (!fits) return Array.from({ length: count }, (_, k) => start + ((k + 0.5) / count) * (end - start));
  const total = tokens!.reduce((n, t) => n + t[2], 0);
  return Array.from({ length: count }, (_, k) => {
    let pos = ((k + 0.5) / count) * total;
    for (const [ts, te, n] of tokens!) {
      if (pos <= n) return ts + (pos / n) * (te - ts);
      pos -= n;
    }
    return tokens![tokens!.length - 1][1];
  });
}
