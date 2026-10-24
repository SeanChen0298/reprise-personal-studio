import { PitchCurve } from "../../components/pitch-curve";
import { usePitchData } from "../../hooks/use-pitch-data";
import { formatMs } from "../../lib/status-config";
import { ISSUE_LABEL, isBreathIssue } from "../../lib/take-review";
import { displayText } from "./use-workspace-edits";
import type { HighlightType } from "../../lib/highlight-config";
import type { UseLinePlayerReturn } from "../../hooks/use-line-player";
import type { Line, Section, Song, TakeIssue } from "../../types/song";

function fmtPrecise(ms: number | undefined) {
  if (ms == null) return "—";
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

const nudgeBtn =
  "px-[6px] py-[1px] rounded-[4px] border border-[var(--border)] bg-transparent text-[10.5px] text-[var(--text-secondary)] hover:border-[#888] hover:text-[var(--text-primary)] cursor-pointer";

export function LinePanel({
  song,
  line,
  index,
  total,
  section,
  highlights,
  player,
  issues,
  onNudge,
  onTapStart,
  onRemoveAnnotation,
  onIssueClick,
}: {
  song: Song;
  line: Line | null;
  index: number;
  total: number;
  section: Section | null;
  highlights: HighlightType[];
  player: UseLinePlayerReturn;
  issues: { issue: TakeIssue; key: string }[];
  onNudge: (field: "start_ms" | "end_ms", deltaMs: number) => void;
  onTapStart: () => void;
  onRemoveAnnotation: (index: number) => void;
  onIssueClick: (issue: TakeIssue, key: string) => void;
}) {
  const pitch = usePitchData(song.pitch_data_path, line?.start_ms, line?.end_ms);

  if (!line) {
    return <p className="text-[12.5px] text-[var(--text-muted)] text-center py-10">Select a line.</p>;
  }

  const text = displayText(line);
  const hlById = new Map(highlights.map((h) => [h.id, h]));
  const nowMs = player.currentTime * 1000;
  const timed = line.start_ms != null && line.end_ms != null && line.end_ms > line.start_ms;
  const progress = timed ? Math.min(1, Math.max(0, (nowMs - line.start_ms!) / (line.end_ms! - line.start_ms!))) : 0;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5" style={{ scrollbarWidth: "thin" }}>
      <div>
        <div className="text-[10.5px] text-[var(--text-muted)] mb-1">
          Line {index + 1} of {total}
          {section && ` · ${section.name}`}
          {line.play_count ? ` · played ${line.play_count}×` : ""}
        </div>
        <div className="text-[14px] leading-[1.5] text-[var(--text-primary)]">{text || <i className="text-[var(--text-muted)]">(empty)</i>}</div>
      </div>

      {/* Timing */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-2">Timing</div>
        {(["start_ms", "end_ms"] as const).map((field) => (
          <div key={field} className="flex items-center gap-2 mb-[6px]">
            <span className="w-[34px] text-[11.5px] text-[var(--text-muted)]">{field === "start_ms" ? "Start" : "End"}</span>
            <span className="w-[62px] text-[12px] tabular-nums text-[var(--text-primary)]">{fmtPrecise(line[field])}</span>
            <button className={nudgeBtn} onClick={() => onNudge(field, -50)} title={field === "start_ms" ? "Alt+←" : "Alt+Shift+←"}>−50ms</button>
            <button className={nudgeBtn} onClick={() => onNudge(field, 50)} title={field === "start_ms" ? "Alt+→" : "Alt+Shift+→"}>+50ms</button>
          </div>
        ))}
        <button
          onClick={onTapStart}
          title="While the song plays, press T as each line starts — the selection then moves to the next line"
          className="mt-1 text-[11.5px] px-[8px] py-[3px] rounded-[5px] border border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--theme)] hover:text-[var(--theme)] cursor-pointer"
        >
          Start here at {formatMs(nowMs)} <kbd className="ml-1 text-[10px] opacity-70">T</kbd>
        </button>
      </div>

      {/* Pitch of the original for this line */}
      {timed && pitch.points.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-2">Melody</div>
          <div className="rounded-[8px] border border-[var(--border-subtle)] overflow-hidden">
            <PitchCurve
              points={pitch.points}
              progress={progress}
              onSeek={(f) => player.seekTo(line.start_ms! + f * (line.end_ms! - line.start_ms!))}
              startMs={line.start_ms!}
              endMs={line.end_ms!}
              yMinSemitone={pitch.songRange?.minSemitone}
              yMaxSemitone={pitch.songRange?.maxSemitone}
            />
          </div>
        </div>
      )}

      {/* Annotations */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-2">Annotations</div>
        {(line.annotations ?? []).length === 0 ? (
          <p className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">
            Select words (drag, or Shift+←/→) and press a number key to mark them.
          </p>
        ) : (
          <div className="flex flex-col gap-[5px]">
            {(line.annotations ?? []).map((a, i) => {
              const hl = hlById.get(a.type);
              return (
                <div key={i} className="group flex items-center gap-2 text-[12px]">
                  <span
                    className="px-[6px] py-[1px] rounded-[3px] text-[10.5px] font-medium flex-shrink-0"
                    style={{ backgroundColor: hl?.bg, color: hl?.color }}
                  >
                    {hl?.name ?? a.type}
                  </span>
                  <span className="truncate text-[var(--text-secondary)]">{text.slice(a.start, a.end)}</span>
                  <button
                    onClick={() => onRemoveAnnotation(i)}
                    title="Remove"
                    className="ml-auto opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-600 bg-transparent border-none cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-2">In the reviewed take</div>
          <div className="flex flex-col gap-[5px]">
            {issues.map(({ issue, key }) => (
              <button
                key={key}
                onClick={() => onIssueClick(issue, key)}
                className="flex items-start gap-2 text-left bg-transparent border-none cursor-pointer p-0"
              >
                <span
                  className={`text-[9.5px] font-semibold px-[5px] py-[1px] rounded-[3px] flex-shrink-0 ${
                    isBreathIssue(issue.kind) ? "bg-sky-500/10 text-sky-700" : "bg-amber-500/10 text-amber-700"
                  }`}
                >
                  {ISSUE_LABEL[issue.kind]}
                </span>
                <span className="text-[11.5px] text-[var(--text-secondary)]">{issue.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
