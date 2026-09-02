#!/usr/bin/env node
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const outputRoot = path.resolve(repoRoot, 'output', 'playwright', 'nested-launcher-real-browser')
const readyPrefix = 'PINOKIO_NESTED_BROWSER_READY '
const resultPrefix = 'PINOKIO_NESTED_BROWSER_RESULT '
const appId = 'nested-browser-acceptance'
const inheritanceId = 'nested-browser-inheritance'
const nestedChildId = 'nested-child-regression'
const historicalSession = 'historical-session'
const historicalSentinel = 'HISTORICAL_NESTED_BROWSER_SENTINEL'
const currentSentinel = 'CURRENT_NESTED_BROWSER_SENTINEL'
const adversarialViewerSentinel = 'ADVERSARIAL_ROOT_LOG_VIEWER_SENTINEL'
const adversarialHelpSentinel = 'ADVERSARIAL_NESTED_GET_HELP_SENTINEL'
const runtimeSentinel = 'RUNTIME_NESTED_BROWSER_SENTINEL'
const runtimeMarker = '.pinokio-nested-acceptance-runtime.json'
const liveControls = {
  root: {
    slug: 'github-com-halr9000-pinokio-hello-world',
    title: 'Hello World Gradio',
    repo: 'https://github.com/halr9000/pinokio-hello-world',
    folder: 'pinokio-hello-world.git',
    layout: 'root'
  },
  nested: {
    slug: 'github-com-bilawalsidhu-gods-eye-view',
    title: "God's Eye View",
    repo: 'https://github.com/bilawalsidhu/gods-eye-view',
    folder: 'gods-eye-view.git',
    layout: 'nested'
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      index += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function run(command, args, options = {}) {
  return childProcess.execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

async function copyDirectory(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  if (process.platform === 'darwin') {
    childProcess.execFileSync('/bin/cp', ['-cR', source, target])
  } else {
    await fsp.cp(source, target, { recursive: true, preserveTimestamps: true, dereference: false, verbatimSymlinks: true })
  }
}

function safeRuntimePath(value, label) {
  const target = path.resolve(String(value || ''))
  const forbidden = new Set([path.parse(target).root, os.homedir(), repoRoot])
  assert.equal(forbidden.has(target), false, `${label} must not be a filesystem root, the user home, or the repository`)
  return target
}

async function runtimeManifest(root) {
  const entries = []
  async function visit(directory, relative = '') {
    const names = await fsp.readdir(directory)
    names.sort()
    for (const name of names) {
      const absolute = path.resolve(directory, name)
      const itemPath = relative ? `${relative}/${name}` : name
      const stat = await fsp.lstat(absolute)
      if (stat.isSymbolicLink()) {
        entries.push({ path: itemPath, type: 'symlink', target: await fsp.readlink(absolute), mtime_ms: stat.mtimeMs })
      } else if (stat.isDirectory()) {
        entries.push({ path: itemPath, type: 'directory', mtime_ms: stat.mtimeMs })
        await visit(absolute, itemPath)
      } else if (stat.isFile()) {
        const hash = crypto.createHash('sha256')
        await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(absolute)
          stream.on('data', chunk => hash.update(chunk))
          stream.on('error', reject)
          stream.on('end', resolve)
        })
        entries.push({ path: itemPath, type: 'file', size: stat.size, sha256: hash.digest('hex'), mtime_ms: stat.mtimeMs })
      } else {
        entries.push({ path: itemPath, type: 'other', size: stat.size, mtime_ms: stat.mtimeMs })
      }
    }
  }
  await visit(root)
  return entries
}

async function prepareRuntime({ active, snapshot, createSnapshot }) {
  const activeRoot = safeRuntimePath(active, 'runtime active path')
  const snapshotRoot = safeRuntimePath(snapshot, 'runtime snapshot path')
  assert.notEqual(activeRoot, snapshotRoot, 'runtime active and snapshot paths must differ')
  assert.equal(activeRoot.startsWith(`${snapshotRoot}${path.sep}`) || snapshotRoot.startsWith(`${activeRoot}${path.sep}`), false, 'runtime active and snapshot paths must not contain one another')
  const condaRelative = path.join('bin', 'miniforge', 'bin', process.platform === 'win32' ? 'conda.exe' : 'conda')
  assert.equal(fs.existsSync(path.resolve(activeRoot, condaRelative)), true, `runtime is missing ${condaRelative}`)
  if (!fs.existsSync(snapshotRoot)) {
    assert.equal(createSnapshot, true, 'runtime snapshot does not exist; pass --create-runtime-snapshot once to create it')
    await fsp.writeFile(path.resolve(activeRoot, runtimeMarker), JSON.stringify({ active: activeRoot, created_at: new Date().toISOString() }, null, 2))
    await copyDirectory(activeRoot, snapshotRoot)
  }
  const marker = JSON.parse(await fsp.readFile(path.resolve(snapshotRoot, runtimeMarker), 'utf8'))
  assert.equal(marker.active, activeRoot, 'runtime snapshot was provisioned for a different absolute active path')
  assert.equal(fs.existsSync(path.resolve(snapshotRoot, condaRelative)), true, 'runtime snapshot is incomplete')
  const manifest = await runtimeManifest(snapshotRoot)
  async function restore() {
    if (fs.existsSync(activeRoot)) {
      const activeMarker = JSON.parse(await fsp.readFile(path.resolve(activeRoot, runtimeMarker), 'utf8'))
      assert.equal(activeMarker.active, activeRoot, 'refusing to replace an unrecognized runtime directory')
      await fsp.rm(activeRoot, { recursive: true, force: true })
    }
    await copyDirectory(snapshotRoot, activeRoot)
    const restoredMarker = JSON.parse(await fsp.readFile(path.resolve(activeRoot, runtimeMarker), 'utf8'))
    assert.equal(restoredMarker.active, activeRoot, 'restored runtime marker does not match its path')
    const conda = path.resolve(activeRoot, condaRelative)
    const version = run(conda, ['--version'])
    assert.match(version, /^conda\s+\S+/, 'restored runtime failed its conda smoke check')
    const compatibilityAlias = path.resolve(activeRoot, 'bin', 'miniconda')
    if (fs.existsSync(compatibilityAlias) && (await fsp.lstat(compatibilityAlias)).isSymbolicLink()) {
      const target = await fsp.readlink(compatibilityAlias)
      assert.equal(path.isAbsolute(target), true, 'runtime compatibility alias must use its provisioned absolute path')
      assert.equal(target === activeRoot || target.startsWith(`${activeRoot}${path.sep}`), true, 'runtime compatibility alias escapes the active runtime')
    }
    const condaHeader = (await fsp.readFile(conda)).subarray(0, 512).toString('utf8')
    if (condaHeader.startsWith('#!')) assert.equal(condaHeader.split(/\r?\n/, 1)[0].includes(activeRoot), true, 'conda shebang points outside the active runtime')
    const bin = path.resolve(activeRoot, 'bin')
    return {
      root: activeRoot,
      bin,
      conda: version,
      node: run(path.resolve(bin, 'miniforge', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'), ['--version']),
      git: run(path.resolve(bin, 'miniforge', 'bin', process.platform === 'win32' ? 'git.exe' : 'git'), ['--version']),
      uv: run(path.resolve(bin, 'miniforge', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'), ['--version'])
    }
  }
  async function verifySnapshot() {
    assert.deepEqual(await runtimeManifest(snapshotRoot), manifest, 'the pristine runtime snapshot was modified')
  }
  return { activeRoot, snapshotRoot, manifest, restore, verifySnapshot }
}

function loadPlaywright() {
  try {
    return require('playwright')
  } catch (_) {}
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const bin = run(locator, ['playwright']).split(/\r?\n/)[0]
    return require(path.join(path.dirname(path.dirname(bin)), 'playwright'))
  } catch (_) {}
  throw new Error('Playwright is required. Run with: npx --yes --package playwright node test/nested-launcher-real-browser.js')
}

function browserExecutable(playwright) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.env.BRAVE_EXECUTABLE,
    process.platform === 'darwin' ? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' : '',
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '',
    process.platform === 'win32' && process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : '',
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    '/usr/bin/brave-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    playwright.chromium.executablePath()
  ].filter(Boolean)
  return candidates.find(candidate => fs.existsSync(candidate)) || ''
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function write(root, relative, content = '') {
  const target = path.resolve(root, relative)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, content)
  return target
}

function script(runSteps, daemon = false) {
  return `module.exports = ${JSON.stringify({ daemon, run: runSteps }, null, 2)}\n`
}

function launcherModule(layout) {
  const prefix = layout === 'nested' ? 'pinokio/' : ''
  const runCommand = `node -e "require('fs').writeFileSync('run-cwd.txt', process.cwd())"`
  return `module.exports = {
  version: "1.0.0",
  title: "Nested Browser Acceptance",
  description: "Controlled nested-launcher browser fixture.",
  icon: "icon.png",
  pre: [
    { title: "Local preflight", icon: "pre.png", href: "setup.js" },
    { title: "External preflight", href: "https://example.com/preflight" }
  ],
  menu: [
    { default: true, text: "Start relative", href: "start.js" },
    { text: "Launcher child", href: "child/tool.js" },
    { text: "Absolute launcher", href: "/api/${appId}/${prefix}absolute.js" },
    { text: "Absolute workspace", href: "/api/${appId}/workspace.js" },
    { text: "Run string", run: ${JSON.stringify(runCommand)} },
    { text: "Stop relative", action: { method: "stop", uri: "start.js" } },
    { text: "State marker", when: "start.js", on: "STATE_ON", off: "STATE_OFF" }
  ],
  shortcuts: [
    { text: "Shortcut stop", action: { method: "stop", uri: "start.js" } }
  ]
}\n`
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64')

async function writePrimaryFixture(pinokioHome, layout) {
  const workspace = path.resolve(pinokioHome, 'api', appId)
  const launcher = layout === 'nested' ? path.resolve(workspace, 'pinokio') : workspace
  await fsp.mkdir(launcher, { recursive: true })
  await write(launcher, 'pinokio.js', launcherModule(layout))
  await write(launcher, 'pinokio.json', JSON.stringify({
    title: 'Nested Browser Acceptance',
    description: 'Controlled nested-launcher browser fixture.',
    icon: 'icon.png'
  }, null, 2))
  await write(launcher, 'icon.png', png)
  await write(launcher, 'pre.png', png)
  await write(launcher, 'install.js', script([{ method: 'local.set', params: { installed: true } }]))
  await write(launcher, 'start.js', script([
    { method: 'process.wait', params: { sec: 20 } },
    { method: 'local.set', params: { started: true, search: 'SCRIPTSEARCHSENTINEL' } }
  ], true))
  await write(launcher, 'env-set.js', script([{ method: 'env.set', params: { ACTION_VALUE: 'set-by-action' } }]))
  await write(launcher, 'env-switch.js', script([{ method: 'env.switch', params: { SWITCH_VALUE: ['one', 'two'] } }]))
  await write(launcher, 'setup.js', script([{ method: 'local.set', params: { setup: true } }]))
  await write(launcher, 'absolute.js', script([{ method: 'local.set', params: { absolute: true } }]))
  await write(launcher, 'child/tool.js', script([{ method: 'local.set', params: { child: true } }]))
  await write(launcher, 'runtime-probe.js', `const fs = require('fs')
const result = { sentinel: ${JSON.stringify(runtimeSentinel)}, cwd: process.cwd(), relative: process.env.RELATIVE_VALUE }
console.log(${JSON.stringify(runtimeSentinel)}, JSON.stringify(result))
fs.writeFileSync('runtime-result.json', JSON.stringify(result, null, 2))
`)
  await write(launcher, 'runtime.js', script([{ method: 'shell.run', params: { message: 'node runtime-probe.js' } }]))
  if (layout === 'nested') {
    await write(launcher, 'README.md', 'LAUNCHERREADMESENTINEL\n')
    await write(launcher, 'CLAUDE.md', 'LAUNCHERAISENTINEL\n')
  }
  await write(launcher, '_ENVIRONMENT', 'TEMPLATE_SENTINEL=primary-template\n')
  await write(launcher, 'ENVIRONMENT', [
    'REQUIRED_VALUE=initial',
    'ACTION_VALUE=initial',
    'SWITCH_VALUE=one',
    'RELATIVE_VALUE=./something',
    'PINOKIO_SHARE_CLOUDFLARE=false',
    'PINOKIO_SHARE_LOCAL=false',
    'PINOKIO_SHARE_LOCAL_PORT=',
    ''
  ].join('\n'))
  await write(workspace, 'workspace.js', script([{ method: 'local.set', params: { workspace: true } }]))
  await write(workspace, 'README.md', layout === 'nested'
    ? 'WORKSPACEREADMESENTINEL\n'
    : 'WORKSPACEREADMESENTINEL\nLAUNCHERREADMESENTINEL\n')
  await write(workspace, 'CLAUDE.md', layout === 'nested'
    ? 'WORKSPACEAISENTINEL\n'
    : 'WORKSPACEAISENTINEL\nLAUNCHERAISENTINEL\n')
  await write(workspace, '.git/config', '[remote "origin"]\n\turl = https://github.com/pinokio/acceptance-fixture.git\n')
  await write(workspace, '.git/info/exclude', 'existing-entry\n')

  const logRoot = path.resolve(launcher, 'logs')
  await write(logRoot, 'api/seeded.js/latest', `${currentSentinel}\n`)
  const historicalLog = await write(logRoot, 'api/start.js/1000', `${historicalSentinel}\n`)
  await write(logRoot, 'dev/latest', 'SEEDED_DEV_LOG\n')
  await write(logRoot, 'shell/latest', 'SEEDED_SHELL_LOG\n')
  await write(logRoot, 'sessions/index.json', JSON.stringify({
    version: 1,
    latest_session: historicalSession,
    sessions: [{ id: historicalSession, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', runs: ['start.js'] }]
  }, null, 2))
  await write(logRoot, `sessions/${historicalSession}.json`, JSON.stringify({
    version: 1,
    id: historicalSession,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    runs: [{
      script: 'start.js',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
      logs: [{ path: path.relative(launcher, historicalLog).split(path.sep).join('/') }]
    }]
  }, null, 2))
  return { workspace, launcher }
}

async function writeInheritanceFixture(pinokioHome, layout) {
  const workspace = path.resolve(pinokioHome, 'api', inheritanceId)
  const launcher = layout === 'nested' ? path.resolve(workspace, 'pinokio') : workspace
  await write(launcher, 'pinokio.js', `module.exports = { title: "Inheritance Fixture", menu: [{ default: true, text: "Start", href: "start.js" }] }\n`)
  await write(launcher, 'start.js', script([{ method: 'local.set', params: { inherited: true } }]))
  await write(launcher, '_ENVIRONMENT', 'INHERITANCE_UNIQUE_SENTINEL=yes\n')
  await write(workspace, '.git/info/exclude', 'existing-entry\n')
  return { workspace, launcher }
}

async function writeNestedChildFixture(pinokioHome, layout) {
  if (layout !== 'nested') return null
  const workspace = path.resolve(pinokioHome, 'api', nestedChildId)
  const launcher = path.resolve(workspace, 'pinokio')
  await write(launcher, 'pinokio.js', `module.exports = {
  title: "Nested Child Regression",
  menu: [
    { text: "Start nested child", href: "pinokio/tool.js" },
    { text: "Stop nested child", action: { method: "stop", uri: "pinokio/tool.js" } }
  ]
}\n`)
  await write(launcher, 'pinokio/tool.js', script([{ method: 'process.wait', params: { sec: 20 } }], true))
  await write(launcher, 'ENVIRONMENT', '')
  return { workspace, launcher }
}

async function writeAdversarialFixtures(pinokioHome) {
  const rootFolder = path.resolve(pinokioHome, 'api', 'root-with-folder')
  await write(rootFolder, 'pinokio.js', `module.exports = { title: "Root With Folder", menu: [{ text: "Root start", href: "start.js" }] }\n`)
  await write(rootFolder, 'start.js', script([{ method: 'process.wait', params: { sec: 20 } }], true))
  await write(rootFolder, 'install.js', script([{ method: 'local.set', params: { installed: true } }]))
  await write(rootFolder, 'logs/api/seeded.js/latest', `${adversarialViewerSentinel}\n`)
  await write(rootFolder, 'pinokio/unrelated.txt', 'unrelated')
  const nestedLog = await write(rootFolder, 'pinokio/logs/api/help.js/1000', `${adversarialHelpSentinel}\n`)
  await write(rootFolder, 'pinokio/logs/sessions/index.json', JSON.stringify({
    version: 1,
    latest_session: 'adversarial-help-session',
    sessions: [{ id: 'adversarial-help-session', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:01.000Z', runs: ['help.js'] }]
  }, null, 2))
  await write(rootFolder, 'pinokio/logs/sessions/adversarial-help-session.json', JSON.stringify({
    version: 1,
    id: 'adversarial-help-session',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:01.000Z',
    runs: [{ script: 'help.js', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-01T00:00:01.000Z', logs: [{ path: path.relative(path.resolve(rootFolder, 'pinokio'), nestedLog).split(path.sep).join('/') }] }]
  }, null, 2))
  await write(rootFolder, '.git/config', '[remote "origin"]\n\turl = https://github.com/pinokio/root-with-folder.git\n')

  const both = path.resolve(pinokioHome, 'api', 'both-launchers')
  await write(both, 'pinokio.js', `module.exports = { title: "Root Winner", menu: [{ text: "Root winner start", href: "start.js" }] }\n`)
  await write(both, 'start.js', script([{ method: 'process.wait', params: { sec: 20 } }], true))
  await write(both, 'install.js', script([{ method: 'local.set', params: { installed: 'root' } }]))
  await write(both, 'pinokio/pinokio.js', `module.exports = { title: "Nested Loser", menu: [{ text: "Nested loser start", href: "start.js" }] }\n`)
  await write(both, 'pinokio/start.js', script([{ method: 'local.set', params: { started: 'nested' } }]))
  await write(both, 'pinokio/install.js', script([{ method: 'local.set', params: { installed: 'nested' } }]))

  const broken = path.resolve(pinokioHome, 'api', 'broken-root')
  await write(broken, 'pinokio.js', 'throw new Error("intentional broken root")\n')
  await write(broken, 'pinokio/pinokio.js', `module.exports = {
  title: "Legacy Nested Fallback",
  menu: [
    { text: "Fallback start", href: "start.js" },
    { text: "Fallback fs", href: "file.txt", fs: true },
    { text: "Fallback command", href: "file.txt", command: "open" },
    { text: "Fallback run", run: "printf fallback" },
    { text: "Fallback stop", action: { method: "stop", uri: "start.js" } },
    { text: "Fallback state", when: "start.js", on: "FALLBACK_ON", off: "FALLBACK_OFF" }
  ]
}\n`)
  await write(broken, 'pinokio/start.js', script([{ method: 'process.wait', params: { sec: 20 } }], true))
  await write(broken, 'pinokio/file.txt', 'nested fallback file\n')

  await write(path.resolve(pinokioHome, 'api', 'empty-pinokio-folder'), 'pinokio/unrelated.txt', 'empty')
  await write(path.resolve(pinokioHome, 'api', 'plain-pinokio-file'), 'pinokio', 'plain file')
  await fsp.mkdir(path.resolve(pinokioHome, 'api', 'no-launcher'), { recursive: true })
  await write(path.resolve(pinokioHome, 'api', 'pinokio'), 'pinokio.js', `module.exports = { title: "App Named Pinokio", menu: [] }\n`)
  await write(path.resolve(pinokioHome, 'api', 'subfolder-project'), 'pinokio.js', `module.exports = { title: "Subfolder Parent", menu: [] }\n`)
  await write(path.resolve(pinokioHome, 'api', 'subfolder-project'), 'child/pinokio.js', `module.exports = { title: "Subfolder Child", icon: "child.png", menu: [{ text: "Child start", href: "start.js" }] }\n`)
  await write(path.resolve(pinokioHome, 'api', 'subfolder-project'), 'child/start.js', script([{ method: 'local.set', params: { child: true } }]))
  await write(path.resolve(pinokioHome, 'api', 'subfolder-project'), 'child/child.png', png)
}

async function createHome(layout, runtimeBin) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-nested-browser-'))
  const fakeUserHome = path.resolve(root, 'user')
  const pinokioHome = path.resolve(root, 'pinokio-home')
  await fsp.mkdir(path.resolve(pinokioHome, 'api'), { recursive: true })
  await fsp.mkdir(fakeUserHome, { recursive: true })
  if (runtimeBin) {
    await fsp.symlink(runtimeBin, path.resolve(pinokioHome, 'bin'), process.platform === 'win32' ? 'junction' : 'dir')
    await write(pinokioHome, 'prototype/system/.acceptance-fixture', '')
    await write(pinokioHome, 'prototype/PINOKIO.md', 'Acceptance fixture\n')
    await write(pinokioHome, 'prototype/PTERM.md', 'Acceptance fixture\n')
  }
  if (process.platform === 'win32') {
    await fsp.mkdir(path.resolve(fakeUserHome, 'AppData', 'Roaming'), { recursive: true })
    await fsp.mkdir(path.resolve(fakeUserHome, 'AppData', 'Local'), { recursive: true })
  }
  const primary = await writePrimaryFixture(pinokioHome, layout)
  const inheritance = await writeInheritanceFixture(pinokioHome, layout)
  const nestedChild = await writeNestedChildFixture(pinokioHome, layout)
  await writeAdversarialFixtures(pinokioHome)
  return { root, fakeUserHome, pinokioHome, primary, inheritance, nestedChild }
}

async function createLiveHome(runtimeBin) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-nested-live-'))
  const fakeUserHome = path.resolve(root, 'user')
  const pinokioHome = path.resolve(root, 'pinokio-home')
  await fsp.mkdir(path.resolve(pinokioHome, 'api'), { recursive: true })
  await fsp.mkdir(fakeUserHome, { recursive: true })
  if (process.platform === 'win32') {
    await fsp.mkdir(path.resolve(fakeUserHome, 'AppData', 'Roaming'), { recursive: true })
    await fsp.mkdir(path.resolve(fakeUserHome, 'AppData', 'Local'), { recursive: true })
  }
  await fsp.symlink(runtimeBin, path.resolve(pinokioHome, 'bin'), process.platform === 'win32' ? 'junction' : 'dir')
  await write(pinokioHome, 'prototype/system/.acceptance-fixture', '')
  await write(pinokioHome, 'prototype/PINOKIO.md', 'Acceptance fixture\n')
  await write(pinokioHome, 'prototype/PTERM.md', 'Acceptance fixture\n')
  return { root, fakeUserHome, pinokioHome }
}

async function runServerMode() {
  const args = parseArgs()
  const checkout = path.resolve(String(args.checkout || ''))
  const home = path.resolve(String(args.home || ''))
  const port = Number(args.port)
  process.chdir(checkout)
  const pkg = require(path.resolve(checkout, 'package.json'))
  const Server = require(path.resolve(checkout, 'server'))
  const server = new Server({
    store: { store: { home, version: pkg.version } },
    agent: 'test',
    newsfeed: '',
    site: 'https://pinokio.co',
    discover_dark: 'https://pinokio.co?embed=1&theme=dark',
    discover_light: 'https://pinokio.co?embed=1&theme=light',
    portal: 'https://pinokio.co'
  })
  server.port = port
  await server.start({ debug: true })
  // The acceptance fixtures need the real app UI, not the unrelated full-dev
  // setup gate. Runtime-backed cases still execute through the real Conda shell.
  server.kernel.bin.check = async () => ({
    requirements: [],
    install_required: false,
    requirements_pending: false,
    error: null
  })
  process.stdout.write(`${readyPrefix}${JSON.stringify({ checkout, home, port, pid: process.pid })}\n`)
  setInterval(() => {}, 1000)
}

async function waitForReady(child, timeoutMs = 90000) {
  return await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`server readiness timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`)), timeoutMs)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`server exited before ready: code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }
    child.once('exit', onExit)
    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith(readyPrefix)) continue
        clearTimeout(timer)
        child.off('exit', onExit)
        resolve({ ready: JSON.parse(line.slice(readyPrefix.length)), stdout, stderr })
      }
    })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function waitForHttp(url, timeoutMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function waitForFile(file, predicate, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const content = await fsp.readFile(file, 'utf8')
      if (predicate(content)) return content
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for ${file}`)
}

async function waitForOptionalFile(file, predicate, timeoutMs = 15000) {
  try {
    return await waitForFile(file, predicate, timeoutMs)
  } catch (_) {
    return null
  }
}

async function readOptional(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function waitForBodyText(page, value, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const body = await page.locator('body').innerText().catch(() => '')
    if (body.includes(value)) return true
    await page.waitForTimeout(150)
  }
  return false
}

async function startRegistryStub() {
  const received = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const match = body.match(/name="metadata_b64"\r\n\r\n([^\r\n]+)/)
      let metadata = null
      if (match) {
        try { metadata = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) } catch (_) {}
      }
      received.push({ method: req.method, url: req.url, authorization: req.headers.authorization || '', metadata })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, draft: 'local-stub' }))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    received,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

