import {
  createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import type { Line, Song } from "../../types/song";
import type {
  ChordAnalysis, ChordKey, ChordSegment,
} from "../../lib/chord-analysis";
import {
  CHORD_LABEL_RE, canonicalChord, capoShapeLabel, formatChord, getChordVoicings,
  shapeMidiNotes, soundingLabel, type ChordNotation, type ChordShape,
} from "../../lib/chord-shapes";
import { buildPicking, PICK_PATTERNS, type PickEvent, type PickPattern } from "../../lib/fingerpicking";
import {
  loadInstrument, pluck, setInstrument, setSynthVolume, strum, synthNow, type GuitarInstrument,
} from "../../lib/guitar-synth";
import { useChordData, type ChordLength } from "../../hooks/use-chord-data";
import { useFingerings } from "../../hooks/use-fingerings";
import { placeChart } from "../../lib/chord-chart";
import { saveChordSettings } from "../../lib/chord-analysis";
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

type Mode = "sheet" | "tab";

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
  /** Chord-name style for labels built outside `display` (e.g. in the picker). */
  notation: ChordNotation;
  /** Fingerings for a shown chord name, and the one picked for it in `bar` (default 0). */
  voicings: (shown: string, bar?: number) => { all: ChordShape[]; chosen: number };
  /** Save a fingering pick for a chord in one bar (index null or 0 = back to the default). */
  chooseVoicing: (shown: string, index: number | null, bar?: number) => void;
  /** Play the chord and open its diagram next to `anchor`. `index` = segment, when known (enables editing). */
  openChord: (label: string, anchor: HTMLElement, index?: number, scope?: { start: number; end: number }) => void;
}

const ActionsContext = createContext<PlayAlongActions | null>(null);
function useActions() {
  return useContext(ActionsContext)!;
}

