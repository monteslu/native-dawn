// Runs inside a scratch project that installed the packed npm tarball.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { create, globals, paths } from 'native-dawn'

for (const file of [paths.library, paths.addon, paths.dawnJson, `${paths.include}/webgpu/webgpu.h`, `${paths.include}/native_dawn/window.h`]) {
  assert.ok(fs.existsSync(file), `missing ${file}`)
}
const backend = process.env.NATIVE_DAWN_TEST_BACKEND
const gpu = create(backend ? [`backend=${backend}`] : [])
const adapter = await gpu.requestAdapter(process.env.NATIVE_DAWN_TEST_FALLBACK === '1' ? { forceFallbackAdapter: true } : {})
assert.ok(adapter, 'no WebGPU adapter')
const device = await adapter.requestDevice()
try {
  const buffer = device.createBuffer({ size: 4, usage: globals.GPUBufferUsage.COPY_DST | globals.GPUBufferUsage.MAP_READ })
  device.queue.writeBuffer(buffer, 0, new Uint32Array([0x12345678]))
  await buffer.mapAsync(globals.GPUMapMode.READ)
  assert.equal(new Uint32Array(buffer.getMappedRange())[0], 0x12345678)
  buffer.destroy()
  console.log('Installed package: Node readback passed')
} finally { device.destroy() }