async function browserRequest(page, pathname, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(async ({ pathname, options }) => {
        const response = await fetch(pathname, options)
        const text = await response.text()
        let json = null
        try { json = JSON.parse(text) } catch (_) {}
        return { status: response.status, ok: response.ok, text, json }
      }, { pathname, options })
    } catch (error) {
      const interrupted = /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed/i.test(String(error && error.message || error))
      if (!interrupted || attempt === 2) throw error
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    }
  }
}

async function waitForBrowserRequest(page, pathname, predicate, timeoutMs = 15000) {
  const started = Date.now()
  let response
  while (Date.now() - started < timeoutMs) {
    response = await browserRequest(page, pathname)
    if (predicate(response)) return response
    await page.waitForTimeout(150)
  }
  return response
}

function stableStatus(payload) {
  if (!payload) return null
  return {
    app_id: payload.app_id,
    title: payload.title,
    icon: payload.icon,
    install_script: payload.install_script,
    start_script: payload.start_script,
    default_script: payload.default_script,
    default_target: payload.default_target,
    state: payload.state
  }
}

async function menuSnapshot(page, selector = '.m.h.menu > .frame-link') {
  return await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    let action = null
    try { action = node.dataset.action ? JSON.parse(node.dataset.action) : null } catch (_) {}
    return {
      text: (node.innerText || '').replace(/\s+/g, ' ').trim(),
      href: node.getAttribute('href'),
      run: node.dataset.run || null,
      cwd: node.dataset.cwd || null,
      command: node.dataset.command || null,
      filepath: node.dataset.filepath || null,
      action,
      running: node.classList.contains('running') || !!node.querySelector('.fa-circle')
    }
  }).filter(item => !/^Settings/.test(item.text)))
}

