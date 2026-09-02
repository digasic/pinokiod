const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Api = require('../kernel/api')
const Env = require('../kernel/api/env')
const Environment = require('../kernel/environment')
const NestedLayout = require('../kernel/nested_layout')
const getLauncherTarget = require('../kernel/api/launcher_target')
const AppLogSessions = require('../kernel/app_log_sessions')
const Server = require('../server')
const ServerAutolaunch = require('../server/autolaunch')
const Socket = require('../server/socket')
const AppLogService = require('../server/lib/app_logs')
const AppLogReportService = require('../server/lib/app_log_report')
const AppRegistryService = require('../server/lib/app_registry')
const AppSearchService = require('../server/lib/app_search')

const exists = target => fs.access(target).then(() => true, () => false)

const kernelFor = home => {
  const loaded = new Map()
  const kernel = {
    homedir: home,
    path: (...parts) => path.resolve(home, ...parts),
    exists,
    status: () => false,
    template: { render: value => value },
    memory: { local: {} },
    loader: { load: async target => ({ resolved: loaded.get(path.resolve(target)) || null }) }
  }
  kernel.api = new Api(kernel)
  kernel.api.userdir = path.resolve(home, 'api')
  kernel.api.exists = exists
  kernel.api.running = {}
  kernel.loaded = loaded
  return kernel
}

const withHome = async callback => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pinokio-nested-parity-'))
  try {
    await callback(home)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
}

const write = async (root, relative, content = '') => {
  const target = path.resolve(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
  return target
}

test('root launcher precedence and environment writes remain unchanged', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const env = new Env()
    const layouts = [
      ['classic', ['pinokio.js']],
      ['root-with-folder', ['pinokio.js', 'pinokio/note.txt']],
      ['both', ['pinokio.js', 'pinokio/pinokio.js']],
      ['empty-folder', ['pinokio/note.txt']],
      ['no-manifest', []]
    ]

    for (const [name, files] of layouts) {
      const workspace = path.resolve(home, 'api', name)
      await fs.mkdir(workspace, { recursive: true })
      for (const file of files) await write(workspace, file)
      await write(workspace, 'ENVIRONMENT')
      assert.equal(await kernel.api.launcher_path(workspace), workspace, name)
      if (files.includes('pinokio.js')) kernel.loaded.set(path.resolve(workspace, 'pinokio.js'), { icon: 'icon.png' })
      const meta = await kernel.api.meta(name)
      if (files.includes('pinokio.js')) {
        assert.equal(meta.icon, `/asset/api/${name}/icon.png`, name)
        assert.equal(meta.iconpath, 'icon.png', name)
      }
      await env.set({ parent: { path: path.resolve(workspace, 'start.js') }, params: { VALUE: name } }, null, kernel)
      assert.match(await fs.readFile(path.resolve(workspace, 'ENVIRONMENT'), 'utf8'), new RegExp(`VALUE=${name}`), name)
    }

    const pinokioEntry = path.resolve(home, 'api', 'pinokio-entry')
    await fs.mkdir(pinokioEntry, { recursive: true })
    await write(pinokioEntry, 'pinokio')
    await write(pinokioEntry, 'ENVIRONMENT')
    assert.equal(await kernel.api.launcher_path(pinokioEntry), pinokioEntry)
    await env.set({ parent: { path: path.resolve(pinokioEntry, 'start.js') }, params: { VALUE: 'file' } }, null, kernel)
    assert.match(await fs.readFile(path.resolve(pinokioEntry, 'ENVIRONMENT'), 'utf8'), /VALUE=file/)
  })
})

