import { useEffect, useRef, useState } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import { RecordingEntry } from "../../components/take-entry";
import { TakeReviewPanel } from "../../components/take-review-panel";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { useSongStore } from "../../stores/song-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { formatMs } from "../../lib/status-config";
import { canReview } from "../../lib/take-review";
import { displayText } from "./use-workspace-edits";
import type { TakesState } from "./use-takes";
import type { Line, Recording, Section, Song } from "../../types/song";

/** Live mic level — confirms the mic is picking you up. */
function MicMeter({ getLevel }: { getLevel: () => number }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const level = Math.min(1, getLevel() * 3);
      if (barRef.current) barRef.current.style.width = `${Math.round(level * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);
  return (
    <div className="w-[56px] h-[5px] rounded-full bg-[var(--bg)] overflow-hidden" title="Mic level">
      <div ref={barRef} className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: 0 }} />
    </div>
  );
}

const short = (text: string, n = 20) => (text.length > n ? `${text.slice(0, n)}…` : text);

/**
 * Record controls, docked at the bottom centre of the lyric sheet so you stay
 * looking at the lyrics while you sing.
 */
export function RecordDock({
  t,
  song,
  lines,
  startLine,
  cursorSection,
  backingLabel,
}: {
  t: TakesState;
  song: Song;
  lines: Line[];
  startLine: Line | null;
  cursorSection: Section | null;
  backingLabel: string;
}) {
  const recordCountIn = usePreferencesStore((s) => s.recordCountIn);
  const setRecordCountIn = usePreferencesStore((s) => s.setRecordCountIn);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    if (t.pending) {
      setNote("");
      setTimeout(() => noteRef.current?.focus(), 30);
    }
  }, [t.pending]);

  const shell =
    "pointer-events-auto flex items-center gap-3 px-3 py-[7px] rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_6px_24px_rgba(0,0,0,0.10)]";

  if (t.pending) {
    return (
      <div className={`${shell} w-[520px] max-w-full`}>
        <span className="text-[12px] text-[var(--text-secondary)] flex-shrink-0">{formatMs(t.pending.durationMs)} take</span>
        <input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") t.save(note);
            if (e.key === "Escape") t.discard();
          }}
          placeholder="Note (optional) — Enter to save"
          maxLength={100}
          className="flex-1 min-w-0 px-3 py-[5px] rounded-[8px] border border-[var(--border)] bg-[var(--bg)] text-[12.5px] outline-none focus:border-[var(--theme)]"
        />
        <button onClick={() => t.save(note)} className="px-3 py-[5px] rounded-[8px] bg-[var(--accent)] text-white text-[12.5px] font-medium hover:opacity-80 cursor-pointer border-none">
          Save
        </button>
        <button onClick={t.discard} className="px-2 py-[5px] rounded-[8px] bg-transparent text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer border-none">
          Discard
        </button>
      </div>
    );
  }

  if (t.countdown != null) {
    return (
      <div className={shell}>
        <span className="w-8 h-8 rounded-full bg-red-600 text-white text-[16px] font-semibold flex items-center justify-center tabular-nums animate-pulse">
          {t.countdown}
        </span>
        <span className="text-[12.5px] text-[var(--text-secondary)]">Get ready…</span>
        <MicMeter getLevel={t.recorder.getInputLevel} />
        <button onClick={t.stop} className="px-2 py-[4px] rounded-[7px] bg-transparent text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer border-none">
          Cancel
        </button>
      </div>
    );
  }

  if (t.recording) {
    return (
      <div className={shell}>
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[13px] font-medium tabular-nums">
          {String(Math.floor(t.elapsedSec / 60)).padStart(2, "0")}:{String(t.elapsedSec % 60).padStart(2, "0")}
        </span>
        <MicMeter getLevel={t.recorder.getInputLevel} />
        <span className="text-[11px] text-[var(--text-muted)]">
          {t.takeSection && t.stopAtMs != null ? `${t.takeSection.name} · stops at ${formatMs(t.stopAtMs)}` : "to the end"}
        </span>
        <button onClick={t.stop} title="Stop (R)" className="px-4 py-[5px] rounded-[8px] bg-red-600 text-white text-[12.5px] font-medium hover:bg-red-700 cursor-pointer border-none">
          Stop
        </button>
      </div>
    );
  }

  return (
    <div className={`${shell} relative`}>
      <button
        onClick={() => t.start(startLine)}
        disabled={!song.audio_folder}
        title="Record from the selected line (R)"
        className="flex items-center gap-[6px] px-4 py-[6px] rounded-[9px] bg-red-600 text-white text-[12.5px] font-medium hover:bg-red-700 cursor-pointer border-none disabled:opacity-40"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" /></svg>
        Record
      </button>
      {cursorSection && (
        <button
          onClick={() => {
            const first = lines.find((l) => l.order >= cursorSection.start_line_order && l.start_ms != null);
            t.start(first ?? startLine, cursorSection);
          }}
          title="Record just this section (Shift+R)"
          className="px-3 py-[6px] rounded-[9px] border border-red-300 bg-transparent text-red-600 text-[12px] font-medium hover:bg-red-50 cursor-pointer"
        >
          {cursorSection.name} only
        </button>
      )}
      <span className="text-[11.5px] text-[var(--text-muted)] max-w-[220px] truncate">
        {startLine?.start_ms != null ? `from “${short(displayText(startLine))}”` : "select a timed line"}
      </span>
      <button
        onClick={() => setOptionsOpen((v) => !v)}
        title="Recording options"
        className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
      {optionsOpen && (
        <div
          className="absolute bottom-[calc(100%+8px)] right-0 w-[270px] p-3 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] shadow-xl flex flex-col gap-3 text-[12px] text-[var(--text-secondary)]"
          onMouseLeave={() => setOptionsOpen(false)}
        >
          <label className="flex items-start gap-[7px] cursor-pointer select-none">
            <input type="checkbox" checked={t.singAlong} onChange={(e) => t.setSingAlong(e.target.checked)} className="mt-[2px] accent-[var(--theme)] cursor-pointer" />
            <span>
              Sing along with the {backingLabel.toLowerCase()} track
              <span className="block text-[11px] text-[var(--text-muted)]">Needed for the review. Wear headphones.</span>
            </span>
          </label>
          <label className="flex items-center gap-[7px] select-none">
            Count-in
            <select
              value={recordCountIn}
              onChange={(e) => setRecordCountIn(Number(e.target.value))}
              className="px-1 py-[1px] rounded-[5px] border border-[var(--border)] bg-[var(--surface)] text-[12px] outline-none cursor-pointer"
            >
              <option value={0}>off</option>
              <option value={3}>3 s</option>
              <option value={5}>5 s</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

/** Takes list + review — lives in the slide-over panel. */
export function TakesPanel({
  t,
  song,
  lines,
  sections,
  noteFocusNonce,
}: {
  t: TakesState;
  song: Song;
  lines: Line[];
  sections: Section[];
  /** Bumped by the N key: focus the open take's note box. */
  noteFocusNonce: number;
}) {
  const playbackVolume = usePreferencesStore((s) => s.playbackVolume);
  const updateRecording = useSongStore((s) => s.updateRecording);
  const removeRecording = useSongStore((s) => s.removeRecording);
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** Where each take is playing (ms) — notes are pinned there. */
  const [playhead, setPlayhead] = useState<Record<string, number>>({});
  const [seek, setSeek] = useState<{ id: string; ms: number; nonce: number } | null>(null);
  const open = t.reviewRec;

  const addNote = (rec: Recording, text: string, takeMs: number) => {
    const notes = [...(rec.notes ?? []), { id: crypto.randomUUID(), take_ms: takeMs, text, created_at: new Date().toISOString() }];
    updateRecording(song.id, rec.id, { notes });
  };
  const deleteNote = (rec: Recording, id: string) => {
    updateRecording(song.id, rec.id, { notes: (rec.notes ?? []).filter((n) => n.id !== id) });
  };
  const playAt = (rec: Recording, ms: number) => {
    setSeek({ id: rec.id, ms, nonce: Date.now() });
    setPlayhead((p) => ({ ...p, [rec.id]: ms }));
    setPlayingId(rec.id);
  };
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {open && (
        <TakeReviewPanel
          rec={open}
          song={song}
          lines={lines}
          analyzing={open.id in t.analyzing ? t.analyzing[open.id] : null}
          error={t.analysisErrors[open.id] ?? null}
          playingKey={t.snippetKey}
          playheadMs={playhead[open.id] ?? null}
          noteFocusNonce={noteFocusNonce}
          onPlayYou={t.playIssueYou}
          onPlayOriginal={t.playIssueOriginal}
          onReanalyze={() => t.runAnalysis(open)}
          onClose={() => {
            t.stopSnippet();
            t.setReviewId(null);
          }}
          onAddNote={(text, ms) => addNote(open, text, ms)}
          onDeleteNote={(id) => deleteNote(open, id)}
          onPlayNote={(ms) => playAt(open, ms)}
        />
      )}
      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: "thin" }}>
        {t.takes.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)] text-center py-10 leading-relaxed">
            No takes yet.
            <br />
            Select a line and press <kbd className="px-1 rounded border border-[var(--border)]">R</kbd> to record from it.
          </p>
        ) : (
          t.takes.map((rec) => (
            <RecordingEntry
              key={rec.id}
              rec={rec}
              line={rec.line_id ? lineById.get(rec.line_id) ?? null : null}
              sectionName={rec.section_id ? sectionById.get(rec.section_id)?.name ?? null : null}
              songId={song.id}
              songAudioPath={song.audio_path}
              selectMode={false}
              selected={false}
              onToggleSelect={() => {}}
              onToggleBestTake={(id) => updateRecording(song.id, id, { is_best_take: !rec.is_best_take })}
              onDelete={() => setDeleteTarget(rec)}
              onPlay={(r) => setPlayingId((cur) => (cur === r.id ? null : r.id))}
              onPlayEnded={(id) => setPlayingId((cur) => (cur === id ? null : cur))}
              onCompare={(r) => setPlayingId((cur) => (cur === r.id ? null : r.id))}
              playingId={playingId}
              comparingId={null}
              volume={playbackVolume}
              review={canReview(rec, song) ? { active: t.reviewId === rec.id, analyzing: rec.id in t.analyzing, onOpen: t.openReview } : undefined}
              onOpen={(id) => t.reviewId !== id && t.openReview(id)}
              onTime={(ms) => setPlayhead((p) => (p[rec.id] === ms ? p : { ...p, [rec.id]: ms }))}
              seek={seek?.id === rec.id ? seek : null}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete take?"
        message="This recording will be permanently removed from disk."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            if (playingId === deleteTarget.id) setPlayingId(null);
            if (t.reviewId === deleteTarget.id) t.setReviewId(null);
            remove(deleteTarget.file_path).catch(() => {});
            removeRecording(song.id, deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
