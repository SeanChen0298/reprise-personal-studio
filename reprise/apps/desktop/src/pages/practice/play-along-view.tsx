import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import type { Line, Song } from "../../types/song";
import type {
  ChordAnalysis, ChordBar, ChordSegment, FingerstyleEvent, StrumSection,
} from "../../lib/chord-analysis";
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

type Mode = "sheet" | "bars" | "tab";

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

/** Scroll the element matching `selector` into view when `key` changes during playback. */
function useFollow(
  containerRef: React.RefObject<HTMLDivElement | null>,
  selector: string | null,
  isPlaying: boolean,
  block: ScrollLogicalPosition = "nearest",
) {
  useEffect(() => {
    if (!isPlaying || !selector) return;
    containerRef.current
      ?.querySelector<HTMLElement>(selector)
      ?.scrollIntoView({ block, behavior: "smooth" });
  }, [containerRef, selector, isPlaying, block]);
}

// ---------------------------------------------------------------------------
// Strum pattern — one cell per eighth note, counted "1 & 2 & …"
// ---------------------------------------------------------------------------

function StrokeArrow({ down }: { down: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      {down ? <path d="M12 4v16M6 14l6 6 6-6" /> : <path d="M12 20V4M6 10l6-6 6 6" />}
    </svg>
  );
}

