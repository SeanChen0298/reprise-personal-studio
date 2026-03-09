import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Line, Annotation, Section } from "../../types/song";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import { STATUS_CONFIG, formatMs } from "../../lib/status-config";
import { useSongStore } from "../../stores/song-store";
import { useHighlightStore } from "../../lib/highlight-config";
import { useSymbolStore } from "../../lib/symbol-config";
import { AnnotatedText } from "../../components/annotated-text";
import { PitchCurve } from "../../components/pitch-curve";
import { Waveform } from "../../components/waveform";
import { usePitchData } from "../../hooks/use-pitch-data";
import { useWaveformData } from "../../hooks/use-waveform-data";
import { useRecorder } from "../../hooks/use-recorder";
import { usePreferencesStore } from "../../stores/preferences-store";
import { playRecordingWithGain, type RecordingPlaybackHandle } from "../../lib/play-recording";
import { remove } from "@tauri-apps/plugin-fs";
import { FloatingToolbar } from "../../components/floating-toolbar";

interface RecordingScope {
  lineId: string;
  startIdx: number;
  endIdx: number;
  section?: Section;
}

interface Props {
  lines: Line[];
  translationLines?: Line[];
  activeLineIndex: number;
  player: UseLinePlayerReturn;
  songId: string;
  songFolder: string;
  bpm?: number;
  inputDeviceId?: string;
  pitchDataPath?: string;
  canAnalyzePitch?: boolean;
  activeSection?: Section | null;
  recordingSection?: Section | null;
  loopRange?: [number, number] | null;
  skipCountdown?: boolean;
  recordThrough?: boolean;
  onEditModeChange?: (editing: boolean) => void;
}