test('nested launcher environment, metadata, targets, registry, and search use pinokio/', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const workspace = path.resolve(home, 'api', 'nested')
    const launcher = path.resolve(workspace, 'pinokio')
    const launcherConfig = { title: 'Nested', icon: 'icon.png', menu: [
      { text: 'Start', href: 'start.js', default: true },
      { text: 'Nested child', href: 'pinokio/tool.js' },
      { text: 'Absolute nested', href: '/api/nested/pinokio/absolute.js' },
      { text: 'Absolute workspace', href: '/api/nested/workspace.js' }
    ] }
    await write(workspace, 'README.md', 'workspace documentation')
    await write(launcher, 'README.md', 'launcher documentation')
    await write(launcher, 'pinokio.js', 'nested launcher token')
    await write(launcher, 'install.js', 'nested install token')
    await write(launcher, 'start.js', 'nested start token')
    await write(launcher, 'pinokio/tool.js', 'nested child token')
    await write(launcher, 'absolute.js', 'absolute nested token')
    await write(workspace, 'workspace.js', 'absolute workspace token')
    await write(launcher, 'ENVIRONMENT', 'DATA=./data\nVALUE=old\n')
    kernel.loaded.set(path.resolve(launcher, 'pinokio.js'), launcherConfig)

    assert.equal(await kernel.api.launcher_path(workspace), launcher)
    assert.equal((await Environment.get(workspace, kernel)).DATA, path.resolve(launcher, 'data'))

    await new Env().set({ parent: { path: path.resolve(launcher, 'start.js') }, params: { VALUE: 'nested' } }, null, kernel)
    assert.match(await fs.readFile(path.resolve(launcher, 'ENVIRONMENT'), 'utf8'), /VALUE=nested/)

    const meta = await kernel.api.meta('nested')
    assert.equal(meta.icon, '/asset/api/nested/pinokio/icon.png')
    assert.equal(meta.iconpath, 'pinokio/icon.png')
    assert.equal(await kernel.api.get_default(workspace), path.resolve(launcher, 'start.js'))
    assert.equal((await getLauncherTarget(kernel.api, workspace, ['start.js'])).uri, path.resolve(launcher, 'start.js'))

    const registry = new AppRegistryService({ kernel })
    const status = await registry.buildAppStatus('nested')
    assert.equal(status.install_script, 'pinokio/install.js')
    assert.equal(status.start_script, 'pinokio/start.js')
    assert.equal(status.default_script, 'pinokio/start.js')

    const searchRegistry = {
      listInfoApps: async () => [{ name: 'nested', title: 'Nested', description: '', icon: '' }],
      isPathWithin: registry.isPathWithin.bind(registry)
    }
    const state = await new AppSearchService({ kernel, registry: searchRegistry }).ensureSearchState(true)
    const files = state.docs.map(doc => doc.file)
    assert(files.includes('README.md'))
    assert(files.includes('pinokio/pinokio.js'))
    assert(files.includes('pinokio/install.js'))
    assert(files.includes('pinokio/start.js'))
    assert.equal(files.filter(file => file === 'pinokio/README.md').length, 1)

    const server = Object.assign(Object.create(Server.prototype), { kernel })
    const app = (await kernel.api.listApps()).find(item => item.id === 'nested')
    const candidates = await new ServerAutolaunch(server).buildCandidates(app)
    assert(candidates.menu.some(item => item.script === 'pinokio/start.js'))
    assert(candidates.menu.some(item => item.script === 'pinokio/pinokio/tool.js'))
    assert(candidates.menu.some(item => item.script === 'pinokio/absolute.js'))
    assert(candidates.menu.some(item => item.script === 'workspace.js'))
    assert(candidates.other.some(item => item.script === 'pinokio/install.js'))

    await kernel.api.updateMeta({ icon_dirty: true, icon_path: 'uploaded.png', avatar: Buffer.from('icon') }, 'nested')
    assert.equal(await fs.readFile(path.resolve(launcher, 'uploaded.png'), 'utf8'), 'icon')
    assert.equal(await exists(path.resolve(workspace, 'uploaded.png')), false)
  })
})

