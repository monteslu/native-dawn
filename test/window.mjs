// Presents to a real @kmamal/sdl window. Needs a display: run under xvfb-run
// on headless Linux.
import assert from 'node:assert/strict'
import sdl from '@kmamal/sdl'
import { NativeSurface } from '../index.js'
import { setup, pixels, clear, GPUTextureUsage } from './helpers.mjs'

const driver = sdl.info.drivers.video.current
const window = sdl.video.createWindow({ title: 'native-dawn window test', width: 96, height: 64, webgpu: true, resizable: true })
const { gpu, device } = await setup()
let surface
try {
  surface = new NativeSurface(device, window.native.gpu, driver)
  const format = gpu.getPreferredCanvasFormat()
  // Returns the width it configured. On a scaled display SDL can update
  // pixelWidth after a DPI event, so later reads of the window may differ.
  const configure = () => {
    const width = window.pixelWidth, height = window.pixelHeight
    surface.configure({ width, height, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, alphaMode: 'opaque', presentMode: 'fifo' })
    return width
  }
  let width = configure()
  for (const color of [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]]) {
    const texture = surface.getCurrentTexture()
    assert.equal(texture.width, width)
    clear(device, texture, color)
    assert.deepEqual([...(await pixels(device, texture)).slice(0, 4)], color.map(c => c * 255))
    surface.present()
  }
  window.setSize(48, 32)
  width = configure()
  const texture = surface.getCurrentTexture()
  assert.equal(texture.width, width)
  clear(device, texture, [1, 1, 0, 1])
  surface.present()
  assert.throws(() => surface.configure({ width: 8, height: 8, format: 'r8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT }), /unsupported/)
  surface.destroy()
  assert.throws(() => surface.getCurrentTexture(), /destroyed/)
  console.log(`SDL ${driver} window: configure, present, readback and resize passed`)
} finally {
  surface?.destroy()
  device.destroy()
  window.destroy()
}
