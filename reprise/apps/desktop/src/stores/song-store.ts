import { create } from "zustand";
import type { Song, ImportDraft, Line, LineStatus, Annotation, Recording, Section } from "../types/song";
import {
  downloadAudio,
  buildSongFolder,
  separateStems,
} from "../lib/audio-download";
import { analyzePitch } from "../lib/audio-analysis";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Cast to any to bypass Supabase's generated type inference (which resolves
// to `never` when Database generics don't perfectly match call-site types).
// Safety is enforced by RLS policies and the DB schema instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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

  // Lines management
  setLines: (songId: string, lines: Line[]) => Promise<void>;
  /** Replace only lines matching `language` (or null-language legacy lines when language is null).
   *  Lines of other languages are preserved. */
  setLinesForLanguage: (songId: string, language: string | null, lines: Line[]) => Promise<void>;
  addLine: (songId: string, text: string, order: number) => Promise<void>;
  updateLine: (songId: string, lineId: string, data: Partial<Line>) => Promise<void>;
  removeLine: (songId: string, lineId: string) => Promise<void>;
  updateLineStatus: (songId: string, lineId: string, status: LineStatus) => Promise<void>;
  updateLineCustomText: (songId: string, lineId: string, customText: string) => Promise<void>;
  updateLineAnnotations: (songId: string, lineId: string, annotations: Annotation[]) => Promise<void>;
  getLinesForSong: (songId: string) => Line[];

  // Recordings management
  addRecording: (songId: string, recording: Recording) => Promise<void>;
  removeRecording: (songId: string, recordingId: string) => Promise<void>;
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

    const songFolder = buildSongFolder(song.title, song.artist);

    await get().updateSong(id, {
      download_status: "downloading",
      download_error: undefined,
      audio_folder: songFolder,
    });

    try {
      const result = await downloadAudio(song.youtube_url, songFolder);

      await get().updateSong(id, {
        download_status: "done",
        audio_path: result.audioPath,
        audio_folder: songFolder,
      });

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
            status: "not_started" as const,
            created_at: now,
            updated_at: now,
          }));
          await get().setLines(id, newLines);
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

      get().analyzeSongPitch(id);
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

    // Optimistic: keep lines of OTHER languages, replace matching-language lines
    set((s) => ({
      lines: {
        ...s.lines,
        [songId]: [
          ...(s.lines[songId] ?? []).filter(
            (l) => l.language != null && l.language !== language
          ),
          ...lines,
        ],
      },
    }));

    // Delete: lines matching this language + null-language legacy lines (both treated as primary)
    const orFilter = language
      ? `language.eq.${language},language.is.null`
      : `language.is.null`;
    const { error: delError } = await db
      .from("lines")
      .delete()
      .eq("song_id", songId)
      .or(orFilter);

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
      status: "not_started",
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
    // Serialize annotations if present
    if (dbData.annotations !== undefined) {
      dbData.annotations = JSON.stringify(dbData.annotations);
    }

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

  updateLineCustomText: async (songId, lineId, customText) => {
    await get().updateLine(songId, lineId, { custom_text: customText });
  },

  updateLineAnnotations: async (songId, lineId, annotations) => {
    await get().updateLine(songId, lineId, { annotations });
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

  toggleMasterTake: async (songId, recordingId) => {
    const recs = get().recordings[songId] ?? [];
    const target = recs.find((r) => r.id === recordingId);
    if (!target) return;

    const lineId = target.line_id;
    const now = new Date().toISOString();

    // Determine new state
    const updatedRecs = recs.map((r) =>
      r.line_id === lineId
        ? {
            ...r,
            is_master_take: r.id === recordingId ? !r.is_master_take : false,
            updated_at: now,
          }
        : r
    );

    // Optimistic update
    set((s) => ({
      recordings: { ...s.recordings, [songId]: updatedRecs },
    }));

    // Update all affected recordings in DB (those belonging to the same line)
    const lineRecs = updatedRecs.filter((r) => r.line_id === lineId);
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
      : [],
    order: row.order as number,
    start_ms: row.start_ms as number | undefined,
    end_ms: row.end_ms as number | undefined,
    status: row.status as LineStatus,
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
    annotations: JSON.stringify(line.annotations ?? []),
    order: line.order,
    start_ms: line.start_ms ?? null,
    end_ms: line.end_ms ?? null,
    status: line.status,
    language: line.language ?? null,
    created_at: line.created_at,
    updated_at: line.updated_at,
  };
}

function dbRowToRecording(row: Record<string, unknown>): Recording {
  return {
    id: row.id as string,
    song_id: row.song_id as string,
    line_id: row.line_id as string,
    file_path: row.file_path as string,
    duration_ms: row.duration_ms as number,
    is_master_take: row.is_master_take as boolean,
    section_id: row.section_id as string | undefined,
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
