#Requires -Version 5.1
<#
.SYNOPSIS
  One-click start for local AI Town (Docker Convex + Vite + chat-server).

.USAGE
  Double-click start.bat, or:
    .\start.ps1
    .\start.ps1 -SkipBrowser
    .\start.ps1 -SkipPredev
#>
param(
  [switch]$SkipBrowser,
  [switch]$SkipPredev,
  [switch]$SkipOllamaCheck
)

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-PortOpen([int]$Port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800, $false)
    if (-not $ok) { $c.Close(); return $false }
    $c.EndConnect($iar)
    $c.Close()
    return $true
  } catch {
    return $false
  }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Test-DockerRunning {
  # Avoid "$ErrorActionPreference=Stop + stderr" false failures from docker warnings.
  cmd /c "docker ps >nul 2>nul"
  return ($LASTEXITCODE -eq 0)
}

function Ensure-EnvLocal([string]$AdminKey) {
  $envPath = Join-Path $PSScriptRoot '.env.local'
  $content = @"
CONVEX_SELF_HOSTED_ADMIN_KEY="$AdminKey"
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
VITE_CONVEX_URL="http://127.0.0.1:3210"
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
"@
  if (-not (Test-Path -LiteralPath $envPath)) {
    Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
    Write-Host "Created .env.local"
    return
  }
  $existing = Get-Content -LiteralPath $envPath -Raw
  if ($existing -notmatch 'CONVEX_SELF_HOSTED_ADMIN_KEY=.+\S' -or $existing -match 'CONVEX_SELF_HOSTED_ADMIN_KEY="<admin-key>"') {
    Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
    Write-Host "Updated .env.local with admin key"
  } else {
    Write-Host ".env.local already set"
  }
}

try {
  # --- checks ---
  Write-Step "Checking Docker"
  if (-not (Test-DockerRunning)) {
    throw "Docker Desktop is not running. Start it and retry."
  }
  Write-Host "Docker OK"

  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Step "Installing npm dependencies"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
  }

  if (-not $SkipOllamaCheck) {
    Write-Step "Checking Ollama (optional)"
    if (Test-PortOpen 11434) {
      Write-Host "Ollama is up on :11434"
    } else {
      Write-Host "Ollama not detected on :11434 — NPC chat/embed may fail until you start it." -ForegroundColor Yellow
    }
  }

  # --- Convex backend ---
  Write-Step "Starting Convex (docker compose backend + dashboard)"
  docker compose up -d backend dashboard
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed (exit $LASTEXITCODE)" }

  Write-Step "Waiting for Convex :3210"
  if (-not (Wait-HttpOk 'http://127.0.0.1:3210/version' 120)) {
    throw "Convex backend did not become ready in time."
  }
  Write-Host "Convex is ready"

  # Admin key / .env.local
  Write-Step "Ensuring admin key / .env.local"
  $envPath = Join-Path $PSScriptRoot '.env.local'
  $needKey = $true
  if (Test-Path -LiteralPath $envPath) {
    $raw = Get-Content -LiteralPath $envPath -Raw
    if ($raw -match 'CONVEX_SELF_HOSTED_ADMIN_KEY="?([^"\r\n]+)"?' -and $Matches[1] -and $Matches[1] -ne '<admin-key>') {
      $needKey = $false
    }
  }
  if ($needKey) {
    $keyOut = cmd /c "docker compose exec -T backend ./generate_admin_key.sh 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "generate_admin_key failed:`n$keyOut" }
    $adminKey = ($keyOut -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -notmatch '^\s*#' } | Select-Object -Last 1)
    if (-not $adminKey) { throw "Failed to parse admin key from:`n$keyOut" }
    Ensure-EnvLocal $adminKey
  } else {
    Write-Host ".env.local already has admin key"
  }

  # Ollama host for Convex (best-effort)
  Write-Step "Convex Ollama env (best-effort)"
  cmd /c "npx convex env set OLLAMA_HOST http://host.docker.internal:11434 >nul 2>nul"
  cmd /c "npx convex env set OLLAMA_MODEL qwen2.5 >nul 2>nul"
  Write-Host "OLLAMA_HOST / OLLAMA_MODEL attempted"

  if (-not $SkipPredev) {
    Write-Step "Running predev (convex init)"
    npm run predev
    if ($LASTEXITCODE -ne 0) { throw "predev failed (exit $LASTEXITCODE)" }
  }

  Write-Step "Starting dev (Convex sync + Vite :5173 + chat :8791)"
  Write-Host "Frontend:  http://localhost:5173/ai-town"
  Write-Host "Monitor:   http://localhost:5173/ai-town/monitor"
  Write-Host "Dashboard: http://localhost:6791"
  Write-Host "Ctrl+C stops Vite/chat/convex-dev (Docker Convex keeps running)." -ForegroundColor DarkGray
  Write-Host ""

  # Open pages after Vite is listening so the monitor can reach /chat-api/status.
  $openBrowser = -not $SkipBrowser
  $job = Start-Job -ScriptBlock {
    param($open)
    for ($i = 0; $i -lt 60; $i++) {
      try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', 5173, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(500, $false)
        if ($ok) {
          $c.EndConnect($iar)
          $c.Close()
          Start-Sleep -Seconds 1
          if ($open) {
            Start-Process 'http://localhost:5173/ai-town'
            Start-Process 'http://localhost:5173/ai-town/monitor'
          }
          return
        }
        $c.Close()
      } catch { }
      Start-Sleep -Seconds 1
    }
  } -ArgumentList $openBrowser

  try {
    npm run dev
    exit $LASTEXITCODE
  } finally {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }
}
catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  if ($env:START_NO_PAUSE -ne '1') {
    Write-Host ""
    Write-Host "Press any key to close..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  }
  exit 1
}