test('nested preflight assets and AI documents use pinokio/ without changing root launchers', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const nested = path.resolve(home, 'api', 'nested')
    const nestedRoot = path.resolve(nested, 'pinokio')
    await write(nestedRoot, 'pinokio.js')
    await write(nestedRoot, 'CLAUDE.md')
    await write(nested, 'CLAUDE.md')

    const launcher = {
      root: nested,
      script: { pre: [{ icon: 'icon.png', href: 'setup.js' }, { href: 'https://example.com' }] }
    }
    const adapted = await NestedLayout.preLauncher(kernel, launcher)
    assert.equal(adapted.root, nestedRoot)
    assert.equal(adapted.script.pre[0].icon, 'pinokio/icon.png')
    assert.equal(adapted.script.pre[0].href, path.resolve(nestedRoot, 'setup.js'))
    assert.equal(adapted.script.pre[1].href, 'https://example.com')
    assert.equal(launcher.script.pre[0].icon, 'icon.png')

    const files = await NestedLayout.addAiFiles(kernel, nested, ['AGENTS.md', 'CLAUDE.md'], ['CLAUDE.md'], exists)
    assert.deepEqual(files, ['CLAUDE.md', 'pinokio/CLAUDE.md'])

    const root = path.resolve(home, 'api', 'root')
    await write(root, 'pinokio.js')
    await write(root, 'pinokio/pinokio.js')
    const rootLauncher = { root, script: { pre: [{ icon: 'icon.png', href: 'setup.js' }] } }
    const rootFiles = []
    assert.equal(await NestedLayout.preLauncher(kernel, rootLauncher), rootLauncher)
    assert.equal(await NestedLayout.addAiFiles(kernel, root, ['CLAUDE.md'], rootFiles, exists), rootFiles)
    assert.deepEqual(rootFiles, [])

    const iconpath = { invalid: true }
    const rootMeta = { icon: iconpath, iconpath }
    NestedLayout.setMetaIcon(rootMeta, 'root', root, '', () => true)
    assert.strictEqual(rootMeta.iconpath, iconpath)
  })
})

test('nested menus and shortcuts resolve relative paths from pinokio/', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const workspace = path.resolve(home, 'api', 'nested')
    const launcher = path.resolve(workspace, 'pinokio')
    await write(launcher, 'pinokio.js')
    const checked = []
    kernel.status = target => {
      checked.push(target)
      return false
    }
    const server = Object.assign(Object.create(Server.prototype), { kernel })
    const config = {
      menu: [
        { text: 'Start', href: 'start.js' },
        { text: 'Shell', run: 'echo ready' },
        { text: 'Stop', action: { method: 'stop', uri: 'start.js' } },
        { text: 'Absolute', action: { method: 'stop', uri: path.resolve('/abs', 'stop.js') } },
        { text: 'State', when: 'start.js', off: 'off' }
      ],
      shortcuts: [
        { action: { method: 'stop', uri: 'start.js' } },
        { action: { method: 'stop', uri: path.resolve('/abs', 'stop.js') } }
      ]
    }

    await server.renderMenu({ launcher_root: 'pinokio', $source: {} }, kernel.path('api'), 'nested', config, [])
    assert.equal(config.menu[0].href, '/api/nested/pinokio/start.js')
    assert.equal(config.menu[1].cwd, launcher)
    assert.equal(config.menu[2].action.uri, '~/api/nested/pinokio/start.js')
    assert.equal(config.menu[3].action.uri, '~/api/nested/abs/stop.js')
    assert(checked.includes(path.resolve(launcher, 'start.js')))

    await server.renderShortcuts(kernel.path('api'), 'nested', config, [], 'pinokio')
    assert.equal(config.shortcuts[0].action.uri, '~/api/nested/pinokio/start.js')
    assert.equal(config.shortcuts[1].action.uri, '~/api/nested/abs/stop.js')
  })
})

test('root launcher load fallback keeps its legacy menu paths', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const workspace = path.resolve(home, 'api', 'fallback')
    await write(workspace, 'pinokio.js')
    await write(workspace, 'pinokio/pinokio.js')
    await write(workspace, 'pinokio/start.js')
    await write(workspace, 'pinokio.json')
    kernel.loaded.set(path.resolve(workspace, 'pinokio/pinokio.js'), { menu: [] })
    kernel.loaded.set(path.resolve(workspace, 'pinokio.json'), { menu: [{ href: '/api/fallback/start.js' }] })
    const launcher = await kernel.api.launcher('fallback')
    assert.equal(launcher.launcher_root, 'pinokio')
    assert.equal(await kernel.api.launcher_path(workspace), workspace)

    const checked = []
    kernel.status = target => {
      checked.push(target)
      return false
    }
    const server = Object.assign(Object.create(Server.prototype), { kernel })
    const config = {
      menu: [
        { text: 'Shell', run: 'echo ready' },
        { text: 'Stop', action: { method: 'stop', uri: 'start.js' } },
        { text: 'State', when: 'start.js', off: 'off' }
      ],
      shortcuts: [{ action: { method: 'stop', uri: 'start.js' } }]
    }
    await server.renderMenu({ launcher_root: launcher.launcher_root, $source: {} }, kernel.path('api'), 'fallback', config, [])
    await server.renderShortcuts(kernel.path('api'), 'fallback', config, [], path.relative(workspace, await kernel.api.launcher_path(workspace)))

    assert.equal(config.menu[0].cwd, path.resolve(home, 'api', 'pinokio', 'fallback'))
    assert.equal(config.menu[1].action.uri, '~/api/fallback/start.js')
    assert(checked.includes(path.resolve(workspace, 'start.js')))
    assert.equal(config.shortcuts[0].action.uri, '~/api/fallback/start.js')

    const app = (await kernel.api.listApps()).find(item => item.id === 'fallback')
    const candidates = await new ServerAutolaunch(server).buildCandidates(app)
    assert.equal(app.launcher_root, '')
    assert(candidates.menu.some(item => item.script === 'pinokio/start.js'))
  })
})

