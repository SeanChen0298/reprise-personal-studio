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
    <div className="w-[60px] h-[5px] rounded-full bg-[var(--bg)] overflow-hidden" title="Mic level">
      <div ref={barRef} className="h-full bg-emerald-500 transition-[width] duration-75" style={{ width: 0 }} />
    </div>
  );
}

const short = (text: string, n = 22) => (text.length > n ? `${text.slice(0, n)}…` : text);

export function TakesPanel({
  t,
  song,
  lines,
  sections,
  startLine,
  cursorSection,
  backingLabel,
}: {
  t: TakesState;
  song: Song;
  lines: Line[];
  sections: Section[];
  startLine: Line | null;
  cursorSection: Section | null;
  backingLabel: string;
}) {
  const recordCountIn = usePreferencesStore((s) => s.recordCountIn);
  const setRecordCountIn = usePreferencesStore((s) => s.setRecordCountIn);
  const playbackVolume = usePreferencesStore((s) => s.playbackVolume);
  const updateRecording = useSongStore((s) => s.updateRecording);
  const removeRecording = useSongStore((s) => s.removeRecording);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);

  useEffect(() => {
    if (t.pending) {
      setNote("");
      setTimeout(() => noteRef.current?.focus(), 30);
    }
  }, [t.pending]);

  const lineById = new Map(lines.map((l) => [l.id, l]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Record controls */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-[var(--border)]">
        {t.pending ? (
          <div className="flex flex-col gap-2">
            <span className="text-[12px] text-[var(--text-secondary)]">
              {formatMs(t.pending.durationMs)} recorded — add a note (optional):
            </span>
            <div className="flex items-center gap-2">
              <input
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") t.save(note);
                  if (e.key === "Escape") t.discard();
                }}
                placeholder="e.g. full run, chorus attempt…"
                maxLength={100}
                className="flex-1 min-w-0 px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] text-[13px] outline-none focus:border-[var(--theme)]"
              />
              <button
                onClick={() => t.save(note)}
                className="px-3 py-[6px] rounded-[7px] bg-[var(--accent)] text-white text-[12.5px] font-medium hover:opacity-80 cursor-pointer border-none"
              >
                Save
              </button>
              <button
                onClick={t.discard}
                className="px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12.5px] text-[var(--text-secondary)] hover:border-[#888] cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        ) : t.countdown != null ? (
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-red-600 text-white text-[18px] font-semibold flex items-center justify-center tabular-nums animate-pulse">
              {t.countdown}
            </span>
            <span className="text-[12.5px] text-[var(--text-secondary)]">Get ready…</span>
            <MicMeter getLevel={t.recorder.getInputLevel} />
            <button
              onClick={t.stop}
              className="ml-auto px-3 py-[6px] rounded-[7px] border border-[var(--border)] bg-transparent text-[12.5px] text-[var(--text-secondary)] hover:border-[#888] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : t.recording ? (
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-[13px] font-medium tabular-nums">
              {String(Math.floor(t.elapsedSec / 60)).padStart(2, "0")}:{String(t.elapsedSec % 60).padStart(2, "0")}
            </span>
            <MicMeter getLevel={t.recorder.getInputLevel} />
            <span className="text-[11px] text-[var(--text-muted)] truncate">
              {t.takeSection && t.stopAtMs != null ? `${t.takeSection.name} · stops at ${formatMs(t.stopAtMs)}` : "to the end"}
            </span>
            <button
              onClick={t.stop}
              title="Stop (R)"
              className="ml-auto px-4 py-[6px] rounded-[7px] bg-red-600 text-white text-[12.5px] font-medium hover:bg-red-700 cursor-pointer border-none"
            >
              Stop
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => t.start(startLine)}
                disabled={!song.audio_folder}
                title="Record from the selected line (R)"
                className="flex items-center gap-[6px] px-4 py-[7px] rounded-[8px] bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 cursor-pointer border-none disabled:opacity-40"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" /></svg>
                Record
              </button>
              {cursorSection && (
                <button
                  onClick={() => {
                    const first = lines.find((l) => l.order >= cursorSection.start_line_order && l.start_ms != null);
                    t.start(first ?? startLine, cursorSection);
                  }}
                  title="Record just this section (Shift+R)"
                  className="px-3 py-[7px] rounded-[8px] border border-red-300 bg-transparent text-red-600 text-[12.5px] font-medium hover:bg-red-50 cursor-pointer"
                >
                  {cursorSection.name}
                </button>
              )}
              <span className="text-[11.5px] text-[var(--text-muted)] truncate min-w-0">
                {startLine?.start_ms != null
                  ? `from “${short(displayText(startLine))}” (${formatMs(startLine.start_ms)})`
                  : "select a timed line to start from"}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11.5px] text-[var(--text-secondary)]">
              <label
                className="flex items-center gap-[6px] cursor-pointer select-none"
                title="Plays the track while you sing, so the take can be reviewed for breath and high notes. Use headphones."
              >
                <input
                  type="checkbox"
                  checked={t.singAlong}
                  onChange={(e) => t.setSingAlong(e.target.checked)}
                  className="w-[13px] h-[13px] accent-[var(--theme)] cursor-pointer"
                />
                Sing along ({backingLabel}) — headphones on
              </label>
              <label className="flex items-center gap-[5px] select-none">
                Count-in
                <select
                  value={recordCountIn}
                  onChange={(e) => setRecordCountIn(Number(e.target.value))}
                  className="px-1 py-[1px] rounded-[5px] border border-[var(--border)] bg-[var(--surface)] text-[11.5px] outline-none cursor-pointer"
                >
                  <option value={0}>off</option>
                  <option value={3}>3 s</option>
                  <option value={5}>5 s</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {t.reviewRec && (
        <TakeReviewPanel
          rec={t.reviewRec}
          lines={lines}
          analyzing={t.reviewRec.id in t.analyzing ? t.analyzing[t.reviewRec.id] : null}
          error={t.analysisErrors[t.reviewRec.id] ?? null}
          playingKey={t.snippetKey}
          onPlayYou={t.playIssueYou}
          onPlayOriginal={t.playIssueOriginal}
          onReanalyze={() => t.runAnalysis(t.reviewRec!)}
          onClose={() => {
            t.stopSnippet();
            t.setReviewId(null);
          }}
        />
      )}

      {/* Takes */}
      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: "thin" }}>
        {t.takes.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)] text-center py-10 leading-relaxed">
            No takes yet.
            <br />
            Select a line and press <kbd className="px-1 rounded border border-[var(--border)]">R</kbd> to record from it.
          </p>
        ) : (
          t.takes.map((rec) => {
            const line = rec.line_id ? lineById.get(rec.line_id) ?? null : null;
            return (
              <RecordingEntry
                key={rec.id}
                rec={rec}
                line={line}
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
                review={
                  canReview(rec, song)
                    ? { active: t.reviewId === rec.id, analyzing: rec.id in t.analyzing, onOpen: t.openReview }
                    : undefined
                }
              />
            );
          })
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