/** A chord name you can click to hear it and see how to hold it. */
function ChordName({ label, index, scope, edited, className = "" }: {
  label: string;
  /** Index of this chord segment in the song, so it can be corrected. */
  index?: number;
  /** Limit edits to this time range (e.g. the bar the chord was clicked in). */
  scope?: { start: number; end: number };
  edited?: boolean;
  className?: string;
}) {
  const { display, openChord } = useActions();
  const open = (el: HTMLElement) => openChord(label, el, index, scope);
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
/** Picker label for a quality suffix in the chosen notation ("" -> "maj"). */
function qualityLabel(suffix: string, notation: ChordNotation): string {
  if (suffix === "") return "maj";
  return formatChord("C" + suffix, notation).slice(1);
}
/** Chord types grouped the way players think about them. */
const QUALITY_GROUPS: { title: string; suffixes: string[] }[] = [
  { title: "Triads", suffixes: ["", "m", "sus2", "sus4", "dim", "aug"] },
  { title: "Sevenths", suffixes: ["7", "m7", "maj7", "m7b5", "dim7", "7sus4"] },
  { title: "Added / extended", suffixes: ["6", "m6", "add9", "maj9", "9", "m9"] },
];

/** Split a label into picker root + suffix, normalising enharmonics to the picker's spelling. */
function splitLabel(label: string): { root: string; suffix: string } {
  const m = CHORD_LABEL_RE.exec(canonicalChord(label));
  if (!m) return { root: "C", suffix: "" };
  const enharmonic: Record<string, string> = { Db: "C#", "D#": "Eb", Gb: "F#", "G#": "Ab", "A#": "Bb" };
  return { root: enharmonic[m[1]] ?? m[1], suffix: m[2] ?? "" };
}

type EditorTab = "pick" | "timing";

/**
 * Change one chord: pick any chord, or change its timing.
 * Works in the names on screen: with the capo toggle on you pick the shape
 * you play, and the sounding chord is saved.
 */
function ChordEditor({ segment, beatsInBar, onPreview, onSelect, onSave, onLength, onRemove, onReset }: {
  segment: ChordSegment;
  /** Beats from this chord's start to the end of its bar. */
  beatsInBar: number;
  onPreview: (soundingLabel: string) => void;
  /** The chord currently selected in the picker (screen name), so the popover can show it. */
  onSelect: (shown: string) => void;
  onSave: (soundingLabel: string) => Promise<void>;
  onLength: (length: ChordLength) => Promise<void>;
  onRemove: (fill: "next" | "previous") => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const { display, toSounding, capoShown, notation } = useActions();
  // Compare and build labels in canonical form; show them in the chosen notation.
  const shownCurrent = segment.label === "N" ? "N" : canonicalChord(display(segment.label));
  const fmt = (l: string) => (l === "N" ? "N.C." : formatChord(l, notation));
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
    onSelect(fmt(nextRoot + nextSuffix));
    onPreview(toSounding(nextRoot + nextSuffix));
  };
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    try { await action(); } finally { setSaving(false); }
  };

  const [tab, setTab] = useState<EditorTab>("pick");

  const tabButton = (value: EditorTab, text: string) => (
    <button
      onClick={() => setTab(value)}
      className={`pb-1.5 text-[12px] font-medium bg-transparent border-none cursor-pointer border-b-2 transition-colors ${
        tab === value
          ? "text-[var(--text-primary)] border-[var(--theme)]"
          : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]"
      }`}
      style={{ borderBottomStyle: "solid", borderBottomWidth: 2, borderBottomColor: tab === value ? "var(--theme)" : "transparent" }}
    >
      {text}
    </button>
  );
  // Light, text-like chips: only the selected one is filled.
  const chip = (active: boolean, extra = "") =>
    `h-[24px] px-2 rounded-full text-[12px] cursor-pointer border-none transition-colors ${extra} ${
      active
        ? "bg-[var(--theme)] text-white font-semibold"
        : "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]"
    }`;
  const sectionTitle = "text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-1";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Change this chord</span>
        {capoShown > 0 && <span className="text-[11px] text-[var(--text-muted)]">capo {capoShown} shapes</span>}
      </div>
      <div className="flex gap-4 mb-3 border-b border-[var(--border-subtle)]">
        {tabButton("pick", "Any chord")}
        {tabButton("timing", "Timing")}
      </div>

      <div className="flex-1 min-h-[214px]">
        {tab === "pick" && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className={sectionTitle}>Root</div>
              <div className="flex flex-wrap gap-0.5">
                {PICKER_ROOTS.map((r) => (
                  <button key={r} onClick={() => pick(r, suffix)} className={chip(!noChord && root === r, "min-w-[30px]")}>{r}</button>
                ))}
              </div>
            </div>
            {QUALITY_GROUPS.map((group) => (
              <div key={group.title}>
                <div className={sectionTitle}>{group.title}</div>
                <div className="flex flex-wrap gap-0.5">
                  {group.suffixes.map((q) => (
                    <button key={q} onClick={() => pick(root, q)} className={chip(!noChord && suffix === q)}>
                      {qualityLabel(q, notation)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={() => { setNoChord(true); onSelect("N"); }}
              className={`self-start ${chip(noChord)}`}
              title="Nothing playing here"
            >
              No chord (N.C.)
            </button>
          </div>
        )}

        {tab === "timing" && (
          <div className="flex flex-col gap-3">
            <div>
              <div className={sectionTitle}>Length · now {segment.beats} beat{segment.beats === 1 ? "" : "s"}</div>
              <div className="inline-flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    disabled={saving || n === segment.beats}
                    onClick={() => run(() => onLength(n))}
                    title={n > segment.beats ? `Hold for ${n} beats (replaces what follows)` : n < segment.beats ? `Shorten to ${n}; the next chord starts earlier` : "Current length"}
                    className={`w-[34px] py-[3px] rounded-[6px] text-[12px] font-medium border-none cursor-pointer transition-all disabled:cursor-default ${
                      n === segment.beats
                        ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                        : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {beatsInBar > 0 && beatsInBar !== segment.beats && (
                  <button
                    disabled={saving}
                    onClick={() => run(() => onLength("bar"))}
                    title="Hold until the end of the bar"
                    className="px-2.5 py-[3px] rounded-[6px] text-[12px] font-medium border-none cursor-pointer bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    to bar end
                  </button>
                )}
              </div>
              <div className="text-[10.5px] text-[var(--text-muted)] mt-1">Longer replaces the chords after it; shorter lets the next chord start earlier.</div>
            </div>
            <div>
              <div className={sectionTitle}>Remove this chord</div>
              <div className="flex flex-col gap-1">
                <button
                  disabled={saving}
                  onClick={() => run(() => onRemove("next"))}
                  className="text-left px-2.5 py-1.5 rounded-[7px] border-none bg-transparent hover:bg-[var(--bg)] cursor-pointer"
                >
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)]">Next chord starts here</span>
                  <span className="block text-[10.5px] text-[var(--text-muted)]">e.g. drop the first chord of a bar</span>
                </button>
                <button
                  disabled={saving}
                  onClick={() => run(() => onRemove("previous"))}
                  className="text-left px-2.5 py-1.5 rounded-[7px] border-none bg-transparent hover:bg-[var(--bg)] cursor-pointer"
                >
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)]">Previous chord carries on</span>
                  <span className="block text-[10.5px] text-[var(--text-muted)]">e.g. drop a stray chord in the middle</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-2.5 mt-2 border-t border-[var(--border-subtle)]">
        {tab !== "timing" && (
          <button
            onClick={() => run(() => onSave(chosen === "N" ? "N" : toSounding(chosen)))}
            disabled={saving || chosen === shownCurrent}
            className="h-[30px] px-4 rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium border-none cursor-pointer hover:opacity-85 disabled:opacity-35 disabled:cursor-default"
          >
            {chosen === shownCurrent ? "No change" : `Use ${fmt(chosen)}`}
          </button>
        )}
        {segment.edited && (
          <button
            onClick={() => run(async () => {
              await onReset();
            })}
            disabled={saving}
            title={`Put back what was detected on these beats (${shownDetected}). You can undo this too.`}
            className="ml-auto text-[11.5px] text-[var(--text-secondary)] bg-transparent border-none cursor-pointer hover:text-[var(--text-primary)] hover:underline"
          >
            Restore detected chord here
          </button>
        )}
      </div>
    </div>
  );
}

function ChordPopover({
  label, anchor, segment, fingeringBar, beatsInBar, capoFret, useCapo, onPlay, onEdit, onLength, onRemove, onReset, onClose,
}: {
  label: string;
  anchor: DOMRect;
  /** The bar this chord was opened in: fingering picks are saved for it. None = just browsing. */
  fingeringBar?: number;
  /** The specific chord in the song, when opened from one (enables editing). */
  segment?: ChordSegment;
  beatsInBar: number;
  capoFret: number;
  useCapo: boolean;
  onPlay: (label: string, how: "strum" | "arpeggio") => void;
  onEdit: (segment: ChordSegment, label: string) => Promise<void>;
  onLength: (segment: ChordSegment, length: ChordLength) => Promise<void>;
  onRemove: (segment: ChordSegment, fill: "next" | "previous") => Promise<void>;
  onReset: (segment: ChordSegment) => Promise<void>;
  onClose: () => void;
}) {
  const { display, toSounding, voicings, chooseVoicing, capoShown, notation } = useActions();
  const ref = useRef<HTMLDivElement>(null);
  // A chord picked in the editor (screen name) replaces the one shown, so its
  // fingering, sound and buttons follow the selection before it's saved.
  const [selected, setSelected] = useState<string | null>(null);
  const currentShown = display(label);
  const shapeLabel = selected ?? currentShown;
  const previewing = selected != null && selected !== currentShown;
  const soundingShown = shapeLabel === "N" ? "N" : toSounding(shapeLabel);
  // Opened from a chord in the song: the fingering pick is saved for that
  // bar only. Opened from the chord chart: just browsing, nothing is saved.
  const bar = fingeringBar;
  const saved = voicings(shapeLabel, bar);
  const all = saved.all;
  const [browseIndex, setBrowseIndex] = useState(0);
  const chosen = Math.min(bar != null ? saved.chosen : browseIndex, Math.max(0, all.length - 1));
  const shape = all[chosen];
  const playShape = (v: ChordShape | undefined) => {
    if (v) strum(shapeMidiNotes(v, capoShown), { direction: "down", spreadMs: 22, velocity: 0.7 });
  };
  const select = (index: number) => {
    if (bar != null) chooseVoicing(shapeLabel, index, bar);
    else setBrowseIndex(index);
    playShape(all[index]);
  };
  const step = (delta: number) => select((chosen + delta + all.length) % all.length);

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

  // Two columns when editing (diagram | editor) so it fits on screen.
  const width = segment ? 540 : 200;
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8);
  // Open below the chord when there's room, else above; then keep it inside
  // the window once its real height is known.
  const [top, setTop] = useState(anchor.bottom + 6);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    const above = anchor.top - 6 - h;
    const preferred = below + h <= window.innerHeight - 8 ? below : above;
    setTop(Math.max(8, Math.min(preferred, window.innerHeight - h - 8)));
  }, [anchor, segment, chosen]);

  const smallButton =
    "flex-1 px-2 py-[5px] rounded-[6px] border-[1.5px] border-[var(--border)] bg-transparent text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--theme)] hover:text-[var(--theme-text)] cursor-pointer transition-all";

  return (
    <div
      ref={ref}
      style={{ left, top, width }}
      className="fixed z-50 p-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(0,0,0,0.14)] flex gap-4"
    >
      {/* How to play it */}
      <div className="w-[176px] flex-shrink-0">
        <div className="flex items-baseline justify-between mb-1 gap-2">
          <span className="text-[18px] font-semibold text-[var(--text-primary)]">{shapeLabel === "N" ? "N.C." : shapeLabel}</span>
          <span className="text-[11px] text-[var(--text-muted)] text-right">
            {previewing && <span className="text-[var(--theme-text)]">preview · </span>}
            {useCapo && capoFret > 0 && shapeLabel !== "N" && <>capo {capoFret} · sounds {formatChord(canonicalChord(soundingShown), notation)}</>}
            {!previewing && segment?.edited && <>{useCapo ? " · " : ""}edited</>}
          </span>
        </div>
        {shape ? (
          <div className="flex flex-col items-center py-1">
            <ChordDiagram shape={shape} size={132} />
            {all.length > 1 && (
              <div className="flex items-center gap-1.5 mt-1">
                <button
                  onClick={() => step(-1)}
                  title="Previous fingering"
                  className="w-[24px] h-[22px] rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[#888] cursor-pointer flex items-center justify-center"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <span className="text-[10.5px] text-[var(--text-muted)] min-w-[104px] text-center tabular-nums">
                  {shape.kind}{shape.position > 0 ? ` · fret ${shape.position}` : ""} · {chosen + 1}/{all.length}
                </span>
                <button
                  onClick={() => step(1)}
                  title="Next fingering"
                  className="w-[24px] h-[22px] rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[#888] cursor-pointer flex items-center justify-center"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            )}
            <div className="flex flex-col items-center mt-1 gap-0.5">
              {chosen > 0 && (
                <button
                  onClick={() => select(0)}
                  title="Back to the first (default) fingering"
                  className="text-[10.5px] text-[var(--text-muted)] bg-transparent border-none cursor-pointer hover:underline"
                >
                  Use default fingering
                </button>
              )}
              <span className="text-[9.5px] text-[var(--text-muted)]">
                {bar != null ? `saved for bar ${bar + 1} only` : "browsing — not saved"}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-[var(--text-muted)] py-4 text-center">
            {shapeLabel === "N" ? "No chord" : "No diagram for this chord"}
          </div>
        )}
        {shapeLabel !== "N" && (
          <div className="flex gap-1.5 mt-2">
            <button onClick={() => onPlay(soundingShown, "strum")} className={smallButton}>Strum</button>
            <button onClick={() => onPlay(soundingShown, "arpeggio")} className={smallButton}>Note by note</button>
          </div>
        )}
      </div>

      {/* Correct it */}
      {segment && (
        <div className="flex-1 min-w-0 pl-4 border-l border-[var(--border-subtle)]">
          <ChordEditor
            key={`${segment.start_ms}:${segment.label}`}
            segment={segment}
            onPreview={(l) => onPlay(l, "strum")}
            beatsInBar={beatsInBar}
            onSelect={setSelected}
            onSave={async (l) => { await onEdit(segment, l); onClose(); }}
            onLength={async (n) => { await onLength(segment, n); onClose(); }}
            onRemove={async (fill) => { await onRemove(segment, fill); onClose(); }}
            onReset={async () => { await onReset(segment); onClose(); }}
          />
        </div>
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
// Tab — fingerstyle arrangement, one card per bar
// ---------------------------------------------------------------------------

const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];

/** Fingerpicked accompaniment from the chords, shown as tab one bar per card. */
function PickingView({ analysis, picking, pattern, onPattern, playhead, isPlaying }: {
  analysis: ChordAnalysis;
  picking: PickEvent[];
  pattern: PickPattern;
  onPattern: (p: PickPattern) => void;
  playhead: Playhead;
  isPlaying: boolean;
}) {
  const { seek, capoShown } = useActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const bars = analysis.bars ?? [];
  const chords = analysis.chords ?? [];
  const meter = analysis.time_signature?.beats_per_bar === 3 ? 3 : 4;
  const slots = meter * 2;
  useFollow(containerRef, playhead.bar >= 0 ? `[data-tab-bar="${playhead.bar}"]` : null, isPlaying);

  const eventsByBar = useMemo(() => {
    const map = new Map<number, Map<number, PickEvent>>();
    for (const ev of picking) {
      if (!map.has(ev.bar)) map.set(ev.bar, new Map());
      map.get(ev.bar)!.set(ev.slot, ev);
    }
    return map;
  }, [picking]);

  const pickedBars = bars.filter((b) => !b.pickup && !b.free && b.beats === meter);

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
          {PICK_PATTERNS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPattern(p.value)}
              title={p.hint}
              className={`px-3 py-[3px] rounded-[6px] text-[12px] font-medium cursor-pointer border-none transition-all ${
                pattern === p.value
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-[var(--text-muted)]">
          Fingerpicking the chords{capoShown ? ` · capo ${capoShown}` : ""} · <b className="font-semibold text-[var(--text-primary)]">bold</b> = thumb (bass) ·
          click a chord name to change its fingering
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-1.5">
        {pickedBars.map((bar) => {
          const isCurrent = bar.index === playhead.bar;
          const evs = eventsByBar.get(bar.index);
          // Chord names in this bar (a change mid-bar shows both).
          const inBar = Array.from(new Set(Array.from(evs?.values() ?? []).map((e) => e.chord)));
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
                {inBar.map((ci) => (
                  <ChordName
                    key={ci}
                    label={chords[ci].label}
                    index={ci}
                    scope={{ start: bar.start_ms, end: bar.end_ms }}
                    edited={chords[ci].edited}
                    className="text-[12.5px] font-semibold text-[var(--text-secondary)]"
                  />
                ))}
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
                              ? note.role === "bass"
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
  { value: "sheet", label: "Strumming" },
  { value: "tab", label: "Fingerpicking" },
];

/** Paste a chord chart you trust; preview where it lands, then apply it as one undoable step. */
function ImportChartDialog({ analysis, lines, onApply, onClose }: {
  analysis: ChordAnalysis;
  lines: Line[];
  onApply: (spans: { start_ms: number; end_ms: number; label: string }[]) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [applying, setApplying] = useState(false);
  const result = useMemo(() => (text.trim() ? placeChart(text, analysis, lines) : null), [text, analysis, lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changes = result?.spans.length ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[640px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(0,0,0,0.2)]"
      >
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
          <div className="text-[15px] font-semibold text-[var(--text-primary)]">Import a chord chart</div>
          <div className="text-[12px] text-[var(--text-muted)] leading-snug mt-1">
            Paste a chart you trust. Chords above lyrics or [C]inline chords are placed on your timed lyric lines;
            a chords-only chart is lined up with the detected chords. It's applied as one step — Undo edit removes it.
          </div>
        </div>
        <div className="px-5 py-3 flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={"Dmaj7        C#m7\n(lyric line)\n\nor  [Dmaj7](lyric)[C#m7](lyric)\nor  | Dmaj7 | C#m7 | F#m7 Em7 |"}
            className="w-full h-[220px] resize-y p-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] font-mono text-[12.5px] leading-[1.5] text-[var(--text-primary)] outline-none focus:border-[var(--theme)]"
          />
          {result && (
            <div className="text-[12px] leading-relaxed">
              {result.mode === "lyrics" ? (
                <div className="text-[var(--text-secondary)]">
                  <b className="text-[var(--text-primary)]">{result.matchedLines} of {result.chartLines}</b> chart lines found in the song ·{" "}
                  <b className="text-[var(--text-primary)]">{changes}</b> chord changes will be placed.
                </div>
              ) : (
                <div className="text-[var(--text-secondary)]">
                  Chords-only chart: <b className="text-[var(--text-primary)]">{result.chartLines}</b> chords lined up with the detected chords
                  ({changes} chords in the song will be renamed).
                </div>
              )}
              {result.unmatched.length > 0 && (
                <div className="mt-1.5 text-[var(--text-muted)]">
                  Not found in the song's lyrics (left as they are):
                  <ul className="mt-0.5 ml-4 list-disc">
                    {result.unmatched.slice(0, 6).map((l, i) => <li key={i} className="truncate">{l}</li>)}
                    {result.unmatched.length > 6 && <li>…and {result.unmatched.length - 6} more</li>}
                  </ul>
                </div>
              )}
              {result.unknownChords.length > 0 && (
                <div className="mt-1.5 text-[var(--text-muted)]">
                  Couldn't read: {result.unknownChords.slice(0, 10).join(", ")}{result.unknownChords.length > 10 ? " …" : ""}
                </div>
              )}
              {changes === 0 && (
                <div className="mt-1.5 text-red-500">Nothing to place yet — check the chart has chord names over lyrics or [brackets].</div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-[32px] px-4 rounded-[7px] border-[1.5px] border-[var(--border)] bg-transparent text-[12.5px] font-medium text-[var(--text-secondary)] hover:border-[#888] cursor-pointer"
          >
            Cancel
          </button>
          <button
            disabled={!result || changes === 0 || applying}
            onClick={async () => {
              if (!result) return;
              setApplying(true);
              try { await onApply(result.spans); onClose(); } finally { setApplying(false); }
            }}
            className="h-[32px] px-4 rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium border-none cursor-pointer hover:opacity-85 disabled:opacity-35 disabled:cursor-default"
          >
            {applying ? "Applying…" : `Apply ${changes || ""} chord${changes === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The song's tempo, with a menu of per-song analysis fixes: half / double
 * time, and analysing on separated instruments. Choices are saved per song
 * and the chords are re-analysed with them.
 */
function TempoButton({ bpm, corrected, busy, onSet, stems, onStems }: {
  bpm: number;
  corrected: boolean;
  busy: boolean;
  onSet: (hint: number | null) => void;
  stems: boolean;
  onStems: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const choose = (hint: number | null) => { setOpen(false); onSet(hint); };
  const item = "w-full text-left px-2.5 py-1.5 rounded-[6px] text-[12px] bg-transparent border-none cursor-pointer hover:bg-[var(--bg)] text-[var(--text-primary)]";

  return (
    <span ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="Tempo wrong? Fix half / double time"
        className="bg-transparent border-none p-0 cursor-pointer text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline decoration-dotted underline-offset-[3px] disabled:opacity-50"
      >
        {busy ? "re-analysing…" : `${Math.round(bpm)} BPM`}{corrected && !busy ? " ✓" : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-[22px] z-50 w-[210px] p-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
          <div className="px-2.5 pt-1 pb-1.5 text-[11px] text-[var(--text-muted)] leading-snug">
            Beat grid twice too fast or too slow? Pick the tempo you'd tap your foot to.
          </div>
          <button onClick={() => choose(Math.round(bpm / 2 * 10) / 10)} className={item}>
            Half time — {Math.round(bpm / 2)} BPM
          </button>
          <button onClick={() => choose(Math.round(bpm * 2 * 10) / 10)} className={item}>
            Double time — {Math.round(bpm * 2)} BPM
          </button>
          {corrected && (
            <button onClick={() => choose(null)} className={`${item} text-[var(--text-secondary)]`}>
              Back to automatic detection
            </button>
          )}
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <button
            onClick={() => { setOpen(false); onStems(!stems); }}
            className={`${item} flex items-start gap-2`}
          >
            <span className={`mt-[2px] w-[13px] h-[13px] rounded-[3px] border flex-shrink-0 flex items-center justify-center ${
              stems ? "bg-[var(--theme)] border-[var(--theme)] text-white" : "border-[var(--border)]"
            }`}>
              {stems && (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </span>
            <span className="leading-snug">
              Separate drums first
              <span className="block text-[10.5px] text-[var(--text-muted)]">
                For drum-heavy songs: chords from the instruments, beats from the drums, bass from the bass. First run takes about a minute.
              </span>
            </span>
          </button>
        </div>
      )}
    </span>
  );
}

// Per-machine guide preferences (conveniences only — fine to lose).
const GUIDE_PREFS_KEY = "reprise.playAlong.guide";

interface GuidePrefs {
  volume: number;        // 0..1
  offsetMs: number;      // play this much earlier than the detected beat
  instrument: GuitarInstrument;
  /** Chord-name style: Dmaj9 (standard) or DM7(9) (J-pop charts). */
  notation: ChordNotation;
  pickPattern: PickPattern;
  /** Chosen fingering per chord name: "E shape@3" etc. */
  voicings: Record<string, string>;
  prefsVersion?: number;
}

const DEFAULT_GUIDE_PREFS: GuidePrefs = {
  volume: 0.3, offsetMs: 0, instrument: "steel", notation: "standard", pickPattern: "travis", voicings: {},
};

function readGuidePrefs(): GuidePrefs {
  try {
    const raw = localStorage.getItem(GUIDE_PREFS_KEY);
    if (!raw) return DEFAULT_GUIDE_PREFS;
    const saved = JSON.parse(raw);
    // The old 60 ms default compensated for a beat grid that sat late in some
    // passages; beats are now aligned to the music, so an untouched old
    // default moves to the new one.
    if (!saved.prefsVersion && saved.offsetMs === 60) saved.offsetMs = DEFAULT_GUIDE_PREFS.offsetMs;
    return { ...DEFAULT_GUIDE_PREFS, ...saved, prefsVersion: 2 };
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
        <div className={label}>Chord names</div>
        <div className="flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
          {([["standard", "Dmaj9 · Dm7♭5"], ["jpop", "DM7(9) · Dm7(♭5)"]] as const).map(([value, text]) => (
            <button
              key={value}
              onClick={() => onChange({ ...prefs, notation: value })}
              className={`flex-1 px-2 py-[3px] rounded-[6px] text-[11.5px] font-medium cursor-pointer border-none ${
                prefs.notation === value
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "bg-transparent text-[var(--text-muted)]"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
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
  const [mode, setMode] = useState<Mode>("sheet");
  // Strumming and fingerpicking keep separate chord edits and fingering picks.
  const chordPath = song.chord_status === "done" ? song.chord_data_path : undefined;
  const reloadKey = `${song.chord_status}:${song.updated_at}`;
  const strumData = useChordData(chordPath, reloadKey, "strum");
  const pickData = useChordData(chordPath, reloadKey, "fingerstyle");
  const {
    analysis, isLoading, error, editChord, setChordLength, removeChord, resetChord, editCount, undoLastEdit, applySpans,
  } = mode === "tab" ? pickData : strumData;
  const enqueue = useTaskQueueStore((s) => s.enqueue);
  const queued = useTaskQueueStore((s) => s.tasks.some((t) => t.songId === song.id && t.type === "chords"));
  const [useCapoShapes, setUseCapoShapes] = useState(false); // capo off by default; one click shows capo shapes
  const [guideOn, setGuideOn] = useState(false);
  const [guidePrefs, setGuidePrefs] = useState<GuidePrefs>(readGuidePrefs);
  const [guideSettingsAnchor, setGuideSettingsAnchor] = useState<DOMRect | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [popover, setPopover] = useState<{
    label: string; anchor: DOMRect; index?: number; scope?: { start: number; end: number };
  } | null>(null);
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
  const capoAvailable = capoFret > 0;
  const capoShown = capoAvailable && useCapoShapes ? capoFret : 0;

  const songKey = analysis?.key;
  const notation = guidePrefs.notation;
  const display = useCallback(
    (label: string) =>
      label === "N"
        ? "N.C."
        : formatChord(capoShown ? capoShapeLabel(label, capoShown) : respell(canonicalChord(label), songKey), notation),
    [capoShown, songKey, notation],
  );
  const toSounding = useCallback(
    (shown: string) => (capoShown ? respell(soundingLabel(shown, capoShown), songKey) : shown),
    [capoShown, songKey],
  );

  // Fingering choices, saved per song (one spot, or every chord of a name).
  const strumFingerings = useFingerings(song.audio_folder, "strum");
  const pickFingerings = useFingerings(song.audio_folder, "fingerstyle");
  const fingerings = mode === "tab" ? pickFingerings : strumFingerings;
  const voicingKey = (v: ChordShape) => `${v.kind}@${v.position}`;
  const shapeOf = useCallback(
    (label: string) => (capoShown ? capoShapeLabel(label, capoShown) : label),
    [capoShown],
  );
  const indexOfKey = (all: ChordShape[], key: string | undefined) => {
    const i = key ? all.findIndex((v) => voicingKey(v) === key) : -1;
    return i >= 0 ? i : undefined;
  };
  /** Index of the bar a time falls in (undefined before the first bar / after the last). */
  const barOf = useCallback(
    (t: number | undefined) => {
      if (t == null) return undefined;
      const b = (analysis?.bars ?? []).find((x) => x.start_ms - 80 <= t && t < x.end_ms - 80);
      return b?.index;
    },
    [analysis],
  );

  const voicings = useCallback(
    (shown: string, bar?: number) => {
      const all = getChordVoicings(shown);
      const picked = bar != null ? indexOfKey(all, fingerings.lookup(bar, shown)) : undefined;
      return { all, chosen: picked ?? 0 };
    },
    [fingerings],
  );
  /** The fingering to use for a chord at a spot (as fingered: the capo shape when the capo is shown). */
  const voicingFor = useCallback(
    (label: string, atMs?: number): ChordShape | null => {
      const { all, chosen } = voicings(capoShown ? capoShapeLabel(label, capoShown) : label, barOf(atMs));
      return all[chosen] ?? null;
    },
    [voicings, capoShown, barOf],
  );

  /** Sounding notes for a chord: its chosen fingering, plus the capo when shapes are capo shapes. */
  const chordNotes = useCallback(
    (label: string, atMs?: number) => {
      const shape = voicingFor(label, atMs);
      return shape ? shapeMidiNotes(shape, capoShown) : [];
    },
    [voicingFor, capoShown],
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
    notation,
    voicings,
    chooseVoicing: (shown, index, bar) => {
      if (bar == null) return;
      const v = index != null ? getChordVoicings(shown)[index] : undefined;
      // The first fingering is the default: no need to store it.
      fingerings.choose(bar, shown, v && index !== 0 ? voicingKey(v) : null);
    },
    openChord: (label, anchor, index, scope) => {
      if (label !== "N") playChord(label);
      setPopover({ label, anchor: anchor.getBoundingClientRect(), index, scope });
    },
  }), [onSeek, display, toSounding, capoShown, notation, voicings, fingerings, playChord]);

  // Older fingering picks were saved by time; move them to their bars once.
  useEffect(() => {
    if (!analysis?.chords || Object.keys(fingerings.legacy).length === 0) return;
    const chords = analysis.chords;
    fingerings.migrate((at) => {
      const bar = barOf(at);
      const chord = chords.find((c) => c.start_ms - 80 <= at && at < c.end_ms);
      return bar != null && chord && chord.label !== "N" ? { bar, shown: shapeOf(chord.label) } : null;
    });
  }, [analysis, fingerings, barOf, shapeOf]);

  const picking = useMemo(
    () => (analysis ? buildPicking(analysis, guidePrefs.pickPattern, voicingFor, capoShown) : []),
    [analysis, guidePrefs.pickPattern, voicingFor, capoShown],
  );

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
    picking,
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
  const tempoCorrected = analysis.tuning?.tempo_hint != null;
  const setTempoHint = async (hint: number | null) => {
    if (!song.chord_data_path) return;
    await saveChordSettings(song.chord_data_path, { tempo_hint: hint });
    enqueue(song.id, song.title, "chords");
  };
  const usingStems = analysis.tuning?.use_stems === true;
  const setUseStems = async (on: boolean) => {
    if (!song.chord_data_path) return;
    await saveChordSettings(song.chord_data_path, { use_stems: on });
    enqueue(song.id, song.title, "chords");
  };
  const guideDisabled = false;

  // The chord the popup edits. Clicked inside a bar (Bars / Fingerpicking),
  // only the part of the chord within that bar is edited, so a chord that
  // carries over from the previous bar isn't changed there too.
  const popoverSegment: ChordSegment | undefined = (() => {
    if (!popover || popover.index == null || popover.index < 0) return undefined;
    const whole = chords[popover.index];
    if (!whole || !popover.scope) return whole;
    const start = Math.max(whole.start_ms, popover.scope.start);
    const end = Math.min(whole.end_ms, popover.scope.end);
    if (end <= start) return whole;
    const beatCount = (analysis.beats_ms ?? []).filter((t) => t >= start - 80 && t < end - 80).length;
    return { ...whole, start_ms: start, end_ms: end, beats: Math.max(1, beatCount) };
  })();

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
            <span className="text-[12px] text-[var(--text-muted)] whitespace-nowrap mr-2">
              {analysis.key && <>{analysis.key.name}<span className="mx-1.5">·</span></>}
              {analysis.tempo_bpm != null && (
                <TempoButton
                  bpm={analysis.tempo_bpm}
                  corrected={tempoCorrected}
                  busy={queued || processing}
                  onSet={setTempoHint}
                  stems={usingStems}
                  onStems={setUseStems}
                />
              )}
              {analysis.time_signature && (
                <><span className="mx-1.5">·</span>{analysis.time_signature.beats_per_bar}/{analysis.time_signature.beat_unit}</>
              )}
            </span>
            <button
              onClick={() => setImportOpen(true)}
              title="Paste a chord chart you trust and line it up with the song"
              className="h-[28px] px-2.5 rounded-[6px] text-[12px] font-medium border-[1.5px] border-[var(--border)] text-[var(--text-secondary)] bg-transparent hover:border-[#888] cursor-pointer whitespace-nowrap"
            >
              Import chart
            </button>
            {editCount > 0 && (
              <button
                onClick={() => void undoLastEdit()}
                title={`Undo your most recent chord change (${editCount} change${editCount === 1 ? "" : "s"} in this song)`}
                className="h-[28px] px-2.5 rounded-[6px] text-[12px] font-medium border-[1.5px] border-[var(--border)] text-[var(--text-secondary)] bg-transparent hover:border-[#888] cursor-pointer flex items-center gap-1 whitespace-nowrap"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
                </svg>
                Undo edit
              </button>
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
                  ? "Fingerpick the chords along with the song"
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
          {mode === "tab" && (
            <PickingView
              analysis={analysis}
              picking={picking}
              pattern={guidePrefs.pickPattern}
              onPattern={(p) => changeGuidePrefs({ ...guidePrefs, pickPattern: p })}
              playhead={playhead}
              isPlaying={isPlaying}
            />
          )}
        </div>

        {popover && (
          <ChordPopover
            label={popover.label}
            anchor={popover.anchor}
            segment={popoverSegment}
            fingeringBar={barOf(popoverSegment?.start_ms)}
            beatsInBar={(() => {
              const seg = popoverSegment;
              if (!seg) return 0;
              const bar = (analysis.bars ?? []).find((b) => b.start_ms <= seg.start_ms + 80 && seg.start_ms < b.end_ms);
              const beats = analysis.beats_ms ?? [];
              return bar ? beats.filter((t) => t >= seg.start_ms - 80 && t < bar.end_ms - 80).length : 0;
            })()}
            capoFret={capoFret}
            useCapo={capoShown > 0}
            onPlay={playChord}
            onEdit={editChord}
            onLength={setChordLength}
            onRemove={removeChord}
            onReset={resetChord}
            onClose={() => setPopover(null)}
          />
        )}
        {importOpen && (
          <ImportChartDialog
            analysis={analysis}
            lines={lines}
            onApply={applySpans}
            onClose={() => setImportOpen(false)}
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
