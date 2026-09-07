# Russian UI localization (I18N)

Документация форка **digasic/pinokiod**: перевод интерфейса Pinokio на русский.

Связанный shell: [digasic/pinokio](https://github.com/digasic/pinokio).  
Upstream: [pinokiocomputer/pinokiod](https://github.com/pinokiocomputer/pinokiod) · [issue #1034](https://github.com/pinokiocomputer/pinokio/issues/1034).

---

## 1. Цель и границы

| Переводим | Не переводим |
|-----------|----------------|
| Chrome UI: сайдбар, Settings, Tools, Plugins, Skills, Logs, Vault, модалки | README/описания установленных приложений из git |
| Статусы, подсказки, empty states | Имена брендов (Claude, VS Code, …) |
| Динамические счётчики (`N ready…`) | Имена пакетов conda/npm |

---

## 2. Файлы

```
server/i18n/index.js              # движок
server/i18n/locales/en.json
server/i18n/locales/ru.json       # основной каталог
server/public/i18n-client.js      # DOM после JS
server/views/settings.ejs         # Language select + object options
server/index.js                   # locale в syncConfig/setConfig + configArray ×2
scripts/patch-installed-ru.ps1    # патч Windows installer
test/i18n-*.js                    # smoke
```

---

## 3. Выбор языка

Приоритет:

1. `store` / `%USERPROFILE%\.pinokio\config.json` → `"locale": "ru"|"en"`
2. Settings → **Language** / **Язык** (пишет в store)
3. `PINOKIO_LOCALE`
4. Системная локаль при первом запуске

Переключатель: **Настройки → Общие → Язык** (между theme и mode) → **Сохранить**.

> Оба `configArray` в `server/index.js` должны содержать `locale`. Живой `/home?mode=settings` идёт по **home-route** (второй массив).

### Осторожно с config.json

Не делайте `ConvertTo-Json` всего конфига «с нуля» в PowerShell — можно стереть `"home"` → blue screen `paths[0] must be string`. Меняйте `locale` через UI или Node merge с сохранением остальных ключей.

---

## 4. Движок перевода

### Сервер (`wrapRender`)

После `res.render` HTML проходит `translateHtml(html, locale)`:

1. Stash: `script`, `style`, `pre`, `code`, `a`, `b|strong`
2. Перевод атрибутов `aria-label|title|placeholder|alt|…`
3. Перевод text-nodes между `>` и `<`
4. Unstash
5. Inject `window.__PINOKIO_I18N__` + `/i18n-client.js`

### Exact-match

Ключ каталога = **целая** EN-фраза (после trim / лёгкой нормализации entity/whitespace).  
Substring-replace запрещён (ломал слова).

Фразы с `<code>`/`<a>` в середине режутся stash’ем → в каталог кладут **фрагменты** слева/справа от stub.

### Динамика (`translateDynamic`)

Примеры:

- `N valid, M invalid.`
- `N ready, M need install.`
- `N updates needed` / `N checks`
- `N checks total. M items need attention.`
- `of N bundles ready`
- `Includes …`
- `Host (This Machine)`

Клиент `i18n-client.js` дублирует ту же логику + `MutationObserver` для модалок/JS.

---

## 5. Установка для пользователя (Windows)

### A. Патч установленного Pinokio

```powershell
git clone https://github.com/digasic/pinokiod.git
git clone https://github.com/digasic/pinokio.git
cd pinokio
npm install --ignore-scripts

powershell -ExecutionPolicy Bypass -File ..\pinokiod\scripts\patch-installed-ru.ps1
```

Скрипт:

- бэкапит `app.asar`;
- копирует `server/i18n`, `i18n-client.js`, `settings.ejs`, `server/index.js` из форка;
- выставляет `locale=ru` **без потери** `home` (Node merge);
- кладёт client в `app.asar.unpacked/.../public` при необходимости.

После апдейта Pinokio — повторить патч.

### B. Source run

```powershell
cd pinokiod && npm install --ignore-scripts
cd ..\pinokio && npm install --ignore-scripts
npx electron .
```

Node **20 LTS** предпочтителен.

---

## 6. Mode: desktop vs background

| Значение | Смысл |
|----------|--------|
| `desktop` | Окно Electron, иконка в **taskbar** |
| `background` | `minimal.js`: **system tray**, UI в браузере |

Это не «minimize to tray» при открытом окне — полный режим оболочки.

---

## 7. Как допереводить

1. Найти EN на экране (или `node` HTTP probe вкладки).
2. Добавить `"English phrase": "Русская фраза"` в `locales/ru.json`.
3. Если текст рвётся `<code>` — добавить левый/правый фрагменты.
4. Если `N something` — расширить `translateDynamic` (+ client).
5. Прогнать тесты / patch / Ctrl+F5.

```powershell
node test/i18n-basic.test.js
node test/i18n-sidebar-smoke.test.js
```

---

## 8. Синхронизация с upstream

```powershell
git fetch upstream
git merge upstream/main   # или rebase
# проверить needles: require('./i18n'), configArray locale ×2, settings.ejs object options
```

При version skew asar ≠ fork: не подменяйте весь `index.js` вслепую — лучше surgical inject + sync только `i18n/`.

---

## 9. Чеклист релиза форка

- [ ] `ru.json` актуален (≥1500 ключей chrome)
- [ ] locale в **обоих** settings `configArray`
- [ ] `settings.ejs` поддерживает `c.label` и object options
- [ ] `patch-installed-ru.ps1` не затирает `home`
- [ ] тесты i18n зелёные
- [ ] README + этот файл обновлены
- [ ] push `digasic/pinokiod` (+ shell `digasic/pinokio` при изменении dep)

---

## 10. Лицензия

Наследует upstream pinokiod. Форк digasic — локализация; вклад в upstream welcome.
