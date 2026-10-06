import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
export const upstream = JSON.parse(fs.readFileSync(path.join(root, 'upstream.json')))
export const targets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64', 'android-arm64']
// Android is cross-compiled and ships the C SDK only; the rest also get the Node addon.
export const nodeTargets = targets.filter(t => !t.startsWith('android-'))
// NATIVE_DAWN_TARGET selects a cross-compiled target; the default is this machine.
export const target = process.env.NATIVE_DAWN_TARGET || `${process.platform}-${process.arch}`
export const isAndroid = target.startsWith('android-')
export const hasAddon = nodeTargets.includes(target)
export const assetName = `native-dawn-v${pkg.version}-${target}.tar.gz`
export const distDir = path.join(root, 'dist', target)
export const binDir = target.startsWith('win32-') ? 'bin' : 'lib'

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
  return result
}

export function assertTarget() {
  if (!targets.includes(target)) throw new Error(`Unsupported platform ${target}; supported: ${targets.join(', ')}`)
}

export function manifestMatches(manifest) {
  return manifest.version === pkg.version && manifest.target === target && manifest.dawn === upstream.dawn.revision
}
