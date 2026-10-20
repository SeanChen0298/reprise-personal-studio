---
name: yt-dlp
description: Update, diagnose, or modify the yt-dlp + Deno sidecar setup in the Reprise desktop app. Use when downloads are broken, binaries need refreshing, or the sidecar wiring needs changes.
argument-hint: [update-binaries | diagnose | <describe task>]
allowed-tools: Read, Grep, Glob, Bash
---

You are working on the **Reprise** desktop app's yt-dlp integration. Use this project-specific knowledge to perform the requested task: **$ARGUMENTS**

---

## Architecture

yt-dlp is bundled as a Tauri **sidecar binary**. Since yt-dlp 2025.11.12+, YouTube JS challenges require **Deno** as an external JS runtime. Deno is also bundled as a sidecar so the app works without any system-level installs.

### Key files

| File | Purpose |
|------|---------|
| `reprise/apps/desktop/src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe` | Bundled yt-dlp binary |
| `reprise/apps/desktop/src-tauri/binaries/deno-x86_64-pc-windows-msvc.exe` | Bundled Deno binary |
| `reprise/apps/desktop/src-tauri/tauri.conf.json` | Registers both under `bundle.externalBin` |
| `reprise/apps/desktop/src-tauri/capabilities/default.json` | Tauri shell permissions for `binaries/yt-dlp` |
| `reprise/apps/desktop/src-tauri/src/lib.rs` | Rust command `get_sidecar_path_env` |
| `reprise/apps/desktop/src/lib/yt-dlp-runtime.ts` | Low-level plumbing: `YT_DLP_BASE`, `makeYtDlpCommand`, `spawnAndWait`, PATH injection |
| `reprise/apps/desktop/src/lib/yt-dlp-update.ts` | Staleness detection + runtime self-update (`--update-to stable`) |
| `reprise/apps/desktop/src/lib/audio-download.ts` | All yt-dlp invocation logic |
| `reprise/scripts/download-binaries.ps1` | Automates refreshing both binaries |

### How Deno discovery works at runtime

1. Tauri installs sidecar binaries **next to the main executable** (the triple-suffix is stripped at install time, so `deno-x86_64-pc-windows-msvc.exe` becomes `deno.exe`).
2. On each yt-dlp invocation, TypeScript calls the Rust command `get_sidecar_path_env` which returns `<exe-dir>;%PATH%`.
3. That path string is passed as the `PATH` env var to `Command.sidecar("binaries/yt-dlp", args, { env })`.
4. yt-dlp finds `deno.exe` on this PATH and uses it to solve YouTube's Botguard JS challenge.
5. `DENO_NO_UPDATE_CHECK=1` suppresses Deno's version prompt.

### Dev vs prod behaviour

| Mode | yt-dlp source | Deno source |
|------|--------------|-------------|
| `pnpm tauri dev` | System `yt-dlp` (PATH) | System `deno` (PATH) — must be installed |
| Production build | `binaries/yt-dlp` sidecar | `binaries/deno` sidecar — auto-discovered |

---

## Common tasks

### Update binaries (refresh to latest yt-dlp / Deno)

```powershell
# From reprise/ monorepo root:
powershell -ExecutionPolicy Bypass -File scripts/download-binaries.ps1 -Refresh   # only what's out of date
powershell -ExecutionPolicy Bypass -File scripts/download-binaries.ps1 -Force     # unconditionally
```

