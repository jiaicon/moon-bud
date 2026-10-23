# Monthly tabBar icon generator.
# Comments are ASCII-only on purpose: Windows PowerShell 5.1 decodes a BOM-less UTF-8
# script as GBK, and any Chinese comment then breaks the parse with a bogus error.
#
#   powershell.exe -ExecutionPolicy Bypass -File apps/mobile/scripts/gen-tabbar-icons.ps1
#
# Inputs: tabbar-colors.json (dump-tabbar-colors.ts writes it from the theme code).
# Output: 81x81 transparent PNGs, one per glyph x preset x mode x state, in src/static/tabbar.

param(
  [string]$ColorsFile = (Join-Path $PSScriptRoot 'tabbar-colors.json'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\src\static\tabbar')
)

Add-Type -AssemblyName System.Drawing

$Sup    = 4       # supersample factor: draw big, then downscale with high-quality bicubic
$U      = 24.0    # design grid in units
$Stroke = 1.75    # line width in units

function Rounded([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
function Ellipse([single]$x, [single]$y, [single]$w, [single]$h) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($x, $y, $w, $h)
  return $p
}
function Lines([single[]]$pts) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  for ($i = 0; $i -lt $pts.Count - 2; $i += 2) {
    $p.AddLine($pts[$i], $pts[$i + 1], $pts[$i + 2], $pts[$i + 3])
  }
  return $p
}

# A shape is @{ M = mode; P = factory }. The factory is required (not a cached path)
# because the same geometry gets drawn twice - soft fill then stroke - and a disposed
# GraphicsPath cannot be reused.
# Modes: stroke = outline, soft = faint wash (active state only), mid = milk level, solid = filled.
function Get-Glyph([string]$kind, [bool]$active) {
  $out = @()
  switch ($kind) {
    'home' {
      $roof  = { Lines @(3.6, 11.5, 12, 4.5, 20.4, 11.5) }
      $house = { Rounded 6.0 11.3 12.0 8.3 2.0 }
      $door  = { Rounded 10.6 15.4 2.8 4.2 0.9 }
      $out += @{ M = 'stroke'; P = $roof }
      $out += @{ M = 'soft';   P = $house }
      $out += @{ M = 'stroke'; P = $house }
      # Active = the door is lit; idle = it is only outlined.
      if ($active) { $out += @{ M = 'solid'; P = $door } } else { $out += @{ M = 'stroke'; P = $door } }
    }
    'bottle' {
      $teat  = { Rounded 10.3 3.4 3.4 2.3 1.0 }
      $body  = { Rounded 7.6 8.9 8.8 11.7 2.6 }
      $out += @{ M = 'stroke'; P = $teat }
      $out += @{ M = 'stroke'; P = { Lines @(8.6, 6.5, 15.4, 6.5) } }
      $out += @{ M = 'stroke'; P = { Lines @(9.8, 6.8, 8.2, 8.9) } }
      $out += @{ M = 'stroke'; P = { Lines @(14.2, 6.8, 15.8, 8.9) } }
      $out += @{ M = 'soft';   P = $body }
      if ($active) {
        # Active = the bottle holds milk; idle = it shows the two measure ticks.
        $out += @{ M = 'mid';    P = { Rounded 8.4 14.9 7.2 5.0 1.9 } }
        $out += @{ M = 'stroke'; P = { Lines @(8.3, 13.6, 15.7, 13.6) } }
      } else {
        $out += @{ M = 'stroke'; P = { Lines @(9.5, 12.4, 11.4, 12.4) } }
        $out += @{ M = 'stroke'; P = { Lines @(9.5, 15.8, 11.4, 15.8) } }
      }
      $out += @{ M = 'stroke'; P = $body }
    }
    'bell' {
      $dome = {
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddLine(6.2, 15.0, 7.3, 10.6)
        $p.AddArc(7.3, 5.4, 9.4, 9.4, 180, 180)
        $p.AddLine(16.7, 10.6, 17.8, 15.0)
        $p
      }
      $clapper = { Ellipse 10.6 17.0 2.8 2.8 }
      $out += @{ M = 'soft';   P = $dome }
      $out += @{ M = 'stroke'; P = $dome }
      $out += @{ M = 'stroke'; P = { Lines @(4.8, 15.2, 19.2, 15.2) } }
      if ($active) {
        # Active = it just rang: solid clapper plus two sound waves.
        $out += @{ M = 'solid';  P = $clapper }
        $out += @{ M = 'stroke'; P = { $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddArc(2.6, 8.6, 3.0, 4.8, 120, 120); $p } }
        $out += @{ M = 'stroke'; P = { $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddArc(18.4, 8.6, 3.0, 4.8, 300, 120); $p } }
      } else {
        $out += @{ M = 'stroke'; P = $clapper }
      }
    }
    'profile' {
      $head = { Ellipse 8.7 4.0 6.6 6.6 }
      $body = {
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddArc(5.6, 13.0, 12.8, 12.0, 180, 180)
        $p.CloseFigure()
        $p
      }
      $arcOnly = { $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $p.AddArc(5.6, 13.0, 12.8, 12.0, 180, 180); $p }
      $out += @{ M = 'soft'; P = $head }
      $out += @{ M = 'soft'; P = $body }
      # Active = the head is filled in; idle = outlined.
      if ($active) { $out += @{ M = 'solid'; P = $head } } else { $out += @{ M = 'stroke'; P = $head } }
      $out += @{ M = 'stroke'; P = $arcOnly }
    }
  }
  return $out
}

function Ink([string]$hex) {
  return [System.Drawing.Color]::FromArgb(
    [int]('0x' + $hex.Substring(1, 2)),
    [int]('0x' + $hex.Substring(3, 2)),
    [int]('0x' + $hex.Substring(5, 2)))
}

function Draw-Icon([string]$kind, [bool]$active, [System.Drawing.Color]$ink, [int]$px) {
  $big = $px * $Sup
  $bmp = New-Object System.Drawing.Bitmap($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = [single]($big / $U)
  $g.ScaleTransform($k, $k)
  $pen = New-Object System.Drawing.Pen($ink, [single]$Stroke)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  foreach ($sh in (Get-Glyph $kind $active)) {
    if ($sh.M -eq 'soft' -and -not $active) { continue }   # the wash only appears in the active state
    $path = & $sh.P
    $brush = $null
    switch ($sh.M) {
      'stroke' { $g.DrawPath($pen, $path) }
      'soft'   { $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(62, $ink.R, $ink.G, $ink.B)) }
      'mid'    { $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, $ink.R, $ink.G, $ink.B)) }
      'solid'  { $brush = New-Object System.Drawing.SolidBrush($ink) }
    }
    if ($null -ne $brush) { $g.FillPath($brush, $path); $brush.Dispose() }
    $path.Dispose()
  }
  $pen.Dispose(); $g.Dispose()
  $outBmp = New-Object System.Drawing.Bitmap($px, $px, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($outBmp)
  $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $og.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $px, $px)))
  $og.Dispose(); $bmp.Dispose()
  return $outBmp
}

$colors = Get-Content -Raw -Encoding UTF8 $ColorsFile | ConvertFrom-Json
$px = [int]$colors.size
if ($px -le 0) { $px = 81 }

# filename glyph -> geometry kind; order must match pages.json tabBar.list
$glyphs = [ordered]@{ home = 'home'; record = 'bottle'; reminder = 'bell'; profile = 'profile' }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

$made = 0
foreach ($glyph in $glyphs.Keys) {
  $kind = $glyphs[$glyph]
  foreach ($preset in $colors.presets.PSObject.Properties.Name) {
    foreach ($mode in @('light', 'dark')) {
      foreach ($state in @(@('idle', $false), @('active', $true))) {
        $name = $state[0]
        $active = [bool]$state[1]
        $hex = $colors.presets.$preset.$name.$mode
        $icon = Draw-Icon $kind $active (Ink $hex) $px
        $path = Join-Path $OutDir "$glyph-$name-$preset-$mode.png"
        $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        $icon.Dispose()
        $made++
      }
    }
  }
}
Write-Output "generated $made PNGs in $OutDir"
