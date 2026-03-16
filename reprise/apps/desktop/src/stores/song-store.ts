import { create } from "zustand";
import type { Song, ImportDraft, Line, LineStatus, Annotation, Recording, Section } from "../types/song";
import { upgradeStatus } from "../lib/status-config";
import {
  downloadAudio,
  buildSongFolder,
  separateStems,
} from "../lib/audio-download";
import { analyzePitch } from "../lib/audio-analysis";
import { supabase } from "../lib/supabase";
import { readFile } from "@tauri-apps/plugin-fs";
import MusicTempo from "music-tempo";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Cast to any to bypass Supabase's generated type inference (which resolves
// to `never` when Database generics don't perfectly match call-site types).
// Safety is enforced by RLS policies and the DB schema instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Maps a user-facing language name (or code) to a yt-dlp language code. */
function languageNameToCode(language?: string): string | undefined {
  if (!language) return undefined;
  const l = language.toLowerCase().trim();
  const map: Record<string, string> = {
    japanese: "ja", ja: "ja",
    english: "en",  en: "en",
    korean: "ko",   ko: "ko",
    chinese: "zh",  zh: "zh",
    spanish: "es",  es: "es",
    french: "fr",   fr: "fr",
    german: "de",   de: "de",
    portuguese: "pt", pt: "pt",
    italian: "it",  it: "it",
  };
  return map[l];
}

async function detectBpmFromFile(filePath: string): Promise<number | null> {
  try {
    const data = await readFile(filePath);
    const ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(data.buffer as ArrayBuffer);
    await ctx.close();
    const channelData = audioBuffer.getChannelData(0);
    const mt = new MusicTempo(channelData);
    return Math.round(mt.tempo);
  } catch {
    return null;
  }
}

async function getUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ---------------------------------------------------------------------------
// Store interface (unchanged — drop-in replacement)
// ---------------------------------------------------------------------------

interface SongStore {
  songs: Song[];
  lines: Record<string, Line[]>;       // songId -> lines
  recordings: Record<string, Recording[]>; // songId -> recordings
  sections: Record<string, Section[]>; // songId -> sections
  importDraft: ImportDraft | null;
  isLoading: boolean;
  loadError: string | null;

  // Bootstrap — call once on app load (after auth)
  loadAllData: () => Promise<void>;
  // Clear all data on sign out
  clearData: () => void;

  setImportDraft: (draft: ImportDraft | null) => void;
  addSong: (
    data: Omit<Song, "id" | "created_at" | "updated_at" | "mastery" | "pinned">
  ) => Promise<Song>;
  updateSong: (id: string, data: Partial<Song>) => Promise<void>;
  removeSong: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;

  // Audio download, stem separation & pitch analysis
  downloadSongAudio: (id: string) => Promise<void>;
  separateSongStems: (id: string) => Promise<void>;
  analyzeSongPitch: (id: string) => Promise<void>;
  markStaleAnalysesAsFailed: () => Promise<void>;

  // Lines management
  setLines: (songId: string, lines: Line[]) => Promise<void>;
  /** Replace only lines matching `language` (or null-language legacy lines when language is null).
   *  Lines of other languages are preserved. */
  setLinesForLanguage: (songId: string, language: string | null, lines: Line[]) => Promise<void>;
  addLine: (songId: string, text: string, order: number) => Promise<void>;
  updateLine: (songId: string, lineId: string, data: Partial<Line>) => Promise<void>;
  removeLine: (songId: string, lineId: string) => Promise<void>;
  updateLineStatus: (songId: string, lineId: string, status: LineStatus) => Promise<void>;
  /** Increment play_count and auto-upgrade status (listened at 1, practiced at 10) */
  incrementPlayCount: (songId: string, lineId: string) => Promise<void>;
  /** Generate furigana HTML for all Japanese lines of a song and persist it. Fire-and-forget safe. */
  generateFuriganaForSong: (songId: string) => Promise<void>;
  updateLineCustomText: (songId: string, lineId: string, customText: string) => Promise<void>;
  updateLineAnnotations: (songId: string, lineId: string, annotations: Annotation[]) => Promise<void>;
  getLinesForSong: (songId: string) => Line[];

