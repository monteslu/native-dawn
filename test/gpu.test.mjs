import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import v8 from 'node:v8'
import vm from 'node:vm'
import { create, globals, deviceHandle, objectHandle, addDeviceFeatures, wasmImports } from '../index.js'
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
    assert.equal(objectHandle(new Proxy(device.queue, {})), undefined, 'a Proxy of a WebGPU object is not one')
    assert.equal(objectHandle(42), undefined)
    device.queue.submit([commands])
    texture.destroy()
  } finally { device.destroy() }
})

test('wasmImports draws through Dawn directly with webgpu.h arguments, and hands what it cannot serve to the glue', async () => {
  const { device } = await setup()
  try {
    const texture = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var<uniform> color: vec4f;
      @vertex fn vs(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0, 1); }
      @fragment fn fs() -> @location(0) vec4f { return color; }` })
    const pipeline = device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } })
    const vertices = device.createBuffer({ size: 24, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(vertices, 0, new Float32Array([-1, -1, 3, -1, -1, 3]))
    const uniform = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform, size: 16 } }] })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })

    // The glue's functions: only reached for what the direct calls cannot serve.
    const glueCalls = []
    const glue = {
      wgpuRenderPassEncoderSetPipeline: (...args) => glueCalls.push(['setPipeline', ...args]),
      wgpuRenderPassEncoderSetBindGroup: (...args) => glueCalls.push(['setBindGroup', ...args]),
      wgpuRenderPassEncoderSetVertexBuffer: (...args) => glueCalls.push(['setVertexBuffer', ...args]),
      wgpuRenderPassEncoderDraw: (...args) => glueCalls.push(['draw', ...args]),
      wgpuQueueWriteBuffer: (...args) => glueCalls.push(['writeBuffer', ...args]),
      notAnImport: () => {},
    }
    const fast = wasmImports(glue)
    assert.deepEqual(Object.keys(fast.imports).sort(), Object.keys(glue).filter(n => n !== 'notAnImport').sort())
    // "wasm memory": the color at 64, a uniform offset (u32) at 128
    const heap = new Uint8Array(1024)
    new Float32Array(heap.buffer, 64, 4).set([0, 1, 0, 1])
    fast.memory(heap)
    const P = { pass: 8, pipeline: 16, group: 24, vertices: 32, uniform: 40, queue: 48 }
    fast.register(P.pass, pass); fast.register(P.pipeline, pipeline); fast.register(P.group, group)
    fast.register(P.vertices, vertices); fast.register(P.uniform, uniform); fast.register(P.queue, device.queue)
    fast.register(56, new Proxy(device.queue, {}))  // not a WebGPU object: nothing registered

    const W = fast.imports
    W.wgpuQueueWriteBuffer(P.queue, P.uniform, 0n, 64, 16)
    W.wgpuRenderPassEncoderSetPipeline(P.pass, P.pipeline)
    W.wgpuRenderPassEncoderSetBindGroup(P.pass, 0, P.group, 0, 0)
    W.wgpuRenderPassEncoderSetVertexBuffer(P.pass, 0, P.vertices, 0n, -1n)  // -1n: WGPU_WHOLE_SIZE
    W.wgpuRenderPassEncoderDraw(P.pass, 3, 1, 0, 0)
    assert.deepEqual(glueCalls, [])
    assert.deepEqual(fast.stats(), { native: 5, fallback: 0, handles: 6 })

    // an object never registered, or memory outside the view: the glue answers
    W.wgpuRenderPassEncoderSetPipeline(P.pass, 999)
    W.wgpuQueueWriteBuffer(P.queue, P.uniform, 0n, 1020, 16)
    fast.forget(P.vertices)
    W.wgpuRenderPassEncoderSetVertexBuffer(P.pass, 0, P.vertices, 0n, 24n)
    assert.deepEqual(glueCalls.map(c => c[0]), ['setPipeline', 'writeBuffer', 'setVertexBuffer'])
    assert.deepEqual(glueCalls[1].slice(1), [P.queue, P.uniform, 0n, 1020, 16], 'the glue gets the call\'s own arguments')
    assert.equal(fast.stats().fallback, 3)

    pass.end()
    device.queue.submit([encoder.finish()])
    const out = await pixels(device, texture)
    for (let i = 0; i < out.length; i += 4) assert.deepEqual([...out.subarray(i, i + 4)], [0, 255, 0, 255])
    texture.destroy(); vertices.destroy(); uniform.destroy()
  } finally { device.destroy() }
})

test('wasmImports lets a program whose glue reaches it be collected, and dispose() drops its objects and memory', async () => {
  // The usual shape: the glue reaches the program, which holds the imports.
  // A strong reference to the glue from native code made that a GC root.
  v8.setFlagsFromString('--expose-gc')
  const gc = vm.runInNewContext('gc')
  let collected = 0
  const registry = new FinalizationRegistry(() => { collected++ })
  const make = (i) => {
    const program = { native: null }
    const glue = { wgpuQueueWriteBuffer: () => program, wgpuRenderPassEncoderDraw: () => program }
    program.native = wasmImports(glue)
    program.native.memory(new Uint8Array(16))
    registry.register(program, i)
  }
  for (let i = 0; i < 4; i++) make(i)
  await new Promise(r => setTimeout(r, 0))
  for (let i = 0; i < 10 && collected < 4; i++) { gc(); await new Promise(r => setTimeout(r, 20)) }
  assert.equal(collected, 4, 'every program was collected')

  const fast = wasmImports({ wgpuQueueWriteBuffer: () => 'glue' })
  fast.register(8, {})
  fast.dispose()
  assert.equal(fast.stats().handles, 0)
  assert.equal(fast.imports.wgpuQueueWriteBuffer(1, 2, 0n, 0, 4), 'glue', 'after dispose() every call goes to the glue')
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
