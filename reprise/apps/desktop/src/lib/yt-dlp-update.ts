import { makeYtDlpCommand, spawnAndWait } from "./yt-dlp-runtime";

/**
 * yt-dlp goes stale fast: YouTube rotates its player/signature logic every few
 * weeks, and an outdated binary fails with "HTTP Error 403: Forbidden" or a
 * signature-extraction error. The bundled sidecar is only as fresh as the
 * installer, so the app keeps itself current at runtime via yt-dlp's own
 * self-updater (`--update-to stable`), which replaces the exe in place.
 */

/** Auto-update once the bundled binary is at least this old. yt-dlp ships roughly monthly. */
const STALE_AFTER_DAYS = 30;

/** Don't hammer the network: wait this long before retrying a failed update check. */
const RETRY_FAILED_CHECK_AFTER_MS = 6 * 60 * 60 * 1000;

const LAST_ATTEMPT_KEY = "reprise.ytdlp.lastUpdateAttempt";

export interface YtDlpUpdateResult {
  ok: boolean;
  /** Human-readable outcome, safe to show in the UI. */
  message: string;
  versionBefore: string | null;
  versionAfter: string | null;
  /** True when the binary actually changed. */
  changed: boolean;
}

/** Read the yt-dlp version string (e.g. "2026.08.19"), or null if it cannot be run. */
export async function getYtDlpVersion(): Promise<string | null> {
  try {
    const command = await makeYtDlpCommand(["--version"]);
    const result = await command.execute();
    if (result.code !== 0) return null;
    // Older builds may print an update warning first; the version is the last line.
    const lines = result.stdout.trim().split(/\r?\n/).filter((l) => l.trim());
    const last = lines[lines.length - 1]?.trim();
    return last || null;
  } catch {
    return null;
  }
}

/** yt-dlp versions are release dates (YYYY.MM.DD[.build]). Returns null if unparseable. */
export function parseYtDlpVersionDate(version: string | null): Date | null {
  if (!version) return null;
  const match = version.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Age of the given yt-dlp version in days, or null if unknown. */
export function ytDlpAgeInDays(version: string | null): number | null {
  const released = parseYtDlpVersionDate(version);
  if (!released) return null;
  return Math.floor((Date.now() - released.getTime()) / 86_400_000);
}

/** True when the version is old enough that YouTube breakage is likely. */
export function isYtDlpStale(version: string | null): boolean {
  const age = ytDlpAgeInDays(version);
  return age !== null && age >= STALE_AFTER_DAYS;
}

/**
 * True when a yt-dlp failure looks like an out-of-date extractor rather than a
 * genuine problem with the video. Check bot detection (expired cookies) BEFORE
 * calling this — that needs a different fix.
 */
export function isStaleYtDlpError(stderr: string): boolean {
  return (
    stderr.includes("HTTP Error 403") ||
    stderr.includes("unable to download video data") ||
    stderr.includes("nsig extraction failed") ||
    stderr.includes("Signature extraction failed") ||
    stderr.includes("Failed to extract any player response") ||
    /your yt-dlp version .* is older than/i.test(stderr)
  );
}

/**
 * Run yt-dlp's self-updater. Safe to call when already current (it is a no-op).
 * Never throws — failures are reported through the returned result.
 */
export async function updateYtDlp(channel = "stable"): Promise<YtDlpUpdateResult> {
  const versionBefore = await getYtDlpVersion();
  markUpdateAttempted();

  try {
    const command = await makeYtDlpCommand(["--update-to", channel]);
    const result = await spawnAndWait(command, "[ytDlpUpdate]");
    const output = `${result.stdout}\n${result.stderr}`;
    const versionAfter = await getYtDlpVersion();
    const changed = !!versionAfter && versionAfter !== versionBefore;

    if (result.code !== 0 && !changed) {
      return {
        ok: false,
        message: summarizeUpdateOutput(output) ?? `yt-dlp update failed (exit code ${result.code}).`,
        versionBefore,
        versionAfter,
        changed: false,
      };
    }

    return {
      ok: true,
      message: changed
        ? `Updated yt-dlp ${versionBefore ?? "?"} to ${versionAfter}.`
        : `yt-dlp is up to date (${versionAfter ?? versionBefore ?? "unknown"}).`,
      versionBefore,
      versionAfter,
      changed,
    };
  } catch (err) {
    return {
      ok: false,
      message: `yt-dlp update could not run: ${err instanceof Error ? err.message : String(err)}`,
      versionBefore,
      versionAfter: versionBefore,
      changed: false,
    };
  }
}

/** Pull the most useful line out of the updater output. */
function summarizeUpdateOutput(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^ERROR|^WARNING|unable to|permission/i.test(l));
  return line || null;
}

function markUpdateAttempted(): void {
  try {
    localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — worst case we check again next launch.
  }
}

function updateAttemptedRecently(): boolean {
  try {
    const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < RETRY_FAILED_CHECK_AFTER_MS;
  } catch {
    return false;
  }
}

// Only one auto-update per app session, shared by concurrent downloads.
let _autoUpdateInFlight: Promise<YtDlpUpdateResult | null> | null = null;

/**
 * Best-effort: if the bundled yt-dlp is old enough to break, update it before
 * we try to download. Awaited (not fire-and-forget) so the exe is never swapped
 * out from under a running download. Offline failures are logged and ignored.
 *
 * Skipped in dev, where yt-dlp comes from the system PATH.
 */
export function ensureFreshYtDlp(): Promise<YtDlpUpdateResult | null> {
  if (import.meta.env.DEV) return Promise.resolve(null);
  if (_autoUpdateInFlight) return _autoUpdateInFlight;

  // The catch is part of the cached promise so later callers can never observe
  // an unhandled rejection. A failure clears the cache so the next call retries.
  const attempt = (async () => {
    const version = await getYtDlpVersion();
    if (!isYtDlpStale(version)) return null;
    if (updateAttemptedRecently()) {
      console.warn("[ensureFreshYtDlp] stale yt-dlp but update was attempted recently; skipping");
      return null;
    }
    console.log(`[ensureFreshYtDlp] yt-dlp ${version} is ${ytDlpAgeInDays(version)} days old; updating`);
    const result = await updateYtDlp();
    console.log("[ensureFreshYtDlp]", result.message);
    return result;
  })().catch((err): YtDlpUpdateResult | null => {
    console.warn("[ensureFreshYtDlp] failed:", err);
    _autoUpdateInFlight = null;
    return null;
  });

  _autoUpdateInFlight = attempt;
  return attempt;
}

// One recovery attempt per session, so a genuinely-broken video cannot loop.
let _recoveryAttempted = false;

/**
 * Called after a yt-dlp failure that looks like staleness. Updates the binary
 * and reports whether a retry is worth it. Returns null if we already tried,
 * the error is not staleness-shaped, or the update changed nothing.
 */
export async function recoverFromStaleYtDlp(stderr: string): Promise<YtDlpUpdateResult | null> {
  if (import.meta.env.DEV) return null;
  if (_recoveryAttempted) return null;
  if (!isStaleYtDlpError(stderr)) return null;

  _recoveryAttempted = true;
  console.log("[recoverFromStaleYtDlp] failure looks like an outdated yt-dlp; updating");
  const result = await updateYtDlp();
  console.log("[recoverFromStaleYtDlp]", result.message);
  return result.changed ? result : null;
}

export const YT_DLP_STALE_MESSAGE =
  "yt-dlp is out of date, so YouTube rejected the request (HTTP 403).\n" +
  'Open Settings, find "Update yt-dlp" under System check, run it, then try again.';
