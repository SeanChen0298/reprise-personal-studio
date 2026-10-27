// What the app measured in the original vocal, in words for the coach (the warm-up is built on it):
// the range, where the high notes and the long phrases are, the key and the tempo.

import { lineVocalInfo, semitoneToNoteName, type VocalMap } from "../vocal-map";
import { readChordAnalysis } from "../chord-analysis";
import type { Line, Song } from "../../types/song";

export async function songVoiceFacts(song: Song, lines: Line[], map: VocalMap | null): Promise<{ text: string; topNote: number | null }> {
  const out: string[] = [];
  let topNote: number | null = null;
  if (map && Number.isFinite(map.topSemitone)) {
    topNote = Math.round(map.topSemitone);
    out.push(`Range of the melody: ${semitoneToNoteName(map.lowSemitone)} – ${semitoneToNoteName(map.topSemitone)} (counts as high from ${semitoneToNoteName(map.highThreshold)}).`);
    const info = lines.map((l, i) => ({ i, info: lineVocalInfo(map, l) })).filter((x) => x.info);
    const high = info
      .filter((x) => x.info!.peakSemitone != null)
      .sort((a, b) => b.info!.peakSemitone! - a.info!.peakSemitone!)
      .slice(0, 8)
      .sort((a, b) => a.i - b.i);
    if (high.length) out.push(`High notes: ${high.map((x) => `L${x.i + 1} (${semitoneToNoteName(x.info!.peakSemitone!)})`).join(", ")}.`);
    const long = info
      .filter((x) => x.info!.longestPhraseMs >= 5000)
      .sort((a, b) => b.info!.longestPhraseMs - a.info!.longestPhraseMs)
      .slice(0, 5)
      .sort((a, b) => a.i - b.i);
    if (long.length) out.push(`Long phrases without a breath: ${long.map((x) => `L${x.i + 1} (${(x.info!.longestPhraseMs / 1000).toFixed(1)} s)`).join(", ")}.`);
  } else {
    out.push("The vocal hasn't been analyzed yet — no measured range; keep patterns in a comfortable middle range.");
  }
  if (song.chord_status === "done" && song.chord_data_path) {
    try {
      const a = await readChordAnalysis(song.chord_data_path);
      if (a.key && a.key.confidence >= 0.4) out.push(`Key: ${a.key.name}.`);
      if (a.tempo_bpm) out.push(`Tempo: about ${Math.round(a.tempo_bpm)} bpm.`);
    } catch {
      // No chords file: the warm-up does without the key.
    }
  }
  return { text: out.join("\n"), topNote };
}
