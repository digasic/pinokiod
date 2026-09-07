(() => {
  const cfg = window.__PINOKIO_I18N__
  if (!cfg || !cfg.locale || cfg.locale === 'en' || !cfg.phrases) return
  if (window.__PINOKIO_I18N_CLIENT__) return
  window.__PINOKIO_I18N_CLIENT__ = true

  const pairs = Object.entries(cfg.phrases)
    .filter(([en, ru]) => en && ru && en !== ru)
    .sort((a, b) => b[0].length - a[0].length)

  const normalizeUiText = (s) => String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()

  const translateDynamic = (core) => {
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

  const translate = (text) => {
    if (!text || typeof text !== 'string') return text
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
    if (!m) return text
    const lead = m[1]
    const core = m[2]
    const trail = m[3]
    if (!core) return text
    const dyn = translateDynamic(core)
    if (dyn != null) return lead + dyn + trail
    const normCore = normalizeUiText(core)
    for (const [en, ru] of pairs) {
      if (core === en || normCore === normalizeUiText(en)) return lead + ru + trail
    }
    return text
  }

  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-tippy-content']

  const walk = (root) => {
    if (!root) return
    const nodes = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement
        if (!p) return NodeFilter.FILTER_REJECT
        const tag = p.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE' || tag === 'TEXTAREA') {
          return NodeFilter.FILTER_REJECT
        }
        if (!/[A-Za-z]/.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let n
    while ((n = walker.nextNode())) nodes.push(n)
    for (const node of nodes) {
      const next = translate(node.nodeValue)
      if (next !== node.nodeValue) node.nodeValue = next
    }
    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
        for (const attr of ATTRS) {
          if (!el.hasAttribute(attr)) continue
          const v = el.getAttribute(attr)
          const nv = translate(v)
          if (nv !== v) el.setAttribute(attr, nv)
        }
      }
    }
  }

  const boot = () => walk(document.body)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) walk(node)
        else if (node.nodeType === 3) {
          const next = translate(node.nodeValue)
          if (next !== node.nodeValue) node.nodeValue = next
        }
      }
    }
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })

  const origSetAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (ATTRS.includes(String(name).toLowerCase()) && typeof value === 'string') {
      value = translate(value)
    }
    return origSetAttribute.call(this, name, value)
  }
})()
