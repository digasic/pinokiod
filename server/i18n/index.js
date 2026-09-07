'use strict'

const fs = require('fs')
const path = require('path')

const LOCALES_DIR = path.join(__dirname, 'locales')
const SUPPORTED = new Set(['en', 'ru'])

function loadLocale(code) {
  const file = path.join(LOCALES_DIR, `${code}.json`)
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const catalogs = {
  en: loadLocale('en'),
  ru: loadLocale('ru'),
}

function normalizeLocale(value) {
  if (!value || typeof value !== 'string') return 'en'
  const lower = value.trim().toLowerCase()
  if (SUPPORTED.has(lower)) return lower
  if (lower.startsWith('ru')) return 'ru'
  return 'en'
}

function detectSystemLocale() {
  try {
    const env = process.env.PINOKIO_LOCALE || process.env.LANG || process.env.LC_ALL || ''
    if (env) return normalizeLocale(env.split('.')[0].replace('_', '-'))
  } catch (_) {}
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().locale
    return normalizeLocale(intl)
  } catch (_) {}
  return 'en'
}

function createTranslator(locale) {
  const code = normalizeLocale(locale)
  const dict = catalogs[code] || {}
  const fallback = catalogs.en || {}

  function t(key, vars) {
    let text = dict[key] || fallback[key] || key
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        text = text.split(`{${k}}`).join(String(v))
      }
    }
    return text
  }

  t.locale = code
  t.dict = dict
  return t
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPhrasePairs(locale) {
  const code = normalizeLocale(locale)
  if (code === 'en') return []
  const dict = catalogs[code] || {}
  return Object.entries(dict)
    .filter(([en, ru]) => en && ru && en !== ru)
    .sort((a, b) => b[0].length - a[0].length)
}

function normalizeUiText(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()
}

const STUB_TOKEN = '\u0000I18N'

/** Dynamic UI counters / patterned chrome that cannot be exact-keyed. */
function translateDynamic(core) {
  let m

  m = core.match(/^(\d+) valid, (\d+) invalid\.$/)
  if (m) return `${m[1]} корректных, ${m[2]} некорректных.`
  m = core.match(/^(\d+) valid, (\d+) invalid$/)
  if (m) return `${m[1]} корректных, ${m[2]} некорректных`

  m = core.match(/^(\d+) ready, (\d+) need install\.$/)
  if (m) return `${m[1]} готовы, ${m[2]} требуют установки.`
  m = core.match(/^(\d+) ready, (\d+) need install$/)
  if (m) return `${m[1]} готовы, ${m[2]} требуют установки`

  m = core.match(/^(\d+) update needed$/)
  if (m) return `${m[1]} обновление нужно`
  m = core.match(/^(\d+) updates needed$/)
  if (m) return `${m[1]} обновлений нужно`

  m = core.match(/^(\d+) checks$/)
  if (m) return `${m[1]} проверок`

  m = core.match(/^(\d+) checks total\. (\d+) item needs attention\.$/)
  if (m) return `${m[1]} проверок всего. ${m[2]} пункт требует внимания.`
  m = core.match(/^(\d+) checks total\. (\d+) items need attention\.$/)
  if (m) return `${m[1]} проверок всего. ${m[2]} пунктов требуют внимания.`

  m = core.match(/^(\d+) update is needed before Pinokio can continue\.$/)
  if (m) return `${m[1]} обновление нужно прежде чем Pinokio сможет продолжить.`
  m = core.match(/^(\d+) updates are needed before Pinokio can continue\.$/)
  if (m) return `${m[1]} обновления нужны прежде чем Pinokio сможет продолжить.`

  m = core.match(/^(\d+) folders checked$/)
  if (m) return `${m[1]} папок проверено`
  m = core.match(/^(\d+) identical files$/)
  if (m) return `${m[1]} одинаковых файлов`
  m = core.match(/^(\d+) files here$/)
  if (m) return `${m[1]} файлов здесь`
  m = core.match(/^(\d+) locations selected$/)
  if (m) return `${m[1]} расположений выбрано`
  m = core.match(/^(\d+) files\/sec$/)
  if (m) return `${m[1]} файлов/с`
  m = core.match(/^(\d+) selected inside$/)
  if (m) return `${m[1]} выбрано внутри`
  m = core.match(/^Add (\d+) locations$/)
  if (m) return `Добавить ${m[1]} расположений`

  m = core.match(/^of (\d+) bundles ready$/)
  if (m) return `из ${m[1]} наборов готовы`
  m = core.match(/^(\d+) of (\d+) bundles ready$/)
  if (m) return `${m[1]} из ${m[2]} наборов готовы`

  m = core.match(/^Add a package through (.+)\.$/)
  if (m) return `Добавить пакет через ${m[1]}.`

  m = core.match(/^Includes (.+)$/)
  if (m) return `Включает ${m[1]}`

  m = core.match(/^(.+) \(This Machine\)$/)
  if (m) return `${m[1]} (этот компьютер)`
  m = core.match(/^(.+) \(Peer\)$/)
  if (m) return `${m[1]} (пир)`

  m = core.match(/^(\d+) startup enabled$/)
  if (m) return `${m[1]} автозапусков включено`
  m = core.match(/^(\d+) apps$/)
  if (m) return `${m[1]} приложений`

  m = core.match(/^Query:\s*(.*?)\s+Results:\s*(\d+)\s*$/i)
  if (m) {
    const q = m[1] === '(empty)' ? '(пусто)' : m[1]
    return `Запрос: ${q} Результаты: ${m[2]}`
  }

  return null
}

