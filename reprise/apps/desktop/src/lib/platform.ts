import { platform } from "@tauri-apps/plugin-os";

let cached: boolean | null = null;

/** Returns true when running on Windows/macOS/Linux desktop (not Android/iOS). */
export async function isDesktopPlatform(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const p = await platform();
    cached = p !== "android" && p !== "ios";
  } catch {
    cached = true;
  }
  return cached;
}
