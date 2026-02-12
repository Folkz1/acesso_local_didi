param(
  [switch]$RestartBridge,
  [switch]$RestartTunnel
)

if (-not $PSBoundParameters.ContainsKey("RestartTunnel")) {
  $RestartTunnel = $true
}

$ErrorActionPreference = "Stop"

$Dir = "D:\jarbas_vida\skills\remote-executor"
Set-Location $Dir

New-Item -ItemType Directory -Force -Path (Join-Path $Dir "logs") | Out-Null

function Stop-ByCommandLineLike($exeName, $patterns) {
  $procs = Get-CimInstance Win32_Process -Filter ("Name='{0}'" -f $exeName) |
    Where-Object {
      $cl = $_.CommandLine
      if (-not $cl) { return $false }
      foreach ($p in $patterns) {
        if ($cl -like $p) { return $true }
      }
      return $false
    }
  foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}

Write-Output "Cleaning previous bridge/tunnel processes (if any)..."
if ($RestartBridge) {
  Stop-ByCommandLineLike "node.exe" @("*bridge-server.js*", "*capture-tunnel-url.js*")
}
if ($RestartTunnel) {
  Stop-ByCommandLineLike "cloudflared.exe" @("*tunnel*--url*http://localhost:8788*", "*tunnel*--url*http://127.0.0.1:8788*")
}

$BridgeOut = Join-Path $Dir "logs\bridge.out.log"
$BridgeErr = Join-Path $Dir "logs\bridge.err.log"
$CloudOut  = Join-Path $Dir "logs\cloudflared.out.log"
$CloudErr  = Join-Path $Dir "logs\cloudflared.err.log"

Write-Output "Starting bridge server..."
try {
  $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://127.0.0.1:8788/health"
  if ($resp.StatusCode -eq 200) {
    Write-Output "Bridge already running on 8788."
  } else {
    throw "Bridge not healthy"
  }
} catch {
  Start-Process -FilePath "node" -ArgumentList "bridge-server.js" -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput $BridgeOut -RedirectStandardError $BridgeErr
}

Write-Output "Waiting for local bridge health..."
$BridgeOk = $false
for ($i = 0; $i -lt 12; $i++) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://127.0.0.1:8788/health"
    if ($resp.StatusCode -eq 200) { $BridgeOk = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $BridgeOk) {
  Write-Output "Bridge did not become healthy. Check:"
  Write-Output "  $BridgeOut"
  Write-Output "  $BridgeErr"
  exit 1
}

$CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $CloudflaredExe)) {
  Write-Output "cloudflared not found at: $CloudflaredExe"
  exit 1
}

Write-Output "Starting Cloudflare Tunnel (quick tunnel)..."
if (-not $RestartTunnel) {
  Write-Output "Tunnel restart disabled (-RestartTunnel:$false)."
} else {
  Start-Process -FilePath $CloudflaredExe -ArgumentList "tunnel --url http://localhost:8788" -WorkingDirectory $Dir -WindowStyle Hidden `
    -RedirectStandardOutput $CloudOut -RedirectStandardError $CloudErr
}

Write-Output "Waiting for tunnel URL in cloudflared output..."
$TunnelUrl = $null
for ($i = 0; $i -lt 60; $i++) {
  try {
    $txt = ""
    if (Test-Path $CloudOut) { $txt += (Get-Content $CloudOut -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path $CloudErr) { $txt += "`n" + (Get-Content $CloudErr -Raw -ErrorAction SilentlyContinue) }
    if ($txt) {
      $m = [regex]::Match($txt, "https://[a-z0-9-]+\.trycloudflare\.com", "IgnoreCase")
      if ($m.Success) { $TunnelUrl = $m.Value; break }
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}

if (-not $TunnelUrl) {
  Write-Output "Tunnel URL not found yet. Check:"
  Write-Output "  $CloudOut"
  Write-Output "  $CloudErr"
  exit 1
}

Write-Output ("Tunnel URL: {0}" -f $TunnelUrl)
Write-Output "Triggering capture side effects (WhatsApp + /bridge/sync)..."
Start-Process -FilePath "node" -ArgumentList @("capture-tunnel-url.js","--url",$TunnelUrl) -WorkingDirectory $Dir -WindowStyle Hidden

Write-Output "Done. Processes are running in background."
