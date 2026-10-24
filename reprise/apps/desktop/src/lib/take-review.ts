// Glue between the Recordings page and take analysis: loads (and caches) a
// song's vocal map, analyses a sung-along take, and turns results into tips.

import { readTextFile } from "@tauri-apps/plugin-fs";
import { parsePitchData } from "./audio-analysis";
import { buildVocalMap, type VocalMap } from "./vocal-map";
import { ANALYSIS_VERSION, analyzeTake, decodeToMono, extractFeatures, type TakeFeatures } from "./take-analysis";
import type { Line, Recording, Song, TakeAnalysis, TakeIssue, TakeIssueKind } from "../types/song";

const mapCache = new Map<string, Promise<VocalMap>>();

/** The song's vocal map, built once per session from pitch.csv (+ the vocal stem's loudness). */
export function loadVocalMap(song: Pick<Song, "pitch_data_path" | "vocals_path">): Promise<VocalMap> | null {
  if (!song.pitch_data_path) return null;
  const key = `${song.pitch_data_path}|${song.vocals_path ?? ""}`;
  let p = mapCache.get(key);
  if (!p) {
    p = (async () => {
      const points = parsePitchData(await readTextFile(song.pitch_data_path!));
      let stemDb: Float32Array | undefined;
      if (song.vocals_path) {
        try {
          stemDb = (await extractFeatures(await decodeToMono(song.vocals_path), undefined, { pitch: false })).db;
        } catch (err) {
          console.warn("[take-review] couldn't read vocal stem loudness; phrase ends may run long:", err);
        }
      }
      return buildVocalMap(points, stemDb);
    })();
    p.catch(() => mapCache.delete(key));
    mapCache.set(key, p);
  }
  return p;
}

const featureCache = new Map<string, Promise<TakeFeatures>>();

/** A take's loudness + pitch tracks (cached for the session — used by the review and its pitch charts). */
export function loadTakeFeatures(filePath: string, onProgress?: (fraction: number) => void): Promise<TakeFeatures> {
  let p = featureCache.get(filePath);
  if (!p) {
    p = decodeToMono(filePath).then((samples) => extractFeatures(samples, onProgress));
    p.catch(() => featureCache.delete(filePath));
    featureCache.set(filePath, p);
  }
  return p;
}

export function canReview(rec: Recording, song: Pick<Song, "pitch_data_path">): boolean {
  return rec.song_start_ms != null && !!song.pitch_data_path;
}

export function needsAnalysis(rec: Recording): boolean {
  return rec.song_start_ms != null && (!rec.analysis || rec.analysis.version < ANALYSIS_VERSION);
}

export async function analyzeRecording(
  rec: Recording,
  song: Song,
  lines: Line[],
  onProgress?: (fraction: number) => void,
): Promise<TakeAnalysis> {
  const mapPromise = loadVocalMap(song);
  if (!mapPromise || rec.song_start_ms == null) throw new Error("This take can't be reviewed.");
  const [map, features] = await Promise.all([mapPromise, loadTakeFeatures(rec.file_path, onProgress)]);
  return analyzeTake(features, map, rec.song_start_ms, lines);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const ISSUE_LABEL: Record<TakeIssueKind, string> = {
  ran_out: "Ran out of air",
  fading: "Fading out",
  extra_breath: "Breath mid-phrase",
  late_entry: "Late after breath",
  high_dropped: "High note dropped",
  high_cracked: "Voice cracked",
  high_flat: "High note flat",
  high_sharp: "High note sharp",
  high_unsteady: "Unsteady high note",
  high_pushed: "Pushing high note",
};

export function isBreathIssue(kind: TakeIssueKind): boolean {
  return kind === "ran_out" || kind === "fading" || kind === "extra_breath" || kind === "late_entry";
}

const TIPS: Record<TakeIssueKind, string> = {
  ran_out:
    "Plan your breaths: before a long phrase, take a full low breath at the breath point the original singer uses (shown in the lyrics), and pace the air so the last word still has support.",
  fading:
    "Sing through to the end of the phrase — keep the airflow steady on the last words instead of letting them drop off.",
  extra_breath:
    "You're breaking phrases to breathe. Breathe earlier and fuller at the marked breath points so you don't need to sneak one in mid-line.",
  late_entry:
    "Quick catch-breaths are costing you the entry. Practise short silent sips through the mouth at those spots, keeping the body open rather than gasping.",
  high_dropped:
    "High notes are cutting out. Try those lines lighter (less volume, more 'ng'/mix), and keep the breath moving into the note rather than stopping before it.",
  high_cracked:
    "Your voice is breaking on high notes. Drill the line on a lip trill or 'ng' first, then on the words; if it's consistently at the top of your range, try the song a step lower.",
  high_flat:
    "Flat high notes usually mean under-support or reaching. Think of arriving at the note from above and keep the airflow going through it.",
  high_sharp:
    "Sharp on high notes often comes from pushing. Ease off the pressure and let the note settle.",
  high_unsteady:
    "The pitch wobbles on high notes — usually breath pressure that isn't steady. Sustain the note on a lip trill, then on the vowel, aiming for an even tone.",
  high_pushed:
    "You're getting much louder than the original on high notes — that's usually shouting into them. Back off volume and let the note be lighter; it will feel easier and last the whole song.",
};

export interface ReviewInsight {
  headline: string;
  tips: string[];
}

export function reviewInsight(a: TakeAnalysis): ReviewInsight {
  const breath = a.issues.filter((i) => isBreathIssue(i.kind));
  const high = a.issues.filter((i) => !isBreathIssue(i.kind));
  const [h1, h2] = a.halves;
  const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
  const tips: string[] = [];

  let headline: string;
  if (a.issues.length === 0) {
    headline = "Clean run — no breath or high-note problems found.";
  } else {
    const parts: string[] = [];
    if (breath.length) parts.push(`${breath.length} breath ${breath.length === 1 ? "problem" : "problems"}`);
    if (high.length) parts.push(`${high.length} high-note ${high.length === 1 ? "problem" : "problems"}`);
    headline = parts.join(", ") + ".";
  }

  // Stamina: does it get worse later in the take?
  const b1 = rate(h1.breath_issues, h1.phrases);
  const b2 = rate(h2.breath_issues, h2.phrases);
  const x1 = rate(h1.high_issues, h1.high_notes);
  const x2 = rate(h2.high_issues, h2.high_notes);
  if ((h2.breath_issues >= 2 && b2 >= b1 * 1.5 + 0.05) || (h2.high_issues >= 2 && x2 >= x1 * 1.5 + 0.05)) {
    tips.push(
      "It gets harder later in the take — that's stamina. Warm up before full runs, keep the first half lighter so you have air left, and practise the second half on its own while you're fresh.",
    );
  }

  // Most frequent problems first, one tip each.
  const counts = new Map<TakeIssueKind, number>();
  for (const i of a.issues) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  for (const [kind] of [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2)) tips.push(TIPS[kind]);

  return { headline, tips };
}

/** Where to start playback for an issue, a little before it. */
export function issueSongStartMs(issue: TakeIssue): number {
  return Math.max(0, issue.song_ms - 2000);
}
