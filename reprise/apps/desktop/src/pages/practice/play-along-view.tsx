import {
  createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-shell";
import type { Line, Song } from "../../types/song";
import type {
  ChordAnalysis, ChordBar, ChordKey, ChordSegment, FingerstyleEvent, StrumSection,
} from "../../lib/chord-analysis";
import {
  CHORD_LABEL_RE, QUALITY_SUFFIXES, capoShapeLabel, getChordShape, shapeMidiNotes, soundingLabel,
} from "../../lib/chord-shapes";
import {
  loadInstrument, pluck, setInstrument, setSynthVolume, strum, synthNow, type GuitarInstrument,
} from "../../lib/guitar-synth";
import { useChordData } from "../../hooks/use-chord-data";
import { useGuitarGuide } from "../../hooks/use-guitar-guide";
import { useTaskQueueStore } from "../../stores/task-queue-store";
import { ChordDiagram } from "../../components/chord-diagram";

interface PlayAlongViewProps {
  song: Song;
  lines: Line[];
  translationLines: Line[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  /** Element in the page's view-switch row where the mode tabs are rendered. */
  modeTabsContainer?: HTMLElement | null;
}

interface Playhead {
  bar: number;     // index into bars, -1 before the first bar
  chord: number;   // index into chords, -1 if none
  slot: number;    // eighth-note slot within the current bar
  line: number;    // index into lines, -1 if none
}

type Mode = "sheet" | "bars" | "tab" | "chart";

/** Last index whose start is <= t (items sorted by start). */
function indexAt<T>(items: T[], t: number, start: (x: T) => number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (start(items[mid]) <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

const SHARP_TO_FLAT: Record<string, string> = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6]);   // F Bb Eb Ab Db Gb (and relative minors)
const SHARP_HEAVY_MAJOR_KEYS = new Set([4, 11]);        // E B

/**
 * Conventional spelling for the song's key: flats in flat keys, and Bb / Eb
 * (not A# / D#) for borrowed chords in sharp keys with few sharps.
 */
function respell(label: string, key?: ChordKey): string {
  if (!key) return label;
  const m = /^([A-G]#)(.*)$/.exec(label);
  if (!m) return label;
  const majorTonic = key.mode === "major" ? key.tonic_pc : (key.tonic_pc + 3) % 12;
  if (FLAT_MAJOR_KEYS.has(majorTonic)) return SHARP_TO_FLAT[m[1]] + m[2];
  if (!SHARP_HEAVY_MAJOR_KEYS.has(majorTonic) && (m[1] === "A#" || m[1] === "D#")) return SHARP_TO_FLAT[m[1]] + m[2];
  return label;
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Scroll the element matching `selector` into view while playing. */
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
// Shared actions for the sub-views
// ---------------------------------------------------------------------------

interface PlayAlongActions {
  seek: (ms: number) => void;
  /** Label as shown (capo shape when the capo toggle is on). */
  display: (label: string) => string;
  /** Inverse of `display`: the sounding chord for a shown name. */
  toSounding: (shown: string) => string;
  /** Capo fret when chord names are shown as capo shapes, else 0. */
  capoShown: number;
  /** Play the chord and open its diagram next to `anchor`. `index` = segment, when known (enables editing). */
  openChord: (label: string, anchor: HTMLElement, index?: number) => void;
}

const ActionsContext = createContext<PlayAlongActions | null>(null);
function useActions() {
  return useContext(ActionsContext)!;
}

/** A chord name you can click to hear it and see how to hold it. */
function ChordName({ label, index, edited, className = "" }: {
  label: string;
  /** Index of this chord segment in the song, so it can be corrected. */
  index?: number;
  edited?: boolean;
  className?: string;
}) {
  const { display, openChord } = useActions();
  const open = (el: HTMLElement) => openChord(label, el, index);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); open(e.currentTarget); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.stopPropagation(); open(e.currentTarget); }
      }}
      className={`cursor-pointer rounded-[4px] hover:bg-[var(--theme-light)] hover:text-[var(--theme-text)] px-[2px] -mx-[2px] ${
        edited ? "underline decoration-dotted decoration-[var(--theme)] underline-offset-[3px]" : ""
      } ${className}`}
      title={edited ? "Edited by you · click to hear, see the fingering or change it" : "Click to hear it, see the fingering or change it"}
    >
      {display(label)}
    </span>
  );
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
// Chord popover — diagram + sound
// ---------------------------------------------------------------------------

const PICKER_ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PICKER_QUALITIES = QUALITY_SUFFIXES.map((suffix) => ({ suffix, label: suffix === "" ? "maj" : suffix }));

