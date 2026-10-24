// Song workspace — one place to practise, mark up, group, time and record a song.
//
// The lyric sheet is the main surface, with a cursor line (and a caret /
// selection inside it) driven by the keyboard like a text editor. One
// transport plays the song for everything; the right panel holds takes and
// the selected line's details. Every lyric edit is undoable.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSongStore } from "../../stores/song-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useHistoryStore } from "../../stores/history-store";
import { useHighlightStore } from "../../lib/highlight-config";
import { useSymbolStore } from "../../lib/symbol-config";
import { useLinePlayer } from "../../hooks/use-line-player";
import { useWaveformData } from "../../hooks/use-waveform-data";
import { useAudioDevices } from "../../hooks/use-audio-devices";
import { loadVocalMap } from "../../lib/take-review";
import { nextWordBoundary } from "../../lib/lyric-edits";
import type { VocalMap } from "../../lib/vocal-map";
import { SongSetupPanel } from "../../components/song-setup-panel";
import { EditSongModal } from "../../components/edit-song-modal";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { useTaskQueueStore } from "../../stores/task-queue-store";
import { LyricSheet, fmtTiming, type Cursor, type SectionEdit } from "./lyric-sheet";
import { TransportBar } from "./transport-bar";
import { RecordDock, TakesPanel } from "./takes-panel";
import { LinePanel } from "./line-panel";
import { CommandPalette, ShortcutSheet, type Command } from "./command-palette";
import { PlayAlongView } from "./play-along-view";
import { KeyHints } from "./key-hints";
import { CoachPanel } from "./coach-panel";
import { debriefPrompt } from "../../lib/coach/persona";
import { describeTake, loadKnowledge, loadProfile, type SingerProfile, type SongKnowledge } from "../../lib/coach/knowledge";
import { useTakes, type Backing } from "./use-takes";
import { displayText, useWorkspaceEdits } from "./use-workspace-edits";
import type { Line, Section } from "../../types/song";

/** A callback whose identity never changes but always runs the latest version (keeps memoised rows still). */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

const EMPTY_MAP = new Map<string, string>();

/** After you touch the lyric sheet, playback stops scrolling it for this long. */
const FOLLOW_PAUSE_MS = 5000;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest("input, textarea, select, [contenteditable=true]");

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const song = useSongStore((s) => s.songs.find((x) => x.id === id));
  if (!song) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--text-muted)]">Song not found.</p>
      </div>
    );
  }
  return <Workspace key={song.id} songId={song.id} />;
}