export function PracticeCenter({
  lines, translationLines, activeLineIndex, player, songId, songFolder, bpm, inputDeviceId,
  pitchDataPath, canAnalyzePitch, activeSection, recordingSection,
  loopRange, skipCountdown, recordThrough,
  onEditModeChange,
}: Props) {
  const updateLineCustomText = useSongStore((s) => s.updateLineCustomText);
  const updateLineAnnotations = useSongStore((s) => s.updateLineAnnotations);
  const addRecording = useSongStore((s) => s.addRecording);
  const analyzeSongPitch = useSongStore((s) => s.analyzeSongPitch);
  const highlights = useHighlightStore((s) => s.highlights);
  const symbols = useSymbolStore((s) => s.symbols);
  const recorder = useRecorder();

  const currentLine = lines[activeLineIndex];
  const prevLine = lines[activeLineIndex - 1];
  const nextLineData = lines[activeLineIndex + 1];

  // Translation support
  const [showTranslation, setShowTranslation] = useState(true);
  const translationByOrder = useMemo(() => {
    if (!translationLines || translationLines.length === 0) return new Map<number, string>();
    return new Map(translationLines.map((l) => [l.order, l.text]));
  }, [translationLines]);
  const hasTranslation = translationByOrder.size > 0;

  // Lines within the active section
  const sectionLines = useMemo(() => {
    if (!activeSection) return null;
    return lines.filter(
      (l) => l.order >= activeSection.start_line_order && l.order <= activeSection.end_line_order
    );
  }, [activeSection, lines]);
  const hasTimestamps = currentLine?.start_ms != null && currentLine?.end_ms != null;
  const pitchData = usePitchData(pitchDataPath, currentLine?.start_ms, currentLine?.end_ms);
  const showWaveform = usePreferencesStore((s) => s.showWaveform);
  const waveform = useWaveformData(
    showWaveform ? (player.audioSrc || undefined) : undefined,
    currentLine?.start_ms,
    currentLine?.end_ms,
  );

  const [editMode, setEditMode] = useState(false);
  const [playBacking, setPlayBacking] = useState(true);
  const recordingLineIdRef = useRef<string | null>(null);
  const recordingSectionRef = useRef<Section | null>(null);
  const recordingEndLineIdx = useRef<number>(-1);

  // Countdown state
  const [countdownActive, setCountdownActive] = useState(false);
  const [countdownBeat, setCountdownBeat] = useState(0);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [editText, setEditText] = useState("");
  const [editAnnotations, setEditAnnotations] = useState<Annotation[]>([]);
  const editableRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Floating toolbar position for inline editing
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelectionOverAnnotation, setHasSelectionOverAnnotation] = useState(false);
  const editWrapperRef = useRef<HTMLDivElement>(null);

  // Retry: last recording scope and file path
  const [lastRecordingScope, setLastRecordingScope] = useState<RecordingScope | null>(null);
  const [lastRecordingFilePath, setLastRecordingFilePath] = useState<string | null>(null);
  const [feedbackPlaying, setFeedbackPlaying] = useState(false);
  const feedbackHandleRef = useRef<RecordingPlaybackHandle | null>(null);

  // Recording timer
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Input level meter
  const [inputLevel, setInputLevel] = useState(0);
  const levelRafRef = useRef<number>(0);

  // Tail buffer timeout
  const tailBufferRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When active line changes during edit mode, save current edits and load new line
  const prevLineIndexRef = useRef(activeLineIndex);
  useEffect(() => {
    if (prevLineIndexRef.current !== activeLineIndex && editMode) {
      const prevLine2 = lines[prevLineIndexRef.current];
      if (prevLine2) {
        updateLineCustomText(songId, prevLine2.id, editText);
        updateLineAnnotations(songId, prevLine2.id, editAnnotations);
      }
      if (currentLine) {
        setEditText(currentLine.custom_text ?? currentLine.text);
        setEditAnnotations(currentLine.annotations ?? []);
      }
    }
    prevLineIndexRef.current = activeLineIndex;
  }, [activeLineIndex, editMode, currentLine, lines, songId, editText, editAnnotations, updateLineCustomText, updateLineAnnotations]);

  // Clear recording feedback when user navigates to a different line
  useEffect(() => {
    if (lastRecordingScope && activeLineIndex !== lastRecordingScope.startIdx) {
      setLastRecordingScope(null);
      setLastRecordingFilePath(null);
      feedbackHandleRef.current?.stop();
      feedbackHandleRef.current = null;
      setFeedbackPlaying(false);
      player.setAdvancePaused(false);
    }
  }, [activeLineIndex, lastRecordingScope, player]);

  // Recording timer — count up while recording
  useEffect(() => {
    if (recorder.isRecording) {
      setRecordingElapsed(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsed((v) => v + 100);
      }, 100);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecordingElapsed(0);
    }
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [recorder.isRecording]);

  // Input level meter — RAF loop while recording
  useEffect(() => {
    if (recorder.isRecording) {
      const tick = () => {
        setInputLevel(recorder.getInputLevel());
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(levelRafRef.current);
      setInputLevel(0);
    }
    return () => cancelAnimationFrame(levelRafRef.current);
  }, [recorder.isRecording, recorder.getInputLevel]);

  const enterEditMode = useCallback(() => {
    if (!currentLine) return;
    setEditText(currentLine.custom_text ?? currentLine.text);
    setEditAnnotations(currentLine.annotations ?? []);
    setToolbarPos(null);
    setEditMode(true);
    onEditModeChange?.(true);
    // Focus the input after render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [currentLine, onEditModeChange]);

  const exitEditMode = useCallback(() => {
    if (!currentLine) return;
    updateLineCustomText(songId, currentLine.id, editText);
    updateLineAnnotations(songId, currentLine.id, editAnnotations);
    setEditMode(false);
    setToolbarPos(null);
    onEditModeChange?.(false);
  }, [currentLine, songId, editText, editAnnotations, updateLineCustomText, updateLineAnnotations, onEditModeChange]);

  const handleApplyHighlight = useCallback(
    (typeId: string) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editableRef.current) return;
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(editableRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;
      if (start === end || start < 0 || end > editText.length) return;
      const filtered = editAnnotations.filter(
        (a) => a.end <= start || a.start >= end
      );
      const newAnnotation: Annotation = { start, end, type: typeId };
      const updated = [...filtered, newAnnotation].sort((a, b) => a.start - b.start);
      setEditAnnotations(updated);
      sel.removeAllRanges();
    },
    [editText, editAnnotations]
  );

  const handleRemoveAnnotation = useCallback(
    (annotationIndex: number) => {
      setEditAnnotations((prev) => prev.filter((_, i) => i !== annotationIndex));
    },
    []
  );

  const handleEditTextChange = useCallback((newText: string) => {
    setEditText(newText);
    setEditAnnotations([]);
  }, []);

  const handleInsertSymbol = useCallback((char: string) => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? editText.length;
    const end = input.selectionEnd ?? start;
    const newText = editText.slice(0, start) + char + editText.slice(end);
    handleEditTextChange(newText);
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + char.length;
      input.setSelectionRange(pos, pos);
    });
  }, [editText, handleEditTextChange]);

  // Show floating toolbar when text is selected in the preview area
  const handlePreviewMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !editableRef.current) {
      setToolbarPos(null);
      return;
    }
    // Check if selection is within our editable ref
    if (!editableRef.current.contains(sel.anchorNode)) {
      setToolbarPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top });

    // Check if selection overlaps an existing annotation
    const preRange = document.createRange();
    preRange.selectNodeContents(editableRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    const overlaps = editAnnotations.some(
      (a) => a.start < end && a.end > start
    );
    setHasSelectionOverAnnotation(overlaps);
  }, [editAnnotations]);

  // Remove annotations overlapping the current selection
  const handleRemoveSelectedAnnotation = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !editableRef.current) return;
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(editableRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    setEditAnnotations((prev) =>
      prev.filter((a) => a.end <= start || a.start >= end)
    );
    sel.removeAllRanges();
    setToolbarPos(null);
  }, []);

  // Close toolbar and clear selection
  const handleToolbarClose = useCallback(() => {
    setToolbarPos(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // Handle highlight from floating toolbar — apply and close
  const handleToolbarHighlight = useCallback((typeId: string) => {
    handleApplyHighlight(typeId);
    setToolbarPos(null);
  }, [handleApplyHighlight]);

  // Handle symbol insert from floating toolbar
  const handleToolbarSymbol = useCallback((char: string) => {
    handleInsertSymbol(char);
    setToolbarPos(null);
  }, [handleInsertSymbol]);

  // Click-outside to exit edit mode
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: MouseEvent) => {
      if (editWrapperRef.current && !editWrapperRef.current.contains(e.target as Node)) {
        exitEditMode();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitEditMode();
    };
    // Delay to avoid catching the double-click that opened edit mode
    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", escHandler);
    });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [editMode, exitEditMode]);

  // Metronome beep helper
  const playTick = useCallback((accent: boolean) => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.value = accent ? 0.3 : 0.15;
    osc.start(ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.stop(ctx.currentTime + 0.08);
  }, []);

  // Start recording immediately (no countdown)
  const startRecordingImmediate = useCallback((
    lineId: string,
    startLineIdx: number,
    endLineIdx: number,
    section?: Section,
  ) => {
    player.pause();
    player.setAdvancePaused(true);
    player.goToLine(startLineIdx, false);
    recordingLineIdRef.current = lineId;
    recordingSectionRef.current = section ?? null;
    recordingEndLineIdx.current = endLineIdx;
    setLastRecordingScope({ lineId, startIdx: startLineIdx, endIdx: endLineIdx, section });

    recorder.startRecording(lineId, songFolder, inputDeviceId || undefined).then(() => {
      if (playBacking) player.play();
    });
  }, [player, recorder, songFolder, inputDeviceId, playBacking]);

  // Start countdown then record
  const startCountdownThenRecord = useCallback((
    lineId: string,
    startLineIdx: number,
    endLineIdx: number,
    section?: Section,
  ) => {
    player.pause();
    if (skipCountdown) {
      startRecordingImmediate(lineId, startLineIdx, endLineIdx, section);
      return;
    }

    const effectiveBpm = bpm ?? 80;
    const totalBeats = 4;
    const beatInterval = 60000 / effectiveBpm;
    let beat = 0;

    setCountdownActive(true);
    setCountdownBeat(totalBeats);
    player.goToLine(startLineIdx, false);
    playTick(true);

    countdownTimerRef.current = setInterval(() => {
      beat++;
      if (beat >= totalBeats) {
        clearInterval(countdownTimerRef.current!);
        countdownTimerRef.current = null;
        setCountdownActive(false);
        setCountdownBeat(0);

        player.setAdvancePaused(true);
        recordingLineIdRef.current = lineId;
        recordingSectionRef.current = section ?? null;
        recordingEndLineIdx.current = endLineIdx;
        setLastRecordingScope({ lineId, startIdx: startLineIdx, endIdx: endLineIdx, section });

        recorder.startRecording(lineId, songFolder, inputDeviceId || undefined).then(() => {
          if (playBacking) player.play();
        });
      } else {
        const remaining = totalBeats - beat;
        setCountdownBeat(remaining);
        playTick(remaining % 4 === 0);
      }
    }, beatInterval);
  }, [bpm, player, playTick, recorder, songFolder, inputDeviceId, playBacking, skipCountdown, startRecordingImmediate]);

  // Cancel countdown
  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownActive(false);
    setCountdownBeat(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (tailBufferRef.current) clearTimeout(tailBufferRef.current);
    };
  }, []);

  // Save recording helper
  const saveRecording = useCallback(async (sectionId?: string) => {
    if (tailBufferRef.current) {
      clearTimeout(tailBufferRef.current);
      tailBufferRef.current = null;
    }

    const result = await recorder.stopRecording();
    if (result) {
      addRecording(songId, {
        id: crypto.randomUUID(),
        line_id: result.lineId,
        song_id: songId,
        file_path: result.filePath,
        duration_ms: result.durationMs,
        is_master_take: false,
        is_best_take: false,
        section_id: sectionId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setLastRecordingFilePath(result.filePath);
    }
    recordingLineIdRef.current = null;
    recordingSectionRef.current = null;
    recordingEndLineIdx.current = -1;
    player.pause();
    return result;
  }, [recorder, addRecording, songId, player]);

  // Auto-stop recording when line/section ends — with 500ms tail buffer
  useEffect(() => {
    if (!recorder.isRecording || !recordingLineIdRef.current) return;
    if (recordThrough) return; // Record-through mode: never auto-stop

    const endIdx = recordingEndLineIdx.current;
    const isAtEnd = endIdx >= 0
      ? (activeLineIndex > endIdx || (activeLineIndex === endIdx && player.lineProgress >= 1))
      : player.lineProgress >= 1;

    if (isAtEnd && !tailBufferRef.current) {
      tailBufferRef.current = setTimeout(() => {
        tailBufferRef.current = null;
        saveRecording(recordingSectionRef.current?.id);
      }, 500);
    }
  }, [recorder.isRecording, player.lineProgress, activeLineIndex, saveRecording, recordThrough]);

  // Compute effective recording scope based on loopRange
  const getRecordingScope = useCallback((): RecordingScope | null => {
    if (!currentLine || !hasTimestamps || !songFolder) return null;
    if (loopRange) {
      const startLine = lines[loopRange[0]];
      if (!startLine || startLine.start_ms == null) return null;
      return { lineId: startLine.id, startIdx: loopRange[0], endIdx: loopRange[1] };
    }
    return { lineId: currentLine.id, startIdx: activeLineIndex, endIdx: activeLineIndex };
  }, [currentLine, hasTimestamps, songFolder, loopRange, lines, activeLineIndex]);

  const handleRecord = useCallback(async (shiftHeld = false) => {
    if (countdownActive) {
      cancelCountdown();
      return;
    }
    if (recorder.isRecording) {
      await saveRecording(recordingSectionRef.current?.id);
      return;
    }

    const scope = getRecordingScope();
    if (!scope) return;

    if (shiftHeld || skipCountdown) {
      startRecordingImmediate(scope.lineId, scope.startIdx, scope.endIdx, scope.section);
    } else {
      startCountdownThenRecord(scope.lineId, scope.startIdx, scope.endIdx, scope.section);
    }
  }, [countdownActive, cancelCountdown, recorder.isRecording, saveRecording, getRecordingScope, skipCountdown, startRecordingImmediate, startCountdownThenRecord]);

  // Feedback loop: play back the last recording with gain boost
  const handleFeedbackPlayback = useCallback(() => {
    if (!lastRecordingFilePath) return;
    // Stop any in-progress playback
    feedbackHandleRef.current?.stop();
    feedbackHandleRef.current = null;
    setFeedbackPlaying(false);

    playRecordingWithGain(lastRecordingFilePath, () => {
      setFeedbackPlaying(false);
      feedbackHandleRef.current = null;
    })
      .then((handle) => {
        feedbackHandleRef.current = handle;
        setFeedbackPlaying(true);
      })
      .catch(() => {
        setFeedbackPlaying(false);
      });
  }, [lastRecordingFilePath]);

  // Feedback loop: discard take and retry
  const handleRetryWithDelete = useCallback(async () => {
    if (!lastRecordingScope || recorder.isRecording || countdownActive) return;
    feedbackHandleRef.current?.stop();
    feedbackHandleRef.current = null;
    setFeedbackPlaying(false);
    const pathToDelete = lastRecordingFilePath;
    setLastRecordingFilePath(null);
    if (pathToDelete) remove(pathToDelete).catch(() => {});
    const { lineId, startIdx, endIdx, section } = lastRecordingScope;
    startCountdownThenRecord(lineId, startIdx, endIdx, section);
  }, [lastRecordingScope, lastRecordingFilePath, recorder.isRecording, countdownActive, startCountdownThenRecord]);

  // Feedback loop: accept take and advance to next line
  const handleFeedbackNext = useCallback(() => {
    feedbackHandleRef.current?.stop();
    feedbackHandleRef.current = null;
    setFeedbackPlaying(false);
    setLastRecordingScope(null);
    setLastRecordingFilePath(null);
    player.setAdvancePaused(false);
    player.nextLine();
  }, [player]);

  // Handle section recording from transport
  const handleRecordSection = useCallback(() => {
    if (!activeSection || recorder.isRecording || countdownActive) return;
    const startIdx = lines.findIndex((l) => l.order >= activeSection.start_line_order);
    const endIdx = lines.findIndex((l) => l.order > activeSection.end_line_order) - 1;
    const actualEnd = endIdx < 0 ? lines.length - 1 : endIdx;
    if (startIdx < 0 || !lines[startIdx]) return;
    const startLine = lines[startIdx];
    if (startLine.start_ms == null) return;
    startCountdownThenRecord(startLine.id, startIdx, actualEnd, activeSection);
  }, [activeSection, recorder.isRecording, countdownActive, lines, startCountdownThenRecord]);

  // Handle section recording (called from LineNavigator via prop)
  useEffect(() => {
    if (!recordingSection || recorder.isRecording || countdownActive) return;
    const startIdx = lines.findIndex((l) => l.order >= recordingSection.start_line_order);
    const endIdx = lines.findIndex((l) => l.order > recordingSection.end_line_order) - 1;
    const actualEnd = endIdx < 0 ? lines.length - 1 : endIdx;
    if (startIdx < 0 || !lines[startIdx]) return;
    const startLine = lines[startIdx];
    if (startLine.start_ms == null) return;
    startCountdownThenRecord(startLine.id, startIdx, actualEnd, recordingSection);
  }, [recordingSection, recorder.isRecording, countdownActive, lines, startCountdownThenRecord]);

  // Keyboard shortcut: R to record
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editMode) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "KeyR") {
        e.preventDefault();
        if (recorder.isRecording) {
          saveRecording(recordingSectionRef.current?.id).then(() => {
            setTimeout(() => handleRetryWithDelete(), 50);
          });
        } else if (lastRecordingFilePath && lastRecordingScope && !countdownActive) {
          handleRetryWithDelete();
        } else {
          handleRecord(e.shiftKey);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editMode, recorder.isRecording, saveRecording, handleRecord, handleRetryWithDelete, lastRecordingFilePath, lastRecordingScope, countdownActive]);

  if (!currentLine) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--text-muted)] text-[14px]">No lines to practice.</p>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[currentLine.status];
  const displayText = currentLine.custom_text ?? currentLine.text;
  const hasCustomText = currentLine.custom_text != null && currentLine.custom_text !== currentLine.text;
  const showFeedback = lastRecordingFilePath && lastRecordingScope && !recorder.isRecording && !countdownActive;
  const showSectionRecord = activeSection && !recorder.isRecording && !countdownActive && !showFeedback;

  const elapsedSec = recordingElapsed / 1000;
  const elapsedMin = Math.floor(elapsedSec / 60);
  const elapsedSecStr = Math.floor(elapsedSec % 60).toString().padStart(2, "0");
  const elapsedTenths = Math.floor((recordingElapsed % 1000) / 100);

  // Main view (playback + inline editing)
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8 relative overflow-hidden">
      {/* Countdown overlay */}
      {countdownActive && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
          <div className="text-[72px] font-bold text-white tabular-nums animate-pulse">
            {countdownBeat}
          </div>
        </div>
      )}

      {sectionLines ? (
        <div className="text-center my-5 max-w-[640px] w-full">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--theme-text)] mb-4">
            {activeSection!.name}
          </div>
          <div className="flex flex-col gap-[6px]">
            {sectionLines.map((line) => {
              const isActive = line.id === currentLine?.id;
              const lineDisplay = line.custom_text ?? line.text;
              const lineIdx = lines.findIndex((l) => l.id === line.id);

              if (isActive && editMode) {
                return (
                  <div key={line.id} ref={editWrapperRef} className="mx-auto max-w-[600px] w-full">
                    <input
                      ref={inputRef}
                      type="text"
                      value={editText}
                      onChange={(e) => handleEditTextChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") exitEditMode(); }}
                      className="w-full px-3 py-1 text-[18px] font-serif rounded-[6px] border-2 border-[var(--theme)] bg-[var(--surface)] text-[var(--text-primary)] outline-none text-center"
                    />
                    <div
                      ref={editableRef}
                      onMouseUp={handlePreviewMouseUp}
                      className="font-serif text-[24px] tracking-[-0.3px] leading-[1.4] mt-2 p-2 rounded-[6px] border border-dashed border-[var(--border)] bg-[var(--bg)] select-text cursor-text text-center"
                    >
                      <AnnotatedText
                        text={editText}
                        annotations={editAnnotations}
                        highlights={highlights}
                        onClickAnnotation={handleRemoveAnnotation}
                      />
                    </div>
                    <button
                      onClick={exitEditMode}
                      className="mt-1 text-[10px] font-medium text-[var(--theme)] hover:underline cursor-pointer bg-transparent border-none"
                    >
                      ✓ Done
                    </button>
                    {toolbarPos && (
                      <FloatingToolbar
                        position={toolbarPos}
                        highlights={highlights}
                        symbols={symbols}
                        onHighlight={handleToolbarHighlight}
                        onInsertSymbol={handleToolbarSymbol}
                        onRemoveAnnotation={hasSelectionOverAnnotation ? handleRemoveSelectedAnnotation : undefined}
                        onClose={handleToolbarClose}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div key={line.id}>
                  <div
                    className={`font-serif tracking-[-0.3px] leading-[1.4] transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "text-[28px] text-[var(--text-primary)] hover:text-[var(--theme)]"
                        : "text-[20px] text-[var(--text-muted)] opacity-40 hover:opacity-70"
                    }`}
                    onClick={() => player.playLineOnce(lineIdx)}
                    onDoubleClick={isActive ? (e) => { e.stopPropagation(); enterEditMode(); } : undefined}
                    title={isActive ? "Click to preview · Double-click to edit" : "Click to preview this line"}
                  >
                    {!line.custom_text && line.furigana_html ? (
                      <span dangerouslySetInnerHTML={{ __html: line.furigana_html }} />
                    ) : (
                      <AnnotatedText
                        text={lineDisplay}
                        annotations={line.annotations}
                        highlights={highlights}
                      />
                    )}
                  </div>
                  {showTranslation && translationByOrder.has(line.order) && (
                    <div className={`font-sans leading-relaxed text-[var(--text-muted)] ${isActive ? "text-[14px] opacity-65 mt-1" : "text-[12px] opacity-40 mt-0.5"}`}>
                      {translationByOrder.get(line.order)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-3 mt-[10px]">
            {hasTimestamps && (
              <span className="text-[11.5px] text-[var(--text-muted)] flex items-center gap-1 tabular-nums">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatMs(currentLine.start_ms!)} — {formatMs(currentLine.end_ms!)}
              </span>
            )}
            <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
              Line {activeLineIndex + 1} of {lines.length}
            </span>
            <span
              className="text-[10.5px] font-medium px-[9px] py-[2px] rounded-[20px]"
              style={{ background: cfg.tagBg, color: cfg.tagColor }}
            >
              {cfg.label}
            </span>
            {!editMode && (
              <button
                onClick={enterEditMode}
                className="w-6 h-6 rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
                title="Edit annotations"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            {hasTranslation && (
              <button
                onClick={() => setShowTranslation((v) => !v)}
                title={showTranslation ? "Hide translation" : "Show translation"}
                className={`w-6 h-6 rounded-[5px] border bg-transparent cursor-pointer flex items-center justify-center transition-all ${
                  showTranslation
                    ? "border-[var(--theme)] text-[var(--theme-text)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)]"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 8l6 6 6-6" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            className={`text-center max-w-[600px] my-[6px] opacity-35 ${prevLine ? "cursor-pointer hover:opacity-60 transition-opacity" : ""}`}
            onClick={() => prevLine && player.playLineOnce(activeLineIndex - 1)}
            title={prevLine ? "Click to preview this line" : undefined}
          >
            <div className="font-serif text-[20px] tracking-[-0.3px] text-[var(--text-muted)] leading-relaxed">
              {prevLine ? (
                !prevLine.custom_text && prevLine.furigana_html ? (
                  <span dangerouslySetInnerHTML={{ __html: prevLine.furigana_html }} />
                ) : (
                  <AnnotatedText
                    text={prevLine.custom_text ?? prevLine.text}
                    annotations={prevLine.annotations}
                    highlights={highlights}
                  />
                )
              ) : "\u00A0"}
            </div>
            {prevLine && showTranslation && translationByOrder.has(prevLine.order) && (
              <div className="text-[13px] text-[var(--text-muted)] font-sans leading-relaxed mt-0.5">
                {translationByOrder.get(prevLine.order)}
              </div>
            )}
          </div>

          <div key={activeLineIndex} className="text-center my-5 animate-fade-up">
            {editMode ? (
              /* Inline editor */
              <div ref={editWrapperRef} className="max-w-[640px] mx-auto">
                {currentLine.custom_text !== currentLine.text && currentLine.custom_text != null && (
                  <div className="text-[11px] text-[var(--text-muted)] opacity-50 mb-2">
                    Original: {currentLine.text}
                  </div>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={editText}
                  onChange={(e) => handleEditTextChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") exitEditMode(); }}
                  className="w-full px-4 py-2 text-[20px] font-serif rounded-[8px] border-2 border-[var(--theme)] bg-[var(--surface)] text-[var(--text-primary)] outline-none shadow-[0_0_0_3px_rgba(37,99,235,0.1)] text-center"
                  placeholder="Edit lyrics..."
                />
                <div
                  ref={editableRef}
                  onMouseUp={handlePreviewMouseUp}
                  className="font-serif text-[28px] tracking-[-0.5px] leading-[1.35] text-[var(--text-primary)] mt-3 p-2 rounded-[8px] border border-dashed border-[var(--border)] bg-[var(--bg)] min-h-[44px] select-text cursor-text"
                >
                  <AnnotatedText
                    text={editText}
                    annotations={editAnnotations}
                    highlights={highlights}
                    onClickAnnotation={handleRemoveAnnotation}
                  />
                </div>
                <div className="text-[9.5px] text-[var(--text-muted)] mt-1 opacity-60">
                  Select text above to highlight · Click highlight to remove
                </div>
                <button
                  onClick={exitEditMode}
                  className="mt-2 text-[11px] font-medium text-[var(--theme)] hover:underline cursor-pointer bg-transparent border-none"
                >
                  ✓ Done
                </button>
                {/* Floating toolbar */}
                {toolbarPos && (
                  <FloatingToolbar
                    position={toolbarPos}
                    highlights={highlights}
                    symbols={symbols}
                    onHighlight={handleToolbarHighlight}
                    onInsertSymbol={handleToolbarSymbol}
                    onRemoveAnnotation={hasSelectionOverAnnotation ? handleRemoveSelectedAnnotation : undefined}
                    onClose={handleToolbarClose}
                  />
                )}
              </div>
            ) : (
              /* Normal lyrics display */
              <>
                {hasCustomText && (
                  <div className="text-[14px] text-[var(--text-muted)] mb-2 opacity-50">
                    {currentLine.text}
                  </div>
                )}
                <div
                  className="font-serif text-[32px] tracking-[-0.5px] leading-[1.35] text-[var(--text-primary)] max-w-[640px] cursor-pointer hover:text-[var(--theme)] transition-colors"
                  onClick={() => player.playLineOnce(activeLineIndex)}
                  onDoubleClick={(e) => { e.stopPropagation(); enterEditMode(); }}
                  title="Click to preview · Double-click to edit"
                >
                  {!hasCustomText && currentLine.furigana_html ? (
                    <span dangerouslySetInnerHTML={{ __html: currentLine.furigana_html }} />
                  ) : (
                    <AnnotatedText
                      text={displayText}
                      annotations={currentLine.annotations}
                      highlights={highlights}
                    />
                  )}
                </div>
                {showTranslation && translationByOrder.has(currentLine.order) && (
                  <div className="text-[15px] text-[var(--text-muted)] font-sans leading-relaxed mt-2 opacity-70">
                    {translationByOrder.get(currentLine.order)}
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-center gap-3 mt-[10px]">
              {hasTimestamps && (
                <span className="text-[11.5px] text-[var(--text-muted)] flex items-center gap-1 tabular-nums">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {formatMs(currentLine.start_ms!)} — {formatMs(currentLine.end_ms!)}
                </span>
              )}
              <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
                Line {activeLineIndex + 1} of {lines.length}
              </span>
              <span
                className="text-[10.5px] font-medium px-[9px] py-[2px] rounded-[20px]"
                style={{ background: cfg.tagBg, color: cfg.tagColor }}
              >
                {cfg.label}
              </span>
              {!editMode && (
                <button
                  onClick={enterEditMode}
                  className="w-6 h-6 rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-muted)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] transition-all"
                  title="Edit annotations"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              {hasTranslation && (
                <button
                  onClick={() => setShowTranslation((v) => !v)}
                  title={showTranslation ? "Hide translation" : "Show translation"}
                  className={`w-6 h-6 rounded-[5px] border bg-transparent cursor-pointer flex items-center justify-center transition-all ${
                    showTranslation
                      ? "border-[var(--theme)] text-[var(--theme-text)]"
                      : "border-[var(--border)] text-[var(--text-muted)] hover:border-[#888] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 8l6 6 6-6" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div
            className={`text-center max-w-[600px] my-[6px] opacity-50 ${nextLineData ? "cursor-pointer hover:opacity-75 transition-opacity" : ""}`}
            onClick={() => nextLineData && player.playLineOnce(activeLineIndex + 1)}
            title={nextLineData ? "Click to preview this line" : undefined}
          >
            <div className="font-serif text-[20px] tracking-[-0.3px] text-[var(--text-muted)] leading-relaxed">
              {nextLineData ? (
                !nextLineData.custom_text && nextLineData.furigana_html ? (
                  <span dangerouslySetInnerHTML={{ __html: nextLineData.furigana_html }} />
                ) : (
                  <AnnotatedText
                    text={nextLineData.custom_text ?? nextLineData.text}
                    annotations={nextLineData.annotations}
                    highlights={highlights}
                  />
                )
              ) : "\u00A0"}
            </div>
            {nextLineData && showTranslation && translationByOrder.has(nextLineData.order) && (
              <div className="text-[13px] text-[var(--text-muted)] font-sans leading-relaxed mt-0.5">
                {translationByOrder.get(nextLineData.order)}
              </div>
            )}
          </div>
        </>
      )}

      {/* Waveform + Pitch curve */}
      {hasTimestamps && (
        <div className="w-full max-w-[560px] mt-6 flex flex-col gap-[6px]">
          {showWaveform && (
            <Waveform
              peaks={waveform.peaks}
              progress={player.lineProgress}
              onSeek={player.seekWithinLine}
            />
          )}
          <PitchCurve
            points={pitchData.points}
            progress={player.lineProgress}
            onSeek={player.seekWithinLine}
            startMs={currentLine.start_ms!}
            endMs={currentLine.end_ms!}
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] tabular-nums mt-1">
            <span>{formatMs(currentLine.start_ms!)}</span>
            {pitchData.points.length === 0 && canAnalyzePitch && (
              <button
                onClick={() => analyzeSongPitch(songId)}
                className="text-[10px] text-[var(--theme)] hover:underline cursor-pointer bg-transparent border-none flex items-center gap-1"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                Analyze pitch
              </button>
            )}
            <span>{formatMs(currentLine.end_ms!)}</span>
          </div>
        </div>
      )}

      {/* Recording info: timer + level meter */}
      {recorder.isRecording && (
        <div className="flex items-center gap-3 mt-4">
          <div className="flex items-end gap-[2px] h-[20px]">
            {[0.15, 0.3, 0.45, 0.6, 0.75].map((threshold, i) => (
              <div
                key={i}
                className="w-[3px] rounded-[1px] transition-all duration-75"
                style={{
                  height: `${4 + i * 3.5}px`,
                  backgroundColor: inputLevel >= threshold
                    ? (i >= 4 ? "#DC2626" : i >= 3 ? "#F59E0B" : "#22C55E")
                    : "var(--border)",
                }}
              />
            ))}
          </div>
          <span className="text-[12px] text-[#DC2626] font-medium tabular-nums">
            {elapsedMin}:{elapsedSecStr}.{elapsedTenths}
          </span>
          <span className="text-[10px] text-[#DC2626] opacity-60 uppercase tracking-wider">
            REC
          </span>
        </div>
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-3 mt-7">
        <button
          onClick={player.prevLine}
          disabled={activeLineIndex === 0}
          className="w-10 h-10 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="19 20 9 12 19 4 19 20" />
            <line x1="5" y1="19" x2="5" y2="5" />
          </svg>
        </button>

        <button
          onClick={player.togglePlay}
          className="w-14 h-14 rounded-full bg-[var(--accent)] text-white cursor-pointer flex items-center justify-center hover:opacity-85 hover:scale-105 transition-all border-none"
        >
          {player.isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 2 }}>
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Record */}
        <button
          onClick={(e) => handleRecord(e.shiftKey)}
          disabled={!hasTimestamps || editMode}
          title={
            countdownActive ? "Cancel countdown" :
            recorder.isRecording ? "Stop recording" :
            loopRange ? `Record lines ${loopRange[0] + 1}–${loopRange[1] + 1}` :
            "Record this line (R)"
          }
          className={`w-14 h-14 rounded-full bg-[#DC2626] text-white flex items-center justify-center border-none transition-all ${
            !hasTimestamps || editMode
              ? "opacity-30 cursor-not-allowed"
              : "cursor-pointer hover:opacity-85 hover:scale-105"
          } ${recorder.isRecording ? "animate-pulse ring-2 ring-[#DC2626] ring-offset-2 ring-offset-[var(--bg)]" : ""} ${countdownActive ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-[var(--bg)]" : ""}`}
        >
          {recorder.isRecording ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : countdownActive ? (
            <span className="text-[16px] font-bold tabular-nums">{countdownBeat}</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="6" fill="#fff" stroke="none" />
            </svg>
          )}
        </button>

        {/* Feedback loop: play / retry / next */}
        {showFeedback && (
          <>
            <button
              onClick={handleFeedbackPlayback}
              title={feedbackPlaying ? "Playing back…" : "Play back recording"}
              className={`w-10 h-10 rounded-full border-[1.5px] cursor-pointer flex items-center justify-center hover:scale-105 transition-all ${
                feedbackPlaying
                  ? "border-[var(--theme)] bg-[var(--theme-light)] text-[var(--theme-text)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[#888]"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </button>
            <button
              onClick={handleRetryWithDelete}
              title="Discard take and retry"
              className="w-10 h-10 rounded-full border-[1.5px] border-[#DC2626] bg-transparent text-[#DC2626] cursor-pointer flex items-center justify-center hover:bg-red-50 hover:scale-105 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
            </button>
            <button
              onClick={handleFeedbackNext}
              title="Accept take and go to next line"
              className="w-10 h-10 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          </>
        )}

        {/* Record section button */}
        {showSectionRecord && (
          <button
            onClick={handleRecordSection}
            title={`Record ${activeSection!.name}`}
            className="h-10 px-3 rounded-full border-[1.5px] border-[#DC2626] bg-transparent text-[#DC2626] cursor-pointer flex items-center justify-center gap-[5px] hover:bg-red-50 hover:scale-105 transition-all text-[11px] font-medium"
          >
            <svg width="8" height="8" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" fill="#DC2626" />
            </svg>
            {activeSection!.name}
          </button>
        )}

        {/* Backing track toggle */}
        <button
          onClick={() => setPlayBacking((v) => !v)}
          title={playBacking ? "Backing track: ON" : "Backing track: OFF"}
          className={`w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center cursor-pointer transition-all hover:border-[#888] ${
            playBacking ? "bg-[var(--theme-light)] text-[var(--theme)]" : "bg-[var(--surface)] text-[var(--text-muted)]"
          }`}
        >
          {playBacking ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
        </button>

        <button
          onClick={player.nextLine}
          disabled={activeLineIndex === lines.length - 1}
          className="w-10 h-10 rounded-full border-[1.5px] border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] cursor-pointer flex items-center justify-center hover:border-[#888] hover:text-[var(--text-primary)] hover:scale-105 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 4 15 12 5 20 5 4" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="px-[5px] py-[1px] rounded bg-[var(--accent-light)] border border-[var(--border)] text-[10px] font-semibold text-[var(--text-secondary)]">R</span>
          record
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="px-[5px] py-[1px] rounded bg-[var(--accent-light)] border border-[var(--border)] text-[10px] font-semibold text-[var(--text-secondary)]">Shift+R</span>
          skip countdown
        </span>
      </div>
    </div>
  );
}