async function adversarialPageSnapshot(page, baseUrl, id) {
  const navigation = await goto(page, baseUrl, `/p/${id}`)
  const body = await page.locator('body').innerText().catch(() => '')
  const status = await browserRequest(page, `/apps/status/${id}`)
  return {
    navigation,
    markers: ['Root With Folder', 'Root Winner', 'Nested Loser', 'Legacy Nested Fallback', 'App Named Pinokio']
      .filter(marker => body.includes(marker)),
    menu: await page.locator('.m.h.menu').count() ? await menuSnapshot(page) : [],
    status: { status: status.status, value: stableStatus(status.json) }
  }
}

async function adversarialRouteSnapshot(page, pathname, markers = []) {
  const response = await browserRequest(page, pathname)
  return {
    status: response.status,
    markers: markers.filter(marker => response.text.includes(marker))
  }
}

async function exerciseAdversarial(page, baseUrl) {
  const rootWithFolder = await adversarialPageSnapshot(page, baseUrl, 'root-with-folder')
  const viewer = await browserRequest(page, '/apps/logs/root-with-folder?script=seeded.js')
  const help = await browserRequest(page, '/apps/logs/root-with-folder/report?session=adversarial-help-session&redaction=none')
  rootWithFolder.logViewer = {
    status: viewer.status,
    script: viewer.json && viewer.json.script,
    hasRootSentinel: !!(viewer.json && String(viewer.json.text || '').includes(adversarialViewerSentinel)),
    hasNestedSentinel: !!(viewer.json && String(viewer.json.text || '').includes(adversarialHelpSentinel))
  }
  rootWithFolder.getHelp = {
    status: help.status,
    hasRootSentinel: !!(help.json && String(help.json.markdown || '').includes(adversarialViewerSentinel)),
    hasNestedSentinel: !!(help.json && String(help.json.markdown || '').includes(adversarialHelpSentinel))
  }

  const subfolderUi = await adversarialRouteSnapshot(page, '/p/subfolder-project/child', ['Subfolder Parent', 'Subfolder Child'])
  const subfolderDirectory = await adversarialRouteSnapshot(page, '/api/subfolder-project/child', ['Subfolder Child', 'Child start'])
  const subfolderIcon = await browserRequest(page, '/asset/api/subfolder-project/child/child.png')
  const brokenRoot = await adversarialPageSnapshot(page, baseUrl, 'broken-root')
  brokenRoot.sidebarNavigation = await goto(page, baseUrl, '/pinokio/sidebar/broken-root')
  brokenRoot.sidebarMenu = await menuSnapshot(page, '.frame-link')

  return {
    rootWithFolder,
    bothLaunchers: await adversarialPageSnapshot(page, baseUrl, 'both-launchers'),
    brokenRoot,
    emptyPinokioFolder: await adversarialRouteSnapshot(page, '/p/empty-pinokio-folder', ['empty-pinokio-folder']),
    plainPinokioFile: await adversarialRouteSnapshot(page, '/p/plain-pinokio-file', ['plain-pinokio-file']),
    noLauncher: await adversarialRouteSnapshot(page, '/p/no-launcher', ['no-launcher']),
    appNamedPinokio: await adversarialPageSnapshot(page, baseUrl, 'pinokio'),
    subfolder: {
      ui: subfolderUi,
      directory: subfolderDirectory,
      iconStatus: subfolderIcon.status
    }
  }
}

async function waitForRunning(page, expected, running, timeoutMs = 12000, targetApp = appId) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const response = await browserRequest(page, `/pinokio/home_status?t=${Date.now()}`)
    const entries = response.json && Array.isArray(response.json.running_scripts) ? response.json.running_scripts : []
    const found = entries.some(entry => entry && entry.app === targetApp && String(entry.script_path || entry.name || '').replace(/\\/g, '/') === expected)
    if (found === running) return true
    await page.waitForTimeout(150)
  }
  return false
}

async function goto(page, baseUrl, pathname) {
  const response = await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'load' })
  return { status: response ? response.status() : 0, url: new URL(page.url()).pathname + new URL(page.url()).search }
}

function normalizedTreeEntries(entries) {
  return entries.map(entry => ({ name: entry.name, path: entry.path, type: entry.type })).sort((a, b) => a.path.localeCompare(b.path))
}

