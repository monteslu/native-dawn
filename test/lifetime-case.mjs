// One lifetime case per process, run by lifetime.test.mjs, which also checks
// how the process ends. Prints "CASE-OK" when the case's own checks hold.
import { create } from '../index.js'
import { flags, adapterOptions, pixels, clear, GPUTextureUsage } from './helpers.mjs'

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
}

await cases[process.argv[2]]()
console.log('CASE-OK')
