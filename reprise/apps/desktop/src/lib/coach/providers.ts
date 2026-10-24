// One interface over Gemini and Claude for the coach. Calls go straight from
// the app to the provider with the singer's own key.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig } from "@google/genai";
import type { CoachProvider } from "../../stores/coach-store";

export interface CoachTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CoachRequest {
  provider: CoachProvider;
  apiKey: string;
  model: string;
  system: string;
  /** Stable context (song, notes) — sent before the conversation so it can be cached. */
  context: string;
  history: CoachTurn[];
  prompt: string;
  /** null = no web search; otherwise the most searches allowed for this answer. */
  maxSearches: number | null;
  /** Tried when the main model stays busy / overloaded after retries. */
  fallbackModel?: string;
  /** Chat: think less, answer sooner. Song cards leave this off. */
  quick?: boolean;
  /** Called with the answer so far as it streams in. */
  onText?: (soFar: string) => void;
}

export interface CoachReply {
  text: string;
  sources: { title: string; url: string }[];
  searches: number;
  /** The model that actually answered (differs from the request when the fallback ran). */
  model: string;
  /** Time to the first words, and to the whole answer (ms). */
  firstMs: number;
  totalMs: number;
}

export class CoachError extends Error {}
/** The key's quota for this model is used up (free tier: per minute / per day). */
class CoachLimitError extends CoachError {}