function StrumPattern({ pattern, activeSlot, showCounts = true }: {
  pattern: string;
  activeSlot?: number;
  showCounts?: boolean;
}) {
  return (
    <div className="flex items-end">
      {pattern.split("").map((ch, i) => {
        const active = i === activeSlot;
        const onBeat = i % 2 === 0;
        return (
          <div key={i} className={`flex flex-col items-center w-[20px] ${onBeat && i > 0 ? "ml-[4px]" : ""}`}>
            <span
              className={`w-[18px] h-[20px] rounded-[4px] flex items-center justify-center transition-colors ${
                active
                  ? "bg-[var(--theme)] text-white"
                  : ch === "-"
                    ? "text-[var(--border)]"
                    : "bg-[var(--theme-light)] text-[var(--theme-text)]"
              }`}
            >
              {ch === "-" ? <span className="w-[4px] h-[4px] rounded-full bg-current" /> : <StrokeArrow down={ch === "D"} />}
            </span>
            {showCounts && (
              <span className={`text-[9.5px] leading-[12px] mt-[2px] ${active ? "text-[var(--theme-text)] font-semibold" : "text-[var(--text-muted)]"}`}>
                {onBeat ? i / 2 + 1 : "&"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chord sheet — chords sit above the syllable where they change
// ---------------------------------------------------------------------------

interface SheetSegment {
  chord: number | null;  // index into chords
  text: string;
}

/**
 * Split a timed line into segments that each start at a chord change.
 * Time within the line is mapped to a character position, so a chord that
 * changes halfway through the line sits above the middle character.
 */
function sheetSegments(line: Line, chords: ChordSegment[]): SheetSegment[] {
  const chars = Array.from(line.custom_text ?? line.text);
  if (line.start_ms == null || line.end_ms == null || line.end_ms <= line.start_ms || chords.length === 0) {
    return [{ chord: null, text: chars.join("") }];
  }
  const start = line.start_ms, end = line.end_ms, dur = end - start;

  const marks: { ci: number; idx: number }[] = [];
  const first = indexAt(chords, start, (c) => c.start_ms);
  for (let i = Math.max(first, 0); i < chords.length && chords[i].start_ms < end; i++) {
    if (chords[i].end_ms <= start) continue;
    const prev = marks[marks.length - 1];
    if (prev && chords[prev.ci].label === chords[i].label) continue;
    const frac = (Math.max(chords[i].start_ms, start) - start) / dur;
    let idx = Math.round(frac * chars.length);
    if (prev && idx <= prev.idx) idx = prev.idx + 1;   // never stack two chords on one character
    if (idx > chars.length) idx = chars.length;
    if (prev && idx === prev.idx) continue;
    marks.push({ ci: i, idx });
  }

  const segments: SheetSegment[] = [];
  if (marks.length === 0 || marks[0].idx > 0) {
    segments.push({ chord: null, text: chars.slice(0, marks[0]?.idx ?? chars.length).join("") });
  }
  marks.forEach((m, k) => {
    const nextIdx = marks[k + 1]?.idx ?? chars.length;
    segments.push({ chord: m.ci, text: chars.slice(m.idx, nextIdx).join("") });
  });
  return segments;
}

function SheetView({
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
  const segmentsByLine = useMemo(() => lines.map((l) => sheetSegments(l, chords)), [lines, chords]);
  useFollow(containerRef, playhead.line >= 0 ? `[data-line="${playhead.line}"]` : null, isPlaying, "center");

  return (
    <div ref={containerRef} className="max-w-[820px] flex flex-col gap-0.5">
      {lines.map((line, li) => {
        const isCurrent = li === playhead.line;
        const translation = translationByOrder.get(line.order);
        return (
          <button
            key={line.id}
            data-line={li}
            onClick={() => line.start_ms != null && seek(audioRef, line.start_ms)}
            className={`text-left px-3 py-2 rounded-[8px] transition-colors cursor-pointer border-none ${
              isCurrent ? "bg-[var(--theme-light)]" : "bg-transparent hover:bg-[var(--surface)]"
            }`}
          >
            <div className="flex flex-wrap items-end">
              {segmentsByLine[li].map((seg, si) => {
                const activeChord = seg.chord != null && seg.chord === playhead.chord && isCurrent;
                return (
                  <span key={si} className="inline-flex flex-col">
                    <span
                      className={`h-[18px] text-[12.5px] font-semibold whitespace-nowrap pr-2 leading-[18px] ${
                        activeChord ? "text-[var(--theme-text)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {seg.chord != null ? displayLabel(chords[seg.chord].label, shapes) : ""}
                    </span>
                    <span
                      className={`text-[15px] leading-[22px] whitespace-pre-wrap ${
                        isCurrent ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {seg.text || " "}
                    </span>
                  </span>
                );
              })}
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
// Bars — a 4-across grid per strum section
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

function BarsView({
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
  useFollow(containerRef, playhead.bar >= 0 ? `[data-bar="${playhead.bar}"]` : null, isPlaying);

  const pickup = bars.find((b) => b.pickup);
  const groups = useMemo(() => {
    const fullBars = bars.filter((b) => !b.pickup);
    if (sections.length === 0) return [{ section: null as StrumSection | null, bars: fullBars }];
    return sections.map((section) => ({
      section,
      bars: fullBars.filter((b) => b.index >= section.start_bar && b.index <= section.end_bar),
    }));
  }, [bars, sections]);

  return (
    <div ref={containerRef} className="flex flex-col gap-6">
      {pickup && (
        <button
          data-bar={pickup.index}
          onClick={() => seek(audioRef, pickup.start_ms)}
          className={`self-start flex items-center gap-2 px-2.5 py-1 rounded-full border text-[12px] cursor-pointer ${
            playhead.bar === pickup.index
              ? "border-[var(--theme)] bg-[var(--theme-light)] text-[var(--theme-text)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"
          }`}
        >
          <span className="text-[var(--text-muted)]">Pickup</span>
          <span className="font-semibold">
            {chordsInBar(pickup, chords).map((ci) => displayLabel(chords[ci].label, shapes)).join("  ")}
          </span>
        </button>
      )}
      {groups.map(({ section, bars: groupBars }, gi) => {
        if (groupBars.length === 0) return null;
        const active = section != null && playhead.bar >= section.start_bar && playhead.bar <= section.end_bar;
        return (
          <section key={gi}>
            {section && (
              <div className="flex items-end gap-4 mb-2.5">
                <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] pb-[14px]">
                  Bars {section.start_bar + 1}–{section.end_bar + 1}
                </span>
                <StrumPattern pattern={section.pattern} activeSlot={active ? playhead.slot : undefined} />
                {section.source === "suggested" && (
                  <span
                    className="text-[10.5px] text-[var(--text-muted)] pb-[14px] cursor-help"
                    title="The rhythm here was too unclear to read, so this pattern is a suggestion"
                  >
                    suggested
                  </span>
                )}
              </div>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {groupBars.map((bar) => {
                const isCurrent = bar.index === playhead.bar;
                const beatsDone = isCurrent ? Math.floor(playhead.slot / 2) : -1;
                return (
                  <button
                    key={bar.index}
                    data-bar={bar.index}
                    onClick={() => seek(audioRef, bar.start_ms)}
                    className={`text-left px-3 pt-1.5 pb-2 rounded-[8px] border transition-colors cursor-pointer ${
                      isCurrent
                        ? "border-[var(--theme)] bg-[var(--theme-light)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
                    }`}
                  >
                    <div className="text-[9.5px] text-[var(--text-muted)] leading-none mb-1">{bar.index + 1}</div>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 min-h-[21px]">
                      {chordsInBar(bar, chords).map((ci) => (
                        <span
                          key={ci}
                          className={`text-[15px] font-semibold leading-tight ${
                            ci === playhead.chord && isCurrent ? "text-[var(--theme-text)]" : "text-[var(--text-primary)]"
                          }`}
                        >
                          {displayLabel(chords[ci].label, shapes)}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      {Array.from({ length: bar.beats || beatsPerBar }).map((_, b) => (
                        <span
                          key={b}
                          className={`h-[3px] flex-1 rounded-full ${
                            b <= beatsDone ? "bg-[var(--theme)]" : isCurrent ? "bg-[var(--surface)]" : "bg-[var(--bg)]"
                          }`}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab — fingerstyle arrangement, one card per bar
// ---------------------------------------------------------------------------

const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];

function openFile(path: string) {
  open(encodeURI(`file:///${path.replace(/^\/+/, "")}`)).catch((err) =>
    console.error("[PlayAlong] could not open file:", err),
  );
}

function TabView({
  analysis, playhead, audioRef, isPlaying,
}: {
  analysis: ChordAnalysis;
  playhead: Playhead;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
}) {
  const fs = analysis.fingerstyle;
  const containerRef = useRef<HTMLDivElement>(null);
  const bars = analysis.bars ?? [];
  const chords = analysis.chords ?? [];
  useFollow(containerRef, playhead.bar >= 0 ? `[data-tab-bar="${playhead.bar}"]` : null, isPlaying);

  const eventsByBar = useMemo(() => {
    const map = new Map<number, Map<number, FingerstyleEvent>>();
    if (fs?.status === "ok") {
      for (const ev of fs.events) {
        if (!map.has(ev.bar)) map.set(ev.bar, new Map());
        map.get(ev.bar)!.set(ev.slot, ev);
      }
    }
    return map;
  }, [fs]);

  if (!fs || fs.status !== "ok") {
    return (
      <div className="max-w-[460px] text-[12.5px] text-[var(--text-muted)] leading-relaxed">
        {fs?.status === "error" ? (
          <span className="text-red-500">Fingerstyle arrangement failed: {fs.message}</span>
        ) : (
          <>No fingerstyle arrangement yet. It needs the vocal pitch analysis (Audio Setup → Pitch analysis);
          chords are re-analysed automatically once pitch finishes.</>
        )}
      </div>
    );
  }

  const slots = fs.slots_per_bar;
  const arrangedBars = bars.filter((b) => !b.pickup && b.beats * 2 === slots);
  const fileButton =
    "px-2.5 py-[3px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] cursor-pointer transition-all";

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-[var(--text-muted)]">
          Standard tuning · <b className="font-semibold text-[var(--text-primary)]">bold</b> = melody (from the vocals) · bass from the chord roots
        </span>
        <span className="ml-auto" />
        <button onClick={() => openFile(fs.tab_path)} className={fileButton}>Open .txt</button>
        <button onClick={() => openFile(fs.musicxml_path)} className={fileButton} title="Opens in MuseScore or Guitar Pro">
          Open MusicXML
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-1.5">
        {arrangedBars.map((bar) => {
          const isCurrent = bar.index === playhead.bar;
          const evs = eventsByBar.get(bar.index);
          const chord = chords[indexAt(chords, bar.start_ms, (c) => c.start_ms)];
          return (
            <button
              key={bar.index}
              data-tab-bar={bar.index}
              onClick={() => seek(audioRef, bar.start_ms)}
              className={`text-left px-2.5 pt-1.5 pb-2 rounded-[8px] border cursor-pointer transition-colors ${
                isCurrent ? "border-[var(--theme)] bg-[var(--theme-light)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[9.5px] text-[var(--text-muted)]">{bar.index + 1}</span>
                {chord && chord.label !== "N" && (
                  <span className="text-[12.5px] font-semibold text-[var(--text-secondary)]">{chord.label}</span>
                )}
              </div>
              <div className="font-mono text-[12px] leading-[16px]">
                {STRING_LABELS.map((name, si) => (
                  <div key={name} className="flex items-center">
                    <span className="w-[14px] text-[var(--text-muted)]">{name}</span>
                    {Array.from({ length: slots }).map((_, slot) => {
                      const note = evs?.get(slot)?.notes.find((n) => n.string === si + 1);
                      const active = isCurrent && slot === playhead.slot;
                      return (
                        <span
                          key={slot}
                          className={`w-[26px] text-center ${active ? "bg-[var(--theme)] text-white rounded-[3px]" : ""} ${
                            note
                              ? note.role === "melody"
                                ? `font-bold ${active ? "" : "text-[var(--text-primary)]"}`
                                : active ? "" : "text-[var(--text-secondary)]"
                              : active ? "opacity-60" : "text-[var(--border)]"
                          }`}
                        >
                          {note ? note.fret : "-"}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

const MODES: { value: Mode; label: string }[] = [
  { value: "sheet", label: "Chord sheet" },
  { value: "bars", label: "Bars" },
  { value: "tab", label: "Fingerstyle tab" },
];

export function PlayAlongView({ song, lines, translationLines, audioRef, isPlaying }: PlayAlongViewProps) {
  const { analysis, isLoading, error } = useChordData(
    song.chord_status === "done" ? song.chord_data_path : undefined,
    `${song.chord_status}:${song.updated_at}`,
  );
  const enqueue = useTaskQueueStore((s) => s.enqueue);
  const queued = useTaskQueueStore((s) => s.tasks.some((t) => t.songId === song.id && t.type === "chords"));
  const [useCapoShapes, setUseCapoShapes] = useState(true);
  const [mode, setMode] = useState<Mode>("sheet");
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

  const chords = analysis.chords ?? [];
  const capo = analysis.capo;
  const capoAvailable = !!capo && capo.fret > 0 && mode !== "tab";
  const shapes = capoAvailable && useCapoShapes ? capo!.shapes : null;

  const current = playhead.chord >= 0 ? chords[playhead.chord] : undefined;
  let next: ChordSegment | undefined;
  for (let i = playhead.chord + 1; i < chords.length; i++) {
    if (chords[i].label !== "N" && chords[i].label !== current?.label) { next = chords[i]; break; }
  }
  const sections = analysis.strumming?.sections ?? [];
  const currentSection =
    sections.find((s) => playhead.bar >= s.start_bar && playhead.bar <= s.end_bar) ?? sections[0];
  const pattern = currentSection?.pattern ?? analysis.strumming?.main_pattern;
  const meta = [
    analysis.key?.name,
    analysis.tempo_bpm ? `${Math.round(analysis.tempo_bpm)} BPM` : null,
    analysis.time_signature ? `${analysis.time_signature.beats_per_bar}/${analysis.time_signature.beat_unit}` : null,
  ].filter(Boolean);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Now playing: current / next chord, live strum, song facts, view controls */}
      <div className="flex items-center gap-x-6 gap-y-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap">
        <div className="flex items-baseline gap-3 min-w-[150px]">
          <span className="text-[30px] font-semibold leading-none text-[var(--theme-text)]">
            {current ? displayLabel(current.label, shapes) : "–"}
          </span>
          {next && (
            <span className="flex items-center gap-1 text-[13px] text-[var(--text-muted)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span className="font-semibold text-[var(--text-secondary)]">{displayLabel(next.label, shapes)}</span>
            </span>
          )}
        </div>

        {mode !== "tab" && pattern && (
          <div
            className="flex items-center gap-2"
            title={currentSection?.source === "suggested"
              ? "Suggested pattern: the rhythm here was too unclear to read"
              : "Strum pattern read from the instrumental's rhythm"}
          >
            <StrumPattern pattern={pattern} activeSlot={currentSection && playhead.bar >= 0 ? playhead.slot : undefined} />
            {currentSection?.source === "suggested" && (
              <span className="text-[10.5px] text-[var(--text-muted)] self-start mt-[3px]">suggested</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 ml-auto flex-wrap">
          {meta.length > 0 && (
            <span className="text-[12px] text-[var(--text-muted)]">
              {meta.map((m, i) => (
                <Fragment key={i}>{i > 0 && <span className="mx-1.5">·</span>}{m}</Fragment>
              ))}
            </span>
          )}
          {capoAvailable && (
            <button
              onClick={() => setUseCapoShapes((v) => !v)}
              title={`Show the chord shapes to play with a capo on fret ${capo!.fret} (barre chords ${Math.round(
                capo!.barre_share_no_capo * 100,
              )}% → ${Math.round(capo!.barre_share_with_capo * 100)}%)`}
              className={`px-2.5 py-[4px] rounded-[6px] text-[12px] font-medium border-[1.5px] cursor-pointer transition-all ${
                useCapoShapes
                  ? "border-[var(--theme)] text-[var(--theme-text)] bg-[var(--theme-light)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] bg-transparent hover:border-[#888]"
              }`}
            >
              Capo {capo!.fret}
            </button>
          )}
          <div className="flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`px-3 py-[4px] rounded-[6px] text-[12px] font-medium cursor-pointer border-none transition-all ${
                  mode === value
                    ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* One scrolling area for whichever view is selected */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {mode === "sheet" && (
          <SheetView
            lines={lines}
            translationLines={translationLines}
            chords={chords}
            playhead={playhead}
            shapes={shapes}
            audioRef={audioRef}
            isPlaying={isPlaying}
          />
        )}
        {mode === "bars" && (
          <BarsView analysis={analysis} playhead={playhead} shapes={shapes} audioRef={audioRef} isPlaying={isPlaying} />
        )}
        {mode === "tab" && (
          <TabView analysis={analysis} playhead={playhead} audioRef={audioRef} isPlaying={isPlaying} />
        )}
      </div>
    </div>
  );
}
