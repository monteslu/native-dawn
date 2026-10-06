// How a process holding WebGPU objects lives and ends. Each case runs in its
// own process (lifetime-case.mjs), because what is under test is the exit: a
// case passes only if its checks held AND the process then ended by itself,
// with status 0, inside the time limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./lifetime-case.mjs', import.meta.url))
function run(name) {
  const result = spawnSync(process.execPath, ['--expose-gc', script, name], { encoding: 'utf8', timeout: 30000 })
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.error?.code, 'ETIMEDOUT', `the process never exited\n${output}`)
  assert.equal(result.signal, null, `the process died with ${result.signal}\n${output}`)
  assert.match(result.stdout, /CASE-OK/, output)
  assert.equal(result.status, 0, output)
}

test('a process holding a live device exits by itself', () => run('held'))
test('an idle device does not keep the event loop spinning', () => run('idle'))
test('a device outlives a collected GPU object', () => run('collected'))
test('destroy() settles device.lost with nothing else pending', () => run('destroyed'))
test('a device lost while idle settles device.lost', () => run('lostWhileIdle'))
