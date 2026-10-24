import { useEffect, useState } from "react";
import { searchesToday, useCoachStore, type CoachProvider, type SearchMode } from "../stores/coach-store";
import { askCoach, listModels } from "../lib/coach/providers";
import { loadProfile, saveProfile } from "../lib/coach/knowledge";

const PROVIDERS: { key: CoachProvider; label: string; keyHelp: string }[] = [
  { key: "gemini", label: "Gemini", keyHelp: "Get a key at aistudio.google.com → API keys." },
  { key: "claude", label: "Claude", keyHelp: "Get a key at platform.claude.com → API keys." },
];

const field =
  "w-full px-3 py-[7px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--theme)]";

/** Settings → Coach: connectors (keys + model), web-search allowance, and the singer profile. */
export function CoachSettings() {
  const s = useCoachStore();
  const [models, setModels] = useState<Record<CoachProvider, string[]>>({ gemini: [], claude: [] });
  const [loadingModels, setLoadingModels] = useState<CoachProvider | null>(null);
  const [test, setTest] = useState<{ provider: CoachProvider; msg: string; ok: boolean } | null>(null);
  const [facts, setFacts] = useState<string[] | null>(null);
  const [newFact, setNewFact] = useState("");
  /** Typing a model id by hand (e.g. one that isn't listed). */
  const [otherModel, setOtherModel] = useState<Record<CoachProvider, boolean>>({ gemini: false, claude: false });

  useEffect(() => {
    loadProfile().then((p) => setFacts(p.facts));
  }, []);

  const refreshModels = async (p: CoachProvider) => {
    setLoadingModels(p);
    try {
      const list = await listModels(p, s.keys[p]);
      setModels((m) => ({ ...m, [p]: list }));
      s.setModelList(p, list);
      if (!s.models[p] && list.length) {
        // Gemini: default to the first "pro" model offered; else the first.
        s.setModel(p, list.find((id) => /pro/i.test(id)) ?? list[0]);
      }
      // A busy / out-of-quota backup: the older 2.5 Flash has its own (larger) free quota.
      if (p === "gemini" && !s.fallbackModels?.gemini && list.includes("gemini-2.5-flash")) {
        s.setFallbackModel("gemini", "gemini-2.5-flash");
      }
    } catch (err) {
      setTest({ provider: p, ok: false, msg: `Couldn't list models: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoadingModels(null);
    }
  };

  // Fill the pickers for keys already saved.
  useEffect(() => {
    for (const p of PROVIDERS) if (s.keys[p.key]) void refreshModels(p.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTest = async (p: CoachProvider) => {
    setTest({ provider: p, ok: true, msg: "Asking…" });
    try {
      const r = await askCoach({
        provider: p,
        apiKey: s.keys[p],
        model: s.models[p],
        system: "Reply with one short friendly sentence.",
        context: "Connection test from the Reprise app settings.",
        history: [],
        prompt: "Say hello as a vocal coach.",
        maxSearches: null,
      });
      setTest({ provider: p, ok: true, msg: `Connected — “${r.text.slice(0, 120)}”` });
    } catch (err) {
      setTest({ provider: p, ok: false, msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const saveFacts = (next: string[]) => {
    setFacts(next);
    void saveProfile({ facts: next });
  };

  const modeOption = (mode: SearchMode, label: string, help: string) => (
    <label key={mode} className="flex items-start gap-2 cursor-pointer select-none">
      <input type="radio" checked={s.searchMode === mode} onChange={() => s.setSearchMode(mode)} className="mt-[3px] accent-[var(--theme)]" />
      <span>
        <span className="text-[13px] text-[var(--text-primary)]">{label}</span>
        <span className="block text-[11.5px] text-[var(--text-muted)]">{help}</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-8">
      <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed -mt-2">
        The coach is a vocal coach for your songs. It uses your own API key; while you use it, the song's lyrics, translation and your notes
        are sent to the provider you pick. Audio is never sent. Keys stay on this computer and aren't part of the library backup.
      </p>

      {/* Provider */}
      <div>
        <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-3">Coach uses</div>
        <div className="flex p-[3px] rounded-[9px] bg-[var(--bg)] border border-[var(--border)] w-fit">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              onClick={() => s.setProvider(p.key)}
              className={`px-4 py-[5px] rounded-[7px] text-[12.5px] font-medium border-none cursor-pointer ${
                s.provider === p.key ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "bg-transparent text-[var(--text-muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connectors */}
      {PROVIDERS.map((p) => (
        <div key={p.key}>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-3">
            {p.label} {s.provider === p.key && <span className="normal-case tracking-normal text-[var(--theme-text)]">· in use</span>}
          </div>
          <div className="flex flex-col gap-2 max-w-[520px]">
            <input
              type="password"
              value={s.keys[p.key]}
              onChange={(e) => s.setKey(p.key, e.target.value)}
              onBlur={() => s.keys[p.key] && void refreshModels(p.key)}
              placeholder={`${p.label} API key`}
              className={field}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-[11.5px] text-[var(--text-muted)]">{p.keyHelp}</span>
            <div className="flex items-center gap-2">
              {otherModel[p.key] ? (
                <input
                  autoFocus
                  value={s.models[p.key]}
                  onChange={(e) => s.setModel(p.key, e.target.value.trim())}
                  onBlur={() => setOtherModel((o) => ({ ...o, [p.key]: false }))}
                  onKeyDown={(e) => e.key === "Enter" && setOtherModel((o) => ({ ...o, [p.key]: false }))}
                  placeholder={p.key === "gemini" ? "model id, e.g. gemma-4-31b-it" : "model id"}
                  className={`${field} flex-1`}
                  spellCheck={false}
                />
              ) : (
                <select
                  value={s.models[p.key]}
                  onChange={(e) => {
                    if (e.target.value === "__other") setOtherModel((o) => ({ ...o, [p.key]: true }));
                    else s.setModel(p.key, e.target.value);
                  }}
                  className={`${field} flex-1`}
                  disabled={!s.keys[p.key]}
                >
                  {!s.models[p.key] && <option value="">Choose a model…</option>}
                  {s.models[p.key] && !models[p.key].includes(s.models[p.key]) && <option value={s.models[p.key]}>{s.models[p.key]}</option>}
                  {models[p.key].map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                  <option value="__other">Other model… (type its id)</option>
                </select>
              )}
              <button
                onClick={() => void refreshModels(p.key)}
                disabled={!s.keys[p.key] || loadingModels === p.key}
                className="px-3 py-[7px] rounded-[8px] border border-[var(--border)] bg-transparent text-[12px] text-[var(--text-secondary)] hover:border-[#888] cursor-pointer disabled:opacity-40"
              >
                {loadingModels === p.key ? "Loading…" : "Refresh"}
              </button>
              <button
                onClick={() => void runTest(p.key)}
                disabled={!s.keys[p.key] || !s.models[p.key]}
                className="px-3 py-[7px] rounded-[8px] bg-[var(--accent)] text-white text-[12px] font-medium border-none cursor-pointer hover:opacity-80 disabled:opacity-40"
              >
                Test
              </button>
            </div>
            {p.key === "gemini" && (
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <span className="flex-shrink-0">If it's busy or out of free quota, try first</span>
                <select
                  value={s.fallbackModels?.gemini ?? ""}
                  onChange={(e) => s.setFallbackModel("gemini", e.target.value)}
                  className={`${field} flex-1`}
                  disabled={!s.keys.gemini}
                >
                  <option value="">no backup</option>
                  {models.gemini.filter((id) => id !== s.models.gemini).map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </label>
            )}
            {p.key === "gemini" && (
              <span className="text-[11.5px] text-[var(--text-muted)]">
                Then up to three other Flash models from your account — each Gemini model has its own free limit.
              </span>
            )}
            {test?.provider === p.key && (
              <span className={`text-[12px] ${test.ok ? "text-emerald-700" : "text-red-600"}`}>{test.msg}</span>
            )}
          </div>
        </div>
      ))}

      {/* Web search */}
      <div>
        <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-3">Web search</div>
        <div className="flex flex-col gap-3 max-w-[520px]">
          {modeOption("off", "Off", "The coach only uses what it already knows.")}
          {modeOption("card", "Only for song cards", "Looks up the song's meaning and the original singer once, when writing the card.")}
          {modeOption("auto", "When needed", "May search during any answer, up to the limit below.")}
          <label className={`flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)] ${s.searchMode === "off" ? "opacity-40" : ""}`}>
            At most
            <input
              type="number"
              min={1}
              max={10}
              value={s.maxSearchesPerAnswer}
              onChange={(e) => s.setMaxSearchesPerAnswer(Number(e.target.value))}
              disabled={s.searchMode === "off"}
              className="w-[56px] px-2 py-[4px] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[12.5px] outline-none"
            />
            searches per answer
          </label>
          <span className="text-[11.5px] text-[var(--text-muted)]">
            Claude keeps to this limit exactly. Gemini can only be allowed or not allowed to search — it decides how many itself.
            Searches today: {searchesToday(s.usage)}.
          </span>
        </div>
      </div>

      {/* Singer profile */}
      <div>
        <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-muted)] mb-3">About you (the coach remembers this across songs)</div>
        <div className="flex flex-col gap-2 max-w-[520px]">
          {facts === null ? (
            <span className="text-[12px] text-[var(--text-muted)]">Loading…</span>
          ) : (
            <>
              {facts.length === 0 && (
                <span className="text-[12px] text-[var(--text-muted)]">
                  Nothing yet. Add things like your voice type, range, or what you're working on — or approve what the coach suggests.
                </span>
              )}
              {facts.map((f, i) => (
                <div key={i} className="group flex items-start gap-2 text-[13px] text-[var(--text-primary)]">
                  <span className="text-[var(--text-muted)]">•</span>
                  <span className="flex-1">{f}</span>
                  <button
                    onClick={() => saveFacts(facts.filter((_, j) => j !== i))}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-600 bg-transparent border-none cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
              <input
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFact.trim()) {
                    saveFacts([...facts, newFact.trim()]);
                    setNewFact("");
                  }
                }}
                placeholder="e.g. Baritone, comfortable up to about E4 — Enter to add"
                className={field}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
