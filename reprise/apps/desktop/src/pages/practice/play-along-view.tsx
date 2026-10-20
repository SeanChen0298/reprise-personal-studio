import { useEffect, useMemo, useRef, useState } from "react";
import type { Line, Song } from "../../types/song";
import type { ChordAnalysis, ChordBar, ChordSegment, StrumSection } from "../../lib/chord-analysis";
import { useChordData } from "../../hooks/use-chord-data";
import { useTaskQueueStore } from "../../stores/task-queue-store";

interface PlayAlongViewProps {
  song: Song;
  lines: Line[];
  translationLines: Line[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
}

interface Playhead {
  bar: number;     // index into bars, -1 before the first bar
  chord: number;   // index into chords, -1 if none
  slot: number;    // eighth-note slot within the current bar
  line: number;    // index into lines, -1 if none
}

/** Last index whose start is <= t (items sorted by start). */
function indexAt<T>(items: T[], t: number, start: (x: T) => number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (start(items[mid]) <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

function displayLabel(label: string, shapes: Record<string, string> | null): string {
  if (label === "N") return "N.C.";
  return shapes?.[label] ?? label;
}

function seek(audioRef: React.RefObject<HTMLAudioElement | null>, ms: number) {
  const audio = audioRef.current;
  if (audio) audio.currentTime = ms / 1000;
}

// ---------------------------------------------------------------------------
// Strum pattern
// ---------------------------------------------------------------------------

function StrumPattern({ pattern, activeSlot }: { pattern: string; activeSlot?: number }) {
  return (
    <div className="flex items-center gap-[3px]">
      {pattern.split("").map((ch, i) => (
        <span
          key={i}
          className={`w-[18px] h-[20px] rounded-[4px] flex items-center justify-center text-[11px] font-semibold ${
            i === activeSlot
              ? "bg-[var(--accent)] text-white"
              : ch === "-"
                ? "text-[var(--text-muted)] opacity-40"
                : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)]"
          } ${i % 2 === 0 && i > 0 ? "ml-[3px]" : ""}`}
        >
          {ch === "D" ? "↓" : ch === "U" ? "↑" : "·"}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bars pane
// ---------------------------------------------------------------------------

function chordsInBar(bar: ChordBar, chords: ChordSegment[]): number[] {
  const out: number[] = [];
  const first = indexAt(chords, bar.start_ms, (c) => c.start_ms);
  if (first >= 0) out.push(first);
  for (let i = Math.max(first + 1, 0); i < chords.length && chords[i].start_ms < bar.end_ms; i++) {
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

function BarsPane({
  analysis, playhead, shapes, audioRef, isPlaying,
}: {
  analysis: ChordAnalysis;
  playhead: Playhead;
  shapes: Record<string, string> | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
}) {
  const bars = analysis.bars ?? [];
  const chords = analysis.chords ?? [];
  const sections: StrumSection[] = analysis.strumming?.sections ?? [];
  const beatsPerBar = analysis.time_signature?.beats_per_bar ?? 4;
  const containerRef = useRef<HTMLDivElement>(null);

  // Group bars under their strum section (pickup bar goes with the first one).
  const groups = useMemo(() => {
    if (sections.length === 0) return [{ section: null as StrumSection | null, bars }];
    return sections.map((section, i) => ({
      section,
      bars: bars.filter((b) =>
        (b.index >= section.start_bar && b.index <= section.end_bar) || (i === 0 && b.pickup),
      ),
    }));
  }, [bars, sections]);

  // Keep the current bar in view while playing.
  useEffect(() => {
    if (!isPlaying || playhead.bar < 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-bar="${playhead.bar}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playhead.bar, isPlaying]);

  return (
    <div ref={containerRef} className="flex flex-col gap-5">
      {groups.map(({ section, bars: groupBars }, gi) => {
        const active = section != null && playhead.bar >= section.start_bar && playhead.bar <= section.end_bar;
        return (
          <div key={gi}>
            {section && (
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)]">
                  Bars {section.start_bar + 1}–{section.end_bar + 1}
                </span>
                <StrumPattern
                  pattern={section.pattern}
                  activeSlot={active ? playhead.slot : undefined}
                />
                {section.source === "suggested" && (
                  <span
                    className="text-[10.5px] px-1.5 py-[1px] rounded-full border border-[var(--border)] text-[var(--text-muted)]"
                    title="The rhythm here was too unclear to read, so this is a common pattern that fits the tempo"
                  >
                    suggested
                  </span>
                )}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {groupBars.map((bar) => {
                const isCurrent = bar.index === playhead.bar;
                return (
                  <button
                    key={bar.index}
                    data-bar={bar.index}
                    onClick={() => seek(audioRef, bar.start_ms)}
                    className={`relative text-left px-2.5 pt-1.5 pb-2 rounded-[7px] border transition-colors cursor-pointer ${
                      isCurrent
                        ? "border-[var(--accent)] bg-[var(--surface)] shadow-[0_0_0_1px_var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
                    } ${bar.pickup ? "opacity-70" : ""}`}
                  >
                    <div className="text-[9.5px] text-[var(--text-muted)] mb-0.5">
                      {bar.pickup ? "pickup" : bar.index + 1}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 min-h-[20px]">
                      {chordsInBar(bar, chords).map((ci) => (
                        <span
                          key={ci}
                          className={`text-[14px] font-semibold leading-tight ${
                            ci === playhead.chord && isCurrent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                          }`}
                        >
                          {displayLabel(chords[ci].label, shapes)}
                        </span>
                      ))}
                    </div>
                    {isCurrent && (
                      <div className="absolute left-2.5 right-2.5 bottom-1 flex gap-1">
                        {Array.from({ length: bar.beats || beatsPerBar }).map((_, b) => (
                          <span
                            key={b}
                            className={`h-[3px] flex-1 rounded-full ${
                              b <= Math.floor(playhead.slot / 2) ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lyrics pane — chords placed above each timed line
// ---------------------------------------------------------------------------

/** Chord labels positioned across a line by time. Labels that would collide are dropped. */
function chordMarksForLine(line: Line, chords: ChordSegment[]): { ci: number; pct: number }[] {
  if (line.start_ms == null || line.end_ms == null || line.end_ms <= line.start_ms) return [];
  const start = line.start_ms, end = line.end_ms, dur = end - start;
  const marks: { ci: number; pct: number }[] = [];
  const first = indexAt(chords, start, (c) => c.start_ms);
  for (let i = Math.max(first, 0); i < chords.length && chords[i].start_ms < end; i++) {
    if (chords[i].end_ms <= start) continue;
    const pct = (Math.max(chords[i].start_ms, start) - start) / dur * 100;
    const prev = marks[marks.length - 1];
    if (prev && pct - prev.pct < 9) continue; // too close to fit a label
    if (prev && chords[prev.ci].label === chords[i].label) continue;
    marks.push({ ci: i, pct });
  }
  return marks;
}

function LyricsPane({
  lines, translationLines, chords, playhead, shapes, audioRef, isPlaying,
}: {
  lines: Line[];
  translationLines: Line[];
  chords: ChordSegment[];
  playhead: Playhead;
  shapes: Record<string, string> | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const translationByOrder = useMemo(
    () => new Map(translationLines.map((l) => [l.order, l.custom_text ?? l.text])),
    [translationLines],
  );

  useEffect(() => {
    if (!isPlaying || playhead.line < 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-line="${playhead.line}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [playhead.line, isPlaying]);

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      {lines.map((line, li) => {
        const marks = chordMarksForLine(line, chords);
        const isCurrent = li === playhead.line;
        const translation = translationByOrder.get(line.order);
        return (
          <button
            key={line.id}
            data-line={li}
            onClick={() => line.start_ms != null && seek(audioRef, line.start_ms)}
            className={`text-left px-3 py-1.5 rounded-[7px] transition-colors cursor-pointer border ${
              isCurrent ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent hover:bg-[var(--surface)]"
            }`}
          >
            <div className="relative h-[17px]">
              {marks.map(({ ci, pct }) => (
                <span
                  key={ci}
                  className={`absolute top-0 text-[12.5px] font-semibold whitespace-nowrap ${
                    ci === playhead.chord && isCurrent ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
                  }`}
                  style={{ left: `${pct}%` }}
                >
                  {displayLabel(chords[ci].label, shapes)}
                </span>
              ))}
            </div>
            <div className={`text-[14.5px] leading-snug ${isCurrent ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"}`}>
              {line.custom_text ?? line.text}
            </div>
            {translation && (
              <div className="text-[12px] text-[var(--text-muted)] leading-snug mt-0.5">{translation}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function PlayAlongView({ song, lines, translationLines, audioRef, isPlaying }: PlayAlongViewProps) {
  const { analysis, isLoading, error } = useChordData(
    song.chord_status === "done" ? song.chord_data_path : undefined,
    `${song.chord_status}:${song.updated_at}`,
  );
  const enqueue = useTaskQueueStore((s) => s.enqueue);
  const queued = useTaskQueueStore((s) => s.tasks.some((t) => t.songId === song.id && t.type === "chords"));
  const [useCapoShapes, setUseCapoShapes] = useState(true);
  const [playhead, setPlayhead] = useState<Playhead>({ bar: -1, chord: -1, slot: -1, line: -1 });

  // Track the playhead from the audio element directly, so seeking while
  // paused still moves the highlight. State only changes when an index does.
  useEffect(() => {
    if (!analysis) return;
    const bars = analysis.bars ?? [];
    const chords = analysis.chords ?? [];
    const beats = analysis.beats_ms ?? [];
    let raf = 0;
    let last = "";
    const tick = () => {
      const t = (audioRef.current?.currentTime ?? 0) * 1000;
      const bar = indexAt(bars, t, (b) => b.start_ms);
      const chord = indexAt(chords, t, (c) => c.start_ms);
      let slot = -1;
      const beat = indexAt(beats, t, (b) => b);
      if (bar >= 0 && beat >= 0) {
        const next = beats[beat + 1] ?? bars[bar].end_ms;
        const half = (t - beats[beat]) / Math.max(next - beats[beat], 1) >= 0.5 ? 1 : 0;
        slot = (beat - bars[bar].first_beat) * 2 + half;
      }
      const line = indexAt(lines, t, (l) => l.start_ms ?? Number.POSITIVE_INFINITY);
      const key = `${bar}:${chord}:${slot}:${line}`;
      if (key !== last) {
        last = key;
        setPlayhead({ bar, chord, slot, line });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, audioRef, lines]);

  const stemsDone = song.stem_status === "done";
  const processing = song.chord_status === "processing";

  if (!analysis) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-[380px]">
          <div className="text-[var(--text-muted)] mb-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
            {isLoading ? "Loading chords…" : processing ? "Analysing chords…" : "Not analysed yet"}
          </div>
          <p className="text-[12.5px] text-[var(--text-muted)] mb-4 leading-relaxed">
            {song.chord_status === "error" || error
              ? <span className="text-red-500">{song.chord_error ?? error}</span>
              : stemsDone
                ? "Analyse the instrumental to get chords, a strum pattern and a capo suggestion."
                : "Separate the stems first (Audio Setup), then analyse chords."}
          </p>
          {stemsDone && !processing && !isLoading && (
            <button
              onClick={() => enqueue(song.id, song.title, "chords")}
              disabled={queued}
              className="inline-flex items-center gap-[5px] px-[18px] py-2 rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 transition-opacity border-none cursor-pointer disabled:opacity-50"
            >
              {queued ? "Queued" : song.chord_status === "error" ? "Retry" : "Analyse chords"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const capo = analysis.capo;
  const shapes = capo && capo.fret > 0 && useCapoShapes ? capo.shapes : null;
  const currentChord = playhead.chord >= 0 ? analysis.chords?.[playhead.chord] : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Summary strip */}
      <div className="flex items-center gap-5 px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap">
        <div className="text-[28px] font-semibold leading-none min-w-[72px] text-[var(--accent)]">
          {currentChord ? displayLabel(currentChord.label, shapes) : "–"}
        </div>
        <div className="flex gap-4 text-[12px] text-[var(--text-muted)]">
          {analysis.key && <span>Key <b className="text-[var(--text-secondary)] font-medium">{analysis.key.name}</b></span>}
          {analysis.tempo_bpm && <span><b className="text-[var(--text-secondary)] font-medium">{Math.round(analysis.tempo_bpm)}</b> BPM</span>}
          {analysis.time_signature && (
            <span><b className="text-[var(--text-secondary)] font-medium">{analysis.time_signature.beats_per_bar}/{analysis.time_signature.beat_unit}</b></span>
          )}
        </div>
        {capo && capo.fret > 0 && (
          <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)] cursor-pointer ml-auto">
            <input type="checkbox" checked={useCapoShapes} onChange={(e) => setUseCapoShapes(e.target.checked)} />
            Capo {capo.fret} shapes
            <span className="text-[var(--text-muted)]">
              (barre chords {Math.round(capo.barre_share_no_capo * 100)}% → {Math.round(capo.barre_share_with_capo * 100)}%)
            </span>
          </label>
        )}
      </div>

      {/* Bars + lyrics side by side on wide screens */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2">
        <div className="overflow-y-auto px-6 py-5 border-r border-[var(--border-subtle)]">
          <BarsPane analysis={analysis} playhead={playhead} shapes={shapes} audioRef={audioRef} isPlaying={isPlaying} />
        </div>
        <div className="overflow-y-auto px-4 py-5">
          <LyricsPane
            lines={lines}
            translationLines={translationLines}
            chords={analysis.chords ?? []}
            playhead={playhead}
            shapes={shapes}
            audioRef={audioRef}
            isPlaying={isPlaying}
          />
        </div>
      </div>
    </div>
  );
}
