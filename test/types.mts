import addon, { create, globals, deviceHandle, NativeSurface, paths, type NativeWindow } from 'native-dawn'
import { paths as pathsOnly } from 'native-dawn/paths'

const gpu: GPU = create(['backend=vulkan'])
const adapter = await gpu.requestAdapter()
if (adapter) {
  const device: GPUDevice = await adapter.requestDevice()
  const handle: bigint = deviceHandle(device)
  const window: NativeWindow = { kind: 'xlib', display: handle, xid: 1n }
  const surface = new NativeSurface(device, window)
  surface.configure({ width: 1, height: 1, format: 'bgra8unorm', usage: 0x10, presentMode: 'fifo' })
  const texture: GPUTexture = surface.getCurrentTexture()
  texture.createView()
  surface.present()
  surface.destroy()
  device.destroy()
}
const library: string = paths.library
const include: string = pathsOnly.include
void [library, include, globals, addon.create]
