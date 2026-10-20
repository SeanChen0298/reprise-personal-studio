import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

const REPRISE_ROOT = "C:/Reprise";

export const COOKIES_PATH = `${REPRISE_ROOT}/cookies.txt`;

/** Common yt-dlp args: single video, Deno JS runtime (bundled sidecar), cookies for YouTube auth */
export const YT_DLP_BASE = [
  "--no-playlist",
  "--js-runtimes", "deno",
  "--cookies", COOKIES_PATH,
];

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn a command and stream stdout/stderr to console in real-time */
export function spawnAndWait(
  command: ReturnType<typeof Command.create>,
  tag: string,
  onProgress?: (line: string) => void
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    command.stdout.on("data", (line: string) => {
      console.log(`${tag} stdout:`, line);
      stdout += line + "\n";
      onProgress?.(line);
    });
    command.stderr.on("data", (line: string) => {
      console.warn(`${tag} stderr:`, line);
      stderr += line + "\n";
    });
    command.on("close", (data: { code: number | null }) => {
      console.log(`${tag} exited with code:`, data.code);
      resolve({ code: data.code, stdout, stderr });
    });
    command.on("error", (err: string) => {
      // Tauri emits "error" for non-UTF-8 output (e.g. Japanese filenames).
      // Log but don't reject — wait for the "close" event to determine success.
      console.warn(`${tag} error (non-fatal):`, err);
      stderr += `[encoding error] ${err}\n`;
    });
    command.spawn().then(() => {
      console.log(`${tag} spawned, waiting...`);
    }).catch((err: unknown) => {
      console.error(`${tag} spawn failed:`, err);
      reject(err);
    });
  });
}

// Cache so we only invoke the Rust command once per session.
let _cachedSidecarPathEnv: string | null = null;

/**
 * In production, returns env vars that inject the sidecar binaries directory into PATH
 * so yt-dlp can discover the bundled deno.exe at runtime.
 * In dev, returns an empty object (system yt-dlp is used; Deno must be on system PATH).
 */
async function getYtDlpEnv(): Promise<Record<string, string>> {
  if (import.meta.env.DEV) return {};
  if (_cachedSidecarPathEnv === null) {
    _cachedSidecarPathEnv = await invoke<string>("get_sidecar_path_env");
  }
  return { PATH: _cachedSidecarPathEnv, DENO_NO_UPDATE_CHECK: "1" };
}

/**
 * Creates a yt-dlp Command with the correct invocation for dev vs prod,
 * and with PATH pre-loaded so yt-dlp can find the bundled deno sidecar.
 */
export async function makeYtDlpCommand(args: string[]): Promise<ReturnType<typeof Command.create>> {
  if (import.meta.env.DEV) {
    return Command.create("yt-dlp", args);
  }
  const env = await getYtDlpEnv();
  return Command.sidecar("binaries/yt-dlp", args, { env });
}
