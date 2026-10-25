import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SongCard } from "../lib/coach/knowledge";
import type { Line } from "../types/song";
import { parseLineRefs, splitLineRefs } from "@reprise/shared";

/** The song's lines (L1 = index 0) and how to jump to one — for showing "L19" as the lyric itself. */
export const LineRefContext = createContext<{ lines: Line[]; onJump?: (index: number) => void }>({ lines: [] });

const lineText = (l: Line | undefined) => (l ? (l.custom_text ?? l.text).trim() : "");
const snippet = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n)}…` : s);

export { parseLineRefs };

/** One line reference: the lyric's opening words, the line numbers muted; click jumps there. */
function LineRef({ from, to }: { from: number; to: number }) {
  const { lines, onJump } = useContext(LineRefContext);
  const first = lineText(lines[from - 1]);
  const full = lines
    .slice(from - 1, to)
    .map((l, i) => `L${from + i}  ${lineText(l)}`)
    .join("\n");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump?.(from - 1);
      }}
      title={full || `L${from}`}
      className="inline-flex items-baseline gap-[4px] max-w-full px-[6px] py-[1px] rounded-[4px] bg-[var(--bg)] border border-[var(--border-subtle)] hover:border-[var(--theme)] text-[11.5px] text-[var(--text-primary)] cursor-pointer align-baseline"
    >
      {first && <span className="truncate">{snippet(first)}</span>}
      <span className="text-[10px] text-[var(--text-muted)] tabular-nums flex-shrink-0">
        L{from}
        {to > from ? `–${to}` : ""}
      </span>
    </button>
  );
}

/** A list of line refs ("L15-22, L36-45"), or the raw text if it has none. */
export function LineRefs({ refs }: { refs: string }) {
  const parsed = parseLineRefs(refs);
  if (!parsed.length) return <span className="text-[10.5px] text-[var(--text-muted)]">{refs}</span>;
  return (
    <span className="inline-flex flex-wrap gap-[4px]">
      {parsed.map(([a, b], i) => (
        <LineRef key={i} from={a} to={b} />
      ))}
    </span>
  );
}

/** Free text with "L12" / "L3–5" turned into clickable lyric refs. */
export function WithLineRefs({ text }: { text: string }): ReactNode {
  const parts = splitLineRefs(text);
  return parts.map((part, i) => {
    const r = i % 2 === 1 ? parseLineRefs(part)[0] : null;
    return r ? <LineRef key={i} from={r[0]} to={r[1]} /> : <span key={i}>{part}</span>;
  });
}

const Chip = ({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "voice" }) => (
  <span
    className={`inline-block px-[6px] py-[1px] rounded-[4px] text-[10.5px] leading-[1.4] ${
      tone === "voice"
        ? "bg-[var(--theme-light)] text-[var(--theme-text)]"
        : "bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
    }`}
  >
    {children}
  </span>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-[5px]">{children}</div>
);

type Tab = "overview" | "story" | "sections" | "voice";
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", story: "Story", sections: "Sections", voice: "Voice" };

/**
 * The coach's song card as short pages (tabs), so it stays a card rather than a long article.
 * `nextTab` changes (Shift+G) step to the next page.
 */
export function SongCardView({ card, nextTab }: { card: SongCard; nextTab?: number }) {
  const [openSection, setOpenSection] = useState<number | null>(null);
  const tabs = (["overview", "story", "sections", "voice"] as Tab[]).filter((t) =>
    t === "overview"
      ? true
      : t === "story"
        ? card.arc.length > 0 || !!card.story
        : t === "sections"
          ? card.sections.length > 0
          : !!card.singer.style || card.techniques.length > 0 || card.singer.techniques.length > 0,
  );
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => {
    if (nextTab) setTab((cur) => tabs[(tabs.indexOf(cur) + 1) % tabs.length]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTab]);
  const shown = tabs.includes(tab) ? tab : "overview";

  return (
    <div className="flex flex-col gap-3 text-[12.5px] leading-snug text-[var(--text-secondary)]">
      {tabs.length > 1 && (
        <div className="flex gap-[2px] border-b border-[var(--border-subtle)]" title="Shift+G: next page">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 pb-[5px] -mb-px text-[11.5px] bg-transparent border-none border-b-2 cursor-pointer ${
                shown === t
                  ? "border-solid border-[var(--theme)] text-[var(--text-primary)] font-medium"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              style={{ borderBottomStyle: "solid", borderBottomColor: shown === t ? "var(--theme)" : "transparent" }}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {shown === "overview" && (
        <>
          <div>
            <p className="text-[13.5px] leading-snug text-[var(--text-primary)]">{card.summary}</p>
            {card.mood && <p className="mt-[5px] text-[12px] text-[var(--text-muted)]">{card.mood}</p>}
          </div>
          {card.practice_focus.length > 0 && (
            <div>
              <Label>Practise</Label>
              <ul className="flex flex-col gap-[4px]">
                {card.practice_focus.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[var(--text-muted)]">☐</span>
                    <span><WithLineRefs text={p} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {shown === "story" && (card.arc.length > 0 ? (
        <div>
          <ol className="flex flex-col gap-[5px]">
            {card.arc.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex-shrink-0 w-[16px] text-[10.5px] tabular-nums text-[var(--text-muted)] pt-[1px]">{i + 1}.</span>
                <span className="flex flex-col gap-[3px] min-w-0">
                  <span><WithLineRefs text={a.text} /></span>
                  {a.lines && <LineRefs refs={a.lines} />}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        card.story && (
          <div>
              <p>{card.story}</p>
          </div>
        )
      ))}

      {shown === "sections" && (
        <div>
          <div className="flex flex-col">
            {card.sections.map((s, i) => {
              const open = openSection === i;
              return (
                <button
                  key={i}
                  onClick={() => setOpenSection(open ? null : i)}
                  className={`text-left px-2 py-[6px] -mx-2 rounded-[6px] bg-transparent border-none cursor-pointer ${open ? "bg-[var(--bg)]" : "hover:bg-[var(--bg)]"}`}
                >
                  <div className="flex flex-wrap items-center gap-[5px]">
                    <span className="text-[12px] font-medium text-[var(--text-primary)] mr-[2px]">{s.name}</span>
                    {s.mood && <Chip>{s.mood}</Chip>}
                    {s.voice?.register && <Chip tone="voice">{s.voice.register}</Chip>}
                    {s.voice?.placement && <Chip tone="voice">{s.voice.placement}</Chip>}
                  </div>
                  {s.intent && <div className="mt-[3px] text-[12px] text-[var(--text-secondary)]">{s.intent}</div>}
                  {open && s.voice?.image && (
                    <div className="mt-[4px] text-[12px] italic text-[var(--text-muted)]">Imagine: {s.voice.image}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {shown === "voice" && (
        <div>
          <Label>{card.singer.name ? `${card.singer.name}'s voice` : "Voice"}</Label>
          {card.singer.style && <p className="mb-2">{card.singer.style}</p>}
          <div className="flex flex-col gap-[8px]">
            {card.techniques.map((t, i) => (
              <div key={i} className="rounded-[8px] border border-[var(--border-subtle)] p-[8px]">
                <div className="flex flex-wrap items-center gap-[5px]">
                  <span className="text-[12px] font-medium text-[var(--text-primary)] mr-[2px]">{t.name}</span>
                  {t.register && <Chip tone="voice">{t.register}</Chip>}
                  {t.placement && <Chip tone="voice">{t.placement}</Chip>}
                </div>
                {t.lines && (
                  <div className="mt-[5px]">
                    <LineRefs refs={t.lines} />
                  </div>
                )}
                {t.image && <div className="mt-[4px] text-[12px]"><span className="text-[var(--text-muted)]">Imagine · </span>{t.image}</div>}
                {t.drill && <div className="mt-[2px] text-[12px]"><span className="text-[var(--text-muted)]">Drill · </span><WithLineRefs text={t.drill} /></div>}
              </div>
            ))}
            {card.techniques.length === 0 && card.singer.techniques.map((t, i) => <div key={i}>• {t}</div>)}
          </div>
        </div>
      )}

    </div>
  );
}
