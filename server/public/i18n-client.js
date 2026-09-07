(() => {
  const cfg = window.__PINOKIO_I18N__
  if (!cfg || !cfg.locale || cfg.locale === 'en' || !cfg.phrases) return
  if (window.__PINOKIO_I18N_CLIENT__) return
  window.__PINOKIO_I18N_CLIENT__ = true

  const pairs = Object.entries(cfg.phrases)
    .filter(([en, ru]) => en && ru && en !== ru)
    .sort((a, b) => b[0].length - a[0].length)

  const translate = (text) => {
    if (!text || typeof text !== 'string') return text
    let out = text
    for (const [en, ru] of pairs) {
      if (out.includes(en)) out = out.split(en).join(ru)
    }
    return out
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

  // Tippy / dynamic title helpers
  const origSetAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (ATTRS.includes(String(name).toLowerCase()) && typeof value === 'string') {
      value = translate(value)
    }
    return origSetAttribute.call(this, name, value)
  }
})()
