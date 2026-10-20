# download-binaries.ps1
# Downloads yt-dlp.exe and deno.exe into src-tauri/binaries/ with the Tauri
# sidecar triple format for Windows x86_64.
#
# Usage:
#   .\scripts\download-binaries.ps1            # download only what's missing
#   .\scripts\download-binaries.ps1 -Refresh   # also re-download anything out of date
#   .\scripts\download-binaries.ps1 -Force     # re-download unconditionally
#
# -Refresh is what production builds use (see apps/desktop package.json
# "binaries:refresh"). A stale yt-dlp gets rejected by YouTube with
# "HTTP Error 403: Forbidden", so the installer must never ship an old one.
# -Refresh is network-tolerant: if GitHub is unreachable but a binary is already
# present, it warns and keeps the existing one so offline builds still work.
#
# Run from the repo root or from within the reprise/ monorepo directory.

param(
    [switch]$Force,   # Re-download even if binaries are already up to date
    [switch]$Refresh  # Re-download only when the local version is out of date
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$TRIPLE = "x86_64-pc-windows-msvc"
$BINARIES_DIR = "$PSScriptRoot\..\apps\desktop\src-tauri\binaries"

if (-not (Test-Path $BINARIES_DIR)) {
    New-Item -ItemType Directory -Path $BINARIES_DIR | Out-Null
}

$BINARIES_DIR = (Resolve-Path $BINARIES_DIR).Path
Write-Host "Binaries directory: $BINARIES_DIR" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Latest release tag for a GitHub repo, or $null if the API can't be reached.
function Get-LatestTag($repo) {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" `
            -UseBasicParsing -Headers @{ "User-Agent" = "reprise-build" }
        return $release.tag_name
    } catch {
        Write-Host "  Could not reach GitHub for $repo : $($_.Exception.Message)" -ForegroundColor DarkYellow
        return $null
    }
}

# Version reported by a local exe, or $null if it's missing or won't run.
function Get-LocalVersion($exe, $argList, $pattern) {
    if (-not (Test-Path $exe)) { return $null }
    try {
        $output = & $exe $argList 2>&1 | Out-String
        $match = [regex]::Match($output, $pattern)
        if ($match.Success) { return $match.Groups[1].Value }
        return $null
    } catch {
        return $null
    }
}

# Decide whether to download. Returns a reason string, or $null to skip.
function Get-DownloadReason($name, $dest, $localVersion, $latestVersion) {
    if ($Force) { return "-Force specified" }
    if (-not (Test-Path $dest)) { return "not present" }
    if (-not $Refresh) { return $null }
    if (-not $latestVersion) { return $null }  # offline; keep what we have
    if (-not $localVersion) { return "local version unreadable" }
    if ($localVersion -ne $latestVersion) {
        return "out of date ($localVersion -> $latestVersion)"
    }
    Write-Host "`n$name is up to date ($localVersion)." -ForegroundColor Green
    return $null
}

# Download, but never break a build that already has a usable binary.
function Invoke-BinaryDownload($name, $dest, $downloadAction) {
    try {
        & $downloadAction
        $sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
        Write-Host "  Done. Size: ${sizeMB} MB" -ForegroundColor Green
    } catch {
        if (Test-Path $dest) {
            Write-Host "  Download failed: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "  Keeping the existing $name binary." -ForegroundColor Yellow
        } else {
            throw "Failed to download $name and no existing binary to fall back on: $($_.Exception.Message)"
        }
    }
}

# ---------------------------------------------------------------------------
# 1. yt-dlp
# ---------------------------------------------------------------------------
$YT_DLP_DEST = "$BINARIES_DIR\yt-dlp-$TRIPLE.exe"

$ytDlpLocal = Get-LocalVersion $YT_DLP_DEST @("--version") '(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)'
$ytDlpLatest = $null
if ($Refresh -and -not $Force) {
    $ytDlpLatest = Get-LatestTag "yt-dlp/yt-dlp"
}

