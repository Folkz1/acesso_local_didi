$ErrorActionPreference = "Stop"

function Read-DotEnvFile([string]$path) {
  $vars = @{}
  if (-not (Test-Path -LiteralPath $path)) {
    return $vars
  }

  foreach ($line in Get-Content -LiteralPath $path) {
    $trim = ""
    if ($null -ne $line) {
      $trim = ([string]$line).Trim()
    }
    if (-not $trim) { continue }
    if ($trim.StartsWith("#")) { continue }

    $idx = $trim.IndexOf("=")
    if ($idx -lt 1) { continue }

    $key = $trim.Substring(0, $idx).Trim()
    $value = $trim.Substring($idx + 1).Trim()
    if (-not $key) { continue }
    $vars[$key] = $value
  }

  return $vars
}

Set-Location -LiteralPath $PSScriptRoot

$dotenv = Read-DotEnvFile (Join-Path $PSScriptRoot ".env")

$memoryUrl =
  $dotenv["JARBAS_MEMORY_URL"]
if ($memoryUrl) {
  $memoryUrl = $memoryUrl.Trim()
  if (-not ($memoryUrl.StartsWith("http://") -or $memoryUrl.StartsWith("https://"))) {
    $memoryUrl = ("https://" + $memoryUrl)
  }
}

$memoryToken =
  $dotenv["JARBAS_MEMORY_AUTH_TOKEN"]
if (-not $memoryToken) {
  $memoryToken = $dotenv["JARBAS_MEMORY_TOKEN"]
}

$bridgeToken =
  $dotenv["BRIDGE_TOKEN"]
if (-not $bridgeToken) {
  $bridgeToken = $dotenv["REMOTE_BRIDGE_TOKEN"]
}

$tunnelUrlPath = Join-Path $PSScriptRoot "tunnel-url.txt"
if (-not (Test-Path -LiteralPath $tunnelUrlPath)) {
  throw "Missing tunnel-url.txt at $tunnelUrlPath"
}

$tunnelUrl = (Get-Content -LiteralPath $tunnelUrlPath -Raw).Trim()
if (-not $tunnelUrl) {
  throw "tunnel-url.txt is empty"
}

if (-not $memoryUrl) {
  throw "Missing JARBAS_MEMORY_URL in .env"
}
if (-not $memoryToken) {
  throw "Missing JARBAS_MEMORY_AUTH_TOKEN (or JARBAS_MEMORY_TOKEN) in .env"
}
if (-not $bridgeToken) {
  throw "Missing BRIDGE_TOKEN in .env"
}

$syncUrl = ($memoryUrl.TrimEnd("/") + "/bridge/sync")
$payload = @{
  url        = $tunnelUrl
  token      = $bridgeToken
  health_url = ($tunnelUrl.TrimEnd("/") + "/health")
  source     = "manual-sync"
  host       = $env:COMPUTERNAME
}

Write-Host ("Syncing bridge to: " + $syncUrl)
Write-Host ("Tunnel URL: " + $tunnelUrl)

$resp = Invoke-RestMethod -Method Post -Uri $syncUrl -Headers @{
  Authorization = ("Bearer " + $memoryToken)
  "Content-Type" = "application/json"
} -Body ($payload | ConvertTo-Json -Depth 6)

$resp | ConvertTo-Json -Depth 10