test('nested logs use launcher-relative paths in storage, display, and reports', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const workspace = path.resolve(home, 'api', 'nested')
    const launcher = path.resolve(workspace, 'pinokio')
    const script = await write(launcher, 'start.js')
    await write(launcher, 'pinokio.js')

    const socket = Object.assign(Object.create(Socket.prototype), { parent: { kernel } })
    const logDir = await socket.resolveLogDir(script)
    assert.equal(logDir, path.resolve(launcher, 'logs', 'api', 'start.js'))
    const logFile = await write(logDir, 'latest', 'nested live content\n')
    const sessionLog = await write(logDir, '123', 'nested report content\n')

    const sessions = new AppLogSessions({ kernel, randomHex: () => 'nested' })
    const run = await sessions.startRun({ path: script })
    assert.equal(run.appRoot, launcher)
    assert.equal(run.script, 'start.js')
    await sessions.recordLogFile({ scriptPath: run.scriptPath, logFile: sessionLog, run })

    const registry = new AppRegistryService({ kernel })
    const selected = await new AppLogService({ registry }).resolveAppLogFile(workspace, '', ['pinokio/start.js'])
    assert.equal(selected.script, 'start.js')
    assert.equal(selected.file, logFile)

    const server = Object.assign(Object.create(Server.prototype), { kernel })
    assert.equal((await server.resolveLogsRoot({ workspace: 'nested' })).logsRoot, path.resolve(launcher, 'logs'))

    const report = await new AppLogReportService({ registry, kernel }).buildReport({ appId: 'nested', status: { path: workspace, title: 'Nested' } })
    assert.equal(report.sections[0].script, 'start.js')
    assert.match(report.markdown, /nested report content/)
  })
})

test('nested environment initialization adds parent repository excludes without touching root-layout repositories', async () => {
  await withHome(async home => {
    const kernel = kernelFor(home)
    const nested = path.resolve(home, 'api', 'nested')
    const root = path.resolve(home, 'api', 'root')
    await write(nested, 'pinokio/pinokio.js')
    await fs.mkdir(path.resolve(nested, '.git'), { recursive: true })
    await write(root, 'pinokio.js')
    await fs.mkdir(path.resolve(root, 'pinokio'), { recursive: true })
    await fs.mkdir(path.resolve(root, '.git', 'info'), { recursive: true })
    await write(root, '.git/info/exclude', 'existing\n')

    await Environment.init({ name: 'nested' }, kernel)
    assert.match(await fs.readFile(path.resolve(nested, '.git', 'info', 'exclude'), 'utf8'), /^\/pinokio\/ENVIRONMENT$/m)

    await Environment.init({ name: 'root' }, kernel)
    assert.equal(await fs.readFile(path.resolve(root, '.git', 'info', 'exclude'), 'utf8'), 'existing\n')

    const worktree = path.resolve(home, 'api', 'worktree')
    await write(worktree, 'pinokio/pinokio.js')
    await write(worktree, '.git', 'gitdir: /tmp/example\n')
    await Environment.init({ name: 'worktree' }, kernel)
    assert.equal(await fs.readFile(path.resolve(worktree, '.git'), 'utf8'), 'gitdir: /tmp/example\n')
  })
})
