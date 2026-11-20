# Opens ClinicaLANTERN on this computer.
# A second click does not start a second server. It only opens the window.
# Loopback only. No administrator rights, no registry, no Windows setting.
param(
  [string]$AppDir,
  [string]$DataDir,
  [int]$Port = 0,
  [switch]$NoWarmup,
  [switch]$NoWindow,
  [switch]$NoMessageBox
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $AppDir) {
  $AppDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $AppDir = (Resolve-Path -LiteralPath $AppDir).Path
}
if (-not $DataDir) { $DataDir = Join-Path $AppDir 'data' }
if (-not (Test-Path -LiteralPath $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir | Out-Null
}
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path

$logPath = Join-Path $DataDir 'lantern-launch.log'
function Write-LaunchLog([string]$text) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
  Write-Output $line
}

function Get-PlanText([string[]]$planArgs) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { return $null }
  $plan = Join-Path $PSScriptRoot 'plan.ts'
  $out = & $node $plan @planArgs
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | Out-String).Trim()
}

function Show-LanternMessage([string]$key) {
  $text = Get-PlanText @('message', $key)
  if (-not $text) { $text = 'ClinicaLANTERN cannot open. The log in the data folder has the details.' }
  Write-LaunchLog "MESSAGE: $text"
  if ($NoMessageBox) { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    # 8 seconds, then it closes. The same sentence is in the log.
    $null = $shell.Popup($text, 8, 'ClinicaLANTERN', 48)
  } catch {
    Write-LaunchLog "The message box could not be shown: $($_.Exception.Message)"
  }
}

function Get-HttpCode([string]$Url) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $Url
    return [int]$resp.StatusCode
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      try { return [int]$response.StatusCode } catch { return 0 }
    }
    return 0
  }
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-LaunchLog 'Node.js was not found on PATH.'
  Show-LanternMessage 'node'
  exit 4
}

$factArgs = @('facts', '--app', $AppDir, '--data', $DataDir)
if ($Port -gt 0) { $factArgs += @('--port', "$Port") }
$factsJson = Get-PlanText $factArgs
if (-not $factsJson) {
  Write-LaunchLog 'The settings file could not be read.'
  Show-LanternMessage 'settings'
  exit 6
}
$facts = $factsJson | ConvertFrom-Json
Write-LaunchLog "AppDir $AppDir"
Write-LaunchLog "DataDir $DataDir"
Write-LaunchLog "Page $($facts.pageUrl)"

$versionCode = Get-HttpCode $facts.versionUrl
if ($versionCode -ne 200) {
  $starter = [string]$facts.modelStartScript
  if (Test-Path -LiteralPath $starter) {
    Write-LaunchLog "The model server is not answering. Starting it with $starter"
    & pwsh -NoProfile -File $starter
    $until = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Seconds 1
      $versionCode = Get-HttpCode $facts.versionUrl
      if ($versionCode -eq 200) { break }
    } while ((Get-Date) -lt $until)
  } else {
    Write-LaunchLog "The model server is not answering, and $starter is not on this computer."
  }
}
if ($versionCode -ne 200) {
  Write-LaunchLog 'The model server is not answering. It was left as it is.'
  Show-LanternMessage 'models'
  exit 3
}
Write-LaunchLog 'The model server is answering. It was left running.'

function Edge-ArgumentList([string[]]$arguments) {
  $list = [System.Collections.Generic.List[string]]::new()
  foreach ($arg in $arguments) {
    if ($arg -match '\s') {
      $list.Add('"' + ($arg -replace '"', '\"') + '"')
    } else {
      $list.Add($arg)
    }
  }
  return [string[]]$list
}

function Open-LanternWindow {
  if ($NoWindow) {
    Write-LaunchLog 'The window was not opened because -NoWindow was set.'
    return
  }
  if ($facts.driverPortRefused) {
    Write-LaunchLog ([string]$facts.driverPortRefused)
  }
  $edge = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($edge) {
    $edgeArgs = Edge-ArgumentList @([string[]]$facts.edgeArguments)
    Start-Process -FilePath $edge -ArgumentList $edgeArgs
    if ($facts.driverPort) {
      Write-LaunchLog "The window was opened for a test driver on port $($facts.driverPort), in a browser profile of its own. The application itself is not changed by this."
    } else {
      Write-LaunchLog "Opened the page in its own Edge window: $($facts.edgeArgument)"
    }
  } else {
    Start-Process $facts.pageUrl
    Write-LaunchLog 'Edge is not installed. Opened the page in the default browser.'
  }
}

$health = Get-HttpCode $facts.healthUrl
if ($health -eq 200) {
  Write-LaunchLog 'The application server is already answering. Opening the window only.'
  Open-LanternWindow
  exit 0
}

if (-not (Test-Path -LiteralPath $facts.builtPage)) {
  Write-LaunchLog "The built page is missing: $($facts.builtPage)"
  Show-LanternMessage 'builtPage'
  exit 2
}

$envArgs = @('server-env', '--port', "$($facts.port)", '--data', $DataDir)
if ($NoWarmup -or $env:LANTERN_NO_WARMUP -eq '1') { $envArgs += '--no-warmup' }
$envJson = Get-PlanText $envArgs
if (-not $envJson) {
  Write-LaunchLog 'The server command could not be built.'
  Show-LanternMessage 'settings'
  exit 6
}
$launch = $envJson | ConvertFrom-Json
$env:PORT = [string]$launch.env.PORT
$env:LANTERN_DATA_DIR = [string]$launch.env.LANTERN_DATA_DIR
if ($launch.env.LANTERN_NO_WARMUP) {
  $env:LANTERN_NO_WARMUP = [string]$launch.env.LANTERN_NO_WARMUP
  Write-LaunchLog 'Starting the application server with the warm-up off.'
} else {
  Remove-Item Env:\LANTERN_NO_WARMUP -ErrorAction SilentlyContinue
  Write-LaunchLog 'Starting the application server.'
}

$outLog = Join-Path $DataDir 'server.out.log'
$errLog = Join-Path $DataDir 'server.err.log'
$proc = Start-Process -FilePath $node -ArgumentList @($launch.args) -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Set-Content -LiteralPath (Join-Path $DataDir 'lantern.pid') -Value $proc.Id -Encoding ascii
Write-LaunchLog "Application server process $($proc.Id)"

$until = (Get-Date).AddSeconds(120)
do {
  Start-Sleep -Milliseconds 500
  $health = Get-HttpCode $facts.healthUrl
  if ($health -eq 200) { break }
  if ($proc.HasExited) { break }
} while ((Get-Date) -lt $until)

if ($health -ne 200) {
  Write-LaunchLog "The application server did not answer (last code $health)."
  if (Test-Path -LiteralPath $errLog) {
    Get-Content -LiteralPath $errLog -Tail 20 | ForEach-Object { Write-LaunchLog "server: $_" }
  }
  Show-LanternMessage 'server'
  exit 5
}

Write-LaunchLog 'The application server is answering.'
Open-LanternWindow
exit 0
