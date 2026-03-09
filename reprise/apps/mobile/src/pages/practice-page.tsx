import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Song, Line, Annotation } from "@reprise/shared";

// ─── Annotation colors (mirrors desktop highlight-config defaults) ──────────

const ANNOTATION_COLORS: Record<string, { bg: string; color: string }> = {
  falsetto: { bg: "rgba(219,234,254,0.25)", color: "#60A5FA" },
  whisper:  { bg: "rgba(220,252,231,0.25)", color: "#4ADE80" },
  accent:   { bg: "rgba(254,226,226,0.25)", color: "#F87171" },
  vibrato:  { bg: "rgba(245,243,255,0.25)", color: "#A78BFA" },
  breath:   { bg: "rgba(255,247,237,0.25)", color: "#FB923C" },
};

// ─── Annotated text renderer ─────────────────────────────────────────────────

function AnnotatedText({ text, annotations }: { text: string; annotations?: Annotation[] }) {
  if (!annotations || annotations.length === 0) return <>{text}</>;

  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const segments: { text: string; annotation?: Annotation }[] = [];
  let pos = 0;

  for (const ann of sorted) {
    if (ann.start > pos) segments.push({ text: text.slice(pos, ann.start) });
    if (ann.end > ann.start) segments.push({ text: text.slice(ann.start, ann.end), annotation: ann });
    pos = ann.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos) });

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.annotation) return <span key={i}>{seg.text}</span>;
        const colors = ANNOTATION_COLORS[seg.annotation.type] ?? {
          bg: "rgba(255,255,255,0.1)",
          color: "var(--color-text)",
        };
        return (
          <mark key={i} style={{ background: colors.bg, color: colors.color, borderRadius: 3, padding: "0 1px" }}>
            {seg.text}
          </mark>
        );
      })}
    </>
  );
}

// ─── Line text — handles furigana HTML in custom_text ────────────────────────

