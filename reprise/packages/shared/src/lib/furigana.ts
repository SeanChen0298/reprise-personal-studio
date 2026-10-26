// Furigana generation using kuroshiro + kuromoji analyzer.
// The dictionary (~17 MB) is bundled with the desktop app at
// apps/desktop/public/kuromoji/dict and served from the app origin, so furigana
// works fully offline. Only used for Japanese text (language === "ja").

// @ts-expect-error — kuroshiro lacks type declarations
import Kuroshiro from "kuroshiro";
// @ts-expect-error — kuroshiro-analyzer-kuromoji lacks type declarations
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";

// Origin-absolute path to the bundled dict (Vite serves public/ at the app root).
const KUROMOJI_DICT_PATH = "/kuromoji/dict/";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instance: any | null = null;
let initPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getKuroshiro(): Promise<any> {
  if (instance) return instance;
  if (!initPromise) {
    const k = new Kuroshiro();
    initPromise = k
      .init(new KuromojiAnalyzer({ dictPath: KUROMOJI_DICT_PATH }))
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

// Parts of speech that join the word before them in romaji ("toke" + "te" → "tokete").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GLUES = (t: any) =>
  t.pos === "助動詞" || (t.pos === "助詞" && t.pos_detail_1 === "接続助詞") || (t.pos === "動詞" && t.pos_detail_1 === "非自立") || t.pos_detail_1 === "接尾";
const OPEN: Record<string, string> = { "「": "“", "『": "“", "（": "(", "(": "(" };
const CLOSE: Record<string, string> = { "」": "”", "』": "”", "）": ")", ")": ")", "、": ",", "。": ".", "！": "!", "？": "?", "!": "!", "?": "?", "…": "…", "～": "~", "〜": "~" };

/**
 * Japanese text → Hepburn romaji with word spacing, read as it's pronounced
 * (particle は → "wa", long vowels with macrons): "あなたは夕日に溶けて" → "anata wa yūhi ni tokete".
 * Throws on failure — callers should catch and fail silently.
 */
export async function generateRomaji(text: string): Promise<string> {
  const k = await getKuroshiro();
  const U = Kuroshiro.Util;
  const tokens = await k._analyzer.parse(text);
  const words: string[] = [];
  let pending = "";
  for (const t of tokens) {
    const s: string = t.surface_form;
    if (/^\s+$/.test(s)) continue;
    if (OPEN[s] != null) {
      pending += OPEN[s];
      continue;
    }
    if (CLOSE[s] != null) {
      if (words.length) words[words.length - 1] += CLOSE[s];
      else pending += CLOSE[s];
      continue;
    }
    const kana: string = U.hasJapanese(s) ? t.pronunciation || t.reading || s : s;
    const r: string = U.hasJapanese(kana) ? U.kanaToRomaji(kana, "hepburn") : kana;
    if (words.length && !pending && GLUES(t)) words[words.length - 1] += r;
    else {
      words.push(pending + r);
      pending = "";
    }
  }
  return words.join(" ").trim();
}
