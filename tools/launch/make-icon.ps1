# Builds tools\launch\lantern.ico from the mark the page already shows (public\favicon.svg).
# It does not draw a new mark. Edge paints the existing file, then the sizes are scaled from that picture.
$ErrorActionPreference = 'Stop'

$svgPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\public\favicon.svg')).Path
$svg = Get-Content -Raw -LiteralPath $svgPath
$dir = Join-Path $env:TEMP 'lantern-icon-html'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$htmlPath = Join-Path $dir 'mark.html'
$pngPath = Join-Path $dir 'mark.png'
if (Test-Path -LiteralPath $pngPath) { Remove-Item -LiteralPath $pngPath -Force }
$html = @"
<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:transparent}svg{width:256px;height:256px;display:block}</style>
$svg
"@
Set-Content -LiteralPath $htmlPath -Value $html -Encoding utf8

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edge)) { throw 'Edge is not installed, so the icon cannot be made from the page mark.' }
$profile = Join-Path $env:TEMP ('lantern-edge-icon-' + [guid]::NewGuid().ToString('n'))
$url = ([Uri]$htmlPath).AbsoluteUri
& $edge --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --user-data-dir="$profile" --window-size=256,256 --default-background-color=00000000 --screenshot="$pngPath" $url
$deadline = (Get-Date).AddSeconds(30)
while (-not (Test-Path -LiteralPath $pngPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Path -LiteralPath $pngPath)) { throw 'The mark could not be painted from public\favicon.svg.' }

Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile($pngPath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = New-Object System.Collections.Generic.List[byte[]]
try {
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $graphics.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $pngs.Add($stream.ToArray())
    $stream.Dispose()
  }
} finally {
  $source.Dispose()
}

$outPath = Join-Path $PSScriptRoot 'lantern.ico'
$stream = [System.IO.File]::Create($outPath)
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$pngs.Count)
$offset = 6 + (16 * $pngs.Count)
for ($i = 0; $i -lt $pngs.Count; $i++) {
  $size = [int]$sizes[$i]
  $dim = if ($size -ge 256) { [byte]0 } else { [byte]$size }
  $writer.Write($dim)
  $writer.Write($dim)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]32)
  $writer.Write([uint32]$pngs[$i].Length)
  $writer.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
for ($i = 0; $i -lt $pngs.Count; $i++) { $writer.Write($pngs[$i]) }
$writer.Flush()
$writer.Dispose()
Write-Output "Wrote $outPath ($((Get-Item -LiteralPath $outPath).Length) bytes) from $svgPath"
