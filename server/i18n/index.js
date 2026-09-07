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

function buildPhrasePairs(locale) {
  const code = normalizeLocale(locale)
  if (code === 'en') return []
  const dict = catalogs[code] || {}
  return Object.entries(dict)
    .filter(([en, ru]) => en && ru && en !== ru)
    .sort((a, b) => b[0].length - a[0].length)
}

function translateText(text, pairs) {
  if (!text || !pairs.length) return text
  let out = text
  for (const [en, ru] of pairs) {
    if (out.includes(en)) out = out.split(en).join(ru)
  }
  return out
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

  // Do not touch scripts / styles / pre / code
  let work = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, stash)
    .replace(/<style\b[\s\S]*?<\/style>/gi, stash)
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, stash)
    .replace(/<code\b[\s\S]*?<\/code>/gi, stash)

  // Attribute values users see
  work = work.replace(
    /\b(aria-label|title|placeholder|alt|data-tippy-content)=("|&quot;)([^"&]*?)\2/gi,
    (full, attr, quote, value) => `${attr}=${quote}${translateText(value, pairs)}${quote}`
  )

  // Text nodes between tags
  work = work.replace(/(>)([^<]+)(<)/g, (full, open, text, close) => {
    if (!/[A-Za-z]/.test(text)) return full
    return open + translateText(text, pairs) + close
  })

  // Restore stashed blocks
  work = work.replace(/\u0000I18N(\d+)\u0000/g, (_, i) => stubs[Number(i)])

  // Inject client dictionary before </body> once
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
  wrapRender,
  catalogs,
}
