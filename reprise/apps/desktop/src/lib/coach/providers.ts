// One interface over Gemini and Claude for the coach. Calls go straight from
// the app to the provider with the singer's own key.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Content } from "@google/genai";
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
}

export interface CoachReply {
  text: string;
  sources: { title: string; url: string }[];
  searches: number;
}

export class CoachError extends Error {}

export async function askCoach(req: CoachRequest): Promise<CoachReply> {
  if (!req.apiKey) throw new CoachError(`Add your ${req.provider === "gemini" ? "Gemini" : "Claude"} API key in Settings → Coach.`);
  if (!req.model) throw new CoachError("Pick a model in Settings → Coach.");
  return req.provider === "gemini" ? askGemini(req) : askClaude(req);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

async function askClaude(req: CoachRequest): Promise<CoachReply> {
  const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    // The song context is the same every turn: cache it with the system prompt.
    { role: "user", content: [{ type: "text", text: req.context, cache_control: { type: "ephemeral" } }] },
    { role: "assistant", content: "I have the song, your notes and your marks. What would you like to work on?" },
    ...req.history.map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: req.prompt },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined =
    req.maxSearches != null ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.maxSearches }] : undefined;

  try {
    let msg = await client.beta.messages.create({
      model: req.model,
      max_tokens: 16000,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages,
      tools,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    // Long server-side tool runs can pause; continue them a few times.
    for (let i = 0; msg.stop_reason === "pause_turn" && i < 3; i++) {
      messages.push({ role: "assistant", content: msg.content });
      msg = await client.beta.messages.create({
        model: req.model,
        max_tokens: 16000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    }
    if (msg.stop_reason === "refusal") throw new CoachError("The coach declined to answer that. Try rephrasing the question.");

    let text = "";
    const sources = new Map<string, string>();
    for (const block of msg.content) {
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") sources.set(c.url, c.title ?? c.url);
      }
    }
    const searches = msg.usage.server_tool_use?.web_search_requests ?? 0;
    return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })), searches };
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

async function askGemini(req: CoachRequest): Promise<CoachReply> {
  const ai = new GoogleGenAI({ apiKey: req.apiKey });
  const contents: Content[] = [
    { role: "user", parts: [{ text: req.context }] },
    { role: "model", parts: [{ text: "I have the song, your notes and your marks. What would you like to work on?" }] },
    ...req.history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: req.prompt }] },
  ];
  try {
    const res = await ai.models.generateContent({
      model: req.model,
      contents,
      config: {
        systemInstruction: req.system,
        // Gemini decides how many searches to run; we can only allow or forbid it.
        tools: req.maxSearches != null ? [{ googleSearch: {} }] : undefined,
        maxOutputTokens: 8192,
      },
    });
    const text = res.text ?? "";
    const meta = res.candidates?.[0]?.groundingMetadata;
    const sources = new Map<string, string>();
    for (const chunk of meta?.groundingChunks ?? []) {
      if (chunk.web?.uri) sources.set(chunk.web.uri, chunk.web.title ?? chunk.web.uri);
    }
    const searches = meta?.webSearchQueries?.length ?? 0;
    if (!text.trim()) throw new CoachError("Gemini returned an empty answer — try again, or pick another model.");
    return { text: text.trim(), sources: [...sources].map(([url, title]) => ({ url, title })), searches };
  } catch (err) {
    if (err instanceof CoachError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/API key|PERMISSION_DENIED|401|403/i.test(msg)) throw new CoachError("Gemini rejected the API key — check it in Settings → Coach.");
    if (/429|RESOURCE_EXHAUSTED/i.test(msg)) throw new CoachError("Gemini is rate-limiting this key — wait a moment and try again.");
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
