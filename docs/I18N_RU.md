# Russian UI localization (I18N)

Форк **digasic/pinokiod**: русский UI Pinokio.

- Shell: [digasic/pinokio](https://github.com/digasic/pinokio)
- Upstream: [pinokiocomputer/pinokiod](https://github.com/pinokiocomputer/pinokiod) · [issue #1034](https://github.com/pinokiocomputer/pinokio/issues/1034)

---

## Версии

| Где | Значение |
|-----|----------|
| Splash / `pinokio/package.json` | `8.2.0` (= upstream) |
| GitHub Release tag | `v8.2.0+RU.v5` |
| Следующие digasic-сборки | `v8.2.0+RU.v6`, … |

Релиз (Setup / Portable): https://github.com/digasic/pinokio/releases

---

## Границы перевода

| Переводим | Не переводим |
|-----------|----------------|
| Chrome UI: сайдбар, Settings, Tools, Plugins, Skills, Logs, Vault, модалки | README установленных приложений |
| Статусы, подсказки, empty states | Бренды (Claude, VS Code, …) |
| Динамические счётчики | Имена пакетов conda/npm |

---

## Файлы

```
server/i18n/index.js
server/i18n/locales/en.json
server/i18n/locales/ru.json
server/public/i18n-client.js
server/views/settings.ejs
server/index.js                   # locale в syncConfig + configArray ×2
scripts/patch-installed-ru.ps1
test/i18n-*.js
```

---

## Язык

1. `%USERPROFILE%\.pinokio\config.json` → `"locale": "ru"|"en"`
2. Settings → **Язык** → **Сохранить**
3. `PINOKIO_LOCALE`
4. Системная локаль (первый запуск)

Оба `configArray` в `server/index.js` должны содержать `locale`.

Не делайте `ConvertTo-Json` всего config в PowerShell — можно стереть `"home"`.

---

## Движок

После `res.render`: stash `script|style|pre|code|a|b` → exact-match EN→RU → unstash → inject `i18n-client.js`.  
Substring-replace запрещён. Фразы с `<code>`/`<a>` — фрагментами. Динамика — `translateDynamic`.

---

## Windows

### Рекомендуется: digasic Setup

- `Pinokio-RU-Setup.exe` — установщик (NSIS, AUMID)
- `Pinokio-RU-Portable.exe` — portable

Сборка:

```powershell
powershell -ExecutionPolicy Bypass -File pinokio\scripts\dist-win-ru.ps1
powershell -ExecutionPolicy Bypass -File pinokio\scripts\install-unpacked-ru.ps1
```

Release-сборка: **не** `npm install --ignore-scripts` (нужны native rebuild).

### Патч официального Pinokio

```powershell
powershell -ExecutionPolicy Bypass -File pinokiod\scripts\patch-installed-ru.ps1
```

### Source run

```powershell
cd pinokiod && npm install
cd ..\pinokio && npm install
npx electron .
```

---

## Mode

| Значение | Смысл |
|----------|--------|
| `desktop` | окно Electron |
| `background` | tray (`minimal.js`), UI в браузере |

На Windows background: без toast Notification и без auto-`openExternal` (иначе OpenWith при кривом AUMID).

---

## Чеклист релиза

- [ ] `ru.json` chrome ≥1500 ключей; locale в обоих `configArray`
- [ ] `version` shell = `8.2.0`; tag = `v8.2.0+RU.vN`
- [ ] `afterPack`: icon, `assets/*`, `conpty.node`, `better_sqlite3.node`
- [ ] Setup через NSIS; smoke RU + нет sqlite/conpty errors
- [ ] push digasic/pinokiod + digasic/pinokio; один актуальный GitHub Release

---

## Лицензия

Как upstream pinokiod. Форк digasic — локализация.
