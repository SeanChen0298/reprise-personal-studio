// Glue between the Recordings page and take analysis: loads (and caches) a
// song's vocal map, analyses a sung-along take, and turns results into tips.

import { readTextFile } from "@tauri-apps/plugin-fs";
import { parsePitchData } from "./audio-analysis";
import { buildVocalMap, type VocalMap } from "./vocal-map";
import { ANALYSIS_VERSION, analyzeTake, decodeToMono, extractFeatures, type TakeFeatures } from "./take-analysis";
import type { Line, Recording, Song, TakeAnalysis } from "../types/song";

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

// Presentation (shared with the phone app)
export { ISSUE_LABEL, isBreathIssue, reviewInsight, issueSongStartMs } from "@reprise/shared";
export type { ReviewInsight } from "@reprise/shared";
