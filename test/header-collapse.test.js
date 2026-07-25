const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('header collapse preserves expanded and legacy minimized header styles', async () => {
  const style = await fs.readFile(path.join(root, 'server/public/style.css'), 'utf8')
  const expanded = style.match(/body\.header-collapse-enabled > header\.navheader:not\(\.minimized\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const collapsed = style.match(/body\.header-collapsed > header\.navheader:not\(\.minimized\) \{[\s\S]*?\n  \}/)?.[0] || ''

  assert.match(expanded, /grid-template-rows: minmax\(0, 1fr\)/)
  assert.doesNotMatch(expanded, /(?:height|padding|border): .*!important/)
  assert.match(collapsed, /grid-template-rows: minmax\(0, 0fr\)/)
  assert.match(collapsed, /padding-top: 0 !important/)
  assert.match(collapsed, /padding-bottom: 0 !important/)
  assert.doesNotMatch(style, /body\.main-sidebar-page > header\.navheader #close-window,\s/)
})

test('collapse-only script includes keep shared header controls without activating legacy navigation behavior', async () => {
  const [nav, connect, create, common, vault] = await Promise.all([
    fs.readFile(path.join(root, 'server/public/nav.js'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/connect/x.ejs'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/create.ejs'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/partials/app_common_scripts.ejs'), 'utf8'),
    fs.readFile(path.join(root, 'server/views/vault.ejs'), 'utf8')
  ])
  const beforeGuard = nav.slice(0, nav.indexOf('if (headerCollapseOnly) return;'))
  const controller = beforeGuard.slice(beforeGuard.indexOf('(() => {'))

  assert.ok([connect, create, common, vault].every((source) => /nav\.js" data-header-collapse-only/.test(source)))
  assert.match(vault, /<script src="\/common\.js"><\/script>/)
  assert.match(nav, /document\.currentScript\?\.hasAttribute\("data-header-collapse-only"\)/)
  assert.match(beforeGuard, /if \(newWindowButton\) \{/)
  assert.match(nav, /if \(headerCollapseOnly\) return;/)
  assert.doesNotMatch(controller, /localStorage|sessionStorage/)
})
