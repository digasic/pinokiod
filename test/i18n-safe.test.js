'use strict'
const i18n = require('../server/i18n')

const t = i18n.translateText
const pairs = Object.entries(i18n.catalogs.ru)
  .filter(([en, ru]) => en && ru && en !== ru)
  .sort((a, b) => b[0].length - a[0].length)

// Must NOT corrupt
const env = t('ENVIRONMENT', pairs)
if (env !== 'ENVIRONMENT') throw new Error('ENVIRONMENT corrupted: ' + env)

const node = t('Node.js', pairs)
if (node !== 'Node.js') throw new Error('Node.js corrupted: ' + node)

const homePh = 'Enter the absolute path to use as your Pinokio home folder (D:\\pinokio, /Users/alice/pinokiofs, etc.)'
const homeOut = t(homePh, pairs)
if (homeOut.includes('Домашняя папка folder') || homeOut.includes('изs')) {
  throw new Error('home placeholder corrupted: ' + homeOut)
}
if (!/домашн/i.test(homeOut) && homeOut === homePh) {
  console.warn('WARN: home placeholder not translated (ok if missing from catalog)')
} else {
  console.log('home ok:', homeOut.slice(0, 80))
}

// Exact short labels
if (t('Settings', pairs) !== 'Настройки') throw new Error('Settings')
if (t('Save', pairs) !== 'Сохранить') throw new Error('Save')
if (t('ON', pairs) !== 'ВКЛ' && t('ON', pairs) !== 'Вкл') throw new Error('ON=' + t('ON', pairs))

const html = i18n.translateHtml(
  '<html><body><div class="caption">My Apps</div><button title="open a new window">X</button><div>ENVIRONMENT file</div></body></html>',
  'ru'
)
if (!html.includes('Мои приложения')) throw new Error('sidebar')
if (html.includes('ENVIRВКЛ') || html.includes('ENVIR')) {
  // "ENVIRONMENT file" may translate if phrase exists; must not be ENVIRВКЛMENT
  if (html.includes('ENVIRВКЛ')) throw new Error('ENVIR corrupt in html')
}
if (!html.includes('новое окно') && !html.includes('open a new window')) {
  // title attr
}
console.log('SAFE_TRANSLATOR_OK')