/** Split a label into picker root + suffix, normalising enharmonics to the picker's spelling. */
function splitLabel(label: string): { root: string; suffix: string } {
  const m = CHORD_LABEL_RE.exec(label);
  if (!m) return { root: "C", suffix: "" };
  const enharmonic: Record<string, string> = { Db: "C#", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb" };
  return { root: enharmonic[m[1]] ?? m[1], suffix: m[2] ?? "" };
}

/**
 * Pick a replacement for one chord. Works in the names on screen: with the
 * capo toggle on you pick the shape you play, and the sounding chord is saved.
 */
function ChordEditor({ segment, onPreview, onSave }: {
  segment: ChordSegment;
  onPreview: (soundingLabel: string) => void;
  onSave: (soundingLabel: string) => Promise<void>;
}) {
  const { display, toSounding, capoShown } = useActions();
  const shownCurrent = segment.label === "N" ? "N" : display(segment.label);
  const initial = shownCurrent === "N" ? { root: "C", suffix: "" } : splitLabel(shownCurrent);
  const [root, setRoot] = useState(initial.root);
  const [suffix, setSuffix] = useState(initial.suffix);
  const [noChord, setNoChord] = useState(segment.label === "N");
  const [saving, setSaving] = useState(false);
  const chosen = noChord ? "N" : root + suffix;
  const detected = segment.detected_label ?? segment.label;
  const shownDetected = detected === "N" ? "N.C." : display(detected);

  const pick = (nextRoot: string, nextSuffix: string) => {
    setRoot(nextRoot);
    setSuffix(nextSuffix);
    setNoChord(false);
    onPreview(toSounding(nextRoot + nextSuffix));
  };
  const save = async (shown: string) => {
    setSaving(true);
    try { await onSave(shown === "N" ? "N" : toSounding(shown)); } finally { setSaving(false); }
  };
  const chip = (active: boolean) =>
    `h-[24px] rounded-[5px] text-[11.5px] font-medium cursor-pointer border transition-colors ${
      active
        ? "border-[var(--theme)] bg-[var(--theme-light)] text-[var(--theme-text)]"
        : "border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[#888]"
    }`;

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-1.5">
        Wrong chord? Change this one
        {capoShown > 0 && <span className="normal-case tracking-normal"> · capo {capoShown} shapes</span>}
      </div>
      <div className="grid grid-cols-6 gap-1 mb-1.5">
        {PICKER_ROOTS.map((r) => (
          <button key={r} onClick={() => pick(r, suffix)} className={chip(!noChord && root === r)}>{r}</button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 mb-2">
        {PICKER_QUALITIES.map((q) => (
          <button key={q.label} onClick={() => pick(root, q.suffix)} className={chip(!noChord && suffix === q.suffix)}>
            {q.label}
          </button>
        ))}
        <button onClick={() => setNoChord(true)} className={chip(noChord)} title="No chord here">N.C.</button>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => save(chosen)}
          disabled={saving || chosen === shownCurrent}
          className="flex-1 h-[28px] rounded-[6px] bg-[var(--accent)] text-white text-[12px] font-medium border-none cursor-pointer hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {chosen === shownCurrent ? "Current" : `Use ${chosen === "N" ? "N.C." : chosen}`}
        </button>
        {segment.edited && (
          <button
            onClick={async () => {
              setSaving(true);
              try { await onSave(detected); } finally { setSaving(false); }
            }}
            disabled={saving}
            title={`Back to the detected chord (${shownDetected})`}
            className="h-[28px] px-2.5 rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] cursor-pointer"
          >
            Reset to {shownDetected}
          </button>
        )}
      </div>
    </div>
  );
}

function ChordPopover({
  label, anchor, segment, capoFret, useCapo, onPlay, onEdit, onClose,
}: {
  label: string;
  anchor: DOMRect;
  /** The specific chord in the song, when opened from one (enables editing). */
  segment?: ChordSegment;
  capoFret: number;
  useCapo: boolean;
  onPlay: (label: string, how: "strum" | "arpeggio") => void;
  onEdit: (segment: ChordSegment, label: string) => Promise<void>;
  onClose: () => void;
}) {
  const { display, toSounding } = useActions();
  const ref = useRef<HTMLDivElement>(null);
  const shapeLabel = display(label);
  const shape = getChordShape(shapeLabel);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const width = segment ? 248 : 196;
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8);
  const below = anchor.bottom + (segment ? 360 : 210) < window.innerHeight;
  const top = below ? anchor.bottom + 6 : anchor.top - 6;

  const smallButton =
    "flex-1 px-2 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--theme)] hover:text-[var(--theme-text)] cursor-pointer transition-all";

  return (
    <div
      ref={ref}
      style={{ left, top, width, transform: below ? undefined : "translateY(-100%)" }}
      className="fixed z-50 p-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(0,0,0,0.14)]"
    >
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-[18px] font-semibold text-[var(--text-primary)]">{label === "N" ? "N.C." : shapeLabel}</span>
        <span className="text-[11px] text-[var(--text-muted)] text-right">
          {useCapo && capoFret > 0 && label !== "N" && <>capo {capoFret} · sounds {toSounding(shapeLabel)}</>}
          {segment?.edited && <>{useCapo ? " · " : ""}edited</>}
        </span>
      </div>
      {shape ? (
        <div className="flex justify-center py-1">
          <ChordDiagram shape={shape} size={132} />
        </div>
      ) : (
        <div className="text-[12px] text-[var(--text-muted)] py-4 text-center">No diagram for this chord</div>
      )}
      {label !== "N" && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={() => onPlay(label, "strum")} className={smallButton}>Strum</button>
          <button onClick={() => onPlay(label, "arpeggio")} className={smallButton}>Note by note</button>
        </div>
      )}
      {segment && (
        <ChordEditor
          key={`${segment.start_ms}:${segment.label}`}
          segment={segment}
          onPreview={(l) => onPlay(l, "strum")}
          onSave={async (l) => { await onEdit(segment, l); onClose(); }}
        />
      )}
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
function sheetSegments(
  line: Line,
  chords: ChordSegment[],
  window: { from: number; to: number },
  lead?: number,
): SheetSegment[] {
  const chars = Array.from(line.custom_text ?? line.text);
  if (line.start_ms == null || line.end_ms == null || line.end_ms <= line.start_ms || chords.length === 0) {
    return [{ chord: null, text: chars.join("") }];
  }
  const start = line.start_ms, dur = line.end_ms - start;

  // The lead-in chord (sounding as the line begins) opens the line; after it,
  // only chords that START in this line's window. A chord still ringing on
  // from the previous line isn't repeated.
  const marks: { ci: number; idx: number }[] = lead != null ? [{ ci: lead, idx: 0 }] : [];
  for (let i = Math.max(indexAt(chords, window.from - 1, (c) => c.start_ms) + 1, 0);
    i < chords.length && chords[i].start_ms < window.to; i++) {
    if (i === lead) continue;
    const prev = marks[marks.length - 1];
    if (prev && chords[prev.ci].label === chords[i].label) continue;
    const frac = (Math.max(chords[i].start_ms, start) - start) / dur;
    let idx = Math.round(frac * chars.length);
    if (prev && idx <= prev.idx) idx = prev.idx + 1;   // never stack two chords on one character
    marks.push({ ci: i, idx });                        // idx past the end = trailing chord, no text
  }

  const segments: SheetSegment[] = [];
  if (marks.length === 0 || marks[0].idx > 0) {
    segments.push({ chord: null, text: chars.slice(0, marks[0]?.idx ?? chars.length).join("") });
  }
  marks.forEach((m, k) => {
    const nextIdx = marks[k + 1]?.idx ?? chars.length;
    segments.push({ chord: m.ci, text: chars.slice(m.idx, Math.max(nextIdx, m.idx)).join("") });
  });
  return segments;
}

/** Chord-only row for music without lyrics: intro, interludes, outro. */
function InstrumentalRow({ label, chordIdx, chords, playheadChord }: {
  label: string;
  chordIdx: number[];
  chords: ChordSegment[];
  playheadChord: number;
}) {
  const { seek } = useActions();
  const active = chordIdx.includes(playheadChord);
  return (
    <div
      onClick={() => seek(chords[chordIdx[0]].start_ms)}
      className={`flex items-baseline gap-3 px-4 py-1.5 rounded-[8px] cursor-pointer transition-colors ${
        active ? "bg-[var(--theme-light)]" : "hover:bg-[var(--surface)]"
      }`}
    >
      <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] w-[64px] flex-shrink-0">
        {label}
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-0.5">
        {chordIdx.map((ci) => (
          <ChordName
            key={ci}
            label={chords[ci].label}
            index={ci}
            edited={chords[ci].edited}
            className={`text-[12.5px] font-semibold ${
              ci === playheadChord ? "text-[var(--theme-text)]" : "text-[var(--text-secondary)]"
            }`}
          />
        ))}
      </span>
    </div>
  );
}

/**
 * One lyric line with chord names floating above it. Names take no width in
 * the text, so the lyric stays continuous; after layout, any name that would
 * overlap the previous one is nudged right.
 */
function SheetLine({ segments, chords, isCurrent, playheadChord }: {
  segments: SheetSegment[];
  chords: ChordSegment[];
  isCurrent: boolean;
  playheadChord: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { display } = useActions();
  // Re-run the layout whenever the names shown change (capo toggle, edits).
  const shownNames = segments.map((s) => (s.chord != null ? display(chords[s.chord].label) : "")).join("|");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const GAP = 8;
    const layout = () => {
      const labels = Array.from(el.querySelectorAll<HTMLElement>("[data-chord-label]"));
      // Read every natural position first, then write all shifts, so the
      // browser lays out once instead of once per label.
      labels.forEach((l) => { l.style.transform = ""; });
      const rects = labels.map((l) => l.getBoundingClientRect());
      const shifts: number[] = [];
      let prevRight = -Infinity;
      let prevTop: number | null = null;
      rects.forEach((r) => {
        const sameRow = prevTop !== null && Math.abs(r.top - prevTop) < 4;
        const dx = sameRow && r.left < prevRight + GAP ? prevRight + GAP - r.left : 0;
        shifts.push(dx);
        prevRight = r.right + dx;
        prevTop = r.top;
      });
      labels.forEach((l, i) => { if (shifts[i]) l.style.transform = `translateX(${shifts[i]}px)`; });
    };
    layout();
    // Labels change width when the web font finishes loading; the line
    // changes width when the window resizes. Either way, lay out again.
    const observer = new ResizeObserver(layout);
    observer.observe(el);
    el.querySelectorAll("[data-chord-label]").forEach((l) => observer.observe(l));
    void document.fonts?.ready.then(layout);
    return () => observer.disconnect();
  }, [segments, shownNames]);

  return (
    <div ref={ref} className="flex flex-wrap items-end">
      {segments.map((seg, si) => {
        const activeChord = seg.chord != null && seg.chord === playheadChord && isCurrent;
        return (
          <span key={si} className="relative inline-block pt-[19px]">
            {seg.chord != null && (
              <span
                data-chord-label
                className={`absolute left-0 top-0 h-[18px] leading-[18px] text-[12.5px] font-semibold whitespace-nowrap ${
                  activeChord ? "text-[var(--theme-text)]" : "text-[var(--text-secondary)]"
                }`}
              >
                <ChordName label={chords[seg.chord].label} index={seg.chord} edited={chords[seg.chord].edited} />
              </span>
            )}
            <span
              className={`text-[15px] leading-[22px] whitespace-pre-wrap ${
                isCurrent ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"
              }`}
            >
              {seg.text || "\u00a0"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function SheetView({
  lines, translationLines, chords, playhead, isPlaying,
}: {
  lines: Line[];
  translationLines: Line[];
  chords: ChordSegment[];
  playhead: Playhead;
  isPlaying: boolean;
}) {
  const { seek } = useActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const translationByOrder = useMemo(
    () => new Map(translationLines.map((l) => [l.order, l.custom_text ?? l.text])),
    [translationLines],
  );
  const sheet = useMemo(() => {
    /*
     * Each chord appears once.
     * - A line opens with its lead-in chord: the one sounding when the
     *   singing starts, if it began after the previous line ended.
     * - Chords starting within the line (or up to SNAP_MS before it — lyric
     *   timing is loose) sit above it.
     * - Other chords between lines: a short breath tags them onto the end of
     *   the previous line; a longer gap (intro, interlude, outro) gets its
     *   own chord-only row instead of being piled onto the next line.
     */
    const SNAP_MS = 250;
    const LONG_GAP_MS = 3000;
    const timed = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.start_ms != null && l.end_ms != null && l.end_ms > l.start_ms);

    const chordsStartingIn = (from: number, to: number) => {
      const out: number[] = [];
      for (let k = Math.max(indexAt(chords, from - 1, (c) => c.start_ms) + 1, 0);
        k < chords.length && chords[k].start_ms < to; k++) {
        if (chords[k].label === "N") continue;
        if (out.length && chords[out[out.length - 1]].label === chords[k].label) continue;
        out.push(k);
      }
      return out;
    };

    const info = timed.map(({ l }, t) => {
      const prevEnd = t > 0 ? timed[t - 1].l.end_ms! : -Infinity;
      const cutoff = l.start_ms! - SNAP_MS;
      const sounding = indexAt(chords, l.start_ms!, (c) => c.start_ms);
      const lead = sounding >= 0 && chords[sounding].start_ms >= prevEnd && chords[sounding].start_ms < cutoff
        && chords[sounding].label !== "N" ? sounding : undefined;
      const longGap = t === 0 || cutoff - prevEnd >= LONG_GAP_MS;
      return { prevEnd, cutoff, lead, longGap };
    });

    const segments: SheetSegment[][] = lines.map((l) => [{ chord: null, text: l.custom_text ?? l.text }]);
    const before: { label: string; chordIdx: number[] }[][] = lines.map(() => []);

    timed.forEach(({ l, i }, t) => {
      const me = info[t];
      const next = info[t + 1];
      // Short breath before the next line: this line keeps the chords in it.
      const to = !next
        ? l.end_ms!
        : next.longGap
          ? l.end_ms!
          : next.lead != null ? chords[next.lead].start_ms : next.cutoff;
      segments[i] = sheetSegments(l, chords, { from: me.cutoff, to: Math.max(to, me.cutoff) }, me.lead);
      if (me.longGap) {
        const gap = chordsStartingIn(me.prevEnd, me.cutoff).filter((k) => k !== me.lead);
        if (gap.length) before[i].push({ label: t === 0 ? "Intro" : "Interlude", chordIdx: gap });
      }
    });

    const last = timed[timed.length - 1];
    const outro = last ? chordsStartingIn(last.l.end_ms!, Number.POSITIVE_INFINITY) : [];
    return { segments, before, outro };
  }, [lines, chords]);
  useFollow(containerRef, playhead.line >= 0 ? `[data-line="${playhead.line}"]` : null, isPlaying, "center");

  return (
    <div ref={containerRef} className="max-w-[820px] flex flex-col gap-1">
      {lines.map((line, li) => {
        const isCurrent = li === playhead.line;
        const translation = translationByOrder.get(line.order);
        return (
          <Fragment key={line.id}>
          {sheet.before[li].map((row, ri) => (
            <InstrumentalRow key={ri} label={row.label} chordIdx={row.chordIdx} chords={chords} playheadChord={playhead.chord} />
          ))}
          <div
            data-line={li}
            onClick={() => line.start_ms != null && seek(line.start_ms)}
            className={`px-4 py-2 rounded-[8px] transition-colors cursor-pointer ${
              isCurrent ? "bg-[var(--theme-light)]" : "hover:bg-[var(--surface)]"
            }`}
          >
            <SheetLine segments={sheet.segments[li]} chords={chords} isCurrent={isCurrent} playheadChord={playhead.chord} />
            {translation && (
              <div className="text-[12px] text-[var(--text-muted)] leading-snug mt-1">{translation}</div>
            )}
          </div>
          </Fragment>
        );
      })}
      {sheet.outro.length > 0 && (
        <InstrumentalRow label="Outro" chordIdx={sheet.outro} chords={chords} playheadChord={playhead.chord} />
      )}
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

function BarsView({ analysis, playhead, isPlaying }: {
  analysis: ChordAnalysis;
  playhead: Playhead;
  isPlaying: boolean;
}) {
  const { seek } = useActions();
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
        <div
          data-bar={pickup.index}
          onClick={() => seek(pickup.start_ms)}
          className={`self-start flex items-center gap-2 px-2.5 py-1 rounded-full border text-[12px] cursor-pointer ${
            playhead.bar === pickup.index
              ? "border-[var(--theme)] bg-[var(--theme-light)] text-[var(--theme-text)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"
          }`}
        >
          <span className="text-[var(--text-muted)]">Pickup</span>
          {chordsInBar(pickup, chords).map((ci) => (
            <ChordName key={ci} label={chords[ci].label} index={ci} edited={chords[ci].edited} className="font-semibold" />
          ))}
        </div>
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
                  <div
                    key={bar.index}
                    data-bar={bar.index}
                    onClick={() => seek(bar.start_ms)}
                    className={`text-left px-3 pt-1.5 pb-2 rounded-[8px] border transition-colors cursor-pointer ${
                      isCurrent
                        ? "border-[var(--theme)] bg-[var(--theme-light)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
                    }`}
                  >
                    <div className="text-[9.5px] text-[var(--text-muted)] leading-none mb-1">{bar.index + 1}</div>
                    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 min-h-[21px]">
                      {chordsInBar(bar, chords).map((ci) => (
                        <ChordName
                          key={ci}
                          label={chords[ci].label}
                          index={ci}
                          edited={chords[ci].edited}
                          className={`text-[15px] font-semibold leading-tight ${
                            ci === playhead.chord && isCurrent ? "text-[var(--theme-text)]" : "text-[var(--text-primary)]"
                          }`}
                        />
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
                  </div>
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
// Chord chart — every chord in the song, in order of first appearance
// ---------------------------------------------------------------------------

function ChartView({ chords, current }: { chords: ChordSegment[]; current?: string }) {
  const { display, openChord } = useActions();
  const unique = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of chords) {
      if (c.label === "N") continue;
      seen.set(c.label, (seen.get(c.label) ?? 0) + (c.end_ms - c.start_ms));
    }
    return [...seen.entries()].map(([label, ms]) => ({ label, ms }));
  }, [chords]);

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
      {unique.map(({ label, ms }) => {
        const shown = display(label);
        const shape = getChordShape(shown);
        const isCurrent = label === current;
        return (
          <button
            key={label}
            onClick={(e) => openChord(label, e.currentTarget)}
            className={`flex flex-col items-center pt-2 pb-1.5 rounded-[8px] border cursor-pointer transition-colors ${
              isCurrent ? "border-[var(--theme)] bg-[var(--theme-light)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
            }`}
          >
            <span className={`text-[15px] font-semibold ${isCurrent ? "text-[var(--theme-text)]" : "text-[var(--text-primary)]"}`}>
              {shown}
            </span>
            {shape ? <ChordDiagram shape={shape} size={100} /> : <span className="h-[100px]" />}
            <span className="text-[10px] text-[var(--text-muted)]">{Math.round(ms / 1000)}s in song</span>
          </button>
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

function TabView({ analysis, playhead, isPlaying }: {
  analysis: ChordAnalysis;
  playhead: Playhead;
  isPlaying: boolean;
}) {
  const { seek } = useActions();
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
          const chordIndex = indexAt(chords, bar.start_ms, (c) => c.start_ms);
          const chord = chords[chordIndex];
          return (
            <div
              key={bar.index}
              data-tab-bar={bar.index}
              onClick={() => seek(bar.start_ms)}
              className={`text-left px-2.5 pt-1.5 pb-2 rounded-[8px] border cursor-pointer transition-colors ${
                isCurrent ? "border-[var(--theme)] bg-[var(--theme-light)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[#888]"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[9.5px] text-[var(--text-muted)]">{bar.index + 1}</span>
                {chord && chord.label !== "N" && (
                  <ChordName label={chord.label} index={chordIndex} edited={chord.edited} className="text-[12.5px] font-semibold text-[var(--text-secondary)]" />
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
            </div>
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
  { value: "chart", label: "Chord chart" },
  { value: "tab", label: "Fingerstyle tab" },
];

// Per-machine guide preferences (conveniences only — fine to lose).
const GUIDE_PREFS_KEY = "reprise.playAlong.guide";

interface GuidePrefs {
  volume: number;        // 0..1
  offsetMs: number;      // play this much earlier than the detected beat
  instrument: GuitarInstrument;
}

const DEFAULT_GUIDE_PREFS: GuidePrefs = { volume: 0.3, offsetMs: 60, instrument: "steel" };

function readGuidePrefs(): GuidePrefs {
  try {
    const raw = localStorage.getItem(GUIDE_PREFS_KEY);
    return raw ? { ...DEFAULT_GUIDE_PREFS, ...JSON.parse(raw) } : DEFAULT_GUIDE_PREFS;
  } catch {
    return DEFAULT_GUIDE_PREFS;
  }
}

function GuideSettings({ prefs, onChange, onClose, anchor }: {
  prefs: GuidePrefs;
  onChange: (p: GuidePrefs) => void;
  onClose: () => void;
  anchor: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const width = 240;
  const left = Math.min(anchor.right - width, window.innerWidth - width - 8);
  const label = "text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-1.5";

  return (
    <div
      ref={ref}
      style={{ left, top: anchor.bottom + 6, width }}
      className="fixed z-50 p-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(0,0,0,0.14)] flex flex-col gap-3"
    >
      <div>
        <div className={label}>Sound</div>
        <div className="flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
          {(["steel", "nylon"] as const).map((inst) => (
            <button
              key={inst}
              onClick={() => onChange({ ...prefs, instrument: inst })}
              className={`flex-1 px-2 py-[3px] rounded-[6px] text-[12px] font-medium cursor-pointer border-none ${
                prefs.instrument === inst
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "bg-transparent text-[var(--text-muted)]"
              }`}
            >
              {inst === "steel" ? "Steel string" : "Nylon"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className={`${label} flex justify-between`}>
          <span>Volume</span><span className="normal-case tracking-normal">{Math.round(prefs.volume * 100)}%</span>
        </div>
        <input
          type="range" min={0.05} max={1} step={0.05} value={prefs.volume}
          onChange={(e) => onChange({ ...prefs, volume: Number(e.target.value) })}
          className="w-full accent-[var(--theme)]"
        />
      </div>
      <div>
        <div className={`${label} flex justify-between`}>
          <span>Timing</span>
          <span className="normal-case tracking-normal">
            {prefs.offsetMs === 0 ? "on the beat" : `${Math.abs(prefs.offsetMs)} ms ${prefs.offsetMs > 0 ? "earlier" : "later"}`}
          </span>
        </div>
        <input
          type="range" min={-150} max={300} step={10} value={prefs.offsetMs}
          onChange={(e) => onChange({ ...prefs, offsetMs: Number(e.target.value) })}
          className="w-full accent-[var(--theme)]"
        />
        <div className="text-[10.5px] text-[var(--text-muted)] leading-snug mt-1">
          Drag right if the guitar sounds behind the song, left if it rushes ahead.
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-muted)] leading-snug">
        Guitar samples: FluidR3_GM by Frank Wen (CC BY 3.0)
      </div>
    </div>
  );
}

export function PlayAlongView({
  song, lines, translationLines, audioRef, isPlaying, onTogglePlay, onSeek, modeTabsContainer,
}: PlayAlongViewProps) {
  const { analysis, isLoading, error, editChord } = useChordData(
    song.chord_status === "done" ? song.chord_data_path : undefined,
    `${song.chord_status}:${song.updated_at}`,
  );
  const enqueue = useTaskQueueStore((s) => s.enqueue);
  const queued = useTaskQueueStore((s) => s.tasks.some((t) => t.songId === song.id && t.type === "chords"));
  const [useCapoShapes, setUseCapoShapes] = useState(false); // capo off by default; one click shows capo shapes
  const [mode, setMode] = useState<Mode>("sheet");
  const [guideOn, setGuideOn] = useState(false);
  const [guidePrefs, setGuidePrefs] = useState<GuidePrefs>(readGuidePrefs);
  const [guideSettingsAnchor, setGuideSettingsAnchor] = useState<DOMRect | null>(null);
  const [popover, setPopover] = useState<{ label: string; anchor: DOMRect; index?: number } | null>(null);
  const [playhead, setPlayhead] = useState<Playhead>({ bar: -1, chord: -1, slot: -1, line: -1 });
  const [clock, setClock] = useState({ now: 0, total: 0 });

  // Track the playhead from the audio element directly, so seeking while
  // paused still moves the highlight. State only changes when a value does.
  useEffect(() => {
    if (!analysis) return;
    const bars = analysis.bars ?? [];
    const chords = analysis.chords ?? [];
    const beats = analysis.beats_ms ?? [];
    let raf = 0;
    let last = "";
    let lastSecond = -1;
    const tick = () => {
      const audio = audioRef.current;
      const t = (audio?.currentTime ?? 0) * 1000;
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
      const second = Math.floor(t / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        const total = audio && Number.isFinite(audio.duration) ? audio.duration * 1000 : analysis.duration_ms ?? 0;
        setClock({ now: t, total });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, audioRef, lines]);

  // Space toggles playback while this view is on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        // Drop focus so Space doesn't also "click" the last button pressed.
        (document.activeElement as HTMLElement | null)?.blur?.();
        onTogglePlay();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onTogglePlay]);

  const capo = analysis?.capo;
  const capoFret = capo?.fret ?? 0;
  const capoAvailable = capoFret > 0 && mode !== "tab";
  const capoShown = capoAvailable && useCapoShapes ? capoFret : 0;

  const songKey = analysis?.key;
  const display = useCallback(
    (label: string) =>
      label === "N" ? "N.C." : capoShown ? capoShapeLabel(label, capoShown) : respell(label, songKey),
    [capoShown, songKey],
  );
  const toSounding = useCallback(
    (shown: string) => (capoShown ? respell(soundingLabel(shown, capoShown), songKey) : shown),
    [capoShown, songKey],
  );

  /** Sounding notes for a chord: the shown shape, plus the capo when shapes are capo shapes. */
  const chordNotes = useCallback(
    (label: string) => {
      const shape = getChordShape(capoShown ? capoShapeLabel(label, capoShown) : label);
      return shape ? shapeMidiNotes(shape, capoShown) : [];
    },
    [capoShown],
  );

  const playChord = useCallback(
    (label: string, how: "strum" | "arpeggio" = "strum") => {
      const notes = chordNotes(label);
      if (how === "strum") {
        strum(notes, { direction: "down", spreadMs: 22, velocity: 0.7 });
      } else {
        const start = synthNow() + 0.02;
        notes.forEach((n, i) => pluck(n, notes.length - i, start + i * 0.22, 0.7));
      }
    },
    [chordNotes],
  );

  const actions = useMemo<PlayAlongActions>(() => ({
    seek: onSeek,
    display,
    toSounding,
    capoShown,
    openChord: (label, anchor, index) => {
      if (label !== "N") playChord(label);
      setPopover({ label, anchor: anchor.getBoundingClientRect(), index });
    },
  }), [onSeek, display, toSounding, capoShown, playChord]);

  // Sound + volume apply to chord previews too, not just the guide.
  useEffect(() => {
    setInstrument(guidePrefs.instrument);
    setSynthVolume(guidePrefs.volume);
  }, [guidePrefs.instrument, guidePrefs.volume]);
  useEffect(() => { void loadInstrument(); }, []);

  useGuitarGuide({
    analysis,
    audioRef,
    enabled: guideOn,
    mode: mode === "tab" ? "fingerstyle" : "strum",
    volume: guidePrefs.volume,
    offsetMs: guidePrefs.offsetMs,
    chordNotes,
  });

  const changeGuidePrefs = (p: GuidePrefs) => {
    setGuidePrefs(p);
    try { localStorage.setItem(GUIDE_PREFS_KEY, JSON.stringify(p)); } catch { /* per-machine convenience only */ }
  };

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
  const current = playhead.chord >= 0 ? chords[playhead.chord] : undefined;
  let next: ChordSegment | undefined;
  let nextIndex = -1;
  for (let i = playhead.chord + 1; i < chords.length; i++) {
    if (chords[i].label !== "N" && chords[i].label !== current?.label) { next = chords[i]; nextIndex = i; break; }
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
  const fingerstyleReady = analysis.fingerstyle?.status === "ok";
  const guideDisabled = mode === "tab" && !fingerstyleReady;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="flex-1 min-h-0 flex flex-col">
        {/* View-mode tabs live in the page's view-switch row */}
        {modeTabsContainer && createPortal(
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
          </div>,
          modeTabsContainer,
        )}

        {/* Now playing */}
        <div className="flex items-center gap-6 px-6 pt-3 pb-2 bg-[var(--surface)]">
          <button
            onClick={onTogglePlay}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            className="w-[40px] h-[40px] rounded-full bg-[var(--theme)] text-white flex items-center justify-center border-none cursor-pointer hover:opacity-90 transition-opacity flex-shrink-0"
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-[2px]"><path d="M6 4l14 8-14 8z" /></svg>
            )}
          </button>

          <div className="flex items-baseline gap-2.5 w-[150px] flex-shrink-0">
            {current && current.label !== "N" ? (
              <ChordName
                label={current.label}
                index={playhead.chord}
                edited={current.edited}
                className="text-[30px] font-semibold leading-none text-[var(--theme-text)]"
              />
            ) : (
              <span className="text-[30px] font-semibold leading-none text-[var(--text-muted)]">–</span>
            )}
            {next && (
              <span className="flex items-center gap-1 text-[13px] text-[var(--text-muted)] whitespace-nowrap">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <ChordName label={next.label} index={nextIndex} edited={next.edited} className="font-semibold text-[var(--text-secondary)]" />
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

          <div className="flex items-center gap-2 ml-auto">
            {meta.length > 0 && (
              <span className="text-[12px] text-[var(--text-muted)] whitespace-nowrap mr-2">
                {meta.map((m, i) => (
                  <Fragment key={i}>{i > 0 && <span className="mx-1.5">·</span>}{m}</Fragment>
                ))}
              </span>
            )}
            {capoAvailable && (
              <button
                onClick={() => setUseCapoShapes((v) => !v)}
                title={`Show the chord shapes to play with a capo on fret ${capoFret} (barre chords ${Math.round(
                  capo!.barre_share_no_capo * 100,
                )}% → ${Math.round(capo!.barre_share_with_capo * 100)}%)`}
                className={`h-[28px] px-2.5 rounded-[6px] text-[12px] font-medium border-[1.5px] cursor-pointer transition-all whitespace-nowrap ${
                  useCapoShapes
                    ? "border-[var(--theme)] text-[var(--theme-text)] bg-[var(--theme-light)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] bg-transparent hover:border-[#888]"
                }`}
              >
                Capo {capoFret}
              </button>
            )}
            <div className="flex items-center rounded-[6px] border-[1.5px] border-[var(--border)] overflow-hidden">
              <button
                onClick={() => setGuideOn((v) => !v)}
                disabled={guideDisabled}
                title={mode === "tab"
                  ? "Play the fingerstyle arrangement along with the song"
                  : "Strum the chords along with the song, using the strum pattern"}
                className={`h-[25px] flex items-center gap-1.5 px-2.5 text-[12px] font-medium border-none cursor-pointer transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                  guideOn
                    ? "text-[var(--theme-text)] bg-[var(--theme-light)]"
                    : "text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {guideOn && <path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14" />}
                </svg>
                Guide guitar
              </button>
              <button
                onClick={(e) => setGuideSettingsAnchor(e.currentTarget.getBoundingClientRect())}
                title="Guitar sound, volume and timing"
                className="h-[25px] w-[26px] border-none border-l border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center justify-center"
                style={{ borderLeft: "1.5px solid var(--border)" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
                  <circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Seek bar */}
        <div className="flex items-center gap-3 px-6 pb-3 bg-[var(--surface)] border-b border-[var(--border)]">
          <span className="text-[11px] tabular-nums text-[var(--text-muted)] w-[34px] text-right">{formatTime(clock.now)}</span>
          <div
            className="relative flex-1 h-[14px] flex items-center cursor-pointer group"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (clock.total > 0) onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * clock.total);
            }}
          >
            <div className="w-full h-[4px] rounded-full bg-[var(--bg)] border border-[var(--border-subtle)] overflow-hidden">
              <div
                className="h-full bg-[var(--theme)]"
                style={{ width: `${clock.total > 0 ? Math.min(100, (clock.now / clock.total) * 100) : 0}%` }}
              />
            </div>
            <div
              className="absolute w-[11px] h-[11px] rounded-full bg-[var(--theme)] border-2 border-[var(--surface)] shadow-[0_0_0_1px_var(--theme)] -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${clock.total > 0 ? Math.min(100, (clock.now / clock.total) * 100) : 0}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-[var(--text-muted)] w-[34px]">{formatTime(clock.total)}</span>
        </div>

        {/* One scrolling area for whichever view is selected */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {mode === "sheet" && (
            <SheetView lines={lines} translationLines={translationLines} chords={chords} playhead={playhead} isPlaying={isPlaying} />
          )}
          {mode === "bars" && <BarsView analysis={analysis} playhead={playhead} isPlaying={isPlaying} />}
          {mode === "chart" && <ChartView chords={chords} current={current?.label} />}
          {mode === "tab" && <TabView analysis={analysis} playhead={playhead} isPlaying={isPlaying} />}
        </div>

        {popover && (
          <ChordPopover
            label={popover.label}
            anchor={popover.anchor}
            segment={popover.index != null && popover.index >= 0 ? chords[popover.index] : undefined}
            capoFret={capoFret}
            useCapo={capoShown > 0}
            onPlay={playChord}
            onEdit={editChord}
            onClose={() => setPopover(null)}
          />
        )}
        {guideSettingsAnchor && (
          <GuideSettings
            prefs={guidePrefs}
            onChange={changeGuidePrefs}
            anchor={guideSettingsAnchor}
            onClose={() => setGuideSettingsAnchor(null)}
          />
        )}
      </div>
    </ActionsContext.Provider>
  );
}
