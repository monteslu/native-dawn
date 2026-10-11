import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { create, globals, deviceHandle, objectHandle, addDeviceFeatures } from '../index.js'
import { setup, flags, adapterOptions, compute, pixels, clear, GPUBufferUsage, GPUMapMode, GPUTextureUsage } from './helpers.mjs'

test('compute dispatch, async pipeline creation and mapped readback', async () => {
  const { device } = await setup()
  try { assert.deepEqual(await compute(device, [0, 1, 7, 123, 65535]), [0, 2, 14, 246, 131070]) }
  finally { device.destroy() }
})

test('writes through mappedAtCreation reach the GPU; unmap detaches the ArrayBuffer', async () => {
  const { device } = await setup()
  try {
    const src = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC, mappedAtCreation: true })
    const range = src.getMappedRange()
    new Uint32Array(range).set([9, 8, 7, 6])
    src.unmap()
    assert.equal(range.byteLength, 0)
    const dst = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    const encoder = device.createCommandEncoder()
    encoder.copyBufferToBuffer(src, 0, dst, 0, 16)
    device.queue.submit([encoder.finish()])
    await dst.mapAsync(GPUMapMode.READ)
    assert.deepEqual([...new Uint32Array(dst.getMappedRange())], [9, 8, 7, 6])
    dst.destroy(); src.destroy()
  } finally { device.destroy() }
})

test('shader diagnostics and validation error scopes', async () => {
  const { device } = await setup()
  try {
    device.pushErrorScope('validation')
    const shader = device.createShaderModule({ code: 'this is not WGSL' })
    const info = await shader.getCompilationInfo()
    assert.ok(info.messages.some(m => m.type === 'error'))
    assert.ok(await device.popErrorScope() instanceof globals.GPUValidationError)
    device.pushErrorScope('validation')
    device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.STORAGE }).destroy()
    assert.ok(await device.popErrorScope() instanceof globals.GPUValidationError)
    device.pushErrorScope('validation')
    assert.equal(await device.popErrorScope(), null)
  } finally { device.destroy() }
})

test('render pipeline draws a triangle into a texture', async () => {
  const { device } = await setup()
  try {
    const texture = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const module = device.createShaderModule({ code: `
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(1, -1), vec2f(0, 1));
        return vec4f(p[i], 0, 1);
      }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(0, 0, 1, 1); }` })
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipeline); pass.draw(3); pass.end()
    device.queue.submit([encoder.finish()])
    const rgba = await pixels(device, texture)
    const at = (x, y) => [...rgba.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
    assert.deepEqual(at(32, 32), [0, 0, 255, 255])
    assert.deepEqual(at(0, 0), [0, 0, 0, 255])
    clear(device, texture, [1, 0, 0, 1])
    assert.deepEqual([...(await pixels(device, texture)).slice(0, 4)], [255, 0, 0, 255])
    texture.destroy()
  } finally { device.destroy() }
})

test('deviceHandle exposes the WGPUDevice pointer and rejects other objects', async () => {
  const { device } = await setup()
  try {
    const handle = deviceHandle(device)
    assert.equal(typeof handle, 'bigint')
    assert.notEqual(handle, 0n)
    assert.equal(deviceHandle(device), handle)
    assert.throws(() => deviceHandle({}), /GPUDevice/)
    assert.throws(() => deviceHandle(device.queue), /GPUDevice/)
  } finally { device.destroy() }
})

test('objectHandle gives the native handle of every kind of WebGPU object, and undefined otherwise', async () => {
  const { device } = await setup()
  try {
    const texture = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: globals.GPUTextureUsage.RENDER_ATTACHMENT })
    const view = texture.createView()
    const buffer = device.createBuffer({ size: 16, usage: globals.GPUBufferUsage.UNIFORM })
    const sampler = device.createSampler()
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] })
    const objects = { texture, view, buffer, sampler, encoder, pass, queue: device.queue }
    const handles = {}
    for (const [name, object] of Object.entries(objects)) {
      handles[name] = objectHandle(object)
      assert.equal(typeof handles[name], 'bigint', name)
      assert.notEqual(handles[name], 0n, name)
      assert.equal(objectHandle(object), handles[name], `${name}: the same handle every time`)
    }
    assert.equal(new Set(Object.values(handles)).size, Object.keys(handles).length, 'distinct objects, distinct handles')
    pass.end()
    const commands = encoder.finish()
    assert.equal(typeof objectHandle(commands), 'bigint')
    assert.equal(objectHandle(device), deviceHandle(device))
    assert.equal(objectHandle({}), undefined)
    assert.equal(objectHandle(42), undefined)
    device.queue.submit([commands])
    texture.destroy()
  } finally { device.destroy() }
})

test('addDeviceFeatures adds the Dawn features the adapter has to the next requestDevice', async () => {
  const adapter = await create(flags()).requestAdapter(adapterOptions())
  assert.equal(typeof objectHandle(adapter), 'bigint', 'an adapter has a handle too')
  const added = addDeviceFeatures(adapter, ['SharedTextureMemoryOpaqueFD', 'SharedFenceVkSemaphoreOpaqueFD', 'SharedTextureMemoryIOSurface'])
  assert.ok(Array.isArray(added))
  for (const name of added) assert.ok(['SharedTextureMemoryOpaqueFD', 'SharedFenceVkSemaphoreOpaqueFD', 'SharedTextureMemoryIOSurface'].includes(name))
  const device = await adapter.requestDevice()
  device.destroy()
  assert.throws(() => addDeviceFeatures(adapter, ['NoSuchFeature']), /Unknown Dawn feature/)
  assert.throws(() => addDeviceFeatures({}, []), /GPUAdapter/)
})

test('the adapter-id flag picks the adapter with those PCI ids, and none for ids no GPU has', async () => {
  await assert.rejects(create([...flags(), 'adapter-id=ffff:ffff']).requestAdapter(adapterOptions()), /no adapter|no suitable/)
  // Linux lists the GPUs' PCI ids in sysfs: asking for each one gives an
  // adapter, and one of them is the default adapter
  if (process.platform !== 'linux' || process.env.NATIVE_DAWN_TEST_FALLBACK === '1') return
  const adapter = await create(flags()).requestAdapter(adapterOptions())
  const ids = new Set()
  for (const node of fs.readdirSync('/sys/class/drm').filter((n) => /^renderD\d+$/.test(n))) {
    const read = (f) => fs.readFileSync(`/sys/class/drm/${node}/device/${f}`, 'utf8').trim().replace(/^0x/, '')
    try { ids.add(`${read('vendor')}:${read('device')}`) } catch { /* not a PCI device */ }
  }
  const names = []
  for (const id of ids) {
    const a = await create([...flags(), `adapter-id=${id}`]).requestAdapter(adapterOptions()).catch(() => null)
    if (a) names.push(a.info.device)
  }
  if (!ids.size || adapter.info.isFallbackAdapter) return // a software adapter: no PCI GPU behind it
  assert.ok(names.includes(adapter.info.device), `the default adapter (${adapter.info.device}) is one of ${[...ids].join(', ')}: ${names.join(', ')}`)
})
