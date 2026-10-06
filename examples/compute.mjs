// Doubles four numbers with a WGSL compute shader.
import { create, globals } from 'native-dawn'

const { GPUBufferUsage, GPUMapMode } = globals
const gpu = create([])
const adapter = await gpu.requestAdapter()
if (!adapter) throw new Error('No WebGPU adapter available')
const device = await adapter.requestDevice()
try {
  const values = new Uint32Array([1, 2, 3, 4])
  const storage = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
  const output = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  device.queue.writeBuffer(storage, 0, values)
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read_write> data: array<u32>;
    @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3u) {
      data[id.x] *= 2u;
    }` })
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(1)
  pass.end()
  encoder.copyBufferToBuffer(storage, 0, output, 0, values.byteLength)
  device.queue.submit([encoder.finish()])
  await output.mapAsync(GPUMapMode.READ)
  console.log([...new Uint32Array(output.getMappedRange())]) // [2, 4, 6, 8]
} finally {
  device.destroy()
}
