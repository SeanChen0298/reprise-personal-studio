// How much energy a part of the song has (0 quiet – 1 big), from the coach's words for its feel
// ("melancholy, resigned", "cathartic, liberating") and what kind of section it is. Drives the
// Vivid backdrop: quiet parts drift slowly in deeper tones, big parts move more and glow brighter.

const BIG = [
  "cathartic", "powerful", "liberat", "euphor", "joy", "intense", "energ", "triumph", "explos", "climax", "build",
  "passion", "defian", "uplift", "bright", "hope", "playful", "fierce", "anger", "angry", "release", "soar", "bold",
  "driving", "urgent", "desperate", "anthem", "excit", "wild", "free", "determin", "confident", "rage", "ecsta",
];
const QUIET = [
  "melanchol", "resign", "somber", "sombre", "sad", "quiet", "gentle", "tender", "intimate", "reflect", "introspect",
  "calm", "peace", "lonely", "wistful", "fragile", "vulnerab", "serene", "nostalg", "detach", "soft", "hush", "regret",
  "longing", "yearn", "weary", "grief", "mourn", "still", "dream", "lullaby", "acceptance", "grateful", "gratitude",
];

/** 0 (quiet) – 1 (big). */
export function sectionEnergy(name: string | undefined, mood: string | undefined): number {
  const n = (name ?? "").toLowerCase();
  const m = (mood ?? "").toLowerCase();
  let e = 0.45;
  if (/chorus|hook|サビ/.test(n)) e += 0.2;
  else if (/pre[- ]?chorus|build/.test(n)) e += 0.1;
  else if (/bridge/.test(n)) e += 0.05;
  else if (/verse/.test(n)) e -= 0.08;
  else if (/intro|outro|ending/.test(n)) e -= 0.15;
  if (/final|last/.test(n)) e += 0.05;
  const big = BIG.filter((w) => m.includes(w)).length;
  const quiet = QUIET.filter((w) => m.includes(w)).length;
  e += 0.14 * big - 0.12 * quiet;
  return Math.max(0.08, Math.min(1, e));
}