/**
 * Exact-match only (after trim + light normalization).
 * Substring replacement of short/mid keys corrupts longer English copy
 * ("Home Server" inside banners, "home" inside placeholders, etc.).
 *
 * Text may contain \u0000I18Nn\u0000 stubs (stashed <code>/<pre>/...).
 * Those are split so surrounding fragments can still exact-match.
 */
function translateText(text, pairs) {
  if (!text || !pairs.length) return text
  const raw = String(text)
  if (raw.includes(STUB_TOKEN)) {
    return raw
      .split(/(\u0000I18N\d+\u0000)/)
      .map((part) => (/^\u0000I18N\d+\u0000$/.test(part) ? part : translateText(part, pairs)))
      .join('')
  }

  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m) return text
  const lead = m[1]
  const core = m[2]
  const trail = m[3]
  if (!core) return text

  const dyn = translateDynamic(core)
  if (dyn != null) return lead + dyn + trail

  const normCore = normalizeUiText(core)
  for (const [en, ru] of pairs) {
    if (core === en || normCore === normalizeUiText(en)) {
      return lead + ru + trail
    }
  }
  return text
}

function translateHtml(html, locale) {
  const code = normalizeLocale(locale)
  if (code === 'en' || typeof html !== 'string' || !html) return html

  const pairs = buildPhrasePairs(code)
  if (!pairs.length) return html

  const stubs = []
  const stash = (match) => {
    const i = stubs.length
    stubs.push(match)
    return `\u0000I18N${i}\u0000`
  }

  let work = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, stash)
    .replace(/<style\b[\s\S]*?<\/style>/gi, stash)
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, stash)
    .replace(/<code\b[\s\S]*?<\/code>/gi, stash)
    // keep link/bold targets intact while translating surrounding chrome
    .replace(/<a\b[\s\S]*?<\/a>/gi, stash)
    .replace(/<(?:b|strong)\b[\s\S]*?<\/(?:b|strong)>/gi, stash)

  work = work.replace(
    /\b(aria-label|title|placeholder|alt|data-tippy-content)=("|&quot;)([^"&]*?)\2/gi,
    (full, attr, quote, value) => `${attr}=${quote}${translateText(value, pairs)}${quote}`
  )

  work = work.replace(/(>)([^<]+)(<)/g, (full, open, text, close) => {
    if (!/[A-Za-z]/.test(text)) return full
    return open + translateText(text, pairs) + close
  })

  work = work.replace(/\u0000I18N(\d+)\u0000/g, (_, i) => stubs[Number(i)])

  if (/<\/body>/i.test(work) && !work.includes('data-pinokio-i18n="1"')) {
    const payload = JSON.stringify({
      locale: code,
      phrases: catalogs[code] || {},
    })
    const inject = [
      `<script data-pinokio-i18n="1">window.__PINOKIO_I18N__=${payload};</script>`,
      '<script data-pinokio-i18n="1" src="/i18n-client.js"></script>',
    ].join('')
    work = work.replace(/<\/body>/i, inject + '</body>')
  }

  return work
}

function wrapRender(res, locale) {
  const code = normalizeLocale(locale)
  if (code === 'en') return
  if (res.__pinokioI18nWrapped) return
  res.__pinokioI18nWrapped = true

  const originalRender = res.render.bind(res)
  res.render = function renderI18n(view, locals, callback) {
    if (typeof locals === 'function') {
      callback = locals
      locals = undefined
    }
    if (typeof callback === 'function') {
      return originalRender(view, locals, (err, html) => {
        if (err) return callback(err, html)
        callback(null, translateHtml(html, code))
      })
    }
    return originalRender(view, locals, (err, html) => {
      if (err) throw err
      res.send(translateHtml(html, code))
    })
  }

  const originalSend = res.send.bind(res)
  res.send = function sendI18n(body) {
    if (typeof body === 'string' && /<html[\s>]/i.test(body)) {
      return originalSend(translateHtml(body, code))
    }
    return originalSend(body)
  }
}

module.exports = {
  SUPPORTED: [...SUPPORTED],
  normalizeLocale,
  detectSystemLocale,
  createTranslator,
  translateHtml,
  translateText,
  wrapRender,
  catalogs,
}