async function exerciseRun({ page, baseUrl, home, build, layout, stub, artifacts, runtimeBacked }) {
  const prefix = layout === 'nested' ? 'pinokio/' : ''
  const envPath = path.resolve(home.primary.launcher, 'ENVIRONMENT')
  const otherEnvPath = layout === 'nested' ? path.resolve(home.primary.workspace, 'ENVIRONMENT') : path.resolve(home.primary.workspace, 'pinokio', 'ENVIRONMENT')
  const envWritePath = build === 'baseline' && layout === 'nested' ? otherEnvPath : envPath
  const trace = { build, layout, runtime_backed: runtimeBacked
    ? { status: 'EXECUTED' }
    : { 4: 'UNVERIFIED: no test-owned runtime supplied', 16: 'UNVERIFIED: no test-owned runtime supplied', 23: 'UNVERIFIED: no test-owned runtime supplied', tier6: 'UNVERIFIED: live Explore installation is a separate release test' } }

  trace.home = await goto(page, baseUrl, '/home')
  await page.locator(`.home-app-line[data-uri="${appId}"]`).waitFor()
  trace.homeCard = await page.locator(`.home-app-line[data-uri="${appId}"]`).evaluate(node => ({
    href: node.getAttribute('data-href'),
    icon: node.getAttribute('data-icon'),
    iconpath: node.getAttribute('data-iconpath'),
    name: node.getAttribute('data-name')
  }))

  trace.app = await goto(page, baseUrl, `/p/${appId}`)
  await page.locator('.m.h.menu').waitFor()
  trace.menuBefore = await menuSnapshot(page)
  const startItem = trace.menuBefore.find(item => item.text.includes('Start relative'))
  const runItem = trace.menuBefore.find(item => item.text.includes('Run string'))
  trace.runCwd = runItem ? runItem.cwd : null
  if (runtimeBacked) {
    const runFile = path.resolve(home.primary.launcher, 'run-cwd.txt')
    const runButton = page.locator('.m.h.menu [data-run]', { hasText: 'Run string' }).first()
    if (await runButton.count()) await runButton.click()
    trace.runtime_backed.run_string = {
      clicked: !!(await runButton.count()),
      output: await waitForOptionalFile(runFile, value => !!value.trim(), 30000)
    }
  }

  trace.status = (await browserRequest(page, `/apps/status/${appId}`))
  trace.status = { status: trace.status.status, value: stableStatus(trace.status.json) }
  const expectedStart = trace.status.value && trace.status.value.start_script ? trace.status.value.start_script : `${prefix}start.js`
  trace.autolaunch = await browserRequest(page, `/autolaunch/candidates?app=${encodeURIComponent(appId)}`)
  if (trace.autolaunch.json) {
    trace.autolaunch = {
      status: trace.autolaunch.status,
      menu: (trace.autolaunch.json.menu || []).map(item => item.script),
      other: (trace.autolaunch.json.other || []).map(item => item.script)
    }
  }

  trace.startNavigation = startItem ? await goto(page, baseUrl, startItem.href) : { status: 0, url: '' }
  trace.startRunning = await waitForRunning(page, expectedStart, true)
  await goto(page, baseUrl, `/p/${appId}`)
  trace.menuRunning = await menuSnapshot(page)
  const stopItem = page.locator('.m.h.menu [data-action]', { hasText: 'Stop relative' }).first()
  if (await stopItem.count()) await stopItem.click()
  trace.menuStopWorked = await waitForRunning(page, expectedStart, false)

  if (startItem) await goto(page, baseUrl, startItem.href)
  trace.shortcutStartRunning = await waitForRunning(page, expectedStart, true)
  await goto(page, baseUrl, '/home')
  const shortcut = page.locator(`.home-app-line[data-uri="${appId}"] .menu-btn[data-action]`).first()
  trace.shortcutAction = await shortcut.count() ? await shortcut.getAttribute('data-action') : null
  trace.shortcutElement = await shortcut.count() ? await shortcut.evaluate(node => node.outerHTML) : null
  await page.waitForTimeout(250)
  if (await shortcut.count()) await shortcut.click()
  trace.shortcutFirstClickWorked = await waitForRunning(page, expectedStart, false, 750)
  if (!trace.shortcutFirstClickWorked && await shortcut.count()) await shortcut.click()
  trace.shortcutStopWorked = trace.shortcutFirstClickWorked || await waitForRunning(page, expectedStart, false)

  trace.envPage = await goto(page, baseUrl, `/env/api/${appId}?init=true`)
  await page.locator('#customize').click()
  await page.locator('#REQUIRED_VALUE').fill('saved-through-browser')
  const envResponsePromise = page.waitForResponse(response => response.url() === `${baseUrl}/env` && response.request().method() === 'POST')
  await page.locator('#save').click()
  const envResponse = await envResponsePromise
  trace.envPost = envResponse.status()
  const baselineNestedRepair = build === 'baseline' && layout === 'nested'
  if (!baselineNestedRepair) {
    await waitForFile(envWritePath, content => content.includes('REQUIRED_VALUE=saved-through-browser'))
  }
  trace.env = { launcher: await readOptional(envPath), other: await readOptional(otherEnvPath) }

  trace.envSetNavigation = await goto(page, baseUrl, `/api/${appId}/${prefix}env-set.js`)
  if (!baselineNestedRepair) {
    await waitForFile(envWritePath, content => content.includes('ACTION_VALUE=set-by-action'))
  }
  trace.envSwitchNavigation = await goto(page, baseUrl, `/api/${appId}/${prefix}env-switch.js`)
  if (!baselineNestedRepair) {
    await waitForFile(envWritePath, content => content.includes('SWITCH_VALUE=two'))
  }
  trace.envAfterActions = await readOptional(envWritePath)

  if (runtimeBacked) {
    const runtimeResultPath = path.resolve(home.primary.launcher, 'runtime-result.json')
    trace.runtime_backed.script_navigation = await goto(page, baseUrl, `/api/${appId}/${prefix}runtime.js`)
    const runtimeResult = await waitForOptionalFile(runtimeResultPath, value => value.includes(runtimeSentinel), 30000)
    trace.runtime_backed.terminal_has_sentinel = await waitForBodyText(page, runtimeSentinel, 5000)
    trace.runtime_backed.result = runtimeResult ? JSON.parse(runtimeResult) : null
    const runtimeLog = await waitForBrowserRequest(
      page,
      `/apps/logs/${appId}?script=${encodeURIComponent(`${prefix}runtime.js`)}`,
      response => !!(response.json && String(response.json.text || '').includes(runtimeSentinel)),
      build === 'baseline' && layout === 'nested' ? 1000 : 15000
    )
    trace.runtime_backed.log = runtimeLog.json ? {
      status: runtimeLog.status,
      script: runtimeLog.json.script,
      has_sentinel: String(runtimeLog.json.text || '').includes(runtimeSentinel)
    } : { status: runtimeLog.status, has_sentinel: false, error: runtimeLog.text }
  }

  trace.share = await goto(page, baseUrl, `/share/${appId}`)
  trace.shareValues = await page.locator('.env-item').evaluateAll(nodes => nodes.map(node => ({
    key: (node.querySelector('label') || {}).innerText || '',
    value: (node.querySelector('input') || {}).value || ''
  })))

  trace.inheritancePage = await goto(page, baseUrl, `/env/api/${inheritanceId}?init=true`)
  trace.inheritance = {
    launcher: await readOptional(path.resolve(home.inheritance.launcher, 'ENVIRONMENT')),
    other: await readOptional(layout === 'nested' ? path.resolve(home.inheritance.workspace, 'ENVIRONMENT') : path.resolve(home.inheritance.workspace, 'pinokio', 'ENVIRONMENT'))
  }

  trace.iconBefore = await browserRequest(page, trace.status.value.icon)
  trace.iconBefore = { status: trace.iconBefore.status, size: trace.iconBefore.text.length }
  trace.iconUpload = await page.evaluate(async ({ appId, pngBase64 }) => {
    const form = new FormData()
    form.append('avatar', new File([Uint8Array.from(atob(pngBase64), value => value.charCodeAt(0))], 'uploaded.png', { type: 'image/png' }))
    form.append('icon_dirty', 'true')
    form.append('icon_path', 'uploaded.png')
    form.append('title', 'Nested Browser Acceptance')
    form.append('description', 'Controlled nested-launcher browser fixture.')
    form.append('old_path', appId)
    form.append('new_path', appId)
    form.append('edit', 'true')
    const response = await fetch('/pinokio/upload', { method: 'POST', body: form })
    return { status: response.status, text: await response.text() }
  }, { appId, pngBase64: png.toString('base64') })
  trace.uploadedIcon = {
    launcher: fs.existsSync(path.resolve(home.primary.launcher, 'uploaded.png')),
    other: fs.existsSync(layout === 'nested' ? path.resolve(home.primary.workspace, 'uploaded.png') : path.resolve(home.primary.workspace, 'pinokio', 'uploaded.png'))
  }
  const refreshedStatus = await browserRequest(page, `/apps/status/${appId}`)
  trace.iconAfter = { url: refreshedStatus.json && refreshedStatus.json.icon }
  if (trace.iconAfter.url) {
    const iconAfterResponse = await browserRequest(page, trace.iconAfter.url)
    trace.iconAfter.status = iconAfterResponse.status
  }

  trace.preFirst = await goto(page, baseUrl, `/pre/api/${appId}`)
  trace.preFirst.items = await page.locator('.item').evaluateAll(nodes => nodes.map(node => ({
    title: (node.querySelector('.title') || {}).innerText || '',
    icon: (node.querySelector('img') || {}).getAttribute ? node.querySelector('img').getAttribute('src') : null,
    href: (node.querySelector('a') || {}).getAttribute ? node.querySelector('a').getAttribute('href') : null,
    filepath: (node.querySelector('button') || {}).dataset ? node.querySelector('button').dataset.filepath || null : null
  })))
  trace.preSecond = await goto(page, baseUrl, `/pre/api/${appId}`)
  trace.preSecond.items = await page.locator('.item').evaluateAll(nodes => nodes.map(node => ({
    title: (node.querySelector('.title') || {}).innerText || '',
    icon: (node.querySelector('img') || {}).getAttribute ? node.querySelector('img').getAttribute('src') : null,
    href: (node.querySelector('a') || {}).getAttribute ? node.querySelector('a').getAttribute('href') : null,
    filepath: (node.querySelector('button') || {}).dataset ? node.querySelector('button').dataset.filepath || null : null
  })))

  trace.search = {}
  for (const token of ['WORKSPACEREADMESENTINEL', 'LAUNCHERREADMESENTINEL', 'SCRIPTSEARCHSENTINEL']) {
    const response = await browserRequest(page, `/apps/search?q=${encodeURIComponent(token)}&mode=strict&min_match=1`)
    trace.search[token] = {
      status: response.status,
      files: response.json && Array.isArray(response.json.apps)
        ? response.json.apps.flatMap(app => (app.matches || []).map(match => match.file)).sort()
        : []
    }
  }
  const aiResponse = await browserRequest(page, `/pinokio/ai/${appId}`)
  trace.ai = { status: aiResponse.status }
  await page.setContent(aiResponse.text)
  trace.ai.links = await page.locator('a').evaluateAll(nodes => nodes.map(node => ({ text: node.innerText.trim(), href: node.getAttribute('href') })).sort((a, b) => a.href.localeCompare(b.href)))
  for (const link of trace.ai.links) {
    const response = await browserRequest(page, link.href)
    link.status = response.status
    link.body = response.text.trim()
  }

  await goto(page, baseUrl, `/p/${appId}`)
  const logQuery = layout === 'nested' ? 'pinokio/seeded.js' : 'seeded.js'
  const currentLog = await browserRequest(page, `/apps/logs/${appId}?script=${encodeURIComponent(logQuery)}`)
  trace.currentLog = currentLog.json ? {
    status: currentLog.status,
    script: currentLog.json.script,
    file: currentLog.json.file,
    text: currentLog.json.text
  } : { status: currentLog.status, error: currentLog.text }
  const logsPage = await goto(page, baseUrl, `/logs?workspace=${appId}`)
  trace.logsPage = { ...logsPage, root: await page.locator('[data-logs-root]').count() ? await page.locator('[data-logs-root]').getAttribute('data-logs-root') : null }
  const tree = await browserRequest(page, `/api/logs/tree?workspace=${appId}`)
  trace.logTree = tree.json ? { status: tree.status, path: tree.json.path, entries: normalizedTreeEntries(tree.json.entries || []) } : { status: tree.status, error: tree.text }

  const reportResponse = await browserRequest(page, `/apps/logs/${appId}/report?session=${historicalSession}&redaction=none`)
  trace.report = reportResponse.json ? {
    status: reportResponse.status,
    session: reportResponse.json.session,
    sections: (reportResponse.json.sections || []).map(section => ({ source: section.source, script: section.script, file: section.file, text: section.text })),
    hasHistorical: String(reportResponse.json.markdown || '').includes(historicalSentinel),
    hasCurrent: String(reportResponse.json.markdown || '').includes(currentSentinel),
    repo: reportResponse.json.repo_url || null
  } : { status: reportResponse.status, error: reportResponse.text }
  if (reportResponse.json) {
    const metadata = Buffer.from(JSON.stringify({
      body: reportResponse.json.markdown,
      appRepoUrl: reportResponse.json.repo_url,
      session: historicalSession
    }), 'utf8').toString('base64')
    trace.draft = await page.evaluate(async ({ appId, registry, metadata }) => {
      const form = new FormData()
      form.append('token', 'acceptance-token')
      form.append('registry', registry)
      form.append('metadata_b64', metadata)
      const response = await fetch(`/apps/logs/${appId}/drafts`, { method: 'POST', body: form })
      return { status: response.status, text: await response.text() }
    }, { appId, registry: stub.url, metadata })
  } else {
    trace.draft = { status: 0, text: '' }
  }
  trace.registryDraft = stub.received.map(item => ({
    method: item.method,
    url: item.url,
    authorization: item.authorization,
    hasHistorical: !!(item.metadata && item.metadata.body && item.metadata.body.includes(historicalSentinel)),
    hasCurrent: !!(item.metadata && item.metadata.body && item.metadata.body.includes(currentSentinel)),
    repo: item.metadata && (item.metadata.appRepoUrl || item.metadata.repoUrl)
  }))

  trace.gitExclude = await readOptional(path.resolve(home.primary.workspace, '.git', 'info', 'exclude'))
  trace.inheritanceGitExclude = await readOptional(path.resolve(home.inheritance.workspace, '.git', 'info', 'exclude'))
  trace.locations = {
    env: path.relative(home.pinokioHome, envPath).split(path.sep).join('/'),
    logs: path.relative(home.pinokioHome, path.resolve(home.primary.launcher, 'logs')).split(path.sep).join('/'),
    icon: trace.uploadedIcon.launcher ? path.relative(home.pinokioHome, path.resolve(home.primary.launcher, 'uploaded.png')).split(path.sep).join('/') : null
  }
  trace.nestedChildRegression = null
  if (layout === 'nested') {
    await goto(page, baseUrl, `/p/${nestedChildId}`)
    const nestedChildMenu = await menuSnapshot(page)
    const start = nestedChildMenu.find(item => item.text.includes('Start nested child'))
    const stop = nestedChildMenu.find(item => item.text.includes('Stop nested child'))
    const candidates = await browserRequest(page, `/autolaunch/candidates?app=${nestedChildId}`)
    if (start) await goto(page, baseUrl, start.href)
    const started = await waitForRunning(page, 'pinokio/pinokio/tool.js', true, 12000, nestedChildId)
    await goto(page, baseUrl, `/p/${nestedChildId}`)
    const stopButton = page.locator('.m.h.menu [data-action]', { hasText: 'Stop nested child' }).first()
    if (await stopButton.count()) await stopButton.click()
    trace.nestedChildRegression = {
      startHref: start && start.href,
      stopUri: stop && stop.action && stop.action.uri,
      candidates: candidates.json && (candidates.json.menu || []).map(item => item.script),
      started,
      stopped: await waitForRunning(page, 'pinokio/pinokio/tool.js', false, 12000, nestedChildId)
    }
  }
  trace.adversarial = await exerciseAdversarial(page, baseUrl)
  await page.screenshot({ path: path.resolve(artifacts, 'final.png'), fullPage: true })
  return trace
}

