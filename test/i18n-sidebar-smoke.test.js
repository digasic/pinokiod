'use strict'
const path = require('path')
const Module = require('module')

// Resolve deps from Electron shell install
const shellMods = path.join('D:/devCursor/pinokio-ru/pinokio/node_modules')
process.env.NODE_PATH = [shellMods, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
Module._initPaths()

const fs = require('fs')
const ejs = require('ejs')
const i18n = require('../server/i18n')

async function main() {
  const sidebar = await fs.promises.readFile(
    path.join(__dirname, '../server/views/partials/main_sidebar.ejs'),
    'utf8'
  )
  const html = ejs.render(sidebar, {
    selected: 'home',
    vaultEnabled: true,
  })
  const wrapped = `<html><body>${html}</body></html>`
  const ru = i18n.translateHtml(wrapped, 'ru')
  const need = ['Мои приложения', 'Обзор', 'Настройки', 'Управление', 'i18n-client.js']
  for (const n of need) {
    if (!ru.includes(n)) {
      console.error('MISS', n)
      process.exit(1)
    }
    console.log('OK', n)
  }
  console.log('SMOKE_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
