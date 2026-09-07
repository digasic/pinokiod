const assert = require('assert')
const i18n = require('../server/i18n')

assert.equal(i18n.normalizeLocale('ru-RU'), 'ru')
assert.equal(i18n.normalizeLocale('en_US'), 'en')

const t = i18n.createTranslator('ru')
assert.equal(t('Settings'), 'Настройки')
assert.equal(t('My Apps'), 'Мои приложения')

const html = `
<html><body>
  <div class="caption">My Apps</div>
  <a title="Settings">Settings</a>
  <script>const x = "Settings"</script>
</body></html>`

const out = i18n.translateHtml(html, 'ru')
assert.ok(out.includes('Мои приложения'), out)
assert.ok(out.includes('Настройки'), out)
assert.ok(out.includes('const x = "Settings"'), 'script must stay English')
assert.ok(out.includes('i18n-client.js'), 'client inject')
assert.ok(out.includes('__PINOKIO_I18N__'), 'dict inject')

console.log('i18n ok')
