# Starts the one local Ollama server for ClinicaLANTERN (loopback only), unless it is already up.
# Safe to run again: it never starts a second server and never touches a server it did not start.
param(
  [int]$Port = 27435,
  [string]$KeepAlive = '20m',
  # The folder that holds ollama-v0.40.15\ollama.exe. The models are kept in ollama-store beside it.
  # Left empty, it is the folder this script stands in.
  [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = $Root
$exe = Join-Path $root 'ollama-v0.40.15\ollama.exe'
$store = Join-Path $root 'ollama-store'
$logs = Join-Path $root 'logs'
$pidFile = Join-Path $root 'ollama.pid.txt'
$base = "http://127.0.0.1:$Port"

function Test-Up {
  try { $r = Invoke-RestMethod -Uri "$base/api/version" -TimeoutSec 3; return [string]$r.version } catch { return $null }
}

$v = Test-Up
if ($v) { Write-Output "ALREADY UP version=$v at $base"; exit 0 }

if (-not (Test-Path -LiteralPath $exe)) { throw "ollama.exe not found at $exe" }
foreach ($d in @($store, $logs)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

$env:OLLAMA_HOST = "127.0.0.1:$Port"
$env:OLLAMA_MODELS = $store
$env:OLLAMA_KEEP_ALIVE = $KeepAlive
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NOPRUNE = '1'
$env:OLLAMA_LOAD_TIMEOUT = '10m'
$env:OLLAMA_CONTEXT_LENGTH = '16384'
$env:OLLAMA_ORIGINS = 'http://127.0.0.1:*,http://localhost:*'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $logs "ollama-$stamp.out.log"
$err = Join-Path $logs "ollama-$stamp.err.log"
$p = Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
Set-Content -LiteralPath $pidFile -Value ("{0}`n{1}`n{2}" -f $p.Id, $stamp, $err) -Encoding utf8

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $v = Test-Up
  if ($v) { Write-Output "STARTED pid=$($p.Id) version=$v at $base log=$err"; exit 0 }
  if ($p.HasExited) { throw "ollama serve exited early with code $($p.ExitCode); see $err" }
}
throw "ollama serve did not answer within 60 s; see $err"
