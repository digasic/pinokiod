const fs = require('fs')
const path = require('path')

const samePath = (left, right) => path.resolve(left) === path.resolve(right)

const launcherPath = async (kernel, workspace) => {
  if (!kernel.api || typeof kernel.api.launcher_path !== 'function') return workspace
  return kernel.api.launcher_path(workspace)
}

const relativeRoot = async (kernel, workspace) => path.relative(workspace, await launcherPath(kernel, workspace))

const menuRoot = async (kernel, workspace, legacyRoot) => {
  if (!legacyRoot) return ''
  return samePath(await launcherPath(kernel, workspace), path.resolve(workspace, legacyRoot)) ? legacyRoot : ''
}

const environmentPath = async (kernel, homedir, value, root) => {
  const base = root.relpath ? await launcherPath(kernel, homedir) : homedir
  return path.resolve(base, value)
}

const sessionScript = async (sessions, apiRoot, appRoot, scriptPath, fallback) => {
  const workspace = path.resolve(apiRoot, path.relative(apiRoot, scriptPath).split(path.sep)[0])
  if (samePath(appRoot, workspace)) return fallback
  const root = await launcherPath(sessions.kernel, workspace)
  return sessions.isPathWithin(root, scriptPath) ? path.relative(root, scriptPath) : fallback
}

const logScript = async (kernel, scriptPath, relativeParts) => {
  const fallback = relativeParts.slice(2)
  if (relativeParts[2] !== 'pinokio') return fallback
  const root = await launcherPath(kernel, kernel.path(...relativeParts.slice(0, 2)))
  const relative = path.relative(root, scriptPath)
  return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? fallback : relative.split(path.sep).filter(Boolean)
}

const appLogValues = async (registry, appRoot, scriptQuery, runtimeScripts) => {
  const root = await launcherPath(registry.kernel || {}, appRoot)
  if (samePath(root, appRoot)) return { appRoot, scriptQuery, runtimeScripts }
  const strip = value => typeof value === 'string' ? value.replace(/^pinokio[\\/]/, '') : value
  return { appRoot: root, scriptQuery: strip(scriptQuery), runtimeScripts: runtimeScripts.map(strip) }
}

const appScripts = async (registry, appRoot) => {
  const root = await launcherPath(registry.kernel, appRoot)
  const prefix = path.relative(appRoot, root).split(path.sep).join('/')
  const candidates = files => files.map(file => path.posix.join(prefix, file))
  return {
    installScript: await registry.firstExistingScript(appRoot, candidates(['install.js', 'install.json'])),
    startScript: await registry.firstExistingScript(appRoot, candidates(['start.js', 'start.json']))
  }
}

const addSearchCandidates = async (search, appRoot, candidates) => {
  const root = await launcherPath(search.kernel, appRoot)
  if (samePath(root, appRoot)) return
  const prefix = path.relative(appRoot, root).split(path.sep).join('/')
  const seen = new Set(candidates.map(candidate => candidate.relativePath))
  for (const candidate of await search.collectAppSearchCandidates(root)) {
    const relativePath = `${prefix}/${candidate.relativePath}`
    if (!seen.has(relativePath)) candidates.push({ ...candidate, relativePath })
  }
}

const setMetaIcon = (meta, apiName, apiRoot, relpath, isWithinApiRoot) => {
  const prefix = relpath.split(path.sep).join('/') === 'pinokio' && isWithinApiRoot(apiRoot) ? 'pinokio/' : ''
  meta.icon = meta.icon ? `/asset/api/${apiName}/${prefix}${meta.icon}` : '/pinokio-black.png'
  if (prefix && meta.iconpath) meta.iconpath = `${prefix}${meta.iconpath}`
}

const preLauncher = async (kernel, launcher) => {
  const root = await launcherPath(kernel, launcher.root)
  if (samePath(root, launcher.root) || !launcher.script || !Array.isArray(launcher.script.pre)) return launcher
  const prefix = path.relative(launcher.root, root).split(path.sep).join('/')
  const pre = launcher.script.pre.map(item => {
    if (!item || typeof item !== 'object') return item
    const copy = { ...item }
    if (typeof copy.icon === 'string' && copy.icon) copy.icon = `${prefix}/${copy.icon}`
    if (typeof copy.href === 'string' && copy.href && !copy.href.startsWith('http')) copy.href = path.resolve(root, copy.href)
    return copy
  })
  return { ...launcher, root, script: { ...launcher.script, pre } }
}

const addAiFiles = async (kernel, workspace, filenames, files, exists) => {
  const root = await launcherPath(kernel, workspace)
  if (samePath(root, workspace)) return files
  for (const filename of filenames) {
    const candidate = path.resolve(root, filename)
    const relative = path.relative(workspace, candidate).split(path.sep).join('/')
    if (!files.includes(relative) && await exists(candidate)) files.push(relative)
  }
  return files
}

// Keep in sync with the legacy list in Environment.init.
const excludeEntries = [
  'ENVIRONMENT', '/.pinokio-temp', '/logs', '/cache', '/AGENTS.md',
  '/CLAUDE.md', '/GEMINI.md', '/QWEN.md', '/.geminiignore',
  '.clinerules', '.cursorrules', '.windsurfrules'
]

const ensureGitExclude = async (root, relpath, kernel) => {
  if (!relpath || !samePath(await launcherPath(kernel, path.dirname(root)), root)) return
  const workspace = path.dirname(root)
  const gitDir = path.resolve(workspace, '.git')
  try {
    if (!(await fs.promises.stat(gitDir)).isDirectory()) return
    const excludePath = path.resolve(gitDir, 'info', 'exclude')
    let content = ''
    try {
      content = await fs.promises.readFile(excludePath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') return
    }
    const existing = new Set(content.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
    const prefix = path.relative(workspace, root).split(path.sep).join('/')
    const missing = excludeEntries.map(entry => `/${prefix}/${entry.replace(/^\//, '')}`).filter(entry => !existing.has(entry))
    if (!missing.length) return
    await fs.promises.mkdir(path.dirname(excludePath), { recursive: true })
    await fs.promises.appendFile(excludePath, `${content && !content.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
  } catch (_) {
  }
}

module.exports = {
  addAiFiles,
  addSearchCandidates,
  appLogValues,
  appScripts,
  ensureGitExclude,
  environmentPath,
  logScript,
  menuRoot,
  preLauncher,
  relativeRoot,
  sessionScript,
  setMetaIcon
}
