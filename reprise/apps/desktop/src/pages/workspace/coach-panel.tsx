import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useCoachStore, searchesToday } from "../../stores/coach-store";
import { askCoach, CoachError } from "../../lib/coach/providers";
import { COACH_SYSTEM, SONG_CARD_PROMPT } from "../../lib/coach/persona";
import {
  buildContext,
  parseReply,
  parseSongCard,
  saveKnowledge,
  saveProfile,
  type CoachProposals,
  type SingerProfile,
  type SongKnowledge,
} from "../../lib/coach/knowledge";
import type { HighlightType } from "../../lib/highlight-config";
import type { Line, Recording, Section, Song } from "../../types/song";

/** Minimal markdown: paragraphs, "- " bullets, **bold**. Enough for coach answers. */
function Markdown({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
    );
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        const rows = b.split("\n");
        if (rows.every((r) => /^\s*([-*•]|\d+\.)\s+/.test(r))) {
          return (
            <ul key={i} className="flex flex-col gap-[3px] pl-4 list-disc">
              {rows.map((r, j) => (
                <li key={j}>{bold(r.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {bold(b.replace(/^#+\s*/gm, ""))}
          </p>
        );
      })}
    </div>
  );
}

function Sources({ sources }: { sources: { title: string; url: string }[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {sources.slice(0, 6).map((s) => (
        <button
          key={s.url}
          onClick={() => open(s.url)}
          title={s.url}
          className="text-[10.5px] text-[var(--theme-text)] hover:underline bg-transparent border-none p-0 cursor-pointer truncate max-w-[180px]"
        >
          ↗ {s.title}
        </button>
      ))}
    </div>
  );
}

const QUICK = [
  "What is this song about, and how should it feel?",
  "How should I sing the chorus differently from the verses?",
  "Plan a 20-minute practice for this song today.",
];

export function CoachPanel({
  song,
  lines,
  translationById,
  sections,
  highlights,
  takes,
  knowledge,
  setKnowledge,
  profile,
  setProfile,
  request,
  onApplyLineNote,
}: {
  song: Song;
  lines: Line[];
  translationById: Map<string, string>;
  sections: Section[];
  highlights: HighlightType[];
  takes: Recording[];
  knowledge: SongKnowledge | null;
  setKnowledge: (k: SongKnowledge) => void;
  profile: SingerProfile;
  setProfile: (p: SingerProfile) => void;
  /** A question sent from elsewhere (e.g. "Ask the coach about this take"). */
  request: { text: string; nonce: number } | null;
  onApplyLineNote: (lineIndex: number, note: string) => void;
}) {
  const coach = useCoachStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<null | "card" | "chat">(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [cardOpen, setCardOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const apiKey = coach.keys[coach.provider];
  const model = coach.models[coach.provider];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [knowledge?.chat.length, busy]);

  const context = () =>
    buildContext({ song, lines, translationById, sections, highlights, takes, knowledge: knowledge ?? emptyKnowledge, profile });

  const writeCard = async () => {
    if (!knowledge) return;
    setBusy("card");
    setError(null);
    try {
      const r = await askCoach({
        provider: coach.provider,
        apiKey,
        model,
        system: COACH_SYSTEM,
        context: context(),
        history: [],
        prompt: SONG_CARD_PROMPT,
        maxSearches: coach.searchMode === "off" ? null : coach.maxSearchesPerAnswer,
      });
      coach.addSearches(r.searches);
      const card = parseSongCard(r.text);
      if (!card) throw new CoachError("The coach's song card came back in an unexpected shape — try again.");
      const next = { ...knowledge, card, card_sources: r.sources, card_made_at: new Date().toISOString() };
      setKnowledge(next);
      await saveKnowledge(song, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || !knowledge || busy) return;
    setInput("");
    setBusy("chat");
    setError(null);
    const at = new Date().toISOString();
    const withQ: SongKnowledge = { ...knowledge, chat: [...knowledge.chat, { role: "user", text: q, at }] };
    setKnowledge(withQ);
    try {
      const r = await askCoach({
        provider: coach.provider,
        apiKey,
        model,
        system: COACH_SYSTEM,
        context: context(),
        history: knowledge.chat.slice(-16).map(({ role, text }) => ({ role, text })),
        prompt: q,
        maxSearches: coach.searchMode === "auto" ? coach.maxSearchesPerAnswer : null,
      });
      coach.addSearches(r.searches);
      const next: SongKnowledge = {
        ...withQ,
        chat: [...withQ.chat, { role: "assistant", text: r.text, at: new Date().toISOString(), sources: r.sources }],
      };
      setKnowledge(next);
      await saveKnowledge(song, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setKnowledge(withQ);
      await saveKnowledge(song, withQ);
    } finally {
      setBusy(null);
    }
  };

  // Questions sent from elsewhere in the workspace.
  const lastNonce = useRef(0);
  useEffect(() => {
    if (request && request.nonce !== lastNonce.current && knowledge) {
      lastNonce.current = request.nonce;
      void send(request.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, knowledge !== null]);

  const applyProposal = async (key: string, kind: keyof CoachProposals, value: string, line?: number) => {
    if (!knowledge) return;
    setApplied((s) => new Set(s).add(key));
    if (kind === "line_notes" && line != null) onApplyLineNote(line - 1, value);
    if (kind === "remember_song") {
      const next = { ...knowledge, memory: [...knowledge.memory, value] };
      setKnowledge(next);
      await saveKnowledge(song, next);
    }
    if (kind === "remember_singer") {
      const next = { facts: [...profile.facts, value] };
      setProfile(next);
      await saveProfile(next);
    }
  };

  const forgetMemory = async (i: number) => {
    if (!knowledge) return;
    const next = { ...knowledge, memory: knowledge.memory.filter((_, j) => j !== i) };
    setKnowledge(next);
    await saveKnowledge(song, next);
  };

  if (!apiKey || !model) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[13.5px] text-[var(--text-primary)]">Set up the coach first</p>
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed max-w-[300px]">
          Add a Gemini or Claude API key and pick a model in Settings → Coach.
        </p>
      </div>
    );
  }
  if (!knowledge) return <div className="flex-1 p-6 text-[12px] text-[var(--text-muted)]">Loading…</div>;

  const card = knowledge.card;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ scrollbarWidth: "thin" }}>
        {/* Song card */}
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCardOpen((v) => !v)}
              className="flex items-center gap-[6px] text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] bg-transparent border-none cursor-pointer p-0"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${cardOpen ? "rotate-90" : ""}`}><polygon points="6,3 20,12 6,21" /></svg>
              Song card
            </button>
            <button
              onClick={() => void writeCard()}
              disabled={busy != null}
              className="ml-auto text-[11px] text-[var(--theme)] bg-transparent border-none cursor-pointer hover:underline disabled:opacity-40"
            >
              {busy === "card" ? "Writing…" : card ? "Rewrite" : "Write it"}
            </button>
          </div>
          {!card ? (
            <p className="text-[12px] text-[var(--text-muted)] mt-2 leading-relaxed">
              What the song is about, the mood of each section, and how the original singer sings it
              {coach.searchMode !== "off" ? " — checked on the web" : ""}.
            </p>
          ) : (
            cardOpen && (
              <div className="mt-2 flex flex-col gap-2 text-[12.5px] leading-snug text-[var(--text-secondary)]">
                <p className="text-[13px] text-[var(--text-primary)]">{card.summary}</p>
                <p><span className="text-[var(--text-muted)]">Mood · </span>{card.mood}</p>
                <p>{card.story}</p>
                {card.sections.length > 0 && (
                  <ul className="flex flex-col gap-[3px]">
                    {card.sections.map((s, i) => (
                      <li key={i}><strong className="text-[var(--text-primary)]">{s.name}</strong> <span className="text-[var(--text-muted)]">({s.mood})</span> — {s.intent}</li>
                    ))}
                  </ul>
                )}
                {card.singer.name && (
                  <p><span className="text-[var(--text-muted)]">{card.singer.name} · </span>{card.singer.style}</p>
                )}
                {card.practice_focus.length > 0 && (
                  <p><span className="text-[var(--text-muted)]">Practise · </span>{card.practice_focus.join(" · ")}</p>
                )}
                <Sources sources={knowledge.card_sources} />
              </div>
            )
          )}
        </div>

        {/* What we've learned */}
        {knowledge.memory.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)] mb-1">What we've learned</div>
            {knowledge.memory.map((m, i) => (
              <div key={i} className="group flex items-start gap-2 text-[12px] text-[var(--text-secondary)] py-[2px]">
                <span className="text-[var(--text-muted)]">•</span>
                <span className="flex-1">{m}</span>
                <button onClick={() => void forgetMemory(i)} className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-600 bg-transparent border-none cursor-pointer">×</button>
              </div>
            ))}
          </div>
        )}

        {/* Conversation */}
        {knowledge.chat.length === 0 && (
          <div className="flex flex-col gap-[6px]">
            <span className="text-[11px] text-[var(--text-muted)]">Ask about the meaning, the feel, a line, or your takes:</span>
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                disabled={busy != null}
                className="text-left text-[12px] px-3 py-[6px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--theme)] cursor-pointer disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {knowledge.chat.map((turn, i) => {
          if (turn.role === "user") {
            return (
              <div key={i} className="self-end max-w-[85%] px-3 py-[7px] rounded-[12px] rounded-br-[4px] bg-[var(--theme-light)] text-[12.5px] text-[var(--theme-text)] whitespace-pre-wrap">
                {turn.text}
              </div>
            );
          }
          const { body, proposals } = parseReply(turn.text);
          return (
            <div key={i} className="text-[12.5px] leading-[1.55] text-[var(--text-primary)]">
              <Markdown text={body} />
              <Sources sources={turn.sources ?? []} />
              {proposals && (
                <div className="mt-2 flex flex-col gap-[5px] p-2 rounded-[8px] border border-dashed border-[var(--border)]">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-muted)]">Save?</span>
                  {proposals.line_notes.map((n, j) => {
                    const key = `${i}:n:${j}`;
                    return (
                      <ProposalRow key={key} done={applied.has(key)} label={`Note on L${n.line}`} text={n.note} onApply={() => void applyProposal(key, "line_notes", n.note, n.line)} />
                    );
                  })}
                  {proposals.remember_song.map((m, j) => {
                    const key = `${i}:s:${j}`;
                    return <ProposalRow key={key} done={applied.has(key) || knowledge.memory.includes(m)} label="Remember for this song" text={m} onApply={() => void applyProposal(key, "remember_song", m)} />;
                  })}
                  {proposals.remember_singer.map((m, j) => {
                    const key = `${i}:p:${j}`;
                    return <ProposalRow key={key} done={applied.has(key) || profile.facts.includes(m)} label="Remember about you" text={m} onApply={() => void applyProposal(key, "remember_singer", m)} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
        {busy === "chat" && <div className="text-[12px] text-[var(--text-muted)] animate-pulse">Thinking…</div>}
        {error && <div className="text-[12px] text-red-600">{error}</div>}
        <div ref={endRef} />
      </div>

      {/* Ask */}
      <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-4 py-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask your coach — Enter to send, Shift+Enter for a new line"
          className="w-full resize-none px-3 py-[7px] rounded-[9px] border border-[var(--border)] bg-[var(--surface)] text-[12.5px] outline-none focus:border-[var(--theme)]"
        />
        <div className="flex items-center gap-2 mt-[5px] text-[10.5px] text-[var(--text-muted)]">
          <span>{coach.provider === "gemini" ? "Gemini" : "Claude"} · {model}</span>
          <span>·</span>
          <span>
            web search {coach.searchMode === "auto" ? `on (≤${coach.maxSearchesPerAnswer}/answer)` : coach.searchMode === "card" ? "song card only" : "off"} · {searchesToday(coach.usage)} today
          </span>
        </div>
      </div>
    </div>
  );
}

const emptyKnowledge: SongKnowledge = { card: null, card_sources: [], memory: [], chat: [] };

function ProposalRow({ label, text, done, onApply }: { label: string; text: string; done: boolean; onApply: () => void }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="text-[10.5px] text-[var(--text-muted)] w-[118px] flex-shrink-0 pt-[1px]">{label}</span>
      <span className="flex-1 text-[var(--text-secondary)]">{text}</span>
      <button
        onClick={onApply}
        disabled={done}
        className="flex-shrink-0 px-2 py-[1px] rounded-[5px] border border-[var(--border)] bg-transparent text-[10.5px] text-[var(--theme)] cursor-pointer hover:border-[var(--theme)] disabled:text-emerald-700 disabled:border-transparent disabled:cursor-default"
      >
        {done ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
