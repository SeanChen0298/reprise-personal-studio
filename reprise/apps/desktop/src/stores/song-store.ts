import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Song, ImportDraft, Line, LineStatus, Annotation } from "../types/song";
import {
  downloadAudio,
  buildSongFolder,
} from "../lib/audio-download";

interface SongStore {
  songs: Song[];
  lines: Record<string, Line[]>; // songId -> lines
  importDraft: ImportDraft | null;

  setImportDraft: (draft: ImportDraft | null) => void;
  addSong: (
    data: Omit<Song, "id" | "created_at" | "updated_at" | "mastery" | "pinned">
  ) => Song;
  updateSong: (id: string, data: Partial<Song>) => void;
  removeSong: (id: string) => void;
  togglePin: (id: string) => void;

  // Audio download
  downloadSongAudio: (id: string) => Promise<void>;

  // Lines management
  setLines: (songId: string, lines: Line[]) => void;
  addLine: (songId: string, text: string, order: number) => void;
  updateLine: (songId: string, lineId: string, data: Partial<Line>) => void;
  removeLine: (songId: string, lineId: string) => void;
  updateLineStatus: (
    songId: string,
    lineId: string,
    status: LineStatus
  ) => void;
  updateLineCustomText: (
    songId: string,
    lineId: string,
    customText: string
  ) => void;
  updateLineAnnotations: (
    songId: string,
    lineId: string,
    annotations: Annotation[]
  ) => void;
  getLinesForSong: (songId: string) => Line[];
}

export const useSongStore = create<SongStore>()(
  persist(
    (set, get) => ({
      songs: [],
      lines: {},
      importDraft: null,

      setImportDraft: (draft) => set({ importDraft: draft }),

      addSong: (data) => {
        const now = new Date().toISOString();
        const song: Song = {
          ...data,
          id: crypto.randomUUID(),
          mastery: 0,
          pinned: false,
          tags: data.tags ?? [],
          download_status: "idle",
          created_at: now,
          updated_at: now,
        };
        set((s) => ({ songs: [...s.songs, song] }));
        return song;
      },

      updateSong: (id, data) =>
        set((s) => ({
          songs: s.songs.map((song) =>
            song.id === id
              ? { ...song, ...data, updated_at: new Date().toISOString() }
              : song
          ),
        })),

      removeSong: (id) =>
        set((s) => {
          const { [id]: _removed, ...restLines } = s.lines;
          return {
            songs: s.songs.filter((song) => song.id !== id),
            lines: restLines,
          };
        }),

      togglePin: (id) =>
        set((s) => ({
          songs: s.songs.map((song) =>
            song.id === id
              ? {
                  ...song,
                  pinned: !song.pinned,
                  updated_at: new Date().toISOString(),
                }
              : song
          ),
        })),

      downloadSongAudio: async (id) => {
        const song = get().songs.find((s) => s.id === id);
        if (!song?.youtube_url) return;

        const songFolder = buildSongFolder(song.title, song.artist);

        get().updateSong(id, {
          download_status: "downloading",
          download_error: undefined,
          audio_folder: songFolder,
        });

        try {
          const result = await downloadAudio(song.youtube_url, songFolder);

          get().updateSong(id, {
            download_status: "done",
            audio_path: result.audioPath,
            audio_folder: songFolder,
          });

          // If lyrics were found and song has no lines yet, auto-populate
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
              get().setLines(id, newLines);
            }
          }
        } catch (err) {
          get().updateSong(id, {
            download_status: "error",
            download_error:
              err instanceof Error ? err.message : "Download failed",
          });
        }
      },

      setLines: (songId, lines) =>
        set((s) => ({
          lines: { ...s.lines, [songId]: lines },
        })),

      addLine: (songId, text, order) => {
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
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: [...(s.lines[songId] ?? []), line],
          },
        }));
      },

      updateLine: (songId, lineId, data) =>
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).map((line) =>
              line.id === lineId
                ? { ...line, ...data, updated_at: new Date().toISOString() }
                : line
            ),
          },
        })),

      removeLine: (songId, lineId) =>
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).filter((l) => l.id !== lineId),
          },
        })),

      updateLineStatus: (songId, lineId, status) =>
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).map((line) =>
              line.id === lineId
                ? { ...line, status, updated_at: new Date().toISOString() }
                : line
            ),
          },
        })),

      updateLineCustomText: (songId, lineId, customText) =>
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).map((line) =>
              line.id === lineId
                ? { ...line, custom_text: customText, updated_at: new Date().toISOString() }
                : line
            ),
          },
        })),

      updateLineAnnotations: (songId, lineId, annotations) =>
        set((s) => ({
          lines: {
            ...s.lines,
            [songId]: (s.lines[songId] ?? []).map((line) =>
              line.id === lineId
                ? { ...line, annotations, updated_at: new Date().toISOString() }
                : line
            ),
          },
        })),

      getLinesForSong: (songId) => {
        return (get().lines[songId] ?? []).sort((a, b) => a.order - b.order);
      },
    }),
    { name: "reprise-songs" }
  )
);