export async function askCoach(req: CoachRequest): Promise<CoachReply> {
  if (!req.apiKey) throw new CoachError(`Add your ${req.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings → Coach.`);
  if (!req.model) throw new CoachError("Pick a model in Settings → Coach.");
  return req.provider === "gemini" ? askGemini(req) : askClaude(req);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

/** Server-side refusal fallback ("default" routing) is offered on these models only. */
const claudeHasFallback = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
/** The dynamic-filtering web search runs on current Opus / Sonnet; other models (Haiku) take the basic tool. */
const claudeSearchTool = (model: string, maxUses: number): Anthropic.Beta.BetaToolUnion =>
  /^claude-(opus|sonnet)-(5|4-[678])/.test(model)
    ? { type: "web_search_20260209", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20250305", name: "web_search", max_uses: maxUses };

async function askClaude(req: CoachRequest): Promise<CoachReply> {
  const started = performance.now();
  let firstAt = 0;
  const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    // The song context is the same every turn: cache it with the system prompt.
    { role: "user", content: [{ type: "text", text: req.context, cache_control: { type: "ephemeral" } }] },
    { role: "assistant", content: "I have the song, your notes and your marks. What would you like to work on?" },
    ...req.history.map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: req.prompt },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined =
    req.maxSearches != null ? [claudeSearchTool(req.model, req.maxSearches)] : undefined;
  const fallback = claudeHasFallback(req.model)
    ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const }
    : {};

  let text = "";
  const sources = new Map<string, string>();
  let searches = 0;
  let model = req.model;
  try {
    // Long server-side tool runs can pause; continue them a few times.
    for (let round = 0; round < 4; round++) {
      const stream = client.beta.messages.stream({
        model: req.model,
        max_tokens: 16000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        output_config: { effort: req.quick ? "low" : "medium" },
        ...fallback,
      });
      stream.on("text", (delta) => {
        if (!firstAt) firstAt = performance.now();
        text += delta;
        req.onText?.(text);
      });
      const msg = await stream.finalMessage();
      model = msg.model;
      searches += msg.usage.server_tool_use?.web_search_requests ?? 0;
      for (const block of msg.content) {
        if (block.type !== "text") continue;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") sources.set(c.url, c.title ?? c.url);
        }
      }
      if (msg.stop_reason === "refusal") throw new CoachError("The coach declined to answer that. Try rephrasing the question.");
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
    const totalMs = performance.now() - started;
    return {
      text: text.trim(),
      sources: [...sources].map(([url, title]) => ({ url, title })),
      searches,
      model,
      firstMs: firstAt ? firstAt - started : totalMs,
      totalMs,
    };
  } catch (err) {
    if (err instanceof CoachError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new CoachError("Claude rejected the API key — check it in Settings → Coach.");
    if (err instanceof Anthropic.RateLimitError) throw new CoachError("Claude is rate-limiting this key — wait a moment and try again.");
    if (err instanceof Anthropic.APIError) throw new CoachError(`Claude error ${err.status ?? ""}: ${err.message}`);
    throw new CoachError(`Couldn't reach Claude: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/** "High demand" / overloaded: worth retrying, then trying another model. */
const isBusy = (msg: string) => /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function askGemini(req: CoachRequest): Promise<CoachReply> {
  const fallback = req.fallbackModel && req.fallbackModel !== req.model ? req.fallbackModel : null;
  // Busy (503): retry the model twice. Busy again, or out of quota (429 — each model has
  // its own free-tier quota): go to the backup model.
  const waits = [0, 1500, 4000];
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await sleep(waits[i]);
    try {
      return await askGeminiOnce(req, req.model);
    } catch (err) {
      if (err instanceof CoachLimitError) break;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBusy(msg)) throw err;
    }
  }
  if (fallback) {
    try {
      return await askGeminiOnce(req, fallback);
    } catch (err) {
      if (err instanceof CoachLimitError) {
        throw new CoachError(`The free-tier limit is used up for ${req.model} and the backup ${fallback} — wait a minute (or until tomorrow for daily limits), or pick another model in Settings → Coach.`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBusy(msg)) throw err;
    }
  }
  throw new CoachError(
    `Gemini ${req.model} is busy or out of free quota right now${fallback ? `, and so is the backup ${fallback}` : ""}. Try again in a minute, ${fallback ? "or" : "set a backup model or"} pick another model in Settings → Coach.`,
  );
}

/** Gemini 3 and newer take a thinking level; 2.5 models don't. */
const takesThinkingLevel = (model: string) => /gemini-([3-9]|\d{2,})/i.test(model);

async function askGeminiOnce(req: CoachRequest, model: string, withThinkingLevel = true): Promise<CoachReply> {
  const started = performance.now();
  let firstAt = 0;
  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const contents: Content[] = [
    { role: "user", parts: [{ text: req.context }] },
    { role: "model", parts: [{ text: "I have the song, your notes and your marks. What would you like to work on?" }] },
    ...req.history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: req.prompt }] },
  ];
  const config: GenerateContentConfig = {
    systemInstruction: req.system,
    // Gemini decides how many searches to run; we can only allow or forbid it.
    tools: req.maxSearches != null ? [{ googleSearch: {} }] : undefined,
    maxOutputTokens: 8192,
  };
  // Chat answers don't need long deliberation — thinking is most of the wait.
  if (req.quick && withThinkingLevel && takesThinkingLevel(model)) config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };

  let text = "";
  const sources = new Map<string, string>();
  let searches = 0;
  try {
    const stream = await ai.models.generateContentStream({ model, contents, config });
    for await (const chunk of stream) {
      const t = chunk.text;
      if (t) {
        if (!firstAt) firstAt = performance.now();
        text += t;
        req.onText?.(text);
      }
      const meta = chunk.candidates?.[0]?.groundingMetadata;
      for (const g of meta?.groundingChunks ?? []) if (g.web?.uri) sources.set(g.web.uri, g.web.title ?? g.web.uri);
      if (meta?.webSearchQueries?.length) searches = Math.max(searches, meta.webSearchQueries.length);
    }
    if (!text.trim()) throw new CoachError("Gemini returned an empty answer — try again, or pick another model.");
    const totalMs = performance.now() - started;
    return {
      text: text.trim(),
      sources: [...sources].map(([url, title]) => ({ url, title })),
      searches,
      model,
      firstMs: firstAt ? firstAt - started : totalMs,
      totalMs,
    };
  } catch (err) {
    if (err instanceof CoachError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // A model that doesn't accept the thinking level: ask again without it.
    if (config.thinkingConfig && !text && /thinking/i.test(msg) && /400|INVALID_ARGUMENT/i.test(msg)) {
      return askGeminiOnce(req, model, false);
    }
    if (isBusy(msg) && !text) throw err; // handled by the retry loop
    if (/API key|PERMISSION_DENIED|401|403/i.test(msg)) throw new CoachError("Gemini rejected the API key — check it in Settings → Coach.");
    if (/429|RESOURCE_EXHAUSTED/i.test(msg)) throw new CoachLimitError(`Free-tier limit reached for ${model}.`);
    throw new CoachError(`Gemini error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Models (for the Settings picker — no guessing model names)
// ---------------------------------------------------------------------------

export async function listModels(provider: CoachProvider, apiKey: string): Promise<string[]> {
  if (!apiKey) return [];
  if (provider === "claude") {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list();
  const names: string[] = [];
  for await (const m of pager) {
    if (!m.name || !(m.supportedActions ?? []).includes("generateContent")) continue;
    const id = m.name.replace(/^models\//, "");
    if (/gemini/i.test(id) && !/embedding|image|tts|audio|live|vision/i.test(id)) names.push(id);
  }
  // Newest-looking first: higher version numbers, "pro" before "flash".
  return names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
