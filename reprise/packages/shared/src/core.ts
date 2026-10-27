// Everything except furigana generation (kuroshiro + a 17 MB dictionary) — for the phone app.
export type { AuthStatus } from "./types/auth";
export type {
  DownloadStatus,
  StemStatus,
  PitchStatus,
  ChordStatus,
  AlignStatus,
  LineStatus,
  Song,
  Annotation,
  Line,
  YouTubeMetadata,
  ImportDraft,
  Recording,
  Section,
  TakeAnalysis,
  TakeNote,
  TakeIssue,
  TakeIssueKind,
  TakeHalfStats,
} from "./types/song";
export type { HighlightType } from "./types/highlight";
export { DEFAULT_HIGHLIGHTS } from "./types/highlight";
export type { SyncFileRef, SyncSongFiles, SyncCoach, SyncLineHint, SyncSnapshot, PhoneTake, PhoneChanges } from "./types/sync";
export { REGISTERS, PLACEMENTS, normaliseCard, parseLineRefs, splitLineRefs } from "./lib/song-card";
export { collapseRepeats, splitLines, translationsByLine, followTranslations } from "./lib/lyrics";
export { ISSUE_LABEL, isBreathIssue, reviewInsight, issueSongStartMs, issueClip, issueLineParts } from "./lib/take-words";
export type { ReviewInsight } from "./lib/take-words";
export type { VoiceSpec, SongCard } from "./lib/song-card";
export { normaliseWarmup, noteToMidi, midiToNote, drillNotes, drillDurationMs, renderDrill, toBase64 } from "./lib/warmup";
export type { Warmup, WarmupDrill } from "./lib/warmup";
