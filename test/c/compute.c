/* Headless: a WGSL compute shader doubles an array, then an offscreen render
 * pass clears a texture; both are read back and checked. */
#include "gpu.h"

static void testCompute(Gpu* gpu) {
    const uint32_t input[5] = {0, 1, 7, 123, 65535};
    const size_t size = sizeof(input);

    WGPUBufferDescriptor storageDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
    storageDescriptor.size = size;
    storageDescriptor.usage = WGPUBufferUsage_Storage | WGPUBufferUsage_CopyDst | WGPUBufferUsage_CopySrc;
    WGPUBuffer storage = wgpuDeviceCreateBuffer(gpu->device, &storageDescriptor);
    WGPUBufferDescriptor readbackDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
    readbackDescriptor.size = size;
    readbackDescriptor.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
    WGPUBuffer readback = wgpuDeviceCreateBuffer(gpu->device, &readbackDescriptor);
    wgpuQueueWriteBuffer(gpu->queue, storage, 0, input, size);

    WGPUShaderSourceWGSL wgsl = WGPU_SHADER_SOURCE_WGSL_INIT;
    wgsl.code = sv(
        "@group(0) @binding(0) var<storage, read_write> values: array<u32>;\n"
        "@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {\n"
        "  if (id.x < arrayLength(&values)) { values[id.x] *= 2u; }\n"
        "}\n");
    WGPUShaderModuleDescriptor moduleDescriptor = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
    moduleDescriptor.nextInChain = &wgsl.chain;
    WGPUShaderModule module = wgpuDeviceCreateShaderModule(gpu->device, &moduleDescriptor);

    WGPUComputePipelineDescriptor pipelineDescriptor = WGPU_COMPUTE_PIPELINE_DESCRIPTOR_INIT;
    pipelineDescriptor.compute.module = module;
    pipelineDescriptor.compute.entryPoint = sv("main");
    WGPUComputePipeline pipeline = wgpuDeviceCreateComputePipeline(gpu->device, &pipelineDescriptor);
    WGPUBindGroupLayout layout = wgpuComputePipelineGetBindGroupLayout(pipeline, 0);

    WGPUBindGroupEntry entry = WGPU_BIND_GROUP_ENTRY_INIT;
    entry.binding = 0;
    entry.buffer = storage;
    entry.size = size;
    WGPUBindGroupDescriptor groupDescriptor = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
    groupDescriptor.layout = layout;
    groupDescriptor.entryCount = 1;
    groupDescriptor.entries = &entry;
    WGPUBindGroup group = wgpuDeviceCreateBindGroup(gpu->device, &groupDescriptor);

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(encoder, NULL);
    wgpuComputePassEncoderSetPipeline(pass, pipeline);
    wgpuComputePassEncoderSetBindGroup(pass, 0, group, 0, NULL);
    wgpuComputePassEncoderDispatchWorkgroups(pass, 1, 1, 1);
    wgpuComputePassEncoderEnd(pass);
    wgpuCommandEncoderCopyBufferToBuffer(encoder, storage, 0, readback, 0, size);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &commands);

    const uint32_t* output = (const uint32_t*)mapRead(gpu, readback, size);
    for (int i = 0; i < 5; ++i) CHECK(output[i] == input[i] * 2, "values[%d] = %u, expected %u", i, output[i], input[i] * 2);
    wgpuBufferUnmap(readback);
    printf("compute: [0, 1, 7, 123, 65535] -> [0, 2, 14, 246, 131070]\n");

    wgpuCommandBufferRelease(commands);
    wgpuComputePassEncoderRelease(pass);
    wgpuCommandEncoderRelease(encoder);
    wgpuBindGroupRelease(group);
    wgpuBindGroupLayoutRelease(layout);
    wgpuComputePipelineRelease(pipeline);
    wgpuShaderModuleRelease(module);
    wgpuBufferRelease(readback);
    wgpuBufferRelease(storage);
}

static void testRender(Gpu* gpu) {
    WGPUTextureDescriptor textureDescriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
    textureDescriptor.size.width = 64;
    textureDescriptor.size.height = 4;
    textureDescriptor.format = WGPUTextureFormat_RGBA8Unorm;
    textureDescriptor.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_CopySrc;
    WGPUTexture texture = wgpuDeviceCreateTexture(gpu->device, &textureDescriptor);
    WGPUTextureView view = wgpuTextureCreateView(texture, NULL);

    const size_t bytesPerRow = 256, size = bytesPerRow * 4;
    WGPUBufferDescriptor readbackDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
    readbackDescriptor.size = size;
    readbackDescriptor.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
    WGPUBuffer readback = wgpuDeviceCreateBuffer(gpu->device, &readbackDescriptor);

    WGPURenderPassColorAttachment color = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    color.view = view;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = (WGPUColor){1.0, 0.5, 0.0, 1.0};
    WGPURenderPassDescriptor passDescriptor = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
    passDescriptor.colorAttachmentCount = 1;
    passDescriptor.colorAttachments = &color;

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDescriptor);
    wgpuRenderPassEncoderEnd(pass);
    WGPUTexelCopyTextureInfo source = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    source.texture = texture;
    WGPUTexelCopyBufferInfo destination = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    destination.buffer = readback;
    destination.layout.bytesPerRow = bytesPerRow;
    destination.layout.rowsPerImage = 4;
    WGPUExtent3D extent = {64, 4, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &source, &destination, &extent);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &commands);

    const uint8_t* pixels = (const uint8_t*)mapRead(gpu, readback, size);
    CHECK(pixels[0] == 255 && pixels[1] >= 127 && pixels[1] <= 128 && pixels[2] == 0 && pixels[3] == 255,
          "first pixel is %u,%u,%u,%u", pixels[0], pixels[1], pixels[2], pixels[3]);
    const uint8_t* last = pixels + 3 * bytesPerRow + 63 * 4;
    CHECK(last[0] == 255 && last[3] == 255, "last pixel is %u,%u,%u,%u", last[0], last[1], last[2], last[3]);
    wgpuBufferUnmap(readback);
    printf("render: cleared 64x4 texture read back as %u,%u,%u,%u\n", pixels[0], pixels[1], pixels[2], pixels[3]);

    wgpuCommandBufferRelease(commands);
    wgpuRenderPassEncoderRelease(pass);
    wgpuCommandEncoderRelease(encoder);
    wgpuBufferRelease(readback);
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(texture);
}

int main(void) {
    Gpu gpu = gpuCreate();
    testCompute(&gpu);
    testRender(&gpu);
    gpuRelease(&gpu);
    printf("C compute test passed\n");
    return 0;
}
