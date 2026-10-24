import { useEffect, useRef, useState } from "react";
import { formatMs } from "../lib/status-config";
import { ISSUE_LABEL, isBreathIssue, reviewInsight } from "../lib/take-review";
import { PitchCompare } from "./pitch-compare";
import type { Line, Recording, Song, TakeAnalysis, TakeIssue } from "../types/song";

function PlayChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-[3px] text-[10px] font-medium px-[6px] py-[2px] rounded-[4px] border cursor-pointer transition-all ${
        active
          ? "bg-[var(--theme)] text-white border-[var(--theme)]"
          : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--theme)] hover:text-[var(--theme)]"
      }`}
    >
      <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
        {active ? <rect x="5" y="5" width="14" height="14" /> : <polygon points="5,3 19,12 5,21" />}
      </svg>
      {label}
    </button>
  );
}

/** The automatic check in plain sentences. */
function summarise(a: TakeAnalysis): string[] {
  const breath = a.issues.filter((i) => isBreathIssue(i.kind));
  const high = a.issues.filter((i) => !isBreathIssue(i.kind));
  const out: string[] = [];
  out.push(
    a.phrases_checked === 0
      ? "Breath: not enough of your singing to judge."
      : breath.length === 0
        ? `Breath: no problems in ${a.phrases_checked} phrases.`
        : `Breath: ${breath.length} problem${breath.length === 1 ? "" : "s"} in ${a.phrases_checked} phrases.`,
  );
  out.push(
    a.high_notes_checked === 0
      ? "High notes: none in the part you sang."
      : high.length === 0
        ? `High notes: all ${a.high_notes_checked} fine.`
        : `High notes: ${high.length} of ${a.high_notes_checked} off.`,
  );
  const [h1, h2] = a.halves;
  const worse = (x: number, xn: number, y: number, yn: number) => yn > 0 && y >= 2 && y / yn > (xn ? x / xn : 0) * 1.5 + 0.05;
  if (worse(h1.breath_issues, h1.phrases, h2.breath_issues, h2.phrases) || worse(h1.high_issues, h1.high_notes, h2.high_issues, h2.high_notes)) {
    out.push("It gets worse in the second half — stamina.");
  }
  return out;
}

export function TakeReviewPanel({
  rec,
  song,
  lines,
  analyzing,
  error,
  playingKey,
  playheadMs,
  noteFocusNonce,
  onPlayYou,
  onPlayOriginal,
  onReanalyze,
  onClose,
  onAddNote,
  onDeleteNote,
  onPlayNote,
  onAskCoach,
}: {
  rec: Recording;
  song: Song;
  lines: Line[];
  /** 0–1 while analysing, null otherwise. */
  analyzing: number | null;
  error: string | null;
  playingKey: string | null;
  /** Where this take is playing (ms), if it is. */
  playheadMs: number | null;
  /** Changes when the note box should take focus (the N key). */
  noteFocusNonce: number;
  onPlayYou: (issue: TakeIssue, key: string) => void;
  onPlayOriginal: (issue: TakeIssue, key: string) => void;
  onReanalyze: () => void;
  onClose: () => void;
  onAddNote: (text: string, takeMs: number) => void;
  onDeleteNote: (id: string) => void;
  onPlayNote: (takeMs: number) => void;
  onAskCoach: () => void;
}) {
  const a = rec.analysis;
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const insight = a ? reviewInsight(a) : null;
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [openIssue, setOpenIssue] = useState<number | null>(null);
  const noteAt = playheadMs ?? 0;

  useEffect(() => {
    if (noteFocusNonce > 0) noteRef.current?.focus();
  }, [noteFocusNonce]);
  useEffect(() => {
    setOpenIssue(null);
  }, [rec.id]);

  const date = new Date(rec.created_at);
  const notes = [...(rec.notes ?? [])].sort((x, y) => x.take_ms - y.take_ms);

  return (
    <div className="flex-shrink-0 max-h-[65%] overflow-y-auto px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)]" style={{ scrollbarWidth: "thin" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12.5px] font-medium">
          Take · {date.toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{formatMs(rec.duration_ms)}</span>
        <button
          onClick={onAskCoach}
          title="Send your notes and the check for this take to your coach"
          className="ml-auto text-[11px] font-medium px-[8px] py-[2px] rounded-[6px] border border-[var(--border)] bg-transparent text-[var(--theme)] hover:border-[var(--theme)] cursor-pointer"
        >
          Ask the coach
        </button>
        <button
          onClick={onClose}
          title="Close"
          className="w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Your notes — the main thing */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-[6px]">My notes</div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] tabular-nums text-[var(--text-muted)] w-[34px] flex-shrink-0">{formatMs(noteAt)}</span>
        <input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && note.trim()) {
              onAddNote(note.trim(), noteAt);
              setNote("");
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={playheadMs != null ? "Note at this moment — Enter" : "Play the take, then press N to note a moment"}
          className="flex-1 min-w-0 px-3 py-[5px] rounded-[8px] border border-[var(--border)] bg-[var(--bg)] text-[12.5px] outline-none focus:border-[var(--theme)]"
        />
      </div>
      {notes.length === 0 ? (
        <p className="text-[11.5px] text-[var(--text-muted)] mb-3 leading-relaxed">
          Listen back and press <kbd className="px-1 rounded border border-[var(--border)]">N</kbd> to pin what you hear — “too bright here”,
          “ran out of air”. Notes on a take sung along with the song also show under its lyric line.
        </p>
      ) : (
        <div className="flex flex-col mb-3">
          {notes.map((n) => (
            <div key={n.id} className="group flex items-start gap-2 py-[4px]">
              <button
                onClick={() => onPlayNote(n.take_ms)}
                title="Play from here"
                className="text-[11px] tabular-nums text-[var(--theme-text)] w-[34px] flex-shrink-0 bg-transparent border-none p-0 cursor-pointer hover:underline text-left"
              >
                {formatMs(n.take_ms)}
              </button>
              <span className="flex-1 text-[12.5px] text-[var(--text-primary)] leading-snug">{n.text}</span>
              <button
                onClick={() => onDeleteNote(n.id)}
                title="Delete note"
                className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-600 bg-transparent border-none cursor-pointer"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Automatic check — a rough second opinion */}
      {rec.song_start_ms != null && (
        <div className="border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCheck((v) => !v)}
              className="flex items-center gap-[6px] text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer p-0"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${showCheck ? "rotate-90" : ""}`}><polygon points="6,3 20,12 6,21" /></svg>
              Automatic check <span className="normal-case tracking-normal font-normal">(rough)</span>
            </button>
            {a && analyzing == null && (
              <button onClick={onReanalyze} className="ml-auto text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer">
                Re-run
              </button>
            )}
          </div>

          {analyzing != null ? (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-[4px] rounded-full bg-[var(--bg)] overflow-hidden">
                <div className="h-full bg-[var(--theme)] transition-all" style={{ width: `${Math.round(analyzing * 100)}%` }} />
              </div>
              <span className="text-[11.5px] text-[var(--text-muted)]">Listening…</span>
            </div>
          ) : error ? (
            <p className="text-[12px] text-red-600 py-2">{error}</p>
          ) : a && insight ? (
            <>
              <ul className="mt-2 flex flex-col gap-[3px]">
                {summarise(a).map((line) => (
                  <li key={line} className="text-[12px] text-[var(--text-secondary)]">{line}</li>
                ))}
              </ul>
              {showCheck && (
                <div className="mt-3">
                  {a.issues.length > 0 && (
                    <p className="text-[11px] text-[var(--text-muted)] mb-1">Click a problem to see your pitch against the original there.</p>
                  )}
                  {a.issues.map((issue, i) => {
                    const key = `${rec.id}:${i}`;
                    const line = issue.line_id ? lineById.get(issue.line_id) : undefined;
                    const breath = isBreathIssue(issue.kind);
                    const open = openIssue === i;
                    return (
                      <div key={key} className="border-t border-[var(--border-subtle)] first:border-t-0">
                        <div
                          onClick={() => setOpenIssue(open ? null : i)}
                          className={`flex items-start gap-2 py-[6px] cursor-pointer rounded-[6px] ${open ? "bg-[var(--bg)]" : "hover:bg-[var(--bg)]"}`}
                        >
                          <span className="text-[10.5px] tabular-nums text-[var(--text-muted)] w-[34px] flex-shrink-0 pt-[1px] pl-1">{formatMs(issue.song_ms)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-[6px]">
                              <span className={`text-[9.5px] font-semibold px-[5px] py-[1px] rounded-[3px] flex-shrink-0 ${breath ? "bg-sky-500/10 text-sky-700" : "bg-amber-500/10 text-amber-700"}`}>
                                {ISSUE_LABEL[issue.kind]}
                              </span>
                              <span className="text-[11.5px] text-[var(--text-secondary)] truncate">{issue.detail}</span>
                            </div>
                            {line && <div className="text-[12px] text-[var(--text-muted)] truncate mt-[2px]">{line.custom_text ?? line.text}</div>}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <PlayChip label="You" active={playingKey === `you:${key}`} onClick={() => onPlayYou(issue, key)} />
                            <PlayChip label="Original" active={playingKey === `orig:${key}`} onClick={() => onPlayOriginal(issue, key)} />
                          </div>
                        </div>
                        {open && (
                          <div className="px-1 pb-3">
                            <PitchCompare
                              song={song}
                              rec={rec}
                              fromMs={Math.max(0, issue.song_ms - 1500)}
                              toMs={issue.song_ms + 2500}
                              markFromMs={issue.song_ms}
                              markToMs={issue.song_ms + (breath ? 600 : 800)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {insight.tips.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-[6px]">
                      {insight.tips.map((tip) => (
                        <li key={tip} className="text-[11.5px] leading-[1.5] text-[var(--text-secondary)] pl-3 border-l-2 border-[var(--theme-light)]">{tip}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!showCheck && a.issues.length > 0 && (
                <button onClick={() => setShowCheck(true)} className="mt-1 text-[11px] text-[var(--theme)] bg-transparent border-none cursor-pointer p-0 hover:underline">
                  Show where, with pitch charts
                </button>
              )}
            </>
          ) : (
            <p className="text-[11.5px] text-[var(--text-muted)] py-2">Not checked yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
