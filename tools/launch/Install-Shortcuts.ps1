# Writes LANTERN.lnk on the Desktop and in the Start menu of the current user.
# It does not pin anything and it does not change a Windows setting.
# -Desktop and -Programs point the two files somewhere else. The proof uses them
# so this script is never aimed at the founder's own Desktop from a build run.
param(
  [string]$AppDir,
  [string]$DataDir,
  [switch]$Remove,
  [string]$Desktop,
  [string]$Programs
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $AppDir) {
  $AppDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $AppDir = (Resolve-Path -LiteralPath $AppDir).Path
}
if (-not $DataDir) { $DataDir = Join-Path $AppDir 'data' }
$DataDir = [System.IO.Path]::GetFullPath($DataDir)

if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }
if (-not $Programs) { $Programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }

$desktopLink = Join-Path $Desktop 'LANTERN.lnk'
$startLink = Join-Path $Programs 'LANTERN.lnk'

if ($Remove) {
  foreach ($link in @($desktopLink, $startLink)) {
    if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
  }
  Write-Output "Removed $desktopLink"
  Write-Output "Removed $startLink"
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $node -or -not $pwsh) {
  Write-Error 'Node.js and PowerShell 7 must both be on PATH.'
  exit 4
}

$script = Join-Path $PSScriptRoot 'Start-Lantern.ps1'
$icon = Join-Path $PSScriptRoot 'lantern.ico'
if (-not (Test-Path -LiteralPath $script)) { Write-Error "Missing $script"; exit 6 }
if (-not (Test-Path -LiteralPath $icon)) { Write-Error "Missing $icon"; exit 6 }

$plan = Join-Path $PSScriptRoot 'plan.ts'
$arguments = (& $node $plan shortcut --script $script --app $AppDir --data $DataDir | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $arguments) {
  Write-Error 'The shortcut command line could not be built.'
  exit 6
}
$description = 'ClinicaLANTERN: the LANTERN'

foreach ($dir in @($Desktop, $Programs)) {
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
}

$shell = New-Object -ComObject WScript.Shell
foreach ($link in @($desktopLink, $startLink)) {
  $cut = $shell.CreateShortcut($link)
  $cut.TargetPath = $pwsh
  $cut.Arguments = $arguments
  $cut.WorkingDirectory = $AppDir
  $cut.IconLocation = "$icon,0"
  $cut.Description = $description
  $cut.WindowStyle = 7
  $cut.Save()
  Write-Output "Wrote $link"
}
exit 0
