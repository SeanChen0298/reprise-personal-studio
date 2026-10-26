// Talks to the desktop's sync server (Settings → Phone on the computer) over the home Wi-Fi.
import * as FileSystem from "expo-file-system";
import type { SyncSnapshot } from "@reprise/shared/core";

export interface Pairing {
  /** "192.168.1.20:47615" */
  host: string;
  token: string;
  /** The computer's name. */
  name: string;
}

/** reprise://pair?h=…&t=…&n=… (the desktop's QR code) → pairing. */
export function parsePairingUrl(url: string): Pairing | null {
  const m = url.trim().match(/^reprise:\/\/pair\?(.+)$/i);
  if (!m) return null;
  const params = new Map<string, string>();
  for (const kv of m[1].split("&")) {
    const [k, v = ""] = kv.split("=");
    try {
      params.set(k, decodeURIComponent(v));
    } catch {
      params.set(k, v);
    }
  }
  const host = params.get("h");
  const token = params.get("t");
  if (!host || !token || !/^[\w.-]+:\d+$/.test(host)) return null;
  return { host, token, name: params.get("n") || "Computer" };
}

const base = (p: Pairing) => `http://${p.host}`;
const headers = (p: Pairing) => ({ "X-Reprise-Token": p.token });

async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export class SyncError extends Error {
  constructor(
    message: string,
    /** Couldn't reach the computer at all (not home / sync off) — not worth shouting about. */
    readonly unreachable = false,
  ) {
    super(message);
  }
}

/** `library`: when the computer's library last changed (ms) — newer than the last pull means pull again. */
export async function ping(p: Pairing): Promise<{ host: string; library?: number | null }> {
  let res: Response;
  try {
    res = await timed(`${base(p)}/ping`, { headers: headers(p) }, 4000);
  } catch {
    throw new SyncError(`Can't reach ${p.name}. Is it on, with phone sync switched on, and on the same Wi-Fi?`, true);
  }
  if (res.status === 401) throw new SyncError(`${p.name} doesn't know this phone any more — pair again.`);
  if (!res.ok) throw new SyncError(`${p.name} answered ${res.status}.`);
  return (await res.json()) as { host: string; library?: number | null };
}

export async function fetchLibrary(p: Pairing): Promise<SyncSnapshot> {
  const res = await timed(`${base(p)}/library`, { headers: headers(p) }, 30000);
  if (!res.ok) throw new SyncError(res.status === 503 ? `${p.name} is still getting the library ready — try again in a moment.` : `Library: ${res.status}`);
  const snap = (await res.json()) as SyncSnapshot;
  if (snap.format !== "reprise-sync") throw new SyncError("That doesn't look like Reprise on the other end.");
  return snap;
}

export function fileUrl(p: Pairing, path: string): string {
  return `${base(p)}/file?path=${encodeURIComponent(path)}`;
}

/** Download a desktop file to `dest`, reporting progress 0–1. */
export async function downloadFile(p: Pairing, path: string, dest: string, onProgress?: (f: number) => void): Promise<void> {
  const tmp = `${dest}.part`;
  const dl = FileSystem.createDownloadResumable(fileUrl(p, path), tmp, { headers: headers(p) }, (e) => {
    if (e.totalBytesExpectedToWrite > 0) onProgress?.(e.totalBytesWritten / e.totalBytesExpectedToWrite);
  });
  const res = await dl.downloadAsync();
  if (!res || res.status !== 200) {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    throw new SyncError(`Download failed (${res?.status ?? "no answer"}).`);
  }
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.moveAsync({ from: tmp, to: dest });
}

/** Upload a local file into the desktop's inbox as `name`. */
export async function uploadFile(p: Pairing, uri: string, name: string): Promise<void> {
  const res = await FileSystem.uploadAsync(`${base(p)}/upload?name=${encodeURIComponent(name)}`, uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { ...headers(p), "Content-Type": "application/octet-stream" },
  });
  if (res.status !== 200) throw new SyncError(`Upload failed (${res.status}).`);
}

/** Upload JSON as a file named `name`. */
export async function uploadJson(p: Pairing, data: unknown, name: string): Promise<void> {
  const tmp = `${FileSystem.cacheDirectory}${name}`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(data));
  try {
    await uploadFile(p, tmp, name);
  } finally {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
  }
}