async function executeCase({ checkout, build, layout, playwright, executablePath, artifactsRoot, runtime }) {
  const home = await createHome(layout, runtime && runtime.bin)
  const artifacts = path.resolve(artifactsRoot, `${build}-${layout}`)
  await fsp.mkdir(artifacts, { recursive: true })
  const port = await freePort()
  const stub = await startRegistryStub()
  const env = {
    ...process.env,
    HOME: home.fakeUserHome,
    PINOKIO_HOME: home.pinokioHome,
    PINOKIO_DISABLE_WATCH: '1',
    NODE_PATH: [path.resolve(repoRoot, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter)
  }
  if (process.platform === 'win32') {
    env.USERPROFILE = home.fakeUserHome
    env.APPDATA = path.resolve(home.fakeUserHome, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.resolve(home.fakeUserHome, 'AppData', 'Local')
  }
  const serverArgs = [
    __filename,
    '--server',
    '--checkout', checkout,
    '--home', home.pinokioHome,
    '--port', String(port)
  ]
  if (!runtime) serverArgs.push('--runtime-free')
  const child = childProcess.spawn(process.execPath, serverArgs, { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  const logs = []
  child.stdout.on('data', chunk => logs.push(chunk.toString()))
  child.stderr.on('data', chunk => logs.push(chunk.toString()))
  let browser
  let page
  try {
    await waitForReady(child)
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHttp(`${baseUrl}/home`)
    browser = await playwright.chromium.launch({ headless: true, executablePath })
    page = await browser.newPage()
    page.setDefaultTimeout(20000)
    const diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [], httpErrors: [] }
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message || String(error)))
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    })
    page.on('requestfailed', request => {
      if (request.url().startsWith(baseUrl)) diagnostics.requestFailures.push({ url: request.url(), error: request.failure() && request.failure().errorText })
    })
    page.on('response', response => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400) diagnostics.httpErrors.push({ url: response.url(), status: response.status() })
    })
    const trace = await exerciseRun({ page, baseUrl, home, build, layout, stub, artifacts, runtimeBacked: !!runtime })
    trace.diagnostics = diagnostics
    await fsp.writeFile(path.resolve(artifacts, 'trace.json'), JSON.stringify(trace, null, 2))
    await fsp.writeFile(path.resolve(artifacts, 'server.log'), logs.join(''))
    const unexpectedPageErrors = diagnostics.pageErrors.filter(message => {
      return !(build === 'baseline' && layout === 'nested' && String(message).startsWith("Unexpected token '<'"))
    })
    assert.deepEqual(unexpectedPageErrors, [], 'unexpected uncaught page errors')
    assert.deepEqual(diagnostics.requestFailures, [], 'failed local browser requests')
    const knownBaselineNestedError = entry => {
      if (!(build === 'baseline' && layout === 'nested')) return false
      const url = new URL(entry.url)
      if (entry.status === 500 && url.pathname === '/env') return true
      if (entry.status === 404 && url.pathname === `/api/${appId}/pre.png`) return true
      if (entry.status !== 404 || url.pathname !== `/apps/logs/${appId}`) return false
      return ['pinokio/start.js', 'pinokio/seeded.js', 'pinokio/runtime.js'].includes(url.searchParams.get('script'))
    }
    const knownTier4Error = entry => {
      const url = new URL(entry.url)
      return (entry.status === 404 && url.pathname === '/p/subfolder-project/child') ||
        (entry.status === 422 && url.pathname === '/p/broken-root') ||
        (entry.status === 500 && url.pathname === '/p/plain-pinokio-file')
    }
    assert.deepEqual(diagnostics.httpErrors.filter(entry => !knownBaselineNestedError(entry) && !knownTier4Error(entry)), [], 'unexpected local 4xx/5xx responses')
    if (build === 'baseline' && layout === 'nested') {
      assert.equal(diagnostics.consoleErrors.every(message => /^Failed to load resource: the server responded with a status of (404|422|500)/.test(message)), true, 'unexpected baseline nested console error')
    } else {
      assert.equal(diagnostics.consoleErrors.every(message => /^Failed to load resource: the server responded with a status of (404|422|500)/.test(message)), true, 'unexpected browser console error')
    }
    return { trace, artifacts, temporaryHome: home.root, browserVersion: browser.version(), server: { pid: child.pid, port } }
  } catch (error) {
    if (page) await page.screenshot({ path: path.resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
    await fsp.writeFile(path.resolve(artifacts, 'server.log'), logs.join('')).catch(() => {})
    await fsp.writeFile(path.resolve(artifacts, 'failure.txt'), error && error.stack ? error.stack : String(error)).catch(() => {})
    error.artifacts = artifacts
    error.temporaryHome = home.root
    throw error
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    await stopChild(child)
    await stub.close().catch(() => {})
  }
}

async function waitForScriptCompletion(page, app, scriptPath, logFile, initiallyRunning = false, timeoutMs = 600000) {
  const started = Date.now()
  let sawRunning = initiallyRunning
  while (Date.now() - started < timeoutMs) {
    const response = await browserRequest(page, `/pinokio/home_status?t=${Date.now()}`)
    const entries = response.json && Array.isArray(response.json.running_scripts) ? response.json.running_scripts : []
    const running = entries.some(entry => entry && entry.app === app && String(entry.script_path || '').replace(/\\/g, '/') === scriptPath)
    sawRunning ||= running
    if (!running && sawRunning) return { completed: true, sawRunning, logCreated: fs.existsSync(logFile) }
    await page.waitForTimeout(500)
  }
  return { completed: false, sawRunning }
}

async function openPublishedControl(page, baseUrl, control) {
  await goto(page, baseUrl, '/home')
  const exploreButton = page.locator('[data-pinokio-explore-nav="true"]').first()
  await exploreButton.waitFor()
  await exploreButton.click()
  await page.waitForURL(url => url.origin === baseUrl && url.searchParams.get('mode') === 'explore', { timeout: 30000 })
  const frameElement = page.locator('iframe[name="pinokio-explore"]')
  await frameElement.waitFor()
  const frame = page.frame({ name: 'pinokio-explore' })
  assert.ok(frame, 'Explore iframe was not created')
  await frame.waitForLoadState('domcontentloaded')
  const toggle = frame.locator('button.search-toggle').first()
  if (await toggle.count()) await toggle.click()
  const search = frame.locator('form[role="search"] input[name="q"]').first()
  await search.waitFor({ timeout: 60000 })
  await search.fill(control.repo)
  await search.press('Enter')
  const result = frame.locator(`a[href="/apps/${control.slug}"]`).first()
  await Promise.race([
    frame.waitForURL(url => url.pathname === `/apps/${control.slug}`, { timeout: 60000 }),
    result.waitFor({ timeout: 60000 })
  ])
  if (new URL(frame.url()).pathname !== `/apps/${control.slug}`) await result.click()
  await frame.waitForURL(url => url.pathname === `/apps/${control.slug}`, { timeout: 60000 })
  const installTrigger = frame.locator('button.install-trigger:visible').first()
  await installTrigger.waitFor()
  await installTrigger.click()
  const installAction = frame.locator('.install-drawer-backdrop.is-open a[href^="http://localhost:42000/pinokio/download?uri="]', { hasText: 'Install latest' }).first()
  await installAction.waitFor()
  const handoff = await installAction.getAttribute('href')
  await installAction.click()
  await page.waitForURL(url => url.origin === baseUrl && url.searchParams.get('mode') === 'download', { timeout: 30000 })
  return {
    explorePath: new URL(frame.url()).pathname,
    handoff,
    parentPath: new URL(page.url()).pathname + new URL(page.url()).search
  }
}

async function latestSession(launcher) {
  const index = await readOptional(path.resolve(launcher, 'logs', 'sessions', 'index.json'))
  if (!index) return null
  try {
    const parsed = JSON.parse(index)
    return parsed.latest_session || (parsed.sessions && parsed.sessions[0] && parsed.sessions[0].id) || null
  } catch (_) {
    return null
  }
}

async function executeLiveCase({ checkout, build, controlName, control, playwright, executablePath, artifactsRoot, runtime }) {
  const home = await createLiveHome(runtime.bin)
  const artifacts = path.resolve(artifactsRoot, `live-${build}-${controlName}`)
  await fsp.mkdir(artifacts, { recursive: true })
  const port = await freePort()
  const env = {
    ...process.env,
    HOME: home.fakeUserHome,
    PINOKIO_HOME: home.pinokioHome,
    PINOKIO_DISABLE_WATCH: '1',
    NODE_PATH: [path.resolve(repoRoot, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter)
  }
  if (process.platform === 'win32') {
    env.USERPROFILE = home.fakeUserHome
    env.APPDATA = path.resolve(home.fakeUserHome, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.resolve(home.fakeUserHome, 'AppData', 'Local')
  }
  const child = childProcess.spawn(process.execPath, [
    __filename,
    '--server',
    '--checkout', checkout,
    '--home', home.pinokioHome,
    '--port', String(port)
  ], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  const logs = []
  child.stdout.on('data', chunk => logs.push(chunk.toString()))
  child.stderr.on('data', chunk => logs.push(chunk.toString()))
  let browser
  let page
  const trace = { build, control: controlName, published: control, runtime: { conda: runtime.conda, node: runtime.node, git: runtime.git, uv: runtime.uv } }
  try {
    await waitForReady(child)
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHttp(`${baseUrl}/home`)
    browser = await playwright.chromium.launch({ headless: true, executablePath })
    page = await browser.newPage()
    page.setDefaultTimeout(30000)
    const diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [], localHttpErrors: [] }
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message || String(error)))
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
    })
    page.on('requestfailed', request => diagnostics.requestFailures.push({ url: request.url(), error: request.failure() && request.failure().errorText }))
    page.on('response', response => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400) diagnostics.localHttpErrors.push({ url: response.url(), status: response.status() })
    })

    trace.explore = await openPublishedControl(page, baseUrl, control)
    const modalInput = page.locator('.swal2-input').first()
    await modalInput.waitFor({ timeout: 30000 })
    trace.downloadName = await modalInput.inputValue()
    assert.equal(trace.downloadName, control.folder)
    await page.locator('.swal2-confirm').click()
    await page.waitForURL(url => url.pathname === `/env/api/${control.folder}` && url.searchParams.get('init') === 'true', { timeout: 240000 })

    const workspace = path.resolve(home.pinokioHome, 'api', control.folder)
    const launcher = control.layout === 'nested' ? path.resolve(workspace, 'pinokio') : workspace
    trace.clone = {
      remote: run('git', ['config', '--get', 'remote.origin.url'], { cwd: workspace }).replace(/\.git$/, ''),
      commit: run('git', ['rev-parse', 'HEAD'], { cwd: workspace }),
      rootManifest: fs.existsSync(path.resolve(workspace, 'pinokio.js')),
      nestedManifest: fs.existsSync(path.resolve(workspace, 'pinokio', 'pinokio.js'))
    }
    assert.equal(trace.clone.remote, control.repo)
    assert.equal(trace.clone.rootManifest, control.layout === 'root')
    assert.equal(trace.clone.nestedManifest, control.layout === 'nested')

    trace.confirmation = {
      path: new URL(page.url()).pathname + new URL(page.url()).search,
      title: (await page.locator('body').innerText()).includes(control.title),
      remote: await page.locator('.warning a').getAttribute('href')
    }
    const envResponsePromise = page.waitForResponse(response => response.url() === `${baseUrl}/env` && response.request().method() === 'POST')
    await page.locator('#save').click()
    const envResponse = await envResponsePromise
    trace.environmentPost = envResponse.status()
    trace.environment = {
      root: await readOptional(path.resolve(workspace, 'ENVIRONMENT')),
      nested: await readOptional(path.resolve(workspace, 'pinokio', 'ENVIRONMENT'))
    }
    if (!envResponse.ok()) {
      trace.expectedReproduction = build === 'baseline' && control.layout === 'nested'
      trace.diagnostics = diagnostics
      await page.screenshot({ path: path.resolve(artifacts, 'environment-failure.png'), fullPage: true })
      await fsp.writeFile(path.resolve(artifacts, 'trace.json'), JSON.stringify(trace, null, 2))
      await fsp.writeFile(path.resolve(artifacts, 'server.log'), logs.join(''))
      assert.equal(trace.expectedReproduction, true, `unexpected environment POST failure: ${envResponse.status()}`)
      return { trace, artifacts, temporaryHome: home.root, browserVersion: browser.version() }
    }

    await page.waitForURL(url => url.pathname === `/p/${control.folder}`, { timeout: 30000 })
    await page.locator('.m.h.menu').waitFor()
    trace.menuBeforeInstall = await menuSnapshot(page)
    let status = await browserRequest(page, `/apps/status/${control.folder}`)
    trace.statusBeforeInstall = { status: status.status, value: stableStatus(status.json) }
    const installScript = `${control.layout === 'nested' ? 'pinokio/' : ''}install.js`
    const installLog = path.resolve(launcher, 'logs', 'api', 'install.js', 'latest')
    const autoStarted = await waitForRunning(page, installScript, true, 5000, control.folder)
    if (!autoStarted) {
      const installItem = trace.menuBeforeInstall.find(item => /^Install(?:\s|$)/.test(item.text))
      assert.ok(installItem && installItem.href, 'published app did not expose an Install action')
      await goto(page, baseUrl, installItem.href)
    }
    trace.install = {
      trigger: autoStarted ? 'environment-install-auto-start' : 'menu-click',
      ...await waitForScriptCompletion(page, control.folder, installScript, installLog, autoStarted)
    }
    assert.equal(trace.install.completed, true, 'published install script did not complete')

    await goto(page, baseUrl, `/p/${control.folder}`)
    await page.locator('.m.h.menu').waitFor()
    trace.menuAfterInstall = await menuSnapshot(page)
    status = await browserRequest(page, `/apps/status/${control.folder}`)
    trace.statusAfterInstall = { status: status.status, value: stableStatus(status.json) }
    const startItem = trace.menuAfterInstall.find(item => /^(Start|Open)/.test(item.text))
    assert.ok(startItem && startItem.href, 'published app did not expose a Start action after install')
    await goto(page, baseUrl, startItem.href)
    const startScript = `${control.layout === 'nested' ? 'pinokio/' : ''}start.js`
    trace.start = { running: await waitForRunning(page, startScript, true, 180000, control.folder) }
    assert.equal(trace.start.running, true, 'published start script did not enter the running state')
    const shellInfo = await browserRequest(page, '/info/shells')
    trace.start.shells = shellInfo.json
      ? Object.values(shellInfo.json).map(shell => ({ path: shell.path, cmd: shell.cmd, done: shell.done })).filter(shell => shell.path && shell.path.includes(control.folder))
      : []
    const stop = page.locator('.stop:not(.hidden)').first()
    await stop.waitFor({ state: 'visible', timeout: 180000 })
    await stop.click()
    trace.start.stopped = await waitForRunning(page, startScript, false, 30000, control.folder)
    assert.equal(trace.start.stopped, true, 'published start script did not stop')

    await goto(page, baseUrl, '/home')
    const card = page.locator(`.home-app-line[data-uri="${control.folder}"]`)
    await card.waitFor()
    trace.homeCard = {
      href: await card.getAttribute('data-href'),
      icon: await card.getAttribute('data-icon'),
      name: await card.getAttribute('data-name')
    }
    const icon = trace.statusAfterInstall.value && trace.statusAfterInstall.value.icon
    const iconResponse = icon ? await browserRequest(page, icon) : null
    trace.icon = { url: icon, status: iconResponse && iconResponse.status }
    const session = await latestSession(launcher)
    const report = session ? await browserRequest(page, `/apps/logs/${control.folder}/report?session=${encodeURIComponent(session)}&redaction=none`) : null
    trace.logs = {
      root: path.relative(home.pinokioHome, path.resolve(launcher, 'logs')).split(path.sep).join('/'),
      installLatest: fs.existsSync(installLog),
      session,
      reportStatus: report && report.status
    }
    trace.filesystem = {
      rootEnvironment: fs.existsSync(path.resolve(workspace, 'ENVIRONMENT')),
      nestedEnvironment: fs.existsSync(path.resolve(workspace, 'pinokio', 'ENVIRONMENT')),
      gitExclude: await readOptional(path.resolve(workspace, '.git', 'info', 'exclude')),
      installedMarker: fs.existsSync(path.resolve(launcher, '.installed')),
      helloVenv: fs.existsSync(path.resolve(workspace, 'app', '.venv'))
    }
    trace.diagnostics = diagnostics
    await page.screenshot({ path: path.resolve(artifacts, 'final.png'), fullPage: true })
    await fsp.writeFile(path.resolve(artifacts, 'trace.json'), JSON.stringify(trace, null, 2))
    await fsp.writeFile(path.resolve(artifacts, 'server.log'), logs.join(''))
    const unexpectedLocal = diagnostics.localHttpErrors.filter(entry => !(entry.status === 404 && new URL(entry.url).pathname.startsWith('/apps/logs/')))
    assert.deepEqual(unexpectedLocal, [], 'unexpected local 4xx/5xx during published-app flow')
    return { trace, artifacts, temporaryHome: home.root, browserVersion: browser.version() }
  } catch (error) {
    if (page) await page.screenshot({ path: path.resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
    await fsp.writeFile(path.resolve(artifacts, 'trace.json'), JSON.stringify(trace, null, 2)).catch(() => {})
    await fsp.writeFile(path.resolve(artifacts, 'server.log'), logs.join('')).catch(() => {})
    await fsp.writeFile(path.resolve(artifacts, 'failure.txt'), error && error.stack ? error.stack : String(error)).catch(() => {})
    error.artifacts = artifacts
    error.temporaryHome = home.root
    throw error
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    await stopChild(child)
  }
}

function normalize(value, trace, parity = false) {
  if (Array.isArray(value)) return value.map(item => normalize(item, trace, parity))
  if (value && typeof value === 'object') {
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      if (['diagnostics', 'runtime_backed'].includes(key)) continue
      next[key] = normalize(item, trace, parity)
    }
    return next
  }
  if (typeof value !== 'string') return value
  let text = value.replace(/\\/g, '/')
  const home = trace.__home.replace(/\\/g, '/')
  const homes = [...new Set([home, canonicalPath(home).replace(/\\/g, '/')])].sort((a, b) => b.length - a.length)
  for (const candidate of homes) {
    text = text.replaceAll(candidate, '<PINOKIO_HOME>')
    text = text.replaceAll(encodeURIComponent(candidate), '<PINOKIO_HOME_ENCODED>')
  }
  if (parity && trace.layout === 'nested') {
    text = text.replaceAll(`/api/${appId}/pinokio/`, `/api/${appId}/`)
    text = text.replaceAll(`/asset/api/${appId}/pinokio/`, `/asset/api/${appId}/`)
    text = text.replaceAll(`api/${appId}/pinokio/`, `api/${appId}/`)
    text = text.replaceAll(`/api/${appId}/pinokio`, `/api/${appId}`)
    text = text.replaceAll(`api/${appId}/pinokio`, `api/${appId}`)
    text = text.replace(/^pinokio\//, '')
  }
  return text
}

function comparable(trace, parity = false) {
  const copy = JSON.parse(JSON.stringify(trace))
  delete copy.__home
  delete copy.build
  if (parity) {
    delete copy.layout
    delete copy.nestedChildRegression
    copy.ai = {
      status: copy.ai.status,
      linksOk: copy.ai.links.every(link => link.status === 200),
      workspace: copy.ai.links.some(link => link.body.includes('WORKSPACEAISENTINEL')),
      launcher: copy.ai.links.some(link => link.body.includes('LAUNCHERAISENTINEL'))
    }
    const excludeSummary = value => String(value || '').split(/\r?\n/)
      .map(line => line.replace(/^\/pinokio\//, '').replace(/^\//, ''))
      .filter(Boolean)
      .sort()
    copy.gitExclude = excludeSummary(copy.gitExclude)
    copy.inheritanceGitExclude = excludeSummary(copy.inheritanceGitExclude)
  }
  return normalize(copy, trace, parity)
}

function comparableRuntime(trace, parity = false) {
  return normalize(trace.runtime_backed, trace, parity)
}

function assertCurrentSemantics(trace, layout) {
  const prefix = layout === 'nested' ? 'pinokio/' : ''
  assert.equal(trace.home.status, 200)
  assert.equal(trace.app.status, 200)
  assert.equal(trace.envPage.status, 200)
  assert.equal(trace.envPost, 200)
  assert.equal(trace.startRunning, true)
  assert.equal(trace.menuStopWorked, true)
  assert.equal(trace.shortcutStartRunning, true)
  assert.equal(trace.shortcutStopWorked, true)
  assert.equal(JSON.parse(trace.shortcutAction).uri, `~/api/${appId}/${prefix}start.js`)
  assert.equal(trace.status.value.install_script, `${prefix}install.js`)
  assert.equal(trace.status.value.start_script, `${prefix}start.js`)
  assert.equal(trace.status.value.default_script, `${prefix}start.js`)
  assert.equal(trace.runCwd.replace(/\\/g, '/').endsWith(`/api/${appId}/${prefix}`.replace(/\/$/, '')), true)
  assert.equal(trace.env.launcher.includes('REQUIRED_VALUE=saved-through-browser'), true)
  assert.equal(trace.env.other, null)
  assert.equal(trace.envAfterActions.includes('ACTION_VALUE=set-by-action'), true)
  assert.equal(trace.envAfterActions.includes('SWITCH_VALUE=two'), true)
  assert.equal(trace.inheritance.launcher.includes('INHERITANCE_UNIQUE_SENTINEL=yes'), true)
  assert.equal(trace.inheritance.other, null)
  assert.equal(trace.iconBefore.status, 200)
  assert.equal(trace.iconUpload.status, 200)
  assert.equal(trace.uploadedIcon.launcher, true)
  assert.equal(trace.uploadedIcon.other, false)
  assert.equal(trace.iconAfter.status, 200)
  assert.deepEqual(trace.preSecond.items, trace.preFirst.items)
  assert.equal(trace.search.WORKSPACEREADMESENTINEL.files.includes('README.md'), true)
  assert.equal(trace.search.LAUNCHERREADMESENTINEL.files.includes(`${prefix}README.md`), true)
  assert.equal(trace.search.SCRIPTSEARCHSENTINEL.files.includes(`${prefix}start.js`), true)
  assert.equal(trace.ai.links.some(link => link.href === `/_api/${appId}/CLAUDE.md` && link.body.includes('WORKSPACEAISENTINEL')), true)
  assert.equal(trace.ai.links.some(link => link.href === `/_api/${appId}/${prefix}CLAUDE.md` && link.body.includes('LAUNCHERAISENTINEL')), true)
  assert.equal(trace.currentLog.status, 200)
  assert.equal(trace.currentLog.text.includes(currentSentinel), true)
  assert.equal(trace.logTree.status, 200)
  assert.equal(trace.report.status, 200)
  assert.equal(trace.report.hasHistorical, true)
  assert.equal(trace.report.hasCurrent, false)
  assert.equal(trace.draft.status, 200)
  assert.equal(trace.registryDraft.length, 1)
  assert.equal(trace.registryDraft[0].hasHistorical, true)
  assert.equal(trace.registryDraft[0].hasCurrent, false)
  assert.deepEqual(trace.adversarial.rootWithFolder.markers, ['Root With Folder'])
  assert.equal(trace.adversarial.rootWithFolder.logViewer.status, 200)
  assert.equal(trace.adversarial.rootWithFolder.logViewer.hasRootSentinel, true)
  assert.equal(trace.adversarial.rootWithFolder.logViewer.hasNestedSentinel, false)
  assert.equal(trace.adversarial.rootWithFolder.getHelp.status, 200)
  assert.equal(trace.adversarial.rootWithFolder.getHelp.hasRootSentinel, false)
  assert.equal(trace.adversarial.rootWithFolder.getHelp.hasNestedSentinel, true)
  assert.deepEqual(trace.adversarial.bothLaunchers.markers, ['Root Winner'])
  assert.equal(trace.adversarial.bothLaunchers.menu.some(item => item.text.includes('Root winner start')), true)
  assert.equal(trace.adversarial.bothLaunchers.menu.some(item => item.text.includes('Nested loser start')), false)
  assert.equal(trace.adversarial.brokenRoot.navigation.status, 422)
  assert.equal(trace.adversarial.brokenRoot.sidebarNavigation.status, 200)
  assert.equal(trace.adversarial.brokenRoot.sidebarMenu.some(item => item.text.includes('Fallback fs')), true)
  assert.equal(trace.adversarial.brokenRoot.sidebarMenu.some(item => item.text.includes('Fallback command')), true)
  assert.deepEqual(trace.adversarial.appNamedPinokio.markers, ['App Named Pinokio'])
  if (trace.runtime_backed.status === 'EXECUTED') {
    assert.equal(trace.runtime_backed.run_string.clicked, true)
    assert.equal(canonicalPath(trace.runtime_backed.run_string.output), canonicalPath(homePath(trace, `${appId}/${prefix}`)))
    assert.equal(trace.runtime_backed.script_navigation.status, 200)
    assert.equal(trace.runtime_backed.terminal_has_sentinel, true)
    assert.equal(trace.runtime_backed.result.sentinel, runtimeSentinel)
    assert.equal(canonicalPath(trace.runtime_backed.result.cwd), canonicalPath(homePath(trace, `${appId}/${prefix}`)))
    assert.equal(canonicalPath(trace.runtime_backed.result.relative), canonicalPath(homePath(trace, `${appId}/${prefix}something`)))
    assert.equal(trace.runtime_backed.log.status, 200)
    assert.equal(trace.runtime_backed.log.has_sentinel, true)
  }
  if (layout === 'nested') {
    assert.match(trace.gitExclude, /^\/pinokio\/ENVIRONMENT$/m)
    assert.deepEqual(trace.nestedChildRegression, {
      startHref: `/api/${nestedChildId}/pinokio/pinokio/tool.js`,
      stopUri: `~/api/${nestedChildId}/pinokio/pinokio/tool.js`,
      candidates: ['pinokio/pinokio/tool.js'],
      started: true,
      stopped: true
    })
  }
}

function homePath(trace, relative) {
  return path.resolve(trace.__home, 'api', relative)
}

function canonicalPath(value) {
  let current = path.resolve(value)
  const suffix = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    assert.notEqual(parent, current, `cannot canonicalize ${value}`)
    suffix.unshift(path.basename(current))
    current = parent
  }
  return path.resolve(fs.realpathSync.native(current), ...suffix)
}

function stableNestedCompatibility(trace) {
  return {
    home: trace.home.status,
    app: trace.app.status,
    envPage: trace.envPage.status,
    inheritanceSentinel: !!(trace.inheritance.launcher && trace.inheritance.launcher.includes('INHERITANCE_UNIQUE_SENTINEL=yes')),
    reportStatus: trace.report.status,
    reportHistorical: trace.report.hasHistorical,
    reportCurrent: trace.report.hasCurrent,
    draftStatus: trace.draft.status,
    draftHistorical: trace.registryDraft[0] && trace.registryDraft[0].hasHistorical,
    nestedChild: trace.nestedChildRegression && {
      startHref: trace.nestedChildRegression.startHref,
      candidates: trace.nestedChildRegression.candidates,
      started: trace.nestedChildRegression.started
    }
  }
}

function stableLiveRoot(trace) {
  const menu = items => (items || []).map(item => ({ text: item.text, href: item.href, run: item.run, cwd: item.cwd, action: item.action }))
  const status = response => response && ({
    ...response,
    value: response.value && {
      ...response.value,
      default_target: response.value.default_target
        ? path.relative(trace.__home, response.value.default_target).split(path.sep).join('/')
        : response.value.default_target
    }
  })
  return {
    explore: trace.explore,
    downloadName: trace.downloadName,
    clone: trace.clone,
    confirmation: trace.confirmation,
    environmentPost: trace.environmentPost,
    environment: {
      root: trace.environment && trace.environment.root !== null,
      nested: trace.environment && trace.environment.nested !== null
    },
    menuBeforeInstall: menu(trace.menuBeforeInstall),
    menuAfterInstall: menu(trace.menuAfterInstall),
    statusBeforeInstall: status(trace.statusBeforeInstall),
    statusAfterInstall: status(trace.statusAfterInstall),
    install: trace.install,
    start: trace.start && { running: trace.start.running, stopped: trace.start.stopped },
    homeCard: trace.homeCard,
    icon: trace.icon,
    logs: trace.logs && { root: trace.logs.root, installLatest: trace.logs.installLatest, reportStatus: trace.logs.reportStatus },
    filesystem: trace.filesystem
  }
}

function assertLiveNested(trace) {
  assert.equal(trace.expectedReproduction, undefined)
  assert.equal(trace.environmentPost, 200)
  assert.equal(trace.environment.root, null)
  assert.ok(trace.environment.nested)
  assert.equal(trace.statusAfterInstall.status, 200)
  assert.equal(trace.statusAfterInstall.value.install_script, 'pinokio/install.js')
  assert.equal(trace.statusAfterInstall.value.start_script, 'pinokio/start.js')
  assert.equal(trace.install.completed, true)
  assert.equal(trace.start.running, true)
  assert.equal(trace.start.stopped, true)
  assert.equal(trace.icon.status, 200)
  assert.equal(trace.logs.root, `api/${liveControls.nested.folder}/pinokio/logs`)
  assert.equal(trace.logs.installLatest, true)
  assert.equal(trace.logs.reportStatus, 200)
  assert.equal(trace.filesystem.rootEnvironment, false)
  assert.equal(trace.filesystem.nestedEnvironment, true)
  assert.equal(trace.filesystem.installedMarker, true)
  assert.match(trace.filesystem.gitExclude, /^\/pinokio\/ENVIRONMENT$/m)
}

async function materializeCheckout(value, tempRoot) {
  const candidate = path.resolve(String(value || ''))
  if (value && fs.existsSync(path.resolve(candidate, 'package.json'))) return { path: candidate, cleanup: async () => {} }
  const ref = value && value !== true ? String(value) : 'HEAD'
  const checkout = path.resolve(tempRoot, 'baseline-checkout')
  run('git', ['worktree', 'add', '--detach', checkout, ref], { cwd: repoRoot })
  return {
    path: checkout,
    cleanup: async () => {
      try { run('git', ['worktree', 'remove', '--force', checkout], { cwd: repoRoot }) } catch (_) {}
    }
  }
}

function checkoutIdentity(checkout) {
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: checkout })
  const status = run('git', ['status', '--short'], { cwd: checkout })
  const diff = run('git', ['diff', '--binary', 'HEAD'], { cwd: checkout })
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: checkout }).split(/\r?\n/).filter(Boolean)
  const digest = crypto.createHash('sha256').update(`${revision}\n${status}\n${diff}`)
  for (const relative of untracked) {
    digest.update(`\nuntracked:${relative}\n`)
    digest.update(fs.readFileSync(path.resolve(checkout, relative)))
  }
  return { checkout, revision, dirty: !!status, status, untracked, diff_hash: digest.digest('hex') }
}

