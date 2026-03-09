// Furigana generation using kuroshiro + kuromoji analyzer.
// The dictionary is loaded from jsDelivr CDN on first use (~20 MB, cached for the session).
// Only used for Japanese text (language === "ja").

// @ts-expect-error — kuroshiro lacks type declarations
import Kuroshiro from "kuroshiro";
// @ts-expect-error — kuroshiro-analyzer-kuromoji lacks type declarations
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";

const KUROMOJI_DICT_CDN = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instance: any | null = null;
let initPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getKuroshiro(): Promise<any> {
  if (instance) return instance;
  if (!initPromise) {
    const k = new Kuroshiro();
    initPromise = k
      .init(new KuromojiAnalyzer({ dictPath: KUROMOJI_DICT_CDN }))
      .then(() => { instance = k; })
      .catch((err: unknown) => {
        // Reset so callers can retry after a transient failure (e.g. network hiccup)
        initPromise = null;
        console.error("[furigana] kuromoji init failed:", err);
        throw err;
      });
  }
  await initPromise;
  return instance;
}

/**
 * Convert Japanese text to furigana HTML (<ruby> tags).
 * Throws on failure — callers should catch and fail silently.
 */
export async function generateFurigana(text: string): Promise<string> {
  console.log("[furigana] generateFurigana called for:", text.slice(0, 30));
  const k = await getKuroshiro();
  return k.convert(text, { mode: "furigana", to: "hiragana" }) as Promise<string>;
}
