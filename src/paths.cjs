const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

function executableName(platform) {
  return platform === 'win32' ? 'codex.exe' : 'codex'
}

function findVendor(root, platform) {
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root)) {
    const vendor = join(root, entry)
    if (existsSync(join(vendor, 'bin', executableName(platform)))) return vendor
  }
  return null
}

function installedVendor(platform = process.platform, architecture = process.arch) {
  const cliPackage = '@openai/codex-' + platform + '-' + architecture
  const dependencies = join(__dirname, '..', 'node_modules')
  const flat = join(dependencies, cliPackage, 'vendor')
  const nested = join(dependencies, '@openai/codex/node_modules', cliPackage, 'vendor')
  return findVendor(flat, platform) ?? findVendor(nested, platform)
}

function locateCodex(resources) {
  const vendor = resources ? join(resources, 'codex') : installedVendor()
  const bin = vendor ? join(vendor, 'bin', executableName(process.platform)) : null
  return bin && existsSync(bin) ? bin : null
}

module.exports = { findVendor, installedVendor, locateCodex }