$reason = Get-DownloadReason "yt-dlp" $YT_DLP_DEST $ytDlpLocal $ytDlpLatest
if ($reason) {
    Write-Host "`nDownloading yt-dlp (latest) - $reason..." -ForegroundColor Yellow

    $YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    Write-Host "  URL: $YT_DLP_URL"
    Write-Host "  Dest: $YT_DLP_DEST"

    Invoke-BinaryDownload "yt-dlp" $YT_DLP_DEST {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $YT_DLP_URL -OutFile $YT_DLP_DEST -UseBasicParsing
        $ProgressPreference = 'Continue'
    }
} elseif (-not $Refresh -and (Test-Path $YT_DLP_DEST)) {
    Write-Host "`nyt-dlp already exists (use -Refresh or -Force to re-download): $YT_DLP_DEST" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 2. Deno
# ---------------------------------------------------------------------------
$DENO_DEST = "$BINARIES_DIR\deno-$TRIPLE.exe"

$denoLocal = Get-LocalVersion $DENO_DEST @("--version") 'deno\s+(\d+\.\d+\.\d+)'
$denoLatest = $null
if ($Refresh -and -not $Force) {
    $tag = Get-LatestTag "denoland/deno"
    if ($tag) { $denoLatest = $tag.TrimStart("v") }
}

$reason = Get-DownloadReason "Deno" $DENO_DEST $denoLocal $denoLatest
if ($reason) {
    Write-Host "`nDownloading Deno (latest) - $reason..." -ForegroundColor Yellow

    $DENO_ZIP_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    $DENO_ZIP_TMP = "$env:TEMP\deno-download.zip"
    $DENO_EXTRACT_TMP = "$env:TEMP\deno-extract"

    Write-Host "  URL: $DENO_ZIP_URL"
    Write-Host "  Temp zip: $DENO_ZIP_TMP"

    Invoke-BinaryDownload "Deno" $DENO_DEST {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $DENO_ZIP_URL -OutFile $DENO_ZIP_TMP -UseBasicParsing
        $ProgressPreference = 'Continue'

        if (Test-Path $DENO_EXTRACT_TMP) {
            Remove-Item $DENO_EXTRACT_TMP -Recurse -Force
        }
        Expand-Archive -Path $DENO_ZIP_TMP -DestinationPath $DENO_EXTRACT_TMP -Force

        $DENO_EXE_SRC = "$DENO_EXTRACT_TMP\deno.exe"
        if (-not (Test-Path $DENO_EXE_SRC)) {
            throw "deno.exe not found in extracted archive. Contents: $(Get-ChildItem $DENO_EXTRACT_TMP)"
        }

        Copy-Item $DENO_EXE_SRC $DENO_DEST -Force

        Remove-Item $DENO_ZIP_TMP -Force -ErrorAction SilentlyContinue
        Remove-Item $DENO_EXTRACT_TMP -Recurse -Force -ErrorAction SilentlyContinue
    }
} elseif (-not $Refresh -and (Test-Path $DENO_DEST)) {
    Write-Host "`nDeno already exists (use -Refresh or -Force to re-download): $DENO_DEST" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host "`nBinaries in $BINARIES_DIR`:" -ForegroundColor Cyan
Get-ChildItem $BINARIES_DIR | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host ("  {0,-50} {1,6} MB" -f $_.Name, $sizeMB)
}

$finalYtDlp = Get-LocalVersion $YT_DLP_DEST @("--version") '(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)'
if ($finalYtDlp) {
    Write-Host "`nyt-dlp version: $finalYtDlp" -ForegroundColor Cyan
    try {
        $age = (New-TimeSpan -Start ([datetime]::ParseExact($finalYtDlp.Substring(0, 10), "yyyy.MM.dd", $null)) -End (Get-Date)).Days
        if ($age -ge 30) {
            Write-Host "NOTE: bundled yt-dlp is $age days old." -ForegroundColor Yellow
            if ($ytDlpLatest -and $finalYtDlp -eq $ytDlpLatest) {
                Write-Host "      That is the newest stable release, so there is nothing fresher to bundle." -ForegroundColor Yellow
                Write-Host "      The app self-updates at runtime once yt-dlp ships a newer build." -ForegroundColor Yellow
            } else {
                Write-Host "      Re-run with -Refresh to pull the latest stable release." -ForegroundColor Yellow
            }
        }
    } catch {
        # Non-date version (e.g. a nightly build) — nothing to warn about.
    }
}

Write-Host "`nAll done!" -ForegroundColor Green
