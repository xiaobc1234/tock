const { createHash } = require('node:crypto')
const { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { findVendor, installedVendor } = require('../src/paths.cjs')
const lock = require('../package-lock.json')

const root = resolve(__dirname, '..')
const options = process.argv.slice(2)
const targetOption = options.find((option) => option.startsWith('--target='))
const target = targetOption?.slice('--target='.length) ?? `${process.platform}-${process.arch}`
const targets = new Map([
  ['win32-x64', '--win'],
  ['darwin-arm64', '--mac'],
  ['darwin-x64', '--mac'],
])
const platform = targets.get(target)
if (!platform) {
  throw new Error('Unsupported target. Use --target=win32-x64, --target=darwin-arm64, or --target=darwin-x64.')
}
const [os, arch] = target.split('-')

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...extra })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? result.signal}`)
  return result.stdout
}

function downloadVendor(directory) {
  const entry = lock.packages[`node_modules/@openai/codex-${target}`]
  if (!entry?.integrity?.startsWith('sha512-')) throw new Error('The target Codex CLI is missing from the lockfile.')
  const npm = process.env.npm_execpath
  const prefix = npm ? [npm] : []
  const output = run(npm ? process.execPath : 'npm', [...prefix, 'pack', entry.resolved,
    '--ignore-scripts', '--prefer-offline', '--json', '--pack-destination', directory],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  const [{ filename }] = JSON.parse(output)
  const archive = join(directory, filename)
  const checksum = createHash('sha512').update(readFileSync(archive)).digest('base64')
  if (entry.integrity !== `sha512-${checksum}`) throw new Error('The downloaded Codex CLI failed its checksum.')
  run('tar', ['-xzf', archive, '-C', directory, 'package/vendor'])
  const vendor = findVendor(join(directory, 'package', 'vendor'), os)
  if (!vendor) throw new Error('Cannot find the target Codex CLI in its package.')
  return vendor
}

function stageVendor(source) {
  const vendor = join(root, 'vendor')
  rmSync(vendor, { recursive: true, force: true })
  cpSync(source, vendor, { recursive: true })
  for (const file of ['CODEX-LICENSE', 'CODEX-NOTICE']) {
    if (existsSync(join(root, file))) copyFileSync(join(root, file), join(vendor, file))
  }
  if (!existsSync(join(vendor, 'CODEX-LICENSE'))) throw new Error('The bundled Codex CLI requires CODEX-LICENSE.')
}

const directory = mkdtempSync(join(tmpdir(), 'tock-package-'))
try {
  stageVendor(installedVendor(os, arch) ?? downloadVendor(directory))
  run(process.execPath, [
    require.resolve('electron-builder/out/cli/cli.js'), platform, '--' + arch, '--publish', 'never',
    ...options.filter((option) => option !== targetOption),
  ])
} finally {
  rmSync(directory, { recursive: true, force: true })
}