  // Recordings management
  addRecording: (songId: string, recording: Recording) => Promise<void>;
  removeRecording: (songId: string, recordingId: string) => Promise<void>;
  updateRecording: (songId: string, recordingId: string, data: Partial<Pick<Recording, "note" | "is_best_take">>) => Promise<void>;
  toggleMasterTake: (songId: string, recordingId: string) => Promise<void>;
  getRecordingsForLine: (songId: string, lineId: string) => Recording[];

  // Sections management
  addSection: (songId: string, section: Section) => Promise<void>;
  updateSection: (songId: string, sectionId: string, data: Partial<Section>) => Promise<void>;
  removeSection: (songId: string, sectionId: string) => Promise<void>;
  getSectionsForSong: (songId: string) => Section[];
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useSongStore = create<SongStore>()((set, get) => ({
  songs: [],
  lines: {},
  recordings: {},
  sections: {},
  importDraft: null,
  isLoading: false,
  loadError: null,

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  loadAllData: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const userId = await getUserId();

      const [songsRes, linesRes, recordingsRes, sectionsRes] = await Promise.all([
        db.from("songs").select("*").eq("user_id", userId).order("created_at"),
        db.from("lines").select("*").eq("user_id", userId),
        db.from("recordings").select("*").eq("user_id", userId),
        db.from("sections").select("*").eq("user_id", userId),
      ]);

      if (songsRes.error) throw songsRes.error;
      if (linesRes.error) throw linesRes.error;
      if (recordingsRes.error) throw recordingsRes.error;
      if (sectionsRes.error) throw sectionsRes.error;

      // Group lines/recordings/sections by song_id
      const lines: Record<string, Line[]> = {};
      for (const row of linesRes.data) {
        const line = dbRowToLine(row);
        (lines[line.song_id] ??= []).push(line);
      }

      const recordings: Record<string, Recording[]> = {};
      for (const row of recordingsRes.data) {
        (recordings[row.song_id] ??= []).push(dbRowToRecording(row));
      }

      const sections: Record<string, Section[]> = {};
      for (const row of sectionsRes.data) {
        (sections[row.song_id] ??= []).push(dbRowToSection(row));
      }

      set({
        songs: songsRes.data.map(dbRowToSong),
        lines,
        recordings,
        sections,
        isLoading: false,
      });
    } catch (err) {
      set({
        loadError: err instanceof Error ? err.message : "Failed to load data",
        isLoading: false,
      });
    }
  },

  // -------------------------------------------------------------------------
  // Import draft
  // -------------------------------------------------------------------------

  clearData: () => set({ songs: [], lines: {}, recordings: {}, sections: {} }),

  setImportDraft: (draft) => set({ importDraft: draft }),

  // -------------------------------------------------------------------------
  // Songs
  // -------------------------------------------------------------------------

  addSong: async (data) => {
    const userId = await getUserId();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const song: Song = {
      ...data,
      id,
      user_id: userId,
      mastery: 0,
      pinned: false,
      tags: data.tags ?? [],
      download_status: "idle",
      created_at: now,
      updated_at: now,
    };

    // Optimistic update
    set((s) => ({ songs: [...s.songs, song] }));

    const { error } = await db.from("songs").insert(songToDbRow(song));
    if (error) {
      // Rollback
      set((s) => ({ songs: s.songs.filter((x) => x.id !== id) }));
      throw error;
    }

    return song;
  },

  updateSong: async (id, data) => {
    const now = new Date().toISOString();
    const updated = { ...data, updated_at: now };

    // Optimistic update
    set((s) => ({
      songs: s.songs.map((song) =>
        song.id === id ? { ...song, ...updated } : song
      ),
    }));

    const { error } = await supabase
      .from("songs")
      .update(updated)
      .eq("id", id);

    if (error) {
      // Reload to recover correct state
      await get().loadAllData();
      throw error;
    }
  },

  removeSong: async (id) => {
    // Optimistic update
    set((s) => {
      const { [id]: _l, ...restLines } = s.lines;
      const { [id]: _r, ...restRecordings } = s.recordings;
      const { [id]: _s, ...restSections } = s.sections;
      return {
        songs: s.songs.filter((song) => song.id !== id),
        lines: restLines,
        recordings: restRecordings,
        sections: restSections,
      };
    });

    // Cascade deletes are handled by the DB foreign keys
    const { error } = await db.from("songs").delete().eq("id", id);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  togglePin: async (id) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song) return;
    await get().updateSong(id, { pinned: !song.pinned });
  },

