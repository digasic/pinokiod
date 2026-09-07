# pinokiod (digasic) — Russian i18n

Fork of https://github.com/pinokiocomputer/pinokiod with UI locale support (`en` / `ru`).

## Files

- `server/i18n/` — catalogs + HTML translator
- `server/public/i18n-client.js` — dynamic DOM strings
- Settings → **Language**

## Apply to installed Pinokio (Windows)

Clone this repo next to a `pinokio` shell clone that has `@electron/asar`, then:

```powershell
powershell -ExecutionPolicy Bypass -File D:\devCursor\pinokio-ru\patch-installed-ru.ps1
```

Or from this repo after adjusting paths in `scripts/patch-installed-ru.ps1`.

Sets `%USERPROFILE%\.pinokio\config.json` → `"locale":"ru"`.