function Workspace({ songId }: { songId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const song = useSongStore((s) => s.songs.find((x) => x.id === songId))!;
  const rawLines = useSongStore((s) => s.lines[songId]);
  const rawSections = useSongStore((s) => s.sections[songId]);
  const updateSong = useSongStore((s) => s.updateSong);
  const removeSong = useSongStore((s) => s.removeSong);
  const incrementPlayCount = useSongStore((s) => s.incrementPlayCount);
  const highlights = useHighlightStore((s) => s.highlights);
  const symbols = useSymbolStore((s) => s.symbols);
  const queueTasks = useTaskQueueStore((s) => s.tasks);
  const setScope = useHistoryStore((s) => s.setScope);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);
  useEffect(() => setScope(songId), [songId, setScope]);

  // ── Data ─────────────────────────────────────────────────────────────────
  const transLang = song.translation_language;
  const lines = useMemo(
    () => [...(rawLines ?? [])].filter((l) => !transLang || l.language !== transLang).sort((a, b) => a.order - b.order),
    [rawLines, transLang],
  );
  const translationLines = useMemo(
    () => (transLang ? (rawLines ?? []).filter((l) => l.language === transLang).sort((a, b) => a.order - b.order) : []),
    [rawLines, transLang],
  );
  // Translation per lyric line. Match by time first — translations fetched from
  // captions are split differently from the lyrics, so their numbering doesn't
  // line up — and fall back to the line number.
  const translationById = useMemo(() => {
    const m = new Map<string, string>();
    if (translationLines.length === 0) return m;
    const byOrder = new Map(translationLines.map((l) => [l.order, l.text]));
    const timed = translationLines.filter((t) => t.start_ms != null);
    for (const line of lines) {
      let text: string | undefined;
      if (line.start_ms != null && line.end_ms != null && timed.length) {
        const parts = timed
          .filter((t) => {
            const mid = (t.start_ms! + (t.end_ms ?? t.start_ms!)) / 2;
            return mid >= line.start_ms! - 150 && mid < line.end_ms!;
          })
          .map((t) => t.text.trim())
          .filter(Boolean);
        if (parts.length) text = parts.join(" ");
      }
      text ??= byOrder.get(line.order);
      if (text) m.set(line.id, text);
    }
    return m;
  }, [lines, translationLines]);
  const showTranslation = usePreferencesStore((s) => s.showTranslation);
  const setShowTranslation = usePreferencesStore((s) => s.setShowTranslation);
  const sections = useMemo(
    () => [...(rawSections ?? [])].sort((a, b) => a.start_line_order - b.start_line_order),
    [rawSections],
  );
  const sectionOf = useCallback(
    (line: Line | undefined | null) =>
      line ? sections.find((s) => line.order >= s.start_line_order && line.order <= s.end_line_order) ?? null : null,
    [sections],
  );

  // ── Player ───────────────────────────────────────────────────────────────
  const tracks = useMemo(() => {
    const t: { key: Backing; label: string; path: string }[] = [];
    if (song.audio_path) t.push({ key: "original", label: "Original", path: song.audio_path });
    if (song.vocals_path) t.push({ key: "vocal", label: "Vocal", path: song.vocals_path });
    if (song.instrumental_path) t.push({ key: "instrumental", label: "Inst.", path: song.instrumental_path });
    return t;
  }, [song.audio_path, song.vocals_path, song.instrumental_path]);
  const [track, setTrack] = useState<Backing>("original");
  const audioPath = tracks.find((t) => t.key === track)?.path ?? song.audio_path ?? "";

  const player = useLinePlayer({
    audioPath,
    lines,
    onLinePlayed: useCallback(
      (index: number) => {
        const line = lines[index];
        if (line) {
          incrementPlayCount(songId, line.id);
          usePreferencesStore.getState().touchLastPracticed(songId);
        }
      },
      [lines, songId, incrementPlayCount],
    ),
  });

  const [durationMs, setDurationMs] = useState(song.duration_ms ?? 0);
  useEffect(() => {
    const audio = player.audioRef.current;
    if (!audio) return;
    const onMeta = () => isFinite(audio.duration) && setDurationMs(Math.round(audio.duration * 1000));
    audio.addEventListener("loadedmetadata", onMeta);
    return () => audio.removeEventListener("loadedmetadata", onMeta);
  }, [player.audioRef]);
  const { peaks } = useWaveformData(song.audio_path ? convertFileSrc(song.audio_path) : undefined, undefined, undefined, 400, true);
  const nowMs = player.currentTime * 1000;
  const playingLineId = player.isPlaying ? lines[player.currentLineIndex]?.id ?? null : null;

  useEffect(() => {
    let cancelled = false;
    void loadKnowledge(song).then((k) => !cancelled && setKnowledge(k));
    void loadProfile().then((p) => !cancelled && setProfile(p));
    return () => {
      cancelled = true;
    };
  }, [song.id, song.audio_folder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Vocal map (long phrases, high notes) ─────────────────────────────────
  const [vocalMap, setVocalMap] = useState<VocalMap | null>(null);
  const [showHints, setShowHints] = useState(true);
  useEffect(() => {
    let cancelled = false;
    loadVocalMap(song)
      ?.then((m) => !cancelled && setVocalMap(m))
      .catch((err) => console.warn("[workspace] vocal map unavailable:", err));
    return () => {
      cancelled = true;
    };
  }, [song.pitch_data_path, song.vocals_path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cursor / editing state ──────────────────────────────────────────────
  const [cursor, setCursor] = useState<Cursor | null>(null);
  useEffect(() => {
    if (lines.length === 0) setCursor(null);
    else if (!cursor || !lines.some((l) => l.id === cursor.lineId)) setCursor({ lineId: lines[0].id, anchor: 0, focus: 0 });
  }, [lines, cursor]);
  const cursorIdx = cursor ? lines.findIndex((l) => l.id === cursor.lineId) : -1;
  const cursorLine = cursorIdx >= 0 ? lines[cursorIdx] : null;
  const cursorText = cursorLine ? displayText(cursorLine) : "";
  // Undo can shorten the line under the caret.
  const anchor = Math.min(cursor?.anchor ?? 0, cursorText.length);
  const focus = Math.min(cursor?.focus ?? 0, cursorText.length);
  const selStart = Math.min(anchor, focus);
  const selEnd = Math.max(anchor, focus);
  const cursorSection = sectionOf(cursorLine);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  /** Line whose note is being written (N with no take open). */
  const [noteLineId, setNoteLineId] = useState<string | null>(null);
  /** Bumped by N while a take is open: its note box takes focus. */
  const [noteFocusNonce, setNoteFocusNonce] = useState(0);
  /** The caret shows only once you work inside a line (←/→, Home/End, clicking into the text). */
  const [caretShown, setCaretShown] = useState(false);
  const [sectionEdit, setSectionEdit] = useState<SectionEdit | null>(null);
  const [view, setView] = useState<"lyrics" | "lead">("lyrics");
  const [modeTabsEl, setModeTabsEl] = useState<HTMLDivElement | null>(null);
  /** Slide-over side panel (closed by default so the lyrics stay centred). */
  const [panel, setPanel] = useState<"takes" | "line" | "coach" | null>(null);
  // Coach: what it knows about this song and about you (loaded from disk).
  const [knowledge, setKnowledge] = useState<SongKnowledge | null>(null);
  const [profile, setProfile] = useState<SingerProfile>({ facts: [] });
  const [coachRequest, setCoachRequest] = useState<{ text: string; nonce: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const setupOpen = searchParams.get("setup") === "1";
  const setSetupOpen = (open: boolean) => setSearchParams(open ? { setup: "1" } : {}, { replace: true });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Mic / speakers chosen in Settings.
  const audioDevices = useAudioDevices();
  useEffect(() => {
    const audio = player.audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (audio?.setSinkId && audioDevices.selectedOutputId) audio.setSinkId(audioDevices.selectedOutputId).catch(() => {});
  }, [audioDevices.selectedOutputId, player.audioRef]);

  const edits = useWorkspaceEdits(songId);
  const takes = useTakes({
    song,
    lines,
    sections,
    player,
    backing: track,
    originalPath: song.audio_path,
    inputDeviceId: audioDevices.selectedInputId,
  });

  // A freshly saved take opens the panel on its review.
  useEffect(() => {
    if (takes.reviewId) setPanel("takes");
  }, [takes.reviewId]);

  // Follow playback: keep the line being sung in view — but not while you're
  // working in the sheet (selecting, clicking, scrolling, moving with keys).
  const sheetRef = useRef<HTMLDivElement>(null);
  const lastInteractionRef = useRef(0);
  const markInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);
  useEffect(() => {
    if (!playingLineId) return;
    if (Date.now() - lastInteractionRef.current < FOLLOW_PAUSE_MS) return;
    const box = sheetRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-line-id="${playingLineId}"]`);
    if (!box || !el) return;
    // Centre the line, then one line higher, so more of what's coming next is visible.
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const top = box.scrollTop + (r.top - b.top) - box.clientHeight / 2 + r.height / 2 + r.height;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [playingLineId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const moveTo = useCallback(
    (line: Line | undefined, keepColumn = true) => {
      if (!line) return;
      const col = keepColumn && caretShown ? Math.min(focus, displayText(line).length) : 0;
      setCursor({ lineId: line.id, anchor: col, focus: col });
    },
    [focus, caretShown],
  );

  const sectionRange = useCallback(
    (sec: Section): [number, number] | null => {
      const idxs = lines.map((l, i) => (l.order >= sec.start_line_order && l.order <= sec.end_line_order ? i : -1)).filter((i) => i >= 0);
      return idxs.length ? [idxs[0], idxs[idxs.length - 1]] : null;
    },
    [lines],
  );

  const playLine = useCallback(
    (lineId: string) => {
      if (takes.busy) return;
      const idx = lines.findIndex((l) => l.id === lineId);
      if (idx >= 0) player.goToLine(idx, true);
    },
    [lines, player, takes.busy],
  );

  const loopLine = useCallback(() => {
    if (takes.busy) return;
    if (player.loopEnabled) {
      player.toggleLoop();
      player.setLoopRange(null);
      return;
    }
    player.setLoopRange(null);
    player.toggleLoop();
    if (cursorIdx >= 0) player.goToLine(cursorIdx, true);
  }, [player, cursorIdx, takes.busy]);

  const loopSection = useCallback(() => {
    if (takes.busy) return;
    if (!cursorSection) return say("This line isn't in a section — press # to start one.");
    const range = sectionRange(cursorSection);
    if (!range) return;
    player.setLoopRange(range);
    if (!player.loopEnabled) player.toggleLoop();
    player.goToLine(range[0], true);
  }, [player, cursorSection, sectionRange, say, takes.busy]);

  const annotate = useCallback(
    (n: number) => {
      const hl = highlights[n - 1];
      if (!cursorLine || !hl) return;
      if (selEnd <= selStart) {
        // A breath goes at a point: mark the character just before the caret.
        if (hl.id === "breath" && cursorText.length > 0) {
          const at = Math.max(0, Math.min(cursorText.length - 1, focus - 1));
          return void edits.annotate(cursorLine.id, at, at + 1, hl.id, hl.name);
        }
        return say("Select some words first — drag, or Shift+A / Shift+D");
      }
      edits.annotate(cursorLine.id, selStart, selEnd, hl.id, hl.name);
    },
    [highlights, cursorLine, cursorText, focus, selStart, selEnd, edits, say],
  );

  const clearMarks = useCallback(async () => {
    if (!cursorLine) return;
    const removed = await edits.clearAnnotations(cursorLine.id, selStart, selEnd);
    if (!removed) say(selEnd > selStart ? "No marks in the selection" : "No mark under the caret");
  }, [cursorLine, selStart, selEnd, edits, say]);

  const tapStart = useCallback(async () => {
    if (!cursorLine || takes.busy) return;
    const ms = Math.round(nowMs);
    const prev = lines[cursorIdx - 1];
    const next = lines[cursorIdx + 1];
    const changes: { lineId: string; start_ms?: number; end_ms?: number }[] = [];
    const end = cursorLine.end_ms != null && cursorLine.end_ms > ms
      ? cursorLine.end_ms
      : next?.start_ms != null && next.start_ms > ms ? next.start_ms : ms + 2000;
    changes.push({ lineId: cursorLine.id, start_ms: ms, end_ms: end });
    if (prev && (prev.end_ms == null || prev.end_ms > ms)) changes.push({ lineId: prev.id, end_ms: ms });
    await edits.setTiming(changes, "Set line start");
    say(`Line ${cursorIdx + 1} starts at ${fmtTiming(ms)}${next ? " — next line" : ""}`);
    if (next) moveTo(next, false);
  }, [cursorLine, cursorIdx, lines, nowMs, edits, moveTo, takes.busy, say]);

  // After a timing change, replay the line once (debounced) so you can hear the new edge.
  const playerRef = useRef(player);
  playerRef.current = player;
  const replayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const replaySoon = useCallback(
    (lineId: string) => {
      clearTimeout(replayTimer.current);
      replayTimer.current = setTimeout(() => {
        if (takes.busy) return;
        const p = playerRef.current;
        const idx = lines.findIndex((l) => l.id === lineId);
        if (idx >= 0) p.playLineOnce(idx);
      }, 450);
    },
    [lines, takes.busy],
  );
  useEffect(() => () => clearTimeout(replayTimer.current), []);

  const nudge = useCallback(
    async (field: "start_ms" | "end_ms", delta: number) => {
      if (!cursorLine || cursorLine[field] == null || takes.busy) return;
      const v = Math.max(0, cursorLine[field]! + delta);
      await edits.setTiming([{ lineId: cursorLine.id, [field]: v }], field === "start_ms" ? "Shift start" : "Shift end");
      say(`${field === "start_ms" ? "Start" : "End"} ${fmtTiming(v)} (${delta > 0 ? "+" : "−"}${Math.abs(delta)} ms) — replaying`);
      replaySoon(cursorLine.id);
    },
    [cursorLine, edits, say, replaySoon, takes.busy],
  );

  const startSectionEdit = useCallback(() => {
    if (!cursorLine) return;
    const starting = sections.find((s) => s.start_line_order === cursorLine.order);
    setSectionEdit(starting ? { mode: "rename", sectionId: starting.id } : { mode: "new", lineId: cursorLine.id });
  }, [cursorLine, sections]);

  const recordFromCursor = useCallback(
    (sectionOnly: boolean) => {
      if (takes.busy) return void takes.stop();
      if (takes.pending) return;
      if (sectionOnly) {
        if (!cursorSection) return say("This line isn't in a section — press # to start one.");
        const range = sectionRange(cursorSection);
        takes.start(range ? lines[range[0]] : cursorLine, cursorSection);
      } else {
        takes.start(cursorLine);
      }
    },
    [takes, cursorSection, sectionRange, lines, cursorLine, say],
  );

  /** Insert a vocal symbol (⤴, ~, …) at the caret, replacing any selection. */
  const insertSymbol = useCallback(
    async (char: string) => {
      setSymbolPickerOpen(false);
      if (!cursorLine) return;
      const next = cursorText.slice(0, selStart) + char + cursorText.slice(selEnd);
      await edits.editText(cursorLine.id, next);
      const pos = selStart + char.length;
      setCursor({ lineId: cursorLine.id, anchor: pos, focus: pos });
      setCaretShown(true);
    },
    [cursorLine, cursorText, selStart, selEnd, edits],
  );

  const doUndo = useCallback(async () => {
    const label = await undo();
    say(label ? `Undid: ${label}` : "Nothing to undo");
  }, [undo, say]);
  const doRedo = useCallback(async () => {
    const label = await redo();
    say(label ? `Redid: ${label}` : "Nothing to redo");
  }, [redo, say]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  // Left-hand layout (right hand stays on the mouse): W/S lines, A/D caret,
  // E play line, Q loop, R record, T timing, X unmark, C symbols, F edit,
  // Alt+W/S speed, Alt+A/D shift timing, Tab panels. Arrows / Enter / L / [ ] /
  // Delete / F2 / Ctrl+K / ? still work as alternates. Letters are matched by
  // physical key (e.code) so they work with an IME on.
  keyRef.current = (e: KeyboardEvent) => {
    if (paletteOpen || shortcutsOpen || editOpen || deleteOpen || setupOpen) return;
    if (isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const k = e.key;
    const letter = e.code.startsWith("Key") ? e.code.slice(3) : "";
    const handled = () => e.preventDefault();
    if (k !== " " && k !== "Enter") markInteraction();

    // Global
    if (ctrl && (letter === "E" || letter === "K")) return handled(), setPaletteOpen(true);
    if (ctrl && letter === "Z") return handled(), void (shift ? doRedo() : doUndo());
    if (ctrl && letter === "Y") return handled(), void doRedo();
    if (k === "F1" || k === "?") return handled(), setShortcutsOpen(true);
    if (k === "Tab" && !ctrl && !alt) {
      handled();
      const want = shift ? "line" : "takes";
      return setPanel((cur) => (cur === want ? null : want));
    }
    if (ctrl && letter === "J") return handled(), setPanel((v) => (v ? null : "takes"));
    if (letter === "R" && !ctrl && !alt) return handled(), recordFromCursor(shift);
    if (k === "Escape" && takes.countdown != null) return handled(), void takes.stop();

    // The lead sheet has its own keys (Space plays there).
    if (view === "lead") return;
    if (!cursorLine) return;
    if (symbolPickerOpen) {
      if (/^[1-9]$/.test(k) && symbols[Number(k) - 1]) return handled(), void insertSymbol(symbols[Number(k) - 1].char);
      if (k === "Escape" || letter === "C") return handled(), setSymbolPickerOpen(false);
    }
    const len = cursorText.length;
    const setSel = (a: number, f: number) => setCursor({ lineId: cursorLine.id, anchor: a, focus: f });

    const moveLine = (down: boolean, bySection: boolean) => {
      handled();
      setCaretShown(false);
      setSymbolPickerOpen(false);
      if (bySection) {
        const starts = sections.map((s) => lines.find((l) => l.order >= s.start_line_order)).filter(Boolean) as Line[];
        const target = down
          ? starts.find((l) => l.order > cursorLine.order)
          : [...starts].reverse().find((l) => l.order < cursorLine.order);
        return moveTo(target, false);
      }
      moveTo(lines[cursorIdx + (down ? 1 : -1)]);
    };
    const moveCaret = (right: boolean, extend: boolean, byWord: boolean) => {
      handled();
      setCaretShown(true);
      let f = byWord ? nextWordBoundary(cursorText, focus, right ? 1 : -1) : Math.max(0, Math.min(len, focus + (right ? 1 : -1)));
      if (!extend && selEnd > selStart && !byWord) f = right ? selEnd : selStart;
      setSel(extend ? anchor : f, f);
    };
    const changeSpeed = (faster: boolean) => {
      handled();
      if (takes.busy) return;
      if (faster) player.incrementSpeed();
      else player.decrementSpeed();
    };

    // Alt: timing (A/D, arrows) and speed (W/S)
    if (alt && !ctrl) {
      if (letter === "A" || k === "ArrowLeft") return handled(), void nudge(shift ? "end_ms" : "start_ms", -50);
      if (letter === "D" || k === "ArrowRight") return handled(), void nudge(shift ? "end_ms" : "start_ms", 50);
      if (letter === "W") return changeSpeed(true);
      if (letter === "S") return changeSpeed(false);
      return;
    }
    if (ctrl) {
      if (k === "Enter") return handled(), playLine(cursorLine.id);
      if (letter === "A") return handled(), setCaretShown(true), setSel(0, len);
      if (k === "ArrowUp" || k === "ArrowDown") return moveLine(k === "ArrowDown", true);
      if (k === "ArrowLeft" || k === "ArrowRight") return moveCaret(k === "ArrowRight", shift, true);
      return;
    }

    switch (k) {
      case "ArrowUp":
      case "ArrowDown":
        return moveLine(k === "ArrowDown", false);
      case "ArrowLeft":
      case "ArrowRight":
        return moveCaret(k === "ArrowRight", shift, false);
      case "Home":
      case "End": {
        handled();
        setCaretShown(true);
        const f = k === "Home" ? 0 : len;
        return setSel(shift ? anchor : f, f);
      }
      case " ":
        handled();
        if (!takes.busy) player.togglePlay();
        return;
      case "Enter":
        handled();
        return playLine(cursorLine.id);
      case "Escape":
        handled();
        if (selEnd > selStart) return setSel(focus, focus);
        if (panel) return setPanel(null);
        if (player.isPlaying && !takes.busy) player.pause();
        return;
      case "[":
        return changeSpeed(false);
      case "]":
        return changeSpeed(true);
      case "F2":
        handled();
        return setEditingLineId(cursorLine.id);
      case "#":
        handled();
        return startSectionEdit();
      case "Delete":
      case "Backspace":
      case "0":
        handled();
        return void clearMarks();
    }

    switch (letter) {
      case "W":
      case "S":
        return moveLine(letter === "S", shift);
      case "A":
      case "D":
        return moveCaret(letter === "D", shift, false);
      case "Q":
      case "L":
        handled();
        return shift ? loopSection() : loopLine();
      case "T":
        handled();
        return void tapStart();
      case "X":
        handled();
        return void clearMarks();
      case "C":
        if (!symbols.length) return;
        handled();
        setCaretShown(true);
        return setSymbolPickerOpen(true);
      case "F":
        handled();
        return setEditingLineId(cursorLine.id);
      case "G":
        handled();
        return setPanel((cur) => (cur === "coach" ? null : "coach"));
      case "N":
        handled();
        // A take is open: note a moment in it. Otherwise: note this line.
        if (panel === "takes" && takes.reviewRec) return setNoteFocusNonce((n) => n + 1);
        return setNoteLineId(cursorLine.id);
    }
    if (/^[1-9]$/.test(k) && !e.repeat) return handled(), annotate(Number(k));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Commands (palette) ───────────────────────────────────────────────────
  const commands: Command[] = useMemo(() => {
    const hasSel = selEnd > selStart;
    return [
      ...highlights.map((h, i) => ({
        id: `mark-${h.id}`,
        group: "Mark",
        label: `Mark selection as ${h.name}`,
        shortcut: i < 9 ? String(i + 1) : undefined,
        disabled: !hasSel,
        featured: true,
        run: () => {
          if (cursorLine) edits.annotate(cursorLine.id, selStart, selEnd, h.id, h.name);
        },
      })),
      { id: "unmark", group: "Mark", label: "Remove marks in selection", shortcut: "X", run: () => void clearMarks() },
      ...symbols.map((sym) => ({
        id: `sym-${sym.id}`,
        group: "Lyrics",
        label: `Insert ${sym.char} ${sym.label}`,
        shortcut: "C",
        run: () => void insertSymbol(sym.char),
      })),
      { id: "note", group: "Lyrics", label: panel === "takes" && takes.reviewRec ? "Note a moment in the open take" : "Write a note on this line", shortcut: "N", featured: true, run: () => (panel === "takes" && takes.reviewRec ? setNoteFocusNonce((n) => n + 1) : cursorLine && setNoteLineId(cursorLine.id)) },
      { id: "edit", group: "Lyrics", label: "Edit line text", shortcut: "F", featured: true, run: () => cursorLine && setEditingLineId(cursorLine.id) },
      { id: "section", group: "Lyrics", featured: true, label: cursorLine && sections.some((s) => s.start_line_order === cursorLine.order) ? "Rename this section" : "Start a section at this line", shortcut: "#", run: startSectionEdit },
      ...(cursorSection ? [{ id: "section-rm", group: "Lyrics", label: `Remove section “${cursorSection.name}”`, run: () => edits.removeSection(cursorSection) }] : []),
      { id: "lyrics", group: "Lyrics", label: "Import / paste lyrics…", run: () => navigate(`/song/${songId}/lyrics`) },
      { id: "hints", group: "View", label: showHints ? "Hide song hints (long phrases, high notes)" : "Show song hints (long phrases, high notes)", run: () => setShowHints((v) => !v) },
      { id: "view", group: "View", label: view === "lyrics" ? "Switch to lead sheet (chords)" : "Switch to lyrics", run: () => setView((v) => (v === "lyrics" ? "lead" : "lyrics")) },
      { id: "play", group: "Play", label: player.isPlaying ? "Pause" : "Play", shortcut: "Space", run: player.togglePlay },
      { id: "play-line", group: "Play", label: "Play from selected line", shortcut: "Ctrl+Enter", featured: true, run: () => cursorLine && playLine(cursorLine.id) },
      { id: "loop", group: "Play", label: player.loopEnabled ? "Stop looping" : "Loop selected line", shortcut: "Q", featured: true, run: loopLine },
      { id: "loop-sec", group: "Play", label: "Loop this section", shortcut: "Shift+Q", featured: true, disabled: !cursorSection, run: loopSection },
      ...tracks.map((t) => ({ id: `track-${t.key}`, group: "Play", label: `Play the ${t.label === "Inst." ? "instrumental" : t.label.toLowerCase()} track`, run: () => setTrack(t.key) })),
      { id: "tap", group: "Timing", label: "Line starts at the playhead", shortcut: "T", featured: true, run: () => void tapStart() },
      { id: "rec", group: "Record", label: "Record from selected line", shortcut: "R", featured: true, run: () => recordFromCursor(false) },
      { id: "rec-sec", group: "Record", label: "Record this section", shortcut: "Shift+R", featured: true, disabled: !cursorSection, run: () => recordFromCursor(true) },
      { id: "undo", group: "Edit", label: "Undo", shortcut: "Ctrl+Z", featured: true, disabled: !canUndo, run: () => void doUndo() },
      { id: "redo", group: "Edit", label: "Redo", shortcut: "Ctrl+Shift+Z", disabled: !canRedo, run: () => void doRedo() },
      { id: "setup", group: "Song", featured: true, label: "Audio setup (download, stems, pitch, chords, align)…", run: () => setSetupOpen(true) },
      { id: "details", group: "Song", label: "Edit song details…", run: () => setEditOpen(true) },
      { id: "panel-takes", group: "View", label: panel === "takes" ? "Hide takes" : "Show takes", shortcut: "Tab", featured: true, run: () => setPanel((v) => (v === "takes" ? null : "takes")) },
      { id: "coach", group: "Coach", label: panel === "coach" ? "Close the coach" : "Ask the coach about this song", shortcut: "G", featured: true, run: () => setPanel((v) => (v === "coach" ? null : "coach")) },
      { id: "panel-line", group: "View", label: "Line details (timing, melody, marks)", shortcut: "Shift+Tab", run: () => setPanel("line") },
      ...(translationLines.length
        ? [{ id: "translation", group: "View", label: showTranslation ? "Hide translation" : "Show translation", run: () => setShowTranslation(!showTranslation) }]
        : [{ id: "translation-add", group: "Lyrics", label: "Add a translation…", run: () => navigate(`/song/${songId}/lyrics`) }]),
      { id: "keys", group: "Help", label: "Keyboard shortcuts", shortcut: "F1", featured: true, run: () => setShortcutsOpen(true) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, selStart, selEnd, cursorLine, cursorSection, sections, view, showHints, panel, symbols, showTranslation, translationLines.length, player.isPlaying, player.loopEnabled, tracks, canUndo, canRedo, edits]);

  // Your take notes, placed under the lyric line they were sung on.
  const takeNotesByLine = useMemo(() => {
    const m = new Map<string, { key: string; text: string; when: string }[]>();
    for (const rec of takes.takes) {
      if (rec.song_start_ms == null || !rec.notes?.length) continue;
      const when = new Date(rec.created_at).toLocaleDateString([], { month: "short", day: "numeric" });
      for (const n of rec.notes) {
        const songMs = rec.song_start_ms + n.take_ms - (rec.analysis?.lag_ms ?? 0);
        let line: Line | undefined;
        for (const l of lines) {
          if (l.start_ms == null || l.start_ms > songMs + 200) continue;
          line = l;
        }
        if (!line) continue;
        const arr = m.get(line.id) ?? [];
        arr.push({ key: `${rec.id}:${n.id}`, text: n.text, when });
        m.set(line.id, arr);
      }
    }
    return m;
  }, [takes.takes, lines]);

  // ── Derived display ──────────────────────────────────────────────────────
  const loopLineIds = useMemo(() => {
    const ids = new Set<string>();
    if (player.loopEnabled && player.loopRange) {
      for (let i = player.loopRange[0]; i <= player.loopRange[1]; i++) if (lines[i]) ids.add(lines[i].id);
    }
    return ids;
  }, [player.loopEnabled, player.loopRange, lines]);
  const loopLabel = useMemo(() => {
    if (!player.loopRange) return null;
    const [a, b] = player.loopRange;
    const sec = sections.find((s) => {
      const r = sectionRange(s);
      return r && r[0] === a && r[1] === b;
    });
    return sec ? sec.name : `Lines ${a + 1}–${b + 1}`;
  }, [player.loopRange, sections, sectionRange]);

  const setupBusy = queueTasks.some((t) => t.songId === songId);
  const setupError = [song.download_status, song.stem_status, song.pitch_status, song.align_status, song.chord_status].includes("error");
  const audioReady = !!song.audio_path && song.download_status === "done";

  const onSelect = useCallback((lineId: string, a: number, f: number) => {
    markInteraction();
    setCursor({ lineId, anchor: a, focus: f });
    setCaretShown(true);
    setEditingLineId(null);
  }, [markInteraction]);
  const onCommitEdit = useStable((lineId: string, text: string) => {
    setEditingLineId(null);
    edits.editText(lineId, text.trim());
  });
  const onCancelEdit = useCallback(() => setEditingLineId(null), []);
  const onIssueClick = useStable(takes.playIssueYou);
  const onPlay = useStable(playLine);
  const onNudge = useStable(nudge);
  const onPickSymbol = useStable((char: string) => void insertSymbol(char));
  const onCloseSymbols = useStable(() => setSymbolPickerOpen(false));
  const onStartNote = useStable((lineId: string) => setNoteLineId(lineId));
  const onCommitNote = useStable((lineId: string, text: string) => {
    setNoteLineId(null);
    edits.setLineNote(lineId, text);
  });
  const onCancelNote = useStable(() => setNoteLineId(null));

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      <audio ref={player.audioRef} src={player.audioSrc} preload="metadata" />

      {/* Header */}
      <header className="h-[52px] px-4 flex items-center gap-3 bg-[var(--surface)] border-b border-[var(--border)] flex-shrink-0">
        <button
          onClick={() => navigate("/library")}
          title="Library"
          className="w-[30px] h-[30px] rounded-[7px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg)] bg-transparent border-none cursor-pointer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        {song.thumbnail_url && <img src={song.thumbnail_url} alt="" className="w-[36px] h-[24px] rounded-[4px] object-cover" />}
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium truncate leading-tight">{song.title}</div>
          <div className="text-[11px] text-[var(--text-muted)] truncate leading-tight">{song.artist}</div>
        </div>

        <div className="ml-4 flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
          {([["lyrics", "Lyrics"], ["lead", "Lead sheet"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-[3px] rounded-[6px] text-[12px] font-medium border-none cursor-pointer ${
                view === v ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "lyrics" && vocalMap && (
          <button
            onClick={() => setShowHints((v) => !v)}
            title="Mark the song's highest notes and long phrases (from the original vocal)"
            className={`px-[8px] py-[3px] text-[11px] font-medium rounded-[6px] border cursor-pointer ${
              showHints ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-transparent" : "bg-transparent text-[var(--text-muted)] border-[var(--border)]"
            }`}
          >
            Song hints
          </button>
        )}
        {view === "lyrics" && translationLines.length > 0 && (
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            title="Show the translation under each line"
            className={`px-[8px] py-[3px] text-[11px] font-medium rounded-[6px] border cursor-pointer ${
              showTranslation ? "bg-[var(--theme-light)] text-[var(--theme-text)] border-transparent" : "bg-transparent text-[var(--text-muted)] border-[var(--border)]"
            }`}
          >
            Translation
          </button>
        )}
        <div ref={setModeTabsEl} className={view === "lead" ? "" : "hidden"} />

        <div className="ml-auto flex items-center gap-2">
          {view === "lyrics" && (
            <div className="flex p-[2px] rounded-[8px] bg-[var(--bg)] border border-[var(--border)]">
              {([["takes", `Takes${takes.takes.length ? ` · ${takes.takes.length}` : ""}`], ["line", "Line"], ["coach", "Coach"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setPanel((cur) => (cur === v ? null : v))}
                  title={v === "takes" ? "Your takes and their reviews (Tab)" : v === "line" ? "Timing, melody and marks of the selected line (Shift+Tab)" : "Your vocal coach for this song (G)"}
                  className={`px-3 py-[3px] rounded-[6px] text-[12px] font-medium border-none cursor-pointer ${
                    panel === v ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 px-3 py-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text-muted)] hover:border-[#888] cursor-pointer"
          >
            Commands <kbd className="font-sans text-[10.5px]">Ctrl E</kbd>
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts (F1)"
            className="w-[28px] h-[28px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            ?
          </button>
          <button
            onClick={() => setSetupOpen(true)}
            className="relative flex items-center gap-[6px] px-3 py-[5px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12px] text-[var(--text-secondary)] hover:border-[#888] cursor-pointer"
          >
            {(setupBusy || setupError) && (
              <span className={`w-[7px] h-[7px] rounded-full ${setupError ? "bg-red-500" : "bg-amber-500 animate-pulse"}`} />
            )}
            Setup
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-[28px] h-[28px] rounded-[7px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-[calc(100%+6px)] z-40 w-[190px] p-1 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] shadow-lg"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {[
                  ["Edit song details…", () => setEditOpen(true)],
                  ["Import / paste lyrics…", () => navigate(`/song/${songId}/lyrics`)],
                  ...(translationLines.length === 0 ? [["Add a translation…", () => navigate(`/song/${songId}/lyrics`)]] : []),
                  ["Delete song…", () => setDeleteOpen(true)],
                ].map(([label, fn]) => (
                  <button
                    key={label as string}
                    onClick={() => {
                      setMenuOpen(false);
                      (fn as () => void)();
                    }}
                    className={`w-full text-left px-3 py-[6px] text-[12.5px] rounded-[5px] bg-transparent border-none cursor-pointer hover:bg-[var(--bg)] ${
                      (label as string).startsWith("Delete") ? "text-red-600" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <TransportBar
        player={player}
        durationMs={durationMs}
        peaks={peaks}
        lines={lines}
        sections={sections}
        cursorLineId={cursorLine?.id ?? null}
        tracks={tracks}
        track={track}
        onTrack={setTrack}
        loopLabel={loopLabel}
        onClearLoopRange={() => player.setLoopRange(null)}
        disabled={takes.busy || !audioReady}
      />

      <div className="relative flex flex-1 min-h-0">
        {/* Center */}
        <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
        <div
          ref={sheetRef}
          onMouseDown={markInteraction}
          onWheel={markInteraction}
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ scrollbarWidth: "thin" }}
        >
          {!audioReady && (
            <div className="mx-auto max-w-[760px] mt-5 px-4 py-3 rounded-[9px] border border-amber-300/60 bg-amber-50/60 text-[12.5px] text-amber-800 flex items-center gap-3">
              <span className="flex-1">The song's audio isn't downloaded yet{song.download_status === "downloading" ? " — downloading now…" : "."}</span>
              <button onClick={() => setSetupOpen(true)} className="font-medium text-amber-900 bg-transparent border-none cursor-pointer hover:underline">
                Open setup
              </button>
            </div>
          )}
          {view === "lead" ? (
            <PlayAlongView
              song={song}
              lines={lines}
              translationLines={translationLines}
              audioRef={player.audioRef}
              isPlaying={player.isPlaying}
              onTogglePlay={player.togglePlay}
              onSeek={player.seekTo}
              modeTabsContainer={modeTabsEl}
            />
          ) : lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 gap-3 text-center">
              <p className="text-[15px] text-[var(--text-primary)]">No lyrics yet</p>
              <p className="text-[12.5px] text-[var(--text-muted)] max-w-[340px] leading-relaxed">
                Fetch them from the video's captions or paste them in — sections like [Chorus] are picked up automatically.
              </p>
              <button
                onClick={() => navigate(`/song/${songId}/lyrics`)}
                className="mt-2 px-4 py-[7px] rounded-[7px] bg-[var(--accent)] text-white text-[13px] font-medium hover:opacity-80 border-none cursor-pointer"
              >
                Add lyrics
              </button>
            </div>
          ) : (
            <div className="mx-auto max-w-[760px] px-6 pt-4">
              <LyricSheet
                lines={lines}
                sections={sections}
                translationById={showTranslation ? translationById : EMPTY_MAP}
                highlights={highlights}
                vocalMap={vocalMap}
                showHints={showHints}
                cursor={cursor ? { ...cursor, anchor, focus } : null}
                editingLineId={editingLineId}
                sectionEdit={sectionEdit}
                playingLineId={playingLineId}
                loopLineIds={loopLineIds}
                showCaret={caretShown}
                issuesByLine={takes.issuesByLine}
                onSelect={onSelect}
                onStartEdit={setEditingLineId}
                onCommitEdit={onCommitEdit}
                onCancelEdit={onCancelEdit}
                onPlay={onPlay}
                onIssueClick={onIssueClick}
                onNudge={onNudge}
                symbols={symbols}
                takeNotesByLine={takeNotesByLine}
                songCard={knowledge?.card ?? null}
                onOpenCoach={() => setPanel("coach")}
                noteLineId={noteLineId}
                onStartNote={onStartNote}
                onCommitNote={onCommitNote}
                onCancelNote={onCancelNote}
                symbolPickerOpen={symbolPickerOpen}
                onPickSymbol={onPickSymbol}
                onCloseSymbols={onCloseSymbols}
                onSectionClick={(sec) => {
                  const first = lines.find((l) => l.order >= sec.start_line_order);
                  moveTo(first, false);
                }}
                onSectionEdit={setSectionEdit}
                onCommitNewSection={(lineId, name) => {
                  setSectionEdit(null);
                  const line = lines.find((l) => l.id === lineId);
                  if (line && name.trim()) edits.createSection(sections, lines, line.order, name.trim());
                }}
                onCommitRename={(sec, name) => {
                  setSectionEdit(null);
                  if (!name.trim()) edits.removeSection(sec);
                  else edits.renameSection(sec, name.trim());
                }}
                onRemoveSection={(sec) => edits.removeSection(sec)}
              />
            </div>
          )}
        </div>
        {view === "lyrics" && lines.length > 0 && (
          <div className="pointer-events-none absolute left-0 right-0 bottom-[46px] flex justify-center px-4 z-10">
            <RecordDock
              t={takes}
              song={song}
              lines={lines}
              startLine={cursorLine}
              cursorSection={cursorSection}
              backingLabel={tracks.find((t) => t.key === track)?.label ?? "Original"}
            />
          </div>
        )}
        <KeyHints
          mode={
            takes.busy
              ? "recording"
              : editingLineId || sectionEdit || noteLineId
                ? "editing"
                : view === "lead"
                  ? "lead"
                  : selEnd > selStart
                    ? "selection"
                    : "idle"
          }
          highlights={highlights}
          breathKey={(() => {
            const i = highlights.findIndex((h) => h.id === "breath");
            return i >= 0 && i < 9 ? i + 1 : null;
          })()}
          onMark={annotate}
          onShowAll={() => setShortcutsOpen(true)}
        />
        </div>

        {/* Side panel — slides over the lyrics, so they stay centred when it's closed */}
        {view === "lyrics" && panel && (
          <aside className="absolute right-0 top-0 bottom-0 z-20 w-[420px] max-w-full flex flex-col min-h-0 border-l border-[var(--border)] bg-[var(--surface)] shadow-[-12px_0_32px_rgba(0,0,0,0.08)] animate-fade-up">
            <div className="flex items-center gap-2 px-4 py-[10px] flex-shrink-0 border-b border-[var(--border-subtle)]">
              <span className="text-[12.5px] font-medium">{panel === "takes" ? "Takes" : panel === "line" ? "Line details" : "Coach"}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{panel === "takes" ? "Tab" : panel === "line" ? "Shift+Tab" : "G"}</span>
              <button
                onClick={() => setPanel(null)}
                title="Close (Esc)"
                className="ml-auto w-[26px] h-[26px] rounded-[7px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {panel === "takes" ? (
              <TakesPanel
                t={takes}
                song={song}
                lines={lines}
                sections={sections}
                noteFocusNonce={noteFocusNonce}
                onAskCoach={(rec) => {
                  setCoachRequest({ text: debriefPrompt(describeTake(rec, lines)), nonce: Date.now() });
                  setPanel("coach");
                }}
              />
            ) : panel === "coach" ? (
              <CoachPanel
                song={song}
                lines={lines}
                translationById={translationById}
                sections={sections}
                highlights={highlights}
                takes={takes.takes}
                knowledge={knowledge}
                setKnowledge={setKnowledge}
                profile={profile}
                setProfile={setProfile}
                request={coachRequest}
                onApplyLineNote={(idx, note) => {
                  const line = lines[idx];
                  if (!line) return;
                  edits.setLineNote(line.id, line.note ? `${line.note} · ${note}` : note);
                }}
              />
            ) : (
              <LinePanel
                song={song}
                line={cursorLine}
                index={cursorIdx}
                total={lines.length}
                section={cursorSection}
                highlights={highlights}
                player={player}
                issues={cursorLine ? takes.issuesByLine.get(cursorLine.id) ?? [] : []}
                onNudge={onNudge}
                onTapStart={() => void tapStart()}
                onRemoveAnnotation={(i) => {
                  const a = cursorLine?.annotations?.[i];
                  if (cursorLine && a) edits.clearAnnotations(cursorLine.id, a.start, a.end);
                }}
                onIssueClick={onIssueClick}
              />
            )}
          </aside>
        )}
      </div>

      {/* Overlays */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-[7px] rounded-[8px] bg-[#111] text-white text-[12.5px] shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} highlightNames={highlights.map((h) => h.name)} />}
      {setupOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onMouseDown={() => setSetupOpen(false)}>
          <div
            className="w-full max-w-[640px] h-full overflow-y-auto bg-[var(--bg)] border-l border-[var(--border)] shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-[var(--surface)] border-b border-[var(--border)]">
              <span className="text-[13px] font-medium">Audio setup</span>
              <button
                onClick={() => setSetupOpen(false)}
                className="px-3 py-[5px] rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium border-none cursor-pointer hover:opacity-80"
              >
                Done
              </button>
            </div>
            <SongSetupPanel songId={songId} />
          </div>
        </div>
      )}
      <EditSongModal
        open={editOpen}
        song={song}
        onSave={(data) => {
          updateSong(songId, data);
          setEditOpen(false);
        }}
        onClose={() => setEditOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete this song?"
        message="Its lyrics, marks, sections and takes are removed from the library — this can't be undone. Audio files on disk stay where they are."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          setDeleteOpen(false);
          await removeSong(songId);
          navigate("/library");
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
