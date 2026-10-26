// A song's colour, from its artwork: the most present vivid hue (or the overall tone when the
// artwork is grey). The phone tints the song's screen, its player bar and cards with it.
// Also how much of the thumbnail is black letterbox bars (top / bottom), so the phone can crop them.

export interface ArtworkInfo {
  color?: string;
  /** Fraction of the height that is black bars, on each of top and bottom (0–0.3). */
  bars: number;
  /** The thumbnail's width / height. */
  aspect: number;
}

const cache = new Map<string, ArtworkInfo>();

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** Colour and letterbox of a song's artwork (base64 thumbnail only — remote images can't be read back). */
export async function artworkInfo(song: { id: string; thumbnail_b64?: string | null }): Promise<ArtworkInfo> {
  const b64 = song.thumbnail_b64;
  if (!b64) return { bars: 0, aspect: 16 / 9 };
  const key = `${song.id}:${b64.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: string | null = null;
  let bars = 0;
  let aspect = 16 / 9;
  try {
    const img = await loadImage(b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`);
    if (img.width && img.height) aspect = img.width / img.height;
    const w = 48;
    const h = Math.max(27, Math.round((48 * img.height) / Math.max(1, img.width)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      // Letterbox: rows (from the top and the bottom) that are nearly black all the way across.
      const dark = (y: number) => {
        let sum = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          sum += px[i] + px[i + 1] + px[i + 2];
        }
        return sum / (w * 3) < 22;
      };
      let top = 0;
      while (top < h / 3 && dark(top)) top++;
      let bottom = 0;
      while (bottom < h / 3 && dark(h - 1 - bottom)) bottom++;
      bars = Math.min(0.3, Math.min(top, bottom) / h);
      // Hue buckets weighted by saturation; dark letterbox bars and blown-out whites don't count.
      const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
      let all = { n: 0, r: 0, g: 0, b: 0 };
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const light = (max + min) / 510;
        if (light < 0.1 || light > 0.94) continue;
        all = { n: all.n + 1, r: all.r + r, g: all.g + g, b: all.b + b };
        const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
        if (sat < 0.22) continue;
        let hue = 0;
        if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        const k = Math.floor((hue / 6) * 12) % 12;
        const wt = sat * sat;
        buckets[k] = { w: buckets[k].w + wt, r: buckets[k].r + r * wt, g: buckets[k].g + g * wt, b: buckets[k].b + b * wt };
      }
      const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
      // Enough vivid pixels → that hue; otherwise the artwork's overall tone.
      if (best.w > all.n * 0.04) out = toHex(best.r / best.w, best.g / best.w, best.b / best.w);
      else if (all.n) out = toHex(all.r / all.n, all.g / all.n, all.b / all.n);
    }
  } catch {
    out = null;
  }
  const info: ArtworkInfo = { color: out ?? undefined, bars: Math.round(bars * 1000) / 1000, aspect: Math.round(aspect * 1000) / 1000 };
  if (cache.size > 500) cache.clear();
  cache.set(key, info);
  return info;
}
