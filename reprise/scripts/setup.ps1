#Requires -Version 5.1
<#
  Reprise - audio tooling setup
  =============================
  Installs the dependencies needed for the LOCAL audio-processing features:
    - Stem separation (Demucs)
    - Pitch analysis (torchcrepe)
    - Timestamp alignment (WhisperX)

  You do NOT need any of this for: browsing your library, lyrics/annotation,
  practice playback, recording, translation, furigana, or YouTube download.
  Those work out of the box.

  Usage (from a normal PowerShell terminal, in the repo root):
      powershell -ExecutionPolicy Bypass -File reprise\scripts\setup.ps1

  Re-runnable: it skips anything already installed.
#>

$ErrorActionPreference = "Stop"

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "  [ok] $m"   -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  [!]  $m"   -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "  [x]  $m"   -ForegroundColor Red }
function Test-Cmd($n)   { return $null -ne (Get-Command $n -ErrorAction SilentlyContinue) }

Write-Host "Reprise audio-tools setup" -ForegroundColor White
Write-Host "Installs FFmpeg + the Python packages for Demucs / torchcrepe / WhisperX."

# --- FFmpeg ----------------------------------------------------------------
Write-Step "FFmpeg"
if (Test-Cmd ffmpeg) {
  Write-Ok "FFmpeg already on PATH."
} elseif (Test-Cmd winget) {
  Write-Warn "Installing FFmpeg via winget (may prompt for elevation)..."
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  Write-Ok "FFmpeg installed. Restart your terminal if 'ffmpeg' isn't found below."
} else {
  Write-Err "FFmpeg missing and winget unavailable. Install FFmpeg manually, then re-run."
}

# --- Python 3.11 -----------------------------------------------------------
# The app runs the 'python' on your PATH, so that one must be 3.11
# (torch 2.5.1 is incompatible with 3.14+).
Write-Step "Python 3.11"
$pyOk = $false
if (Test-Cmd python) {
  $ver = (& python --version) 2>&1
  if ("$ver" -match "Python 3\.11") {
    Write-Ok "$ver  ('python' on PATH matches what the app calls)."
    $pyOk = $true
  } else {
    Write-Warn "'python' on PATH is '$ver' but Reprise needs Python 3.11."
  }
} else {
  Write-Warn "No 'python' found on PATH."
}

if (-not $pyOk) {
  $hasLauncher = $false
  try {
    $lver = (& py -3.11 --version) 2>&1
    if ("$lver" -match "Python 3\.11") { $hasLauncher = $true }
  } catch { }

  if ($hasLauncher) {
    Write-Warn "Python 3.11 exists via 'py -3.11' but is NOT the default 'python'."
    Write-Warn "Reprise calls 'python' from PATH - make 3.11 the default (put its"
    Write-Warn "folder ahead of other Pythons in PATH), then re-run this script."
  } else {
    Write-Err "Python 3.11 not found."
    Write-Err "Install it:  winget install Python.Python.3.11"
    Write-Err "Then ensure 'python --version' reports 3.11 and re-run. (Do NOT use 3.14+.)"
  }
  Write-Host "`nAborting - resolve Python 3.11 first." -ForegroundColor Red
  exit 1
}

# --- Python packages -------------------------------------------------------
Write-Step "Python packages"
Write-Warn "Installing into the 'python' on PATH. torch/whisperx are large (several GB)."

function Invoke-Pip([string[]]$pkgs) {
  & python -m pip install @pkgs
  if ($LASTEXITCODE -ne 0) {
    Write-Err ("pip install failed: " + ($pkgs -join ' '))
    exit 1
  }
}

& python -m pip install --upgrade pip | Out-Host
Invoke-Pip @("torch==2.5.1", "torchaudio==2.5.1")   # pinned; do NOT install torchcodec
Invoke-Pip @("demucs", "soundfile", "torchcrepe")
Invoke-Pip @("whisperx")
Write-Ok "Packages installed."

# --- Verify ----------------------------------------------------------------
Write-Step "Verifying"
$checks = @(
  @{ name = "torch";      code = "import torch; print(torch.__version__)" },
  @{ name = "demucs";     code = "import demucs; print(getattr(demucs,'__version__','ok'))" },
  @{ name = "torchcrepe"; code = "import torchcrepe; print('ok')" },
  @{ name = "whisperx";   code = "import whisperx; print('ok')" }
)
$allOk = $true
foreach ($c in $checks) {
  $out = (& python -c $c.code) 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Ok ("{0}: {1}" -f $c.name, ("$out".Trim()))
  } else {
    Write-Err ("{0} import failed" -f $c.name)
    $allOk = $false
  }
}
if (Test-Cmd ffmpeg) { Write-Ok "ffmpeg present" } else { Write-Warn "ffmpeg not on PATH yet - restart the terminal." }

# --- Next steps ------------------------------------------------------------
Write-Step "Next steps"
Write-Host "  1. Put your YouTube cookies at:  C:\Reprise\cookies.txt"
Write-Host "  2. First use of each feature downloads its model automatically (needs internet):"
Write-Host "       Demucs htdemucs (~80 MB) | torchcrepe model | WhisperX (~3 GB)"
Write-Host "  3. Restart Reprise so it re-checks tools (Settings -> Downloads shows status)."

if ($allOk) {
  Write-Host "`nSetup complete." -ForegroundColor Green
} else {
  Write-Host "`nSetup finished with warnings - see [x] lines above." -ForegroundColor Yellow
  exit 1
}
