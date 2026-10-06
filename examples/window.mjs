// An animated clear color in an SDL window. Needs @kmamal/sdl.
import sdl from '@kmamal/sdl'
import { create, NativeSurface, globals } from 'native-dawn'

const window = sdl.video.createWindow({ title: 'native-dawn', width: 640, height: 480, webgpu: true, resizable: true })
const gpu = create([])
const adapter = await gpu.requestAdapter()
const device = await adapter.requestDevice()
const surface = new NativeSurface(device, window.native.gpu, sdl.info.drivers.video.current)
const configure = () => surface.configure({
  width: window.pixelWidth,
  height: window.pixelHeight,
  format: gpu.getPreferredCanvasFormat(),
  usage: globals.GPUTextureUsage.RENDER_ATTACHMENT,
})
configure()
window.on('resize', configure)

const timer = setInterval(() => {
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{
    view: surface.getCurrentTexture().createView(),
    clearValue: [0.1, 0.4 + 0.3 * Math.sin(performance.now() / 500), 0.6, 1],
    loadOp: 'clear',
    storeOp: 'store',
  }] })
  pass.end()
  device.queue.submit([encoder.finish()])
  surface.present()
}, 16)

window.on('close', () => {
  clearInterval(timer)
  surface.destroy()
  device.destroy()
})
