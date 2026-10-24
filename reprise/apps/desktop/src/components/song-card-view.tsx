import { useState } from "react";
import type { SongCard } from "../lib/coach/knowledge";

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

/** The coach's song card, laid out to be read at a glance. */
export function SongCardView({ card }: { card: SongCard }) {
  const [openSection, setOpenSection] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-4 text-[12.5px] leading-snug text-[var(--text-secondary)]">
      {/* At a glance */}
      <div>
        <p className="text-[13.5px] leading-snug text-[var(--text-primary)]">{card.summary}</p>
        {card.mood && <p className="mt-[5px] text-[12px] text-[var(--text-muted)]">{card.mood}</p>}
      </div>

      {/* Story */}
      {card.arc.length > 0 ? (
        <div>
          <Label>Story</Label>
          <ol className="flex flex-col gap-[5px]">
            {card.arc.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="flex-shrink-0 w-[52px] text-[10.5px] tabular-nums text-[var(--text-muted)] pt-[1px]">{a.lines}</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        card.story && (
          <div>
            <Label>Story</Label>
            <p>{card.story}</p>
          </div>
        )
      )}

      {/* Sections */}
      {card.sections.length > 0 && (
        <div>
          <Label>Sections</Label>
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

      {/* Voice */}
      {(card.singer.style || card.techniques.length > 0) && (
        <div>
          <Label>{card.singer.name ? `${card.singer.name}'s voice` : "Voice"}</Label>
          {card.singer.style && <p className="mb-2">{card.singer.style}</p>}
          <div className="flex flex-col gap-[8px]">
            {card.techniques.map((t, i) => (
              <div key={i} className="rounded-[8px] border border-[var(--border-subtle)] p-[8px]">
                <div className="flex flex-wrap items-center gap-[5px]">
                  <span className="text-[12px] font-medium text-[var(--text-primary)] mr-[2px]">{t.name}</span>
                  {t.lines && <span className="text-[10.5px] text-[var(--text-muted)] tabular-nums">{t.lines}</span>}
                  {t.register && <Chip tone="voice">{t.register}</Chip>}
                  {t.placement && <Chip tone="voice">{t.placement}</Chip>}
                </div>
                {t.image && <div className="mt-[4px] text-[12px]"><span className="text-[var(--text-muted)]">Imagine · </span>{t.image}</div>}
                {t.drill && <div className="mt-[2px] text-[12px]"><span className="text-[var(--text-muted)]">Drill · </span>{t.drill}</div>}
              </div>
            ))}
            {card.techniques.length === 0 && card.singer.techniques.map((t, i) => <div key={i}>• {t}</div>)}
          </div>
        </div>
      )}

      {/* Practise */}
      {card.practice_focus.length > 0 && (
        <div>
          <Label>Practise</Label>
          <ul className="flex flex-col gap-[4px]">
            {card.practice_focus.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--text-muted)]">☐</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
