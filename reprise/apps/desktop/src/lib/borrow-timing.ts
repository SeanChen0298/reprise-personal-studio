// Take another version's line timing (an LRCLIB upload) onto the song's own lines, matching
// lines by their words — so your lines, notes and marks stay and only the times change.
// Lines pair up in order (one can't jump past another); either side may have lines the other
// lacks, and a line with no partner gets a time between its neighbours.

export interface OwnLine {
  text: string;
}

export interface SourceLine {
  text: string;
  start_ms: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

/** How alike two lines are (0–1), by shared character pairs. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const c = [...s];
    const m = new Map<string, number>();
    for (let i = 0; i < c.length - 1; i++) m.set(c[i] + c[i + 1], (m.get(c[i] + c[i + 1]) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let both = 0;
  let total = 0;
  ga.forEach((n, g) => {
    total += n;
    both += Math.min(n, gb.get(g) ?? 0);
  });
  gb.forEach((n) => (total += n));
  return total ? (2 * both) / total : 0;
}

/**
 * A start time for each of `lines` (same order), or null when too few lines match for the
 * other version to be the same lyrics.
 */
export function borrowTiming(lines: OwnLine[], source: SourceLine[]): (number | undefined)[] | null {
  const src = source.filter((s) => s.text.trim() && s.start_ms >= 0);
  const n = lines.length;
  const m = src.length;
  if (n < 3 || m < 3) return null;
  const a = lines.map((l) => norm(l.text));
  const b = src.map((s) => norm(s.text));
  const sim = (i: number, j: number) => {
    const s = similarity(a[i], b[j]);
    return s >= 0.5 ? s : 0;
  };

  // The best in-order pairing (a longest common subsequence, weighted by how alike lines are).
  const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const s = sim(i, j);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s > 0 ? s + best[i + 1][j + 1] : 0);
    }
  }
  const paired = new Array<number | null>(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const s = sim(i, j);
    if (s > 0 && best[i][j] === s + best[i + 1][j + 1]) {
      paired[i] = src[j].start_ms;
      i++;
      j++;
    } else if (best[i][j] === best[i + 1][j]) i++;
    else j++;
  }
  const lyricLines = a.filter(Boolean).length;
  if (paired.filter((x) => x != null).length < lyricLines * 0.6) return null;

  // Lines with no partner: between the neighbours that have one (or a little after / before).
  return paired.map((t, k) => {
    if (t != null) return t;
    let p = k - 1;
    while (p >= 0 && paired[p] == null) p--;
    let q = k + 1;
    while (q < n && paired[q] == null) q++;
    const before = p >= 0 ? paired[p]! : null;
    const after = q < n ? paired[q]! : null;
    if (before != null && after != null) return Math.round(before + ((after - before) * (k - p)) / (q - p));
    if (before != null) return before + 3000 * (k - p);
    if (after != null) return Math.max(0, after - 3000 * (q - k));
    return undefined;
  });
}
