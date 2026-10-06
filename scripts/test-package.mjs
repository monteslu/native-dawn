// Packs the npm tarball, installs it with the release archive into a scratch
// project, and checks it from Node and from a C program built against it.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, assetName, run } from './common.mjs'

run(process.execPath, ['scripts/package-binary.mjs'])
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this through npm run test:package')
function npmRun(args, options = {}) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed (${result.status})`)
  return result
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'native-dawn-consumer-'))
try {
  const packed = npmRun(['pack', '--json', '--pack-destination', temporary], { stdio: 'pipe', encoding: 'utf8' })
  const [metadata] = JSON.parse(packed.stdout)
  const leaked = metadata.files.filter(f => /^(\.cache|node_modules|build|dist|artifacts|test)\//.test(f.path))
  if (leaked.length) throw new Error(`npm package includes ${leaked.map(f => f.path).join(', ')}`)
  await fs.writeFile(path.join(temporary, 'package.json'), '{"name":"native-dawn-consumer","private":true,"type":"module"}\n')
  npmRun(['install', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, metadata.filename)], {
    cwd: temporary,
    env: { ...process.env, NATIVE_DAWN_BINARY: path.join(root, 'artifacts', assetName), NATIVE_DAWN_SKIP_INSTALL: '0', NATIVE_DAWN_BUILD_FROM_SOURCE: '0' },
  })
  await fs.copyFile(path.join(root, 'test/consumer.mjs'), path.join(temporary, 'consumer.mjs'))
  run(process.execPath, ['consumer.mjs'], { cwd: temporary })
  const prefix = spawnSync(process.execPath, [path.join(temporary, 'node_modules/native-dawn/bin/native-dawn.js'), 'prefix'], { encoding: 'utf8' }).stdout.trim()
  run(process.execPath, ['scripts/test-c.mjs', prefix])
  console.log('Packed package passed from Node and from C')
} finally { await fs.rm(temporary, { recursive: true, force: true }) }
