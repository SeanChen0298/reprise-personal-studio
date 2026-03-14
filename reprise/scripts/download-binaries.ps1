# download-binaries.ps1
# Downloads the latest yt-dlp.exe and deno.exe and places them in src-tauri/binaries/
# with the correct Tauri sidecar triple format for Windows x86_64.
#
# Usage: .\scripts\download-binaries.ps1
# Run from the repo root or from within the reprise/ monorepo directory.

param(
    [switch]$Force  # Re-download even if binaries already exist
)

$ErrorActionPreference = "Stop"

$TRIPLE = "x86_64-pc-windows-msvc"
$BINARIES_DIR = "$PSScriptRoot\..\apps\desktop\src-tauri\binaries"

# Ensure binaries directory exists
if (-not (Test-Path $BINARIES_DIR)) {
    New-Item -ItemType Directory -Path $BINARIES_DIR | Out-Null
}

$BINARIES_DIR = (Resolve-Path $BINARIES_DIR).Path
Write-Host "Binaries directory: $BINARIES_DIR" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. yt-dlp
# ---------------------------------------------------------------------------
$YT_DLP_DEST = "$BINARIES_DIR\yt-dlp-$TRIPLE.exe"

if ($Force -or -not (Test-Path $YT_DLP_DEST)) {
    Write-Host "`nDownloading yt-dlp (latest)..." -ForegroundColor Yellow

    # Resolve the redirect to get the actual latest release URL
    $YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"

    Write-Host "  URL: $YT_DLP_URL"
    Write-Host "  Dest: $YT_DLP_DEST"

    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $YT_DLP_URL -OutFile $YT_DLP_DEST -UseBasicParsing
    $ProgressPreference = 'Continue'

    $sizeMB = [math]::Round((Get-Item $YT_DLP_DEST).Length / 1MB, 1)
    Write-Host "  Done. Size: ${sizeMB} MB" -ForegroundColor Green
} else {
    Write-Host "`nyt-dlp already exists (use -Force to re-download): $YT_DLP_DEST" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 2. Deno
# ---------------------------------------------------------------------------
$DENO_DEST = "$BINARIES_DIR\deno-$TRIPLE.exe"

if ($Force -or -not (Test-Path $DENO_DEST)) {
    Write-Host "`nDownloading Deno (latest)..." -ForegroundColor Yellow

    $DENO_ZIP_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    $DENO_ZIP_TMP = "$env:TEMP\deno-download.zip"
    $DENO_EXTRACT_TMP = "$env:TEMP\deno-extract"

    Write-Host "  URL: $DENO_ZIP_URL"
    Write-Host "  Temp zip: $DENO_ZIP_TMP"

    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $DENO_ZIP_URL -OutFile $DENO_ZIP_TMP -UseBasicParsing
    $ProgressPreference = 'Continue'

    # Extract deno.exe from the zip
    if (Test-Path $DENO_EXTRACT_TMP) {
        Remove-Item $DENO_EXTRACT_TMP -Recurse -Force
    }
    Expand-Archive -Path $DENO_ZIP_TMP -DestinationPath $DENO_EXTRACT_TMP -Force

    $DENO_EXE_SRC = "$DENO_EXTRACT_TMP\deno.exe"
    if (-not (Test-Path $DENO_EXE_SRC)) {
        Write-Error "deno.exe not found in extracted archive. Contents: $(Get-ChildItem $DENO_EXTRACT_TMP)"
        exit 1
    }

    Copy-Item $DENO_EXE_SRC $DENO_DEST -Force

    # Cleanup temp files
    Remove-Item $DENO_ZIP_TMP -Force -ErrorAction SilentlyContinue
    Remove-Item $DENO_EXTRACT_TMP -Recurse -Force -ErrorAction SilentlyContinue

    $sizeMB = [math]::Round((Get-Item $DENO_DEST).Length / 1MB, 1)
    Write-Host "  Done. Size: ${sizeMB} MB" -ForegroundColor Green
} else {
    Write-Host "`nDeno already exists (use -Force to re-download): $DENO_DEST" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host "`nBinaries in $BINARIES_DIR`:" -ForegroundColor Cyan
Get-ChildItem $BINARIES_DIR | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host ("  {0,-50} {1,6} MB" -f $_.Name, $sizeMB)
}

Write-Host "`nAll done!" -ForegroundColor Green
