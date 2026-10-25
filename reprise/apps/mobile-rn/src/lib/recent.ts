import type { Song, SyncSnapshot } from "@reprise/shared/core";

export interface Recent {
  song: Song;
  at: string;
  kind: "take" | "practice" | "added";
}

/** Songs by the last time anything happened with them (on the phone or the computer), newest first. */
export function recentSongs(snap: SyncSnapshot | null, phonePracticed: Record<string, string>, phoneTakes: { song_id: string; created_at: string }[]): Recent[] {
  if (!snap) return [];
  const lastTake = new Map<string, string>();
  for (const r of [...snap.recordings, ...phoneTakes]) {
    const cur = lastTake.get(r.song_id);
    if (!cur || r.created_at > cur) lastTake.set(r.song_id, r.created_at);
  }
  const out: Recent[] = [];
  for (const song of snap.songs) {
    const take = lastTake.get(song.id);
    const a = snap.practiced?.[song.id];
    const b = phonePracticed[song.id];
    const practiced = a && b ? (a > b ? a : b) : a ?? b;
    if (take && (!practiced || take >= practiced)) out.push({ song, at: take, kind: "take" });
    else if (practiced) out.push({ song, at: practiced, kind: "practice" });
  }
  out.sort((x, y) => y.at.localeCompare(x.at));
  if (!out.length) {
    const newest = [...snap.songs].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
    if (newest) out.push({ song: newest, at: newest.created_at, kind: "added" });
  }
  return out;
}
