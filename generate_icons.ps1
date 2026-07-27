Add-Type -AssemblyName System.Drawing

$iconsDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir | Out-Null
}

function Create-Icon($size, $outputPath) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background gradient or fill
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255, 255, 102, 0), [System.Drawing.Color]::FromArgb(255, 230, 74, 0), 45.0)
    $g.FillRectangle($brush, $rect)

    # Draw arrow down
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [Math]::Max(2, [int]($size / 10)))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $mid = $size / 2
    $top = $size * 0.25
    $bot = $size * 0.65
    $wing = $size * 0.25

    # Vertical line
    $g.DrawLine($pen, [float]$mid, [float]$top, [float]$mid, [float]$bot)
    # Left wing
    $g.DrawLine($pen, [float]$mid, [float]$bot, [float]($mid - $wing), [float]($bot - $wing))
    # Right wing
    $g.DrawLine($pen, [float]$mid, [float]$bot, [float]($mid + $wing), [float]($bot - $wing))

    # Bottom line
    $g.DrawLine($pen, [float]($mid - $wing), [float]($size * 0.8), [float]($mid + $wing), [float]($size * 0.8))

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

Create-Icon 16 (Join-Path $iconsDir "icon16.png")
Create-Icon 48 (Join-Path $iconsDir "icon48.png")
Create-Icon 128 (Join-Path $iconsDir "icon128.png")

Write-Host "Icons generated successfully!"
