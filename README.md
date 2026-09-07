# digasic/pinokiod — Russian UI localization

Fork of [pinokiocomputer/pinokiod](https://github.com/pinokiocomputer/pinokiod) with **en/ru** UI i18n.

> Pair with the Electron shell: **[digasic/pinokio](https://github.com/digasic/pinokio)** (`"pinokiod": "file:../pinokiod"`).

Full guide (architecture, patch, tray mode, contributing):  
**[docs/I18N_RU.md](./docs/I18N_RU.md)** · workspace overview: sibling `pinokio-ru/README.md`

## Features

- Settings → **Language** (`English` / `Русский`)
- `locale` in `%USERPROFILE%\.pinokio\config.json`
- Exact-match translator + dynamic counters + client DOM i18n
- Catalog: `server/i18n/locales/ru.json` (~1500+ chrome strings)

## Patch installed Pinokio (Windows)

```powershell
# clone digasic/pinokiod + digasic/pinokio as siblings, then:
cd <pinokio>
npm install --ignore-scripts

powershell -ExecutionPolicy Bypass -File ..\pinokiod\scripts\patch-installed-ru.ps1
```

Re-run after Pinokio auto-updates overwrite `app.asar`.

## Dev

```powershell
npm install --ignore-scripts
node test/i18n-basic.test.js
node test/i18n-sidebar-smoke.test.js
```

## Upstream

Official Pinokio has no UI i18n ([issue #1034](https://github.com/pinokiocomputer/pinokio/issues/1034)). Chromium `locales/*.pak` ≠ app chrome language.
