/**
 * Local-only line translation using Helsinki-NLP Opus-MT models via
 * @huggingface/transformers (ONNX Runtime Web). Models are downloaded once
 * from the HF hub on first use and cached by the runtime; subsequent calls
 * run fully offline.
 */

// Map ISO source language → English-target Marian model on the HF hub.
// Each model is ~80 MB quantized.
const MODEL_BY_SRC: Record<string, string> = {
  ja: "Xenova/opus-mt-ja-en",
  ko: "Xenova/opus-mt-ko-en",
  zh: "Xenova/opus-mt-zh-en",
  fr: "Xenova/opus-mt-fr-en",
  es: "Xenova/opus-mt-es-en",
  de: "Xenova/opus-mt-de-en",
  it: "Xenova/opus-mt-it-en",
  ru: "Xenova/opus-mt-ru-en",
  nl: "Xenova/opus-mt-nl-en",
  ar: "Xenova/opus-mt-ar-en",
  hi: "Xenova/opus-mt-hi-en",
  vi: "Xenova/opus-mt-vi-en",
};

export type TranslateProgress = {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

const pipelineCache = new Map<string, Promise<any>>();

function normalizeLang(code: string): string {
  return code.split("-")[0].toLowerCase();
}

export function isTranslationSupported(srcLang: string | undefined): boolean {
  if (!srcLang) return false;
  return normalizeLang(srcLang) in MODEL_BY_SRC;
}

async function getTranslator(
  modelId: string,
  onProgress?: (p: TranslateProgress) => void,
): Promise<any> {
  let promise = pipelineCache.get(modelId);
  if (!promise) {
    promise = (async () => {
      const tx = await import("@huggingface/transformers");
      // Force fp32 weights — the int8-quantized Opus-MT exports trip ORT Web
      // with `Can't create a session. qdq_actions`. fp32 is bigger (~300 MB)
      // but loads reliably across decoder/encoder pairs.
      return tx.pipeline("translation", modelId, {
        progress_callback: onProgress,
        dtype: "fp32",
      });
    })();
    pipelineCache.set(modelId, promise);
  }
  return promise;
}

/**
 * Translate a single line of text to English.
 * `onProgress` fires only during the first call (model download + load).
 */
export async function translateToEnglish(
  text: string,
  srcLang: string,
  onProgress?: (p: TranslateProgress) => void,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const lang = normalizeLang(srcLang);
  const modelId = MODEL_BY_SRC[lang];
  if (!modelId) {
    throw new Error(`No local translation model for source language "${srcLang}"`);
  }

  const translator = await getTranslator(modelId, onProgress);
  const out = await translator(trimmed);
  const first = Array.isArray(out) ? out[0] : out;
  if (first && typeof first === "object" && "translation_text" in first) {
    return String((first as { translation_text: unknown }).translation_text);
  }
  throw new Error("Unexpected translation output shape");
}

/** Translate a batch of lines, preserving order. */
export async function translateLinesToEnglish(
  texts: string[],
  srcLang: string,
  onProgress?: (p: TranslateProgress) => void,
): Promise<string[]> {
  const lang = normalizeLang(srcLang);
  const modelId = MODEL_BY_SRC[lang];
  if (!modelId) {
    throw new Error(`No local translation model for source language "${srcLang}"`);
  }

  const translator = await getTranslator(modelId, onProgress);
  const results: string[] = [];
  for (const t of texts) {
    const trimmed = t.trim();
    if (!trimmed) {
      results.push("");
      continue;
    }
    const out = await translator(trimmed);
    const first = Array.isArray(out) ? out[0] : out;
    if (first && typeof first === "object" && "translation_text" in first) {
      results.push(String((first as { translation_text: unknown }).translation_text));
    } else {
      results.push("");
    }
  }
  return results;
}
