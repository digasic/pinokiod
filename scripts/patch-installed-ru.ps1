# Patch installed Pinokio (AppData) with digasic/pinokiod Russian i18n.
# Re-run after Pinokio auto-updates overwrite app.asar.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File D:\devCursor\pinokio-ru\patch-installed-ru.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Install = Join-Path $env:LOCALAPPDATA 'Programs\Pinokio'
$Asar = Join-Path $Install 'resources\app.asar'
$Work = Join-Path $Root '_asar-work'
$Extracted = Join-Path $Work 'app'
$Backup = Join-Path $Work ("app.asar.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$AsarCli = Join-Path $Root 'pinokio\node_modules\@electron\asar\bin\asar.js'
$Fork = Join-Path $Root 'pinokiod'

if (-not (Test-Path $AsarCli)) {
  throw "Need @electron/asar. Run: cd `"$Root\pinokio`"; npm install --ignore-scripts"
}
if (-not (Test-Path $Asar)) { throw "Pinokio not installed: $Asar" }
if (-not (Test-Path (Join-Path $Fork 'server\i18n\index.js'))) {
  throw "Fork missing i18n: $Fork"
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
Write-Host "Backup -> $Backup"
Copy-Item -Force $Asar $Backup

if (Test-Path $Extracted) { Remove-Item -Recurse -Force $Extracted }
Write-Host 'Extract asar...'
& node $AsarCli extract $Asar $Extracted

$Target = Join-Path $Extracted 'node_modules\pinokiod'
if (-not (Test-Path $Target)) { throw "pinokiod missing in asar" }

Copy-Item -Recurse -Force (Join-Path $Fork 'server\i18n') (Join-Path $Target 'server\i18n')
Copy-Item -Force (Join-Path $Fork 'server\public\i18n-client.js') (Join-Path $Target 'server\public\i18n-client.js')
Copy-Item -Force (Join-Path $Fork 'server\index.js') (Join-Path $Target 'server\index.js')
Copy-Item -Force (Join-Path $Fork 'server\views\settings.ejs') (Join-Path $Target 'server\views\settings.ejs')

$UnpackedPublic = Join-Path $Install 'resources\app.asar.unpacked\node_modules\pinokiod\server\public'
New-Item -ItemType Directory -Force -Path $UnpackedPublic | Out-Null
Copy-Item -Force (Join-Path $Fork 'server\public\i18n-client.js') (Join-Path $UnpackedPublic 'i18n-client.js')

$cfgPath = Join-Path $env:USERPROFILE '.pinokio\config.json'
if (Test-Path $cfgPath) {
  $cfg = Get-Content -Raw $cfgPath | ConvertFrom-Json
  $cfg | Add-Member -NotePropertyName locale -NotePropertyValue 'ru' -Force
  ($cfg | ConvertTo-Json -Depth 30) | Set-Content -Path $cfgPath -Encoding utf8
}

$NewAsar = Join-Path $Work 'app.asar.new'
if (Test-Path $NewAsar) { Remove-Item -Force $NewAsar }
& node $AsarCli pack $Extracted $NewAsar

Get-Process -Name 'Pinokio' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
Copy-Item -Force $NewAsar $Asar
Write-Host 'OK: installed Pinokio patched with RU i18n'
Write-Host 'Start Pinokio.exe — Settings → Language → Русский'