The script downloads from:
- yt-dlp: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`
- Deno: `https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip`

`-Refresh` compares the local `--version` against the latest GitHub release tag and skips the
download when already current (so it does not re-pull ~93 MB of Deno on every build). It is
network-tolerant: if GitHub is unreachable but a binary already exists, it warns and keeps it.

**This runs automatically on every production build** — `beforeBuildCommand` in `tauri.conf.json`
is `pnpm --filter desktop binaries:refresh && pnpm --filter desktop build`, so an installer can
never ship a stale yt-dlp.

Binaries are gitignored (`**/src-tauri/binaries/*.exe`) — the download script is the source of truth.

### Staleness / self-update (why 403s happen)

YouTube rotates its player and signature logic every few weeks, so a yt-dlp more than about a
month old starts failing with `HTTP Error 403: Forbidden` or a signature-extraction error. The
bundled sidecar is only ever as fresh as the installer, so the app also heals itself at runtime
(`lib/yt-dlp-update.ts`):

- **Pre-flight** — `ensureFreshYtDlp()` runs before each YouTube-touching call (`downloadAudio`,
  `fetchLyricsForLanguage`, `listSubtitleLanguages`). yt-dlp versions *are* release dates, so age
  is computed offline from `--version`; at `STALE_AFTER_DAYS` (30) it runs `--update-to stable`.
  Cached once per session, and rate-limited to one attempt per 6 h via `localStorage`.
- **Recovery** — if the audio pass still fails with a staleness-shaped error
  (`isStaleYtDlpError`), `recoverFromStaleYtDlp()` self-updates and retries the pass once.
  Bot-detection errors are checked first, since those need fresh cookies instead.
- **Manual** — Settings → YouTube downloads shows the version, flags it amber with its age when
  stale, and offers an **Update yt-dlp** button.

Self-update works because the NSIS bundle installs to `%LOCALAPPDATA%\Reprise` (`installMode:
currentUser`), which is user-writable; yt-dlp replaces its own exe in place. Auto-update is
skipped in dev, where yt-dlp comes from the system PATH.

### Diagnose a download failure

1. Check the error message in the yt-dlp stderr in the browser devtools console.
2. **"HTTP Error 403: Forbidden"** or **"older than 90 days"** → the bundled yt-dlp is stale. This is self-healing now (see *Staleness / self-update* below); if it persists, run `scripts/download-binaries.ps1 -Refresh` and rebuild, or press **Update yt-dlp** in Settings → YouTube downloads.
3. **"Sign in to confirm you're not a bot"** → cookies expired; re-export from Chrome to `C:/Reprise/cookies.txt`.
4. **"The page needs to be reloaded"** or **"JS challenge"** → Deno is missing or not found. Check that `deno-x86_64-pc-windows-msvc.exe` exists in `binaries/`. In dev, confirm `deno --version` works in shell.
5. **Exit code non-zero, no clear error** → run `yt-dlp -v <url>` in a terminal with the sidecar dir on PATH to see verbose output.

### Add or change yt-dlp flags

Edit the `YT_DLP_BASE` array in `reprise/apps/desktop/src/lib/yt-dlp-runtime.ts`. All four call sites (`downloadAudio` subtitles pass, `downloadAudio` audio pass, `fetchLyricsForLanguage`, `listSubtitleLanguages`) inherit from this array via spread.

### Add a new yt-dlp-backed feature

Use `makeYtDlpCommand(args)` — it handles dev/prod branching and PATH injection automatically:

```typescript
const command = await makeYtDlpCommand([...YT_DLP_BASE, ...yourArgs]);
const result = await spawnAndWait(command, "[yourTag]");
```

### Register a new sidecar binary

1. Place `<name>-x86_64-pc-windows-msvc.exe` in `reprise/apps/desktop/src-tauri/binaries/`.
2. Add `"binaries/<name>"` to `externalBin` in `tauri.conf.json`.
3. Add it to `scripts/download-binaries.ps1` so it can be refreshed.
4. If it needs Tauri shell permissions, add entries to `capabilities/default.json`.

---

## Invariants to preserve

- **Never call `Command.sidecar` for yt-dlp directly** — always go through `makeYtDlpCommand()` so PATH injection stays consistent.
- **Always spread `YT_DLP_BASE`** into every yt-dlp args array so `--js-runtimes deno` and `--cookies` are always present.
- **The Rust command `get_sidecar_path_env` must stay registered** in `lib.rs` via `invoke_handler` — it is called on every production yt-dlp invocation.
- **Binaries must not be committed to git** — they are gitignored; the download script is the source of truth.
- **Keep `beforeBuildCommand` running `binaries:refresh`** — dropping it lets a stale yt-dlp ship in the installer, which is exactly the 403 failure mode.
- **Do not add `--no-update`** to `YT_DLP_BASE`. The "your version is older than 90 days" warning is a useful staleness signal and `isStaleYtDlpError()` matches on it.
