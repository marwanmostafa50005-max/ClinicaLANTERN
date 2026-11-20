# Moves a running ClinicaLANTERN server's demo clock and prints the server's new time.
# This clone's server is on 8788. Pass -Port only when the server is on another port.
#   pwsh -NoProfile -File tools\demo-clock.ps1 -Days 8 -Port 8788
param(
  [Parameter(Mandatory = $true)]
  [int]$Days,
  [int]$Port = 8788
)
$ErrorActionPreference = 'Stop'
if ($Days -lt 0) { throw 'The demo clock takes a whole number of days, 0 or more.' }
$body = @{ days = $Days } | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/demo-clock" -ContentType 'application/json' -Body $body
if ($Days -eq 0) {
  Write-Output "The demo clock is back to the real date. Server time: $($result.serverTime)"
} else {
  Write-Output "Demo clock: $Days days ahead. Server time: $($result.serverTime)"
}