async function parentMode() {
  const args = parseArgs()
  const playwright = loadPlaywright()
  const executablePath = browserExecutable(playwright)
  assert.ok(executablePath, 'No supported Chromium or Brave executable is available')
  const started = new Date().toISOString().replace(/[:.]/g, '-')
  const artifactsRoot = path.resolve(outputRoot, started)
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinokio-nested-checkouts-'))
  await fsp.mkdir(artifactsRoot, { recursive: true })
  const baseline = await materializeCheckout(args.baseline || args['baseline-ref'] || 'HEAD', tempRoot)
  const current = path.resolve(String(args.current || repoRoot))
  const runtimeActive = args['runtime-active'] || process.env.PINOKIO_ACCEPTANCE_RUNTIME
  const runtimeSnapshot = args['runtime-snapshot'] || process.env.PINOKIO_ACCEPTANCE_RUNTIME_SNAPSHOT
  assert.equal(!!runtimeActive, !!runtimeSnapshot, 'runtime-active and runtime-snapshot must be supplied together')
  const runtimeManager = runtimeActive ? await prepareRuntime({
    active: runtimeActive,
    snapshot: runtimeSnapshot,
    createSnapshot: !!args['create-runtime-snapshot']
  }) : null
  const runtimeManifestHash = runtimeManager
    ? crypto.createHash('sha256').update(JSON.stringify(runtimeManager.manifest)).digest('hex')
    : null
  const evidence = {
    started_at: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    browser: null,
    baseline: checkoutIdentity(baseline.path),
    current: checkoutIdentity(current),
    runtime_backed: runtimeManager ? {
      status: 'RUNNING',
      active: runtimeManager.activeRoot,
      snapshot: runtimeManager.snapshotRoot,
      snapshot_entries: runtimeManager.manifest.length,
      snapshot_manifest_sha256: runtimeManifestHash
    } : 'UNVERIFIED: PINOKIO_ACCEPTANCE_RUNTIME was not supplied; this execution intentionally runs the runtime-free subset only.',
    unverified: {
      runtime_backed_steps: runtimeManager ? null : 'Steps 4, 16, and 23 require a test-owned runtime.',
      tier6_live_explore: args.tier6 || args['tier6-only'] ? null : 'The published-app Explore installation matrix is a separate release test.',
      windows: process.platform === 'win32' ? null : 'This run does not provide Windows execution evidence.'
    }
  }
  evidence.browser = { executable: executablePath, version: null }
  const cases = args['tier6-only'] ? [] : [
    { build: 'baseline', checkout: baseline.path, layout: 'root' },
    { build: 'baseline', checkout: baseline.path, layout: 'nested' },
    { build: 'current', checkout: current, layout: 'root' },
    { build: 'current', checkout: current, layout: 'nested' }
  ]
  const results = {}
  let failed = false
  try {
    for (const item of cases) {
      const key = `${item.build}-${item.layout}`
      process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'running', case: key })}\n`)
      try {
        const runtime = runtimeManager ? await runtimeManager.restore() : null
        const result = await executeCase({ ...item, playwright, executablePath, artifactsRoot, runtime })
        result.trace.__home = result.trace.layout === item.layout ? result.temporaryHome.replace(/\\/g, '/') + '/pinokio-home' : ''
        results[key] = result
        evidence.browser.version ||= result.browserVersion
        process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'collected', case: key, artifacts: result.artifacts })}\n`)
      } catch (error) {
        failed = true
        results[key] = { error: error && error.stack ? error.stack : String(error), artifacts: error.artifacts || null, temporaryHome: error.temporaryHome || null }
        process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'failed', case: key, error: results[key].error, artifacts: results[key].artifacts })}\n`)
        break
      }
    }

    if (!failed && cases.length > 0) {
      const baselineRoot = results['baseline-root'].trace
      const baselineNested = results['baseline-nested'].trace
      const currentRoot = results['current-root'].trace
      const currentNested = results['current-nested'].trace
      assertCurrentSemantics(currentRoot, 'root')
      assertCurrentSemantics(currentNested, 'nested')
      assert.deepEqual(comparable(currentRoot), comparable(baselineRoot), 'strict additivity failed: baseline root and current root traces differ')
      assert.deepEqual(stableNestedCompatibility(currentNested), stableNestedCompatibility(baselineNested), 'existing nested behavior regressed')
      assert.deepEqual(comparable(currentNested, true), comparable(currentRoot, true), 'layout parity failed after translating the nested launcher root')
      if (runtimeManager) {
        assert.deepEqual(comparableRuntime(currentRoot), comparableRuntime(baselineRoot), 'runtime-backed strict additivity failed for the root layout')
        assert.deepEqual(comparableRuntime(currentNested, true), comparableRuntime(currentRoot, true), 'runtime-backed root/nested parity failed')
      }
      evidence.comparisons = {
        strict_additivity: 'PASS',
        existing_nested_behavior: 'PASS',
        current_layout_parity: 'PASS',
        tier4_adversarial: 'PASS',
        runtime_backed: runtimeManager ? 'PASS' : 'UNVERIFIED'
      }
      if (runtimeManager) evidence.runtime_backed.status = 'PASS'
    }
    if (!failed && (args.tier6 || args['tier6-only'])) {
      assert.ok(runtimeManager, 'Tier 6 requires runtime-active and runtime-snapshot')
      const liveCases = [
        { build: 'baseline', checkout: baseline.path, controlName: 'root', control: liveControls.root },
        { build: 'baseline', checkout: baseline.path, controlName: 'nested', control: liveControls.nested },
        { build: 'current', checkout: current, controlName: 'root', control: liveControls.root },
        { build: 'current', checkout: current, controlName: 'nested', control: liveControls.nested }
      ]
      for (const item of liveCases) {
        const key = `live-${item.build}-${item.controlName}`
        process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'running', case: key })}\n`)
        try {
          const runtime = await runtimeManager.restore()
          const result = await executeLiveCase({ ...item, playwright, executablePath, artifactsRoot, runtime })
          result.trace.__home = `${result.temporaryHome.replace(/\\/g, '/')}/pinokio-home`
          results[key] = result
          evidence.browser.version ||= result.browserVersion
          process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'collected', case: key, artifacts: result.artifacts })}\n`)
        } catch (error) {
          failed = true
          results[key] = { error: error && error.stack ? error.stack : String(error), artifacts: error.artifacts || null, temporaryHome: error.temporaryHome || null }
          process.stdout.write(`${resultPrefix}${JSON.stringify({ state: 'failed', case: key, error: results[key].error, artifacts: results[key].artifacts })}\n`)
          break
        }
      }
      if (!failed) {
        const baselineLiveRoot = results['live-baseline-root'].trace
        const baselineLiveNested = results['live-baseline-nested'].trace
        const currentLiveRoot = results['live-current-root'].trace
        const currentLiveNested = results['live-current-nested'].trace
        assert.equal(baselineLiveRoot.clone.commit, currentLiveRoot.clone.commit, 'root control changed commits between baseline and current')
        assert.equal(baselineLiveNested.clone.commit, currentLiveNested.clone.commit, 'nested control changed commits between baseline and current')
        assert.deepEqual(stableLiveRoot(currentLiveRoot), stableLiveRoot(baselineLiveRoot), 'published root-layout behavior changed')
        assert.equal(baselineLiveNested.expectedReproduction, true, 'baseline did not reproduce the published nested environment failure')
        assertLiveNested(currentLiveNested)
        evidence.comparisons ||= {}
        evidence.comparisons.tier6_live_root_additivity = 'PASS'
        evidence.comparisons.tier6_live_nested_reproduction_and_repair = 'PASS'
        evidence.runtime_backed.status = 'PASS'
      }
    }
  } catch (error) {
    failed = true
    evidence.failure = error && error.stack ? error.stack : String(error)
  } finally {
    if (runtimeManager) {
      try {
        await runtimeManager.verifySnapshot()
        evidence.runtime_backed.snapshot_unchanged = true
      } catch (error) {
        failed = true
        evidence.runtime_backed.snapshot_unchanged = false
        evidence.runtime_backed.snapshot_error = error && error.stack ? error.stack : String(error)
      }
    }
    evidence.finished_at = new Date().toISOString()
    evidence.results = Object.fromEntries(Object.entries(results).map(([key, value]) => [key, {
      artifacts: value.artifacts || null,
      error: value.error || null,
      server: value.server || null
    }]))
    await fsp.writeFile(path.resolve(artifactsRoot, 'evidence.json'), JSON.stringify(evidence, null, 2))
    for (const value of Object.values(results)) {
      if (value.temporaryHome) await fsp.rm(value.temporaryHome, { recursive: true, force: true }).catch(() => {})
    }
    await baseline.cleanup()
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
  process.stdout.write(`${resultPrefix}${JSON.stringify({ ok: !failed, artifacts: artifactsRoot, comparisons: evidence.comparisons || null, failure: evidence.failure || null })}\n`)
  if (failed) process.exitCode = 1
}

if (process.argv.includes('--server')) {
  runServerMode().catch(error => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
} else {
  parentMode().catch(error => {
    console.error(error && error.stack ? error.stack : error)
    process.exit(1)
  })
}
