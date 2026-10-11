// One lifetime case per process, run by lifetime.test.mjs, which also checks
// how the process ends. Prints "CASE-OK" when the case's own checks hold.
import addon, { create } from '../index.js'
import { flags, adapterOptions, pixels, clear, GPUBufferUsage, GPUMapMode, GPUTextureUsage } from './helpers.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function device(gpu) {
  const adapter = await gpu.requestAdapter(adapterOptions())
  if (!adapter) throw new Error('Tests need a WebGPU adapter (a GPU driver or a software one such as lavapipe); nothing is skipped')
  return adapter.requestDevice()
}
async function draw(dev) {
  const texture = dev.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
  clear(dev, texture, [1, 0, 0, 1])
  const px = await pixels(dev, texture)
  if (px[0] !== 255 || px[1] !== 0 || px[3] !== 255) throw new Error(`wrong pixel ${px.slice(0, 4)}`)
}

const cases = {
  // Everything stays reachable and nothing is destroyed. The process must
  // still end by itself.
  async held() {
    globalThis.gpu = create(flags())
    globalThis.device = await device(globalThis.gpu)
  },
  // A device with nothing to do must not keep the event loop spinning.
  async idle() {
    globalThis.gpu = create(flags())
    globalThis.device = await device(globalThis.gpu)
    const before = process.cpuUsage()
    await sleep(2000)
    const used = process.cpuUsage(before)
    const ms = (used.user + used.system) / 1000
    if (ms > 500) throw new Error(`an idle device used ${ms.toFixed(0)}ms of CPU in 2000ms`)
  },
  // The GPU object is collected while its device is still in use.
  async collected() {
    const dev = await device(create(flags()))
    for (let i = 0; i < 6; ++i) { globalThis.gc(); await sleep(20) }
    await draw(dev)
    for (let i = 0; i < 6; ++i) { globalThis.gc(); await sleep(20) }
    await draw(dev)
  },
  // destroy() settles device.lost, with no other work to drive it.
  async destroyed() {
    const dev = await device(create(flags()))
    let info
    dev.lost.then(value => { info = value })
    dev.destroy()
    await sleep(200)
    if (info?.reason !== 'destroyed') throw new Error(`device.lost was not settled as destroyed: ${info?.reason}`)
  },
  // Buffers whose JavaScript wrappers are collected while their mapAsync is
  // still pending: Dawn answers each map at a later poll, after the GPUBuffer
  // behind the wrapper was freed. The callback used to write into it, which
  // corrupted the heap within the first few hundred buffers.
  async mapCollected() {
    const dev = await device(create(flags()))
    for (let i = 0; i < 4000; ++i) {
      dev.createBuffer({ size: 65536, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }).mapAsync(GPUMapMode.READ).catch(() => {})
      if (i % 64 === 63) { globalThis.gc(); await new Promise(resolve => setImmediate(resolve)) }
    }
    for (let i = 0; i < 6; ++i) { globalThis.gc(); await sleep(20) }
    await draw(dev)
    dev.destroy()
  },
  // destroy() while a map is pending rejects the map with an AbortError, and
  // Dawn's own answer for that map, arriving later, is ignored.
  async mapDestroyed() {
    const dev = await device(create(flags()))
    let aborted = 0
    for (let i = 0; i < 4000; ++i) {
      const buffer = dev.createBuffer({ size: 65536, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      buffer.mapAsync(GPUMapMode.READ).catch(e => { if (e.name === 'AbortError') aborted++ })
      buffer.destroy()
      if (i % 64 === 63) { globalThis.gc(); await new Promise(resolve => setImmediate(resolve)) }
    }
    for (let i = 0; i < 6; ++i) { globalThis.gc(); await sleep(20) }
    if (aborted !== 4000) throw new Error(`${aborted} of 4000 maps were rejected with an AbortError`)
    await draw(dev)
    dev.destroy()
  },
  // A device lost the way a driver reset loses it, with nothing else pending:
  // only timers run, so nothing the app does drives a poll.
  async lostWhileIdle() {
    const dev = await device(create(flags()))
    let info
    dev.lost.then(value => { info = value })
    await sleep(100)
    addon._forceDeviceLoss(dev)
    const deadline = Date.now() + 5000
    while (!info && Date.now() < deadline) await sleep(100)
    if (info?.reason !== 'unknown') throw new Error(`device.lost was not settled after a real loss: ${info?.reason}`)
  },
}

await cases[process.argv[2]]()
console.log('CASE-OK')
