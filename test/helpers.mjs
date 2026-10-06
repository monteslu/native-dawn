import { create, globals } from '../index.js'

export const { GPUBufferUsage, GPUMapMode, GPUTextureUsage } = globals

// CI picks the backend: NATIVE_DAWN_TEST_BACKEND=vulkan|metal|d3d12, and
// NATIVE_DAWN_TEST_FALLBACK=1 for a software adapter.
export function flags() {
  const backend = process.env.NATIVE_DAWN_TEST_BACKEND
  return backend ? [`backend=${backend}`] : []
}
export function adapterOptions() {
  return process.env.NATIVE_DAWN_TEST_FALLBACK === '1' ? { forceFallbackAdapter: true } : {}
}
export async function setup() {
  const gpu = create(flags())
  const adapter = await gpu.requestAdapter(adapterOptions())
  if (!adapter) throw new Error('Tests need a WebGPU adapter (a GPU driver or a software one such as lavapipe); nothing is skipped')
  const device = await adapter.requestDevice()
  return { gpu, adapter, device }
}

export async function pixels(device, texture) {
  const { width, height, format } = texture
  if (!['rgba8unorm', 'bgra8unorm'].includes(format)) throw new Error(`Unsupported readback format ${format}`)
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256
  const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height])
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(buffer.getMappedRange())
    const output = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; ++y) output.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
    if (format === 'bgra8unorm') for (let i = 0; i < output.length; i += 4) [output[i], output[i + 2]] = [output[i + 2], output[i]]
    return output
  } finally { buffer.destroy() }
}

export function clear(device, texture, color) {
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: color, loadOp: 'clear', storeOp: 'store' }] })
  pass.end()
  device.queue.submit([encoder.finish()])
}

export async function compute(device, input = [1, 2, 3, 4]) {
  const data = new Uint32Array(input)
  const storage = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
  const readback = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
  try {
    device.queue.writeBuffer(storage, 0, data)
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> values: array<u32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
        if (id.x < arrayLength(&values)) { values[id.x] *= 2u; }
      }` })
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(input.length / 64)); pass.end()
    encoder.copyBufferToBuffer(storage, 0, readback, 0, data.byteLength)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    return Array.from(new Uint32Array(readback.getMappedRange()))
  } finally { storage.destroy(); readback.destroy() }
}
