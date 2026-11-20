# Starts a clean demo on a running ClinicaLANTERN server.
# It calls POST /api/reset, puts the demo clock back to 0, then prints health and the criteria in use.
# This clone's server is on 8788. Pass -Port when the server is on another port.
#   pwsh -NoProfile -File tools\demo-reset.ps1 -Port 8788
param(
  [int]$Port = 8788
)
$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"
Invoke-RestMethod -Method Post -Uri "$base/api/reset" -ContentType 'application/json' -Body '{}' | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/demo-clock" -ContentType 'application/json' -Body '{"days":0}' | Out-Null
$health = Invoke-RestMethod -Uri "$base/api/health"
$criteria = Invoke-RestMethod -Uri "$base/api/criteria"
Write-Output 'A clean demo was started.'
Write-Output ('Health: ' + ($health | ConvertTo-Json -Compress -Depth 6))
$ids = @()
foreach ($item in @($criteria)) {
  if ($item.id) { $ids += [string]$item.id }
}
if ($ids.Count -eq 0) {
  Write-Output 'Criteria in use: none'
} else {
  Write-Output ('Criteria in use: ' + ($ids -join ', '))
}
