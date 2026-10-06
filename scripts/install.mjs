import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { x as extract } from 'tar'
import { root, target, pkg, assetName, distDir, binDir, nodeTargets, hasAddon, manifestMatches, run } from './common.mjs'

const addon = dir => path.join(dir, binDir, 'dawn.node')

export async function install() {
  if (process.env.NATIVE_DAWN_SKIP_INSTALL === '1') return
  if (!hasAddon) throw new Error(`No Node build for ${target}; supported: ${nodeTargets.join(', ')}. Android SDK archives are on the GitHub releases.`)
  if (process.env.NATIVE_DAWN_BUILD_FROM_SOURCE === '1') {
    run(process.execPath, [path.join(root, 'scripts/build.mjs')])
    return
  }
  if (!process.env.NATIVE_DAWN_BINARY) {
    try {
      if (manifestMatches(JSON.parse(await fs.readFile(path.join(distDir, 'build.json'))))) {
        createRequire(import.meta.url)(addon(distDir))
        return
      }
    } catch { /* No usable local build; install the release archive. */ }
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'native-dawn-install-'))
  try {
    let archive, checksum
    if (process.env.NATIVE_DAWN_BINARY) {
      const file = path.resolve(process.env.NATIVE_DAWN_BINARY)
      archive = await fs.readFile(file)
      checksum = await fs.readFile(`${file}.sha256`, 'utf8')
    } else {
      const base = `https://github.com/monteslu/native-dawn/releases/download/v${pkg.version}`
      const responses = await Promise.all([
        fetch(`${base}/${assetName}`, { signal: AbortSignal.timeout(300000) }),
        fetch(`${base}/${assetName}.sha256`, { signal: AbortSignal.timeout(60000) }),
      ])
      for (const response of responses) if (!response.ok) throw new Error(`Release download failed: HTTP ${response.status} ${response.url}`)
      archive = Buffer.from(await responses[0].arrayBuffer())
      checksum = await responses[1].text()
    }
    const expected = checksum.trim().split(/\s+/)[0]
    const actual = createHash('sha256').update(archive).digest('hex')
    if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) throw new Error('Native archive checksum mismatch')
    const file = path.join(temporary, 'binary.tar.gz')
    const staging = path.join(temporary, 'unpacked')
    await fs.mkdir(staging)
    await fs.writeFile(file, archive)
    await extract({
      file, cwd: staging, strict: true, preservePaths: false,
      filter: (name, entry) => {
        if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || !['File', 'Directory', 'SymbolicLink'].includes(entry.type)) throw new Error(`Invalid native archive entry: ${name}`)
        if (entry.type === 'SymbolicLink' && (path.isAbsolute(entry.linkpath) || entry.linkpath.split(/[\\/]/).includes('..'))) throw new Error(`Invalid native archive link: ${name}`)
        return true
      },
    })
    if (!manifestMatches(JSON.parse(await fs.readFile(path.join(staging, 'build.json'))))) {
      throw new Error('Native archive does not match this package version, platform, or Dawn revision')
    }
    await fs.access(addon(staging))
    await fs.rm(distDir, { recursive: true, force: true })
    await fs.mkdir(path.dirname(distDir), { recursive: true })
    await fs.cp(staging, distDir, { recursive: true, verbatimSymlinks: true })
    createRequire(import.meta.url)(addon(distDir))
    console.log(`Installed native-dawn for ${target}`)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

try {
  await install()
} catch (error) {
  console.error(`native-dawn: ${error.message}\nTo build from source instead, install the toolchain in README.md and set NATIVE_DAWN_BUILD_FROM_SOURCE=1.`)
  process.exitCode = 1
}
