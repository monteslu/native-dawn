/// <reference types="@webgpu/types" />
import type { NativeDawnPaths } from './paths.js'

export { paths } from './paths.js'
export type { NativeDawnPaths }

/** An X11, Wayland, Win32 or Metal window, with pointers as BigInt. */
export interface NativeWindow {
  kind: 'xlib' | 'wayland' | 'win32' | 'metal-layer'
  /** Display* (xlib), wl_display* (wayland) or HINSTANCE (win32). */
  display?: bigint | number
  /** wl_surface* (wayland), HWND (win32) or CAMetalLayer* (metal-layer). */
  handle?: bigint | number
  /** X11 Window id (xlib). */
  xid?: bigint | number
}

export interface NativeSurfaceConfiguration {
  width: number
  height: number
  format: GPUTextureFormat
  usage: number
  alphaMode?: 'opaque' | 'premultiplied'
  presentMode?: 'fifo' | 'fifoRelaxed' | 'immediate' | 'mailbox'
  viewFormats?: GPUTextureFormat[]
}

/** A swap chain for a native window. */
export declare class NativeSurface {
  /**
   * @param window An @kmamal/sdl `window.native.gpu` buffer, or a NativeWindow.
   * @param videoDriver For SDL buffers on Linux: 'x11' or 'wayland'
   *   (sdl.info.drivers.video.current).
   */
  constructor(device: GPUDevice, window: Buffer | NativeWindow, videoDriver?: string)
  configure(configuration: NativeSurfaceConfiguration): void
  getCurrentTexture(): GPUTexture
  present(): void
  unconfigure(): void
  destroy(): void
}

/** Dawn instance flags as `key=value` strings, e.g. `backend=vulkan`. */
export declare function create(flags: string[]): GPU
/** The WGPUDevice pointer behind a GPUDevice, for native code in this process. */
export declare function deviceHandle(device: GPUDevice): bigint
/**
 * The native webgpu.h handle behind any WebGPU object from this addon
 * (WGPUTexture, WGPURenderPassEncoder, WGPUQueue, ...), for native code in
 * this process; undefined for anything else.
 */
export declare function objectHandle(object: object): bigint | undefined
/**
 * Dawn features WebGPU has no GPUFeatureName for (webgpu.h's WGPUFeatureName_
 * names without the prefix, e.g. 'SharedTextureMemoryOpaqueFD'), requested by
 * every later requestDevice on this adapter, for native code using them on
 * that device. Returns the names the adapter supports, which are the ones added.
 */
export declare function addDeviceFeatures(adapter: GPUAdapter, names: string[]): string[]
/** WebGPU interface objects and constants (GPUBufferUsage, GPUDevice, ...). */
export declare const globals: Record<string, unknown>

declare const addon: {
  create: typeof create
  globals: typeof globals
  NativeSurface: typeof NativeSurface
  deviceHandle: typeof deviceHandle
  objectHandle: typeof objectHandle
  addDeviceFeatures: typeof addDeviceFeatures
}
export default addon