  // -------------------------------------------------------------------------
  // Audio processing (unchanged logic, uses updateSong which now hits Supabase)
  // -------------------------------------------------------------------------

  downloadSongAudio: async (id) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song?.youtube_url) return;

    const songFolder = buildSongFolder(song.title, song.artist, id);

    await get().updateSong(id, {
      download_status: "downloading",
      download_error: undefined,
      audio_folder: songFolder,
    });

    try {
      const prefLang = languageNameToCode(song.language);
      const result = await downloadAudio(song.youtube_url, songFolder, undefined, prefLang);

      await get().updateSong(id, {
        download_status: "done",
        audio_path: result.audioPath,
        audio_folder: songFolder,
      });

      // Auto-detect BPM in background if not already set
      if (!song.bpm) {
        detectBpmFromFile(result.audioPath).then((bpm) => {
          if (bpm) get().updateSong(id, { bpm }).catch(() => {});
        }).catch((e) => console.warn("BPM detection failed:", e));
      }

      if (result.lyrics && result.lyrics.length > 0) {
        const existingLines = get().lines[id];
        if (!existingLines || existingLines.length === 0) {
          const now = new Date().toISOString();
          const newLines: Line[] = result.lyrics.map((tl, i) => ({
            id: crypto.randomUUID(),
            song_id: id,
            text: tl.text,
            order: i,
            start_ms: tl.start_ms,
            end_ms: tl.end_ms,
            status: "new" as const,
            created_at: now,
            updated_at: now,
          }));
          await get().setLines(id, newLines);
          if (song.language?.startsWith("ja")) {
            get().generateFuriganaForSong(id).catch(() => {});
          }
        }
      }
    } catch (err) {
      await get().updateSong(id, {
        download_status: "error",
        download_error: err instanceof Error ? err.message : "Download failed",
      });
    }
  },

  separateSongStems: async (id) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song?.audio_path || song.download_status !== "done") return;
    if (!song.audio_folder) return;

    await get().updateSong(id, { stem_status: "processing", stem_error: undefined });

    try {
      const result = await separateStems(song.audio_path, song.audio_folder);

      await get().updateSong(id, {
        stem_status: "done",
        vocals_path: result.vocalsPath,
        instrumental_path: result.instrumentalPath,
      });
    } catch (err) {
      await get().updateSong(id, {
        stem_status: "error",
        stem_error: err instanceof Error ? err.message : "Stem separation failed",
      });
    }
  },

  analyzeSongPitch: async (id) => {
    const song = get().songs.find((s) => s.id === id);
    if (!song?.vocals_path || song.stem_status !== "done") return;
    if (!song.audio_folder) return;

    await get().updateSong(id, { pitch_status: "processing", pitch_error: undefined });

    try {
      const pitchDataPath = await analyzePitch(song.vocals_path, song.audio_folder);
      await get().updateSong(id, { pitch_status: "done", pitch_data_path: pitchDataPath });
    } catch (err) {
      await get().updateSong(id, {
        pitch_status: "error",
        pitch_error: err instanceof Error ? err.message : "Pitch analysis failed",
      });
    }
  },

  markStaleAnalysesAsFailed: async () => {
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    for (const song of get().songs) {
      const updatedAt = new Date(song.updated_at).getTime();
      if (now - updatedAt <= TIMEOUT_MS) continue;

      const updates: Partial<Song> = {};
      if (song.stem_status === "processing") {
        updates.stem_status = "error";
        updates.stem_error = "Processing timed out after 10 minutes. Please retry.";
      }
      if (song.pitch_status === "processing") {
        updates.pitch_status = "error";
        updates.pitch_error = "Processing timed out after 10 minutes. Please retry.";
      }
      if (Object.keys(updates).length > 0) {
        await get().updateSong(song.id, updates);
      }
    }
  },

  // -------------------------------------------------------------------------
  // Lines
  // -------------------------------------------------------------------------

  setLines: async (songId, lines) => {
    const userId = await getUserId();

    // Optimistic update
    set((s) => ({ lines: { ...s.lines, [songId]: lines } }));

    // Delete existing lines for this song, then insert new batch
    const { error: delError } = await supabase
      .from("lines")
      .delete()
      .eq("song_id", songId);

    if (delError) {
      await get().loadAllData();
      throw delError;
    }

    if (lines.length > 0) {
      const { error: insError } = await supabase
        .from("lines")
        .insert(lines.map((l) => lineToDbRow(l, userId)));

      if (insError) {
        await get().loadAllData();
        throw insError;
      }
    }
  },

  setLinesForLanguage: async (songId, language, lines) => {
    const userId = await getUserId();
    const song = get().songs.find((s) => s.id === songId);
    const translationLang = song?.translation_language ?? null;
    // A "translation save" is when we're explicitly saving the song's translation language.
    // Everything else (primary language, language change, etc.) is a "primary save".
    const isTranslationSave = translationLang != null && language === translationLang;

    // Optimistic: for primary saves keep only translation lines; for translation saves keep
    // everything EXCEPT lines of this translation language (null-language primary lines are preserved).
    set((s) => ({
      lines: {
        ...s.lines,
        [songId]: [
          ...(s.lines[songId] ?? []).filter((l) =>
            isTranslationSave
              // Keep all lines except the translation language being replaced
              ? l.language !== language
              // Keep only translation lines (primary lines are being replaced)
              : translationLang != null && l.language === translationLang
          ),
          ...lines,
        ],
      },
    }));

    // DB delete
    let delError: unknown;
    if (isTranslationSave) {
      // Translation save: delete ONLY lines with this translation language.
      // Never delete null-language lines — those are primary lyrics that were saved before
      // language tagging was introduced.
      ({ error: delError } = await db
        .from("lines")
        .delete()
        .eq("song_id", songId)
        .eq("language", language));
    } else {
      // Primary save: delete all lines except translation lines.
      // IMPORTANT: PostgreSQL != does not match NULL, so we explicitly include
      // null-language (legacy) lines in the delete to avoid accumulating duplicates.
      const deleteQuery = translationLang
        ? db.from("lines").delete().eq("song_id", songId)
            .or(`language.is.null,language.neq.${translationLang}`)
        : db.from("lines").delete().eq("song_id", songId);
      ({ error: delError } = await deleteQuery);
    }

    if (delError) {
      await get().loadAllData();
      throw delError;
    }

    if (lines.length > 0) {
      const { error: insError } = await db
        .from("lines")
        .insert(lines.map((l) => lineToDbRow(l, userId)));
      if (insError) {
        await get().loadAllData();
        throw insError;
      }
      if (language?.startsWith("ja") && lines.length > 0) {
        get().generateFuriganaForSong(songId).catch(() => {});
      }
    }
  },

  addLine: async (songId, text, order) => {
    const userId = await getUserId();
    const now = new Date().toISOString();
    const line: Line = {
      id: crypto.randomUUID(),
      song_id: songId,
      text,
      order,
      status: "new",
      play_count: 0,
      created_at: now,
      updated_at: now,
    };

    // Optimistic update
    set((s) => ({
      lines: { ...s.lines, [songId]: [...(s.lines[songId] ?? []), line] },
    }));

    const { error } = await db.from("lines").insert(lineToDbRow(line, userId));
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  updateLine: async (songId, lineId, data) => {
    const now = new Date().toISOString();
    const updated = { ...data, updated_at: now };

    // Optimistic update
    set((s) => ({
      lines: {
        ...s.lines,
        [songId]: (s.lines[songId] ?? []).map((line) =>
          line.id === lineId ? { ...line, ...updated } : line
        ),
      },
    }));

    const dbData: Record<string, unknown> = { ...updated };

    const { error } = await db.from("lines").update(dbData).eq("id", lineId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  removeLine: async (songId, lineId) => {
    // Optimistic update
    set((s) => ({
      lines: {
        ...s.lines,
        [songId]: (s.lines[songId] ?? []).filter((l) => l.id !== lineId),
      },
    }));

    const { error } = await db.from("lines").delete().eq("id", lineId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  updateLineStatus: async (songId, lineId, status) => {
    await get().updateLine(songId, lineId, { status });
  },

  incrementPlayCount: async (songId, lineId) => {
    const line = (get().lines[songId] ?? []).find((l) => l.id === lineId);
    if (!line) return;
    const newCount = (line.play_count ?? 0) + 1;
    let newStatus = upgradeStatus(line.status, "listened");
    if (newCount >= 10) newStatus = upgradeStatus(newStatus, "practiced");
    await get().updateLine(songId, lineId, { play_count: newCount, status: newStatus });
  },

  generateFuriganaForSong: async (songId) => {
    console.log("[furigana] generateFuriganaForSong called for songId:", songId);
    const song = get().songs.find((s) => s.id === songId);
    if (!song) return;
    const allLines = get().lines[songId] ?? [];
    // Generate for lines explicitly tagged "ja", or untagged lines when the song language is "ja"
    const targets = allLines.filter(
      (l) => l.language?.startsWith("ja") || (!l.language && song.language?.startsWith("ja"))
    );
    console.log("[furigana] target line count:", targets.length);
    if (targets.length === 0) return;

    const { generateFurigana } = await import("@reprise/shared");

    for (const line of targets) {
      try {
        const html = await generateFurigana(line.text);
        // Write directly to DB (no updated_at bump) and update in-memory state
        await supabase.from("lines").update({ furigana_html: html }).eq("id", line.id);
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).map((l) =>
              l.id === line.id ? { ...l, furigana_html: html } : l
            ),
          },
        }));
      } catch (err) {
        console.error("[furigana] failed for line:", line.id, line.text.slice(0, 30), err);
      }
    }
  },

  updateLineCustomText: async (songId, lineId, customText) => {
    await get().updateLine(songId, lineId, { custom_text: customText });
  },

  updateLineAnnotations: async (songId, lineId, annotations) => {
    const line = (get().lines[songId] ?? []).find((l) => l.id === lineId);
    const updates: Partial<Line> = { annotations };
    if (line && annotations.length > 0) {
      updates.status = upgradeStatus(line.status, "annotated");
    }
    await get().updateLine(songId, lineId, updates);

    // Fire-and-forget: generate furigana for the full line and each annotation slice (Japanese songs only)
    const song = get().songs.find((s) => s.id === songId);
    if (song?.language?.startsWith("ja") && annotations.length > 0 && line) {
      const lineText = line.custom_text ?? line.text;
      const KANJI_RE = /[\u4E00-\u9FAF\u3400-\u4DBF]/;
      (async () => {
        const { generateFurigana } = await import("@reprise/shared");

        // Full-line furigana → line.furigana_html (same as generateFuriganaForSong)
        if (KANJI_RE.test(line.text)) {
          try {
            const lineHtml = await generateFurigana(line.text);
            await supabase.from("lines").update({ furigana_html: lineHtml }).eq("id", lineId);
            set((s) => ({
              lines: {
                ...s.lines,
                [songId]: (s.lines[songId] ?? []).map((l) =>
                  l.id === lineId ? { ...l, furigana_html: lineHtml } : l
                ),
              },
            }));
          } catch {
            // fail silently
          }
        }

        // Per-annotation furigana → annotation.furigana_html (for ruby inside highlight spans)
        const newAnnotations: Annotation[] = [...annotations];
        let changed = false;
        for (let i = 0; i < annotations.length; i++) {
          const ann = annotations[i];
          const text = lineText.slice(ann.start, ann.end);
          if (!KANJI_RE.test(text)) continue;
          try {
            const html = await generateFurigana(text);
            newAnnotations[i] = { ...ann, furigana_html: html };
            changed = true;
          } catch {
            // fail silently per annotation
          }
        }
        if (changed) {
          await get().updateLine(songId, lineId, { annotations: newAnnotations });
        }
      })();
    }
  },

  getLinesForSong: (songId) => {
    return (get().lines[songId] ?? []).sort((a, b) => a.order - b.order);
  },

  // -------------------------------------------------------------------------
  // Recordings
  // -------------------------------------------------------------------------

  addRecording: async (songId, recording) => {
    const userId = await getUserId();

    // Optimistic update
    set((s) => ({
      recordings: {
        ...s.recordings,
        [songId]: [...(s.recordings[songId] ?? []), recording],
      },
    }));

    const { error } = await supabase
      .from("recordings")
      .insert(recordingToDbRow(recording, userId));

    if (error) {
      await get().loadAllData();
      throw error;
    }

    // Auto-upgrade line status to recorded (if tied to a line)
    if (recording.line_id) {
      const line = (get().lines[songId] ?? []).find((l) => l.id === recording.line_id);
      if (line) {
        const newStatus = upgradeStatus(line.status, "recorded");
        if (newStatus !== line.status) {
          await get().updateLine(songId, recording.line_id, { status: newStatus });
        }
      }
    }
  },

  removeRecording: async (songId, recordingId) => {
    // Optimistic update
    set((s) => ({
      recordings: {
        ...s.recordings,
        [songId]: (s.recordings[songId] ?? []).filter((r) => r.id !== recordingId),
      },
    }));

    const { error } = await db.from("recordings").delete().eq("id", recordingId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  updateRecording: async (songId, recordingId, data) => {
    const now = new Date().toISOString();
    const recBefore = (get().recordings[songId] ?? []).find((r) => r.id === recordingId);
    set((s) => ({
      recordings: {
        ...s.recordings,
        [songId]: (s.recordings[songId] ?? []).map((r) =>
          r.id === recordingId ? { ...r, ...data, updated_at: now } : r
        ),
      },
    }));
    const { error } = await db.from("recordings").update({ ...data, updated_at: now }).eq("id", recordingId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
    // Auto-upgrade line status to best_take_set when marking as best take
    if (data.is_best_take === true && recBefore?.line_id) {
      const line = (get().lines[songId] ?? []).find((l) => l.id === recBefore.line_id);
      if (line) {
        const newStatus = upgradeStatus(line.status, "best_take_set");
        if (newStatus !== line.status) {
          await get().updateLine(songId, recBefore.line_id, { status: newStatus });
        }
      }
    }
  },

  toggleMasterTake: async (songId, recordingId) => {
    const recs = get().recordings[songId] ?? [];
    const target = recs.find((r) => r.id === recordingId);
    if (!target) return;

    const lineId = target.line_id;
    const now = new Date().toISOString();

    let updatedRecs: Recording[];
    let lineRecs: Recording[];

    if (lineId === null) {
      // Free recordings: just toggle the individual recording
      updatedRecs = recs.map((r) =>
        r.id === recordingId ? { ...r, is_master_take: !r.is_master_take, updated_at: now } : r
      );
      lineRecs = updatedRecs.filter((r) => r.id === recordingId);
    } else {
      // Line recordings: exclusive toggle (only one master per line)
      updatedRecs = recs.map((r) =>
        r.line_id === lineId
          ? { ...r, is_master_take: r.id === recordingId ? !r.is_master_take : false, updated_at: now }
          : r
      );
      lineRecs = updatedRecs.filter((r) => r.line_id === lineId);
    }

    // Optimistic update
    set((s) => ({
      recordings: { ...s.recordings, [songId]: updatedRecs },
    }));

    const updates = lineRecs.map((r) =>
      supabase
        .from("recordings")
        .update({ is_master_take: r.is_master_take, updated_at: now })
        .eq("id", r.id)
    );

    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) {
      await get().loadAllData();
      throw firstError;
    }

    // Auto-upgrade line status to best_take_set when setting a master take
    const newTarget = updatedRecs.find((r) => r.id === recordingId);
    if (newTarget?.is_master_take && newTarget?.line_id) {
      const line = (get().lines[songId] ?? []).find((l) => l.id === newTarget.line_id);
      if (line) {
        const newStatus = upgradeStatus(line.status, "best_take_set");
        if (newStatus !== line.status) {
          await get().updateLine(songId, newTarget.line_id, { status: newStatus });
        }
      }
    }
  },

  getRecordingsForLine: (songId, lineId) => {
    return (get().recordings[songId] ?? []).filter((r) => r.line_id === lineId);
  },

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  addSection: async (songId, section) => {
    const userId = await getUserId();

    // Optimistic update
    set((s) => ({
      sections: {
        ...s.sections,
        [songId]: [...(s.sections[songId] ?? []), section],
      },
    }));

    const { error } = await supabase
      .from("sections")
      .insert(sectionToDbRow(section, userId));

    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  updateSection: async (songId, sectionId, data) => {
    const now = new Date().toISOString();
    const updated = { ...data, updated_at: now };

    // Optimistic update
    set((s) => ({
      sections: {
        ...s.sections,
        [songId]: (s.sections[songId] ?? []).map((sec) =>
          sec.id === sectionId ? { ...sec, ...updated } : sec
        ),
      },
    }));

    const { error } = await db.from("sections").update(updated).eq("id", sectionId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  removeSection: async (songId, sectionId) => {
    // Optimistic update
    set((s) => ({
      sections: {
        ...s.sections,
        [songId]: (s.sections[songId] ?? []).filter((sec) => sec.id !== sectionId),
      },
    }));

    const { error } = await db.from("sections").delete().eq("id", sectionId);
    if (error) {
      await get().loadAllData();
      throw error;
    }
  },

  getSectionsForSong: (songId) => {
    return (get().sections[songId] ?? []).sort(
      (a, b) => a.start_line_order - b.start_line_order
    );
  },
}));

// ---------------------------------------------------------------------------
// DB row <-> domain type converters
// ---------------------------------------------------------------------------

function dbRowToSong(row: Record<string, unknown>): Song {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    artist: row.artist as string,
    youtube_url: row.youtube_url as string | undefined,
    thumbnail_url: row.thumbnail_url as string | undefined,
    thumbnail_b64: row.thumbnail_b64 as string | undefined,
    duration_ms: row.duration_ms as number | undefined,
    bpm: row.bpm as number | undefined,
    language: row.language as string | undefined,
    translation_language: row.translation_language as string | undefined,
    tags: (row.tags as string[]) ?? [],
    notes: row.notes as string | undefined,
    pinned: row.pinned as boolean,
    mastery: row.mastery as number,
    audio_path: row.audio_path as string | undefined,
    audio_folder: row.audio_folder as string | undefined,
    vocals_path: row.vocals_path as string | undefined,
    instrumental_path: row.instrumental_path as string | undefined,
    pitch_data_path: row.pitch_data_path as string | undefined,
    download_status: (row.download_status as Song["download_status"]) ?? "idle",
    download_error: row.download_error as string | undefined,
    stem_status: (row.stem_status as Song["stem_status"]) ?? "idle",
    stem_error: row.stem_error as string | undefined,
    pitch_status: (row.pitch_status as Song["pitch_status"]) ?? "idle",
    pitch_error: row.pitch_error as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function songToDbRow(song: Song): Record<string, unknown> {
  return {
    id: song.id,
    user_id: song.user_id,
    title: song.title,
    artist: song.artist,
    youtube_url: song.youtube_url ?? null,
    thumbnail_url: song.thumbnail_url ?? null,
    thumbnail_b64: song.thumbnail_b64 ?? null,
    duration_ms: song.duration_ms ?? null,
    bpm: song.bpm ?? null,
    language: song.language ?? null,
    translation_language: song.translation_language ?? null,
    tags: song.tags,
    notes: song.notes ?? null,
    pinned: song.pinned,
    mastery: song.mastery,
    audio_path: song.audio_path ?? null,
    audio_folder: song.audio_folder ?? null,
    vocals_path: song.vocals_path ?? null,
    instrumental_path: song.instrumental_path ?? null,
    pitch_data_path: song.pitch_data_path ?? null,
    download_status: song.download_status ?? "idle",
    download_error: song.download_error ?? null,
    stem_status: song.stem_status ?? "idle",
    stem_error: song.stem_error ?? null,
    pitch_status: song.pitch_status ?? "idle",
    pitch_error: song.pitch_error ?? null,
    created_at: song.created_at,
    updated_at: song.updated_at,
  };
}

function dbRowToLine(row: Record<string, unknown>): Line {
  return {
    id: row.id as string,
    song_id: row.song_id as string,
    text: row.text as string,
    custom_text: row.custom_text as string | undefined,
    annotations: Array.isArray(row.annotations)
      ? (row.annotations as Annotation[])
      : typeof row.annotations === "string"
        ? (JSON.parse(row.annotations) as Annotation[])
        : [],
    order: row.order as number,
    start_ms: row.start_ms as number | undefined,
    end_ms: row.end_ms as number | undefined,
    status: row.status as LineStatus,
    play_count: (row.play_count as number | undefined) ?? 0,
    furigana_html: (row.furigana_html as string | undefined) ?? undefined,
    language: row.language as string | undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function lineToDbRow(line: Line, userId: string): Record<string, unknown> {
  return {
    id: line.id,
    song_id: line.song_id,
    user_id: userId,
    text: line.text,
    custom_text: line.custom_text ?? null,
    annotations: line.annotations ?? [],
    order: line.order,
    start_ms: line.start_ms ?? null,
    end_ms: line.end_ms ?? null,
    status: line.status,
    play_count: line.play_count ?? 0,
    furigana_html: line.furigana_html ?? null,
    language: line.language ?? null,
    created_at: line.created_at,
    updated_at: line.updated_at,
  };
}

function dbRowToRecording(row: Record<string, unknown>): Recording {
  return {
    id: row.id as string,
    song_id: row.song_id as string,
    line_id: (row.line_id as string | null) ?? null,
    file_path: row.file_path as string,
    duration_ms: row.duration_ms as number,
    is_master_take: row.is_master_take as boolean,
    is_best_take: (row.is_best_take as boolean) ?? false,
    note: (row.note as string | undefined) ?? undefined,
    section_id: (row.section_id as string | undefined) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function recordingToDbRow(recording: Recording, userId: string): Record<string, unknown> {
  return {
    id: recording.id,
    song_id: recording.song_id,
    line_id: recording.line_id,
    user_id: userId,
    file_path: recording.file_path,
    duration_ms: recording.duration_ms,
    is_master_take: recording.is_master_take,
    is_best_take: recording.is_best_take,
    note: recording.note ?? null,
    section_id: recording.section_id ?? null,
    created_at: recording.created_at,
    updated_at: recording.updated_at,
  };
}

function dbRowToSection(row: Record<string, unknown>): Section {
  return {
    id: row.id as string,
    song_id: row.song_id as string,
    name: row.name as string,
    start_line_order: row.start_line_order as number,
    end_line_order: row.end_line_order as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function sectionToDbRow(section: Section, userId: string): Record<string, unknown> {
  return {
    id: section.id,
    song_id: section.song_id,
    user_id: userId,
    name: section.name,
    start_line_order: section.start_line_order,
    end_line_order: section.end_line_order,
    created_at: section.created_at,
    updated_at: section.updated_at,
  };
}
