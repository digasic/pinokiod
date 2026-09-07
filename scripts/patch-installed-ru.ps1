# Patch installed Pinokio (AppData) with digasic/pinokiod Russian i18n.
# Re-run after Pinokio auto-updates overwrite app.asar.
#
# Usage (from pinokio-ru workspace OR with siblings pinokiod/ + pinokio/):
#   powershell -ExecutionPolicy Bypass -File pinokiod\scripts\patch-installed-ru.ps1
#
# Requires: pinokio/node_modules/@electron/asar (npm install --ignore-scripts in pinokio)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Fork = Split-Path -Parent $ScriptDir
# Workspace root = parent of pinokiod (siblings: pinokiod + pinokio)
$Root = Split-Path -Parent $Fork
if (-not (Test-Path (Join-Path $Root 'pinokio\package.json'))) {
  # fallback: script living at workspace root as patch-installed-ru.ps1
  if (Test-Path (Join-Path $ScriptDir '..\pinokio\package.json')) {
    $Root = Resolve-Path (Join-Path $ScriptDir '..')
    $Fork = Join-Path $Root 'pinokiod'
  }
}

$Install = Join-Path $env:LOCALAPPDATA 'Programs\Pinokio'
$Asar = Join-Path $Install 'resources\app.asar'
$Work = Join-Path $Root '_asar-work'
$Extracted = Join-Path $Work 'app'
$Backup = Join-Path $Work ("app.asar.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$AsarCli = Join-Path $Root 'pinokio\node_modules\@electron\asar\bin\asar.js'

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

$i18nDst = Join-Path $Target 'server\i18n'
if (Test-Path $i18nDst) { Remove-Item -Recurse -Force $i18nDst }
Copy-Item -Recurse -Force (Join-Path $Fork 'server\i18n') $i18nDst
Copy-Item -Force (Join-Path $Fork 'server\public\i18n-client.js') (Join-Path $Target 'server\public\i18n-client.js')
Copy-Item -Force (Join-Path $Fork 'server\index.js') (Join-Path $Target 'server\index.js')
Copy-Item -Force (Join-Path $Fork 'server\views\settings.ejs') (Join-Path $Target 'server\views\settings.ejs')

$i18nJs = Get-Content -Raw (Join-Path $i18nDst 'index.js')
if ($i18nJs -notmatch 'Exact-match only|translateDynamic|normalizeUiText') {
  throw 'Patched i18n/index.js looks stale (missing exact-match translator)'
}
$idx = Get-Content -Raw (Join-Path $Target 'server\index.js')
$localeHits = ([regex]::Matches($idx, 'key: "locale"')).Count
if ($localeHits -lt 2) {
  throw "Expected locale in both settings configArrays, found $localeHits"
}

$UnpackedPublic = Join-Path $Install 'resources\app.asar.unpacked\node_modules\pinokiod\server\public'
New-Item -ItemType Directory -Force -Path $UnpackedPublic | Out-Null
Copy-Item -Force (Join-Path $Fork 'server\public\i18n-client.js') (Join-Path $UnpackedPublic 'i18n-client.js')

# Merge locale into config WITHOUT wiping home (never ConvertTo-Json the whole file blindly)
$cfgPath = Join-Path $env:USERPROFILE '.pinokio\config.json'
$mergeJs = @'
const fs = require('fs')
const p = process.argv[1]
if (!fs.existsSync(p)) process.exit(0)
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
if (!cfg.home) {
  console.warn('WARN: config.json has no home — not writing locale-only wipe; set home first')
  process.exit(0)
}
cfg.locale = 'ru'
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n')
console.log('config locale=ru home=', cfg.home)
'@
$mergeFile = Join-Path $Work '_merge-locale.js'
Set-Content -Path $mergeFile -Value $mergeJs -Encoding utf8
& node $mergeFile $cfgPath

$NewAsar = Join-Path $Work 'app.asar.new'
if (Test-Path $NewAsar) { Remove-Item -Force $NewAsar }
& node $AsarCli pack $Extracted $NewAsar

Get-Process -Name 'Pinokio' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Copy-Item -Force $NewAsar $Asar
Write-Host 'OK: installed Pinokio patched with RU i18n'
Write-Host 'Start Pinokio.exe — Settings → Language → Русский → Save'
