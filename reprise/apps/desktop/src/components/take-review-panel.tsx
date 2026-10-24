import { formatMs } from "../lib/status-config";
import { ISSUE_LABEL, isBreathIssue, reviewInsight } from "../lib/take-review";
import type { Line, Recording, TakeIssue } from "../types/song";

function PlayChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-[3px] text-[10px] font-medium px-[6px] py-[2px] rounded-[4px] border cursor-pointer transition-all ${
        active
          ? "bg-[var(--theme)] text-white border-[var(--theme)]"
          : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--theme)] hover:text-[var(--theme)]"
      }`}
    >
      {active ? (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
          <rect x="5" y="5" width="14" height="14" />
        </svg>
      ) : (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      )}
      {label}
    </button>
  );
}

function HalfBar({ label, issues, total, unit }: { label: string; issues: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.round((issues / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-[62px] text-[var(--text-muted)]">{label}</span>
      <div className="flex-1 h-[5px] rounded-full bg-[var(--bg)] overflow-hidden">
        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-[92px] text-right tabular-nums text-[var(--text-secondary)]">
        {issues} of {total} {unit}
      </span>
    </div>
  );
}

export function TakeReviewPanel({
  rec,
  lines,
  analyzing,
  error,
  playingKey,
  onPlayYou,
  onPlayOriginal,
  onReanalyze,
  onClose,
}: {
  rec: Recording;
  lines: Line[];
  /** 0–1 while analysing, null otherwise. */
  analyzing: number | null;
  error: string | null;
  playingKey: string | null;
  onPlayYou: (issue: TakeIssue, key: string) => void;
  onPlayOriginal: (issue: TakeIssue, key: string) => void;
  onReanalyze: () => void;
  onClose: () => void;
}) {
  const a = rec.analysis;
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const insight = a ? reviewInsight(a) : null;

  return (
    <div className="flex-shrink-0 max-h-[55%] overflow-y-auto px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">
          Take review
        </span>
        {a && (
          <span className="text-[10.5px] text-[var(--text-muted)] tabular-nums">
            {formatMs(a.song_from_ms)}–{formatMs(a.song_to_ms)}
            {a.octave_shift !== 0 && ` · sung ${a.octave_shift < 0 ? "an octave down" : "an octave up"}`}
          </span>
        )}
        <div className="flex-1" />
        {a && analyzing == null && (
          <button
            onClick={onReanalyze}
            className="text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer"
            title="Run the analysis again"
          >
            Re-analyze
          </button>
        )}
        <button
          onClick={onClose}
          title="Close review"
          className="w-6 h-6 flex items-center justify-center cursor-pointer border-none bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {analyzing != null ? (
        <div className="flex items-center gap-3 py-3">
          <div className="flex-1 h-[4px] rounded-full bg-[var(--bg)] overflow-hidden">
            <div className="h-full bg-[var(--theme)] transition-all" style={{ width: `${Math.round(analyzing * 100)}%` }} />
          </div>
          <span className="text-[11.5px] text-[var(--text-muted)]">Listening to your take…</span>
        </div>
      ) : error ? (
        <p className="text-[12.5px] text-red-600 py-2">{error}</p>
      ) : !a || !insight ? (
        <p className="text-[12.5px] text-[var(--text-muted)] py-2">Not analysed yet.</p>
      ) : (
        <>
          <p className="text-[13.5px] font-medium text-[var(--text-primary)] mb-3">{insight.headline}</p>

          {/* Stamina: first vs second half */}
          {(a.phrases_checked > 0 || a.high_notes_checked > 0) && (
            <div className="flex flex-col gap-[5px] mb-3">
              {a.phrases_checked > 0 && (
                <>
                  <HalfBar label="Breath · 1st" issues={a.halves[0].breath_issues} total={a.halves[0].phrases} unit="phrases" />
                  <HalfBar label="Breath · 2nd" issues={a.halves[1].breath_issues} total={a.halves[1].phrases} unit="phrases" />
                </>
              )}
              {a.high_notes_checked > 0 && (
                <>
                  <HalfBar label="High · 1st" issues={a.halves[0].high_issues} total={a.halves[0].high_notes} unit="high notes" />
                  <HalfBar label="High · 2nd" issues={a.halves[1].high_issues} total={a.halves[1].high_notes} unit="high notes" />
                </>
              )}
            </div>
          )}

          {insight.tips.length > 0 && (
            <ul className="mb-3 flex flex-col gap-[6px]">
              {insight.tips.map((tip) => (
                <li key={tip} className="text-[12px] leading-[1.5] text-[var(--text-secondary)] pl-3 border-l-2 border-[var(--theme-light)]">
                  {tip}
                </li>
              ))}
            </ul>
          )}

          {/* Issues, in song order */}
          {a.issues.length > 0 && (
            <div className="flex flex-col">
              {a.issues.map((issue, i) => {
                const key = `${rec.id}:${i}`;
                const line = issue.line_id ? lineById.get(issue.line_id) : undefined;
                const breath = isBreathIssue(issue.kind);
                return (
                  <div key={key} className="flex items-start gap-2 py-[6px] border-t border-[var(--border-subtle)] first:border-t-0">
                    <span className="text-[10.5px] tabular-nums text-[var(--text-muted)] w-[34px] flex-shrink-0 pt-[1px]">
                      {formatMs(issue.song_ms)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-[6px]">
                        <span
                          className={`text-[9.5px] font-semibold px-[5px] py-[1px] rounded-[3px] flex-shrink-0 ${
                            breath ? "bg-sky-500/10 text-sky-700" : "bg-amber-500/10 text-amber-700"
                          }`}
                        >
                          {ISSUE_LABEL[issue.kind]}
                        </span>
                        <span className="text-[11.5px] text-[var(--text-secondary)] truncate">{issue.detail}</span>
                      </div>
                      {line && (
                        <div className="text-[12px] text-[var(--text-muted)] truncate mt-[2px]">
                          {line.custom_text ?? line.text}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <PlayChip label="You" active={playingKey === `you:${key}`} onClick={() => onPlayYou(issue, key)} />
                      <PlayChip label="Original" active={playingKey === `orig:${key}`} onClick={() => onPlayOriginal(issue, key)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {a.phrases_checked === 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">
              Couldn't hear you over enough of the song to judge. Sing with headphones on so the backing track doesn't reach the mic.
            </p>
          )}
        </>
      )}
    </div>
  );
}
