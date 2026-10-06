import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { c as tar } from 'tar'
import { root, pkg, upstream, distDir, binDir } from '../scripts/common.mjs'

test('installer rejects corrupt and mismatched archives and keeps the working build', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'native-dawn-invalid-'))
  const addon = path.join(distDir, binDir, 'dawn.node')
  const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')
  const before = await hash(addon)
  const archive = path.join(temporary, 'invalid.tar.gz')
  const install = () => spawnSync(process.execPath, ['scripts/install.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NATIVE_DAWN_BINARY: archive, NATIVE_DAWN_SKIP_INSTALL: '0', NATIVE_DAWN_BUILD_FROM_SOURCE: '0' },
  })
  try {
    await fs.writeFile(archive, 'not an archive')
    await fs.writeFile(`${archive}.sha256`, '0'.repeat(64))
    const corrupt = install()
    assert.ifError(corrupt.error)
    assert.equal(corrupt.status, 1)
    assert.match(corrupt.stderr, /checksum mismatch/)

    await fs.writeFile(path.join(temporary, 'build.json'), JSON.stringify({ version: pkg.version, target: 'wrong-target', dawn: upstream.dawn.revision }))
    await tar({ file: archive, cwd: temporary, gzip: true }, ['build.json'])
    await fs.writeFile(`${archive}.sha256`, await hash(archive))
    const mismatched = install()
    assert.ifError(mismatched.error)
    assert.equal(mismatched.status, 1)
    assert.match(mismatched.stderr, /does not match this package/)
    assert.equal(await hash(addon), before)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
})
