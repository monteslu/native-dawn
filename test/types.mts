import addon, { create, globals, deviceHandle, NativeSurface, paths, wasmImports, type NativeWindow, type WasmImports } from 'native-dawn'
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
  const fast: WasmImports = wasmImports({ wgpuRenderPassEncoderDraw: () => {} })
  fast.memory(new Uint8Array(16))
  fast.register(8, device.queue)
  fast.forget(8)
  fast.imports.wgpuRenderPassEncoderDraw?.(8, 3, 1, 0, 0)
  const served: number = fast.stats().native
  void served
  device.destroy()
}
const library: string = paths.library
const include: string = pathsOnly.include
void [library, include, globals, addon.create]