function LineText({ line }: { line: Line }) {
  const displayText = line.custom_text ?? line.text;
  const hasHtml = displayText.includes("<ruby>") || displayText.includes("<rt>");

  if (hasHtml) {
    return (
      <span
        className="leading-relaxed"
        // custom_text is user-authored content, not from external sources
        dangerouslySetInnerHTML={{ __html: displayText }}
      />
    );
  }

  return (
    <span className="leading-relaxed">
      <AnnotatedText
        text={displayText}
        annotations={line.annotations as Annotation[] | undefined}
      />
    </span>
  );
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

async function resolveAudioSrc(audioPath: string): Promise<string> {
  if (audioPath.startsWith("http://") || audioPath.startsWith("https://")) {
    return audioPath;
  }
  try {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    return convertFileSrc(audioPath);
  } catch {
    return audioPath;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── No-song placeholder ──────────────────────────────────────────────────────

function NoSongSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-surface)]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10,8 16,12 10,16" fill="var(--color-text-muted)" stroke="none" />
        </svg>
      </div>
      <p className="text-base font-semibold text-[var(--color-text)]">No song selected</p>
      <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
        Tap a song in your library to start practicing.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [song, setSong] = useState<Song | null>(null);
  const [rawLines, setRawLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);

  // Audio state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Refs for scroll-to-line
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Fetch song + lines ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);

    async function load() {
      const [{ data: songData }, { data: linesData }] = await Promise.all([
        supabase.from("songs").select("*").eq("id", id!).single(),
        supabase
          .from("lines")
          .select("id, song_id, text, custom_text, annotations, order, start_ms, end_ms, status, language")
          .eq("song_id", id!)
          .order("order", { ascending: true }),
      ]);

      if (cancelled) return;

      setSong(songData as Song | null);
      setRawLines((linesData ?? []) as Line[]);
      setLoading(false);

      // Resolve audio src
      const path = (songData as Song | null)?.audio_path;
      if (path) {
        resolveAudioSrc(path).then((src) => {
          if (!cancelled) setAudioSrc(src);
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  // ── Derived data ────────────────────────────────────────────────────────────

  // Primary language lines
  const lines = useMemo(() => {
    const mainLang = song?.language;
    return rawLines.filter(
      (l) => !mainLang || !l.language || l.language === mainLang
    );
  }, [rawLines, song?.language]);

  // Translation lines mapped by order
  const translationByOrder = useMemo(() => {
    const transLang = song?.translation_language;
    if (!transLang) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const l of rawLines) {
      if (l.language === transLang) map.set(l.order, l.text);
    }
    return map;
  }, [rawLines, song?.translation_language]);

  const hasTranslation = translationByOrder.size > 0;

  // Active line index based on current playback time
  const activeLineIdx = useMemo(() => {
    const ms = currentTime * 1000;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.start_ms == null) continue;
      const end = line.end_ms ?? lines[i + 1]?.start_ms ?? Infinity;
      if (ms >= line.start_ms && ms < end) return i;
    }
    return -1;
  }, [currentTime, lines]);

  // ── Scroll active line into view ────────────────────────────────────────────

  useEffect(() => {
    if (activeLineIdx < 0) return;
    const el = lineRefs.current.get(activeLineIdx);
    if (el && scrollRef.current) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeLineIdx]);

  // ── Audio event handlers ────────────────────────────────────────────────────

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);
  }, []);

  const handleDurationChange = useCallback(() => {
    const audio = audioRef.current;
    if (audio && isFinite(audio.duration)) setDuration(audio.duration);
  }, []);

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const handleSeek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = value;
      setCurrentTime(value);
    }
  }, []);

  const seekToLine = useCallback((lineIdx: number) => {
    const line = lines[lineIdx];
    if (line?.start_ms == null) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = line.start_ms / 1000;
    setCurrentTime(line.start_ms / 1000);
    audio.play().catch(() => {});
  }, [lines]);

  // ── Render: no id ───────────────────────────────────────────────────────────

  if (!id) return <NoSongSelected />;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-theme)] border-t-transparent" />
      </div>
    );
  }

  if (!song) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-base font-semibold text-[var(--color-text)]">Song not found</p>
        <button
          onClick={() => navigate("/")}
          className="min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium text-[var(--color-theme-light)] active:opacity-70"
        >
          Back to library
        </button>
      </div>
    );
  }

  // ── Render: full practice view ──────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Hidden audio element */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onLoadedMetadata={handleDurationChange}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => navigate("/")}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full active:bg-[var(--color-border)]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{song.title}</p>
          <p className="truncate text-[12px] text-[var(--color-text-muted)]">{song.artist}</p>
        </div>

        {hasTranslation && (
          <button
            onClick={() => setShowTranslation((v) => !v)}
            className={[
              "flex h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-medium transition-colors",
              showTranslation
                ? "bg-[var(--color-theme)] text-white"
                : "bg-[var(--color-border)] text-[var(--color-text-muted)]",
            ].join(" ")}
          >
            TL
          </button>
        )}
      </header>

      {/* Lyrics scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            <p className="text-sm text-[var(--color-text-muted)]">No lyrics added yet.</p>
          </div>
        ) : (
          <div className="space-y-0.5 pb-4">
            {lines.map((line, idx) => {
              const isActive = idx === activeLineIdx;
              const translation = translationByOrder.get(line.order);

              return (
                <div
                  key={line.id}
                  ref={(el) => {
                    if (el) lineRefs.current.set(idx, el);
                    else lineRefs.current.delete(idx);
                  }}
                  onClick={() => seekToLine(idx)}
                  className={[
                    "rounded-lg px-3 py-2.5 transition-colors",
                    isActive
                      ? "bg-[var(--color-theme)] bg-opacity-15"
                      : "active:bg-[var(--color-surface)]",
                  ].join(" ")}
                >
                  {/* Status dot */}
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_DOT_COLORS[line.status as keyof typeof STATUS_DOT_COLORS] ?? "#94A3B8" }}
                    />
                    <div className="min-w-0 flex-1">
                      {/* Lyrics text */}
                      <p
                        className={[
                          "text-[15px] leading-relaxed",
                          isActive ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text)]",
                        ].join(" ")}
                      >
                        <LineText line={line} />
                      </p>

                      {/* Translation */}
                      {showTranslation && translation && (
                        <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-text-muted)]">
                          {translation}
                        </p>
                      )}

                      {/* Timestamps */}
                      {line.start_ms != null && (
                        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)] opacity-50">
                          {formatTime(line.start_ms / 1000)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Audio player */}
      <div
        className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 pt-4 pb-4"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        {!audioSrc ? (
          <p className="text-center text-sm text-[var(--color-text-muted)]">
            Audio not available on mobile
          </p>
        ) : (
          <>
            {/* Seek bar */}
            <div className="mb-3 flex items-center gap-2">
              <span className="w-8 text-right text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)] accent-[var(--color-theme)]"
              />
              <span className="w-8 text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {formatTime(duration)}
              </span>
            </div>

            {/* Play / pause */}
            <div className="flex items-center justify-center">
              <button
                onClick={handlePlayPause}
                className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[var(--color-theme)] text-white active:opacity-80"
              >
                {isPlaying ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Status dot colors (inlined — mirrors desktop status-config)
const STATUS_DOT_COLORS = {
  new:          "#94A3B8",
  listened:     "#60A5FA",
  annotated:    "#F59E0B",
  practiced:    "#F97316",
  recorded:     "#22C55E",
  best_take_set:"#EAB308",
} as const;
