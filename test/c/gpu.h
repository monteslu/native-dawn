/* Shared setup for the C tests: an instance, adapter and device through the
 * plain WebGPU C API, with every error fatal. */
#ifndef NATIVE_DAWN_TEST_GPU_H_
#define NATIVE_DAWN_TEST_GPU_H_

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <webgpu/webgpu.h>

#define CHECK(cond, ...) do { if (!(cond)) { fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__); fprintf(stderr, __VA_ARGS__); fputc('\n', stderr); exit(1); } } while (0)

static WGPUStringView sv(const char* s) { WGPUStringView v = { s, strlen(s) }; return v; }

typedef struct Gpu {
    WGPUInstance instance;
    WGPUAdapter adapter;
    WGPUDevice device;
    WGPUQueue queue;
} Gpu;

typedef struct Pending { int done; int ok; void* result; } Pending;

static void onAdapter(WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView message, void* p, void* unused) {
    Pending* pending = (Pending*)p;
    (void)unused;
    pending->done = 1;
    pending->ok = status == WGPURequestAdapterStatus_Success;
    pending->result = adapter;
    if (!pending->ok) fprintf(stderr, "requestAdapter: %.*s\n", (int)message.length, message.data);
}

static void onDevice(WGPURequestDeviceStatus status, WGPUDevice device, WGPUStringView message, void* p, void* unused) {
    Pending* pending = (Pending*)p;
    (void)unused;
    pending->done = 1;
    pending->ok = status == WGPURequestDeviceStatus_Success;
    pending->result = device;
    if (!pending->ok) fprintf(stderr, "requestDevice: %.*s\n", (int)message.length, message.data);
}

static void onUncapturedError(WGPUDevice const* device, WGPUErrorType type, WGPUStringView message, void* a, void* b) {
    (void)device; (void)a; (void)b;
    fprintf(stderr, "FAIL uncaptured WebGPU error %d: %.*s\n", (int)type, (int)message.length, message.data);
    exit(1);
}

static void waitFor(WGPUInstance instance, Pending* pending) {
    for (int i = 0; i < 100000 && !pending->done; ++i) wgpuInstanceProcessEvents(instance);
    CHECK(pending->done, "timed out waiting for a WebGPU callback");
}

/* Options come from the environment so CI can pick a backend:
 * NATIVE_DAWN_TEST_BACKEND=vulkan|metal|d3d12|opengles,
 * NATIVE_DAWN_TEST_FALLBACK=1, and NATIVE_DAWN_TEST_COMPAT=1 for the
 * compatibility feature level (required for OpenGL ES). */
static Gpu gpuCreate(void) {
    Gpu gpu = {0};
    gpu.instance = wgpuCreateInstance(NULL);
    CHECK(gpu.instance, "wgpuCreateInstance returned NULL");

    WGPURequestAdapterOptions options = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
    const char* backend = getenv("NATIVE_DAWN_TEST_BACKEND");
    if (backend && strcmp(backend, "vulkan") == 0) options.backendType = WGPUBackendType_Vulkan;
    if (backend && strcmp(backend, "metal") == 0) options.backendType = WGPUBackendType_Metal;
    if (backend && strcmp(backend, "d3d12") == 0) options.backendType = WGPUBackendType_D3D12;
    if (backend && strcmp(backend, "opengles") == 0) options.backendType = WGPUBackendType_OpenGLES;
    const char* compat = getenv("NATIVE_DAWN_TEST_COMPAT");
    if (compat && strcmp(compat, "1") == 0) options.featureLevel = WGPUFeatureLevel_Compatibility;
    const char* fallback = getenv("NATIVE_DAWN_TEST_FALLBACK");
    options.forceFallbackAdapter = fallback && strcmp(fallback, "1") == 0;

    Pending pending = {0};
    WGPURequestAdapterCallbackInfo adapterCallback = WGPU_REQUEST_ADAPTER_CALLBACK_INFO_INIT;
    adapterCallback.mode = WGPUCallbackMode_AllowProcessEvents;
    adapterCallback.callback = onAdapter;
    adapterCallback.userdata1 = &pending;
    wgpuInstanceRequestAdapter(gpu.instance, &options, adapterCallback);
    waitFor(gpu.instance, &pending);
    CHECK(pending.ok && pending.result, "no WebGPU adapter");
    gpu.adapter = (WGPUAdapter)pending.result;

    WGPUAdapterInfo info = WGPU_ADAPTER_INFO_INIT;
    if (wgpuAdapterGetInfo(gpu.adapter, &info) == WGPUStatus_Success) {
        printf("adapter: %.*s (backend %d)\n", (int)info.device.length, info.device.data, (int)info.backendType);
        wgpuAdapterInfoFreeMembers(info);
    }

    WGPUDeviceDescriptor deviceDescriptor = WGPU_DEVICE_DESCRIPTOR_INIT;
    deviceDescriptor.uncapturedErrorCallbackInfo.callback = onUncapturedError;
    Pending devicePending = {0};
    WGPURequestDeviceCallbackInfo deviceCallback = WGPU_REQUEST_DEVICE_CALLBACK_INFO_INIT;
    deviceCallback.mode = WGPUCallbackMode_AllowProcessEvents;
    deviceCallback.callback = onDevice;
    deviceCallback.userdata1 = &devicePending;
    wgpuAdapterRequestDevice(gpu.adapter, &deviceDescriptor, deviceCallback);
    waitFor(gpu.instance, &devicePending);
    CHECK(devicePending.ok && devicePending.result, "requestDevice failed");
    gpu.device = (WGPUDevice)devicePending.result;
    gpu.queue = wgpuDeviceGetQueue(gpu.device);
    return gpu;
}

static void gpuRelease(Gpu* gpu) {
    wgpuQueueRelease(gpu->queue);
    wgpuDeviceDestroy(gpu->device);
    wgpuDeviceRelease(gpu->device);
    wgpuAdapterRelease(gpu->adapter);
    wgpuInstanceRelease(gpu->instance);
}

static void onMapped(WGPUMapAsyncStatus status, WGPUStringView message, void* p, void* unused) {
    Pending* pending = (Pending*)p;
    (void)unused;
    pending->done = 1;
    pending->ok = status == WGPUMapAsyncStatus_Success;
    if (!pending->ok) fprintf(stderr, "mapAsync: %.*s\n", (int)message.length, message.data);
}

/* Maps a MAP_READ buffer and blocks until the data is readable. */
static const void* mapRead(Gpu* gpu, WGPUBuffer buffer, size_t size) {
    Pending pending = {0};
    WGPUBufferMapCallbackInfo callback = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = onMapped;
    callback.userdata1 = &pending;
    wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, size, callback);
    waitFor(gpu->instance, &pending);
    CHECK(pending.ok, "mapAsync failed");
    return wgpuBufferGetConstMappedRange(buffer, 0, size);
}

#endif /* NATIVE_DAWN_TEST_GPU_H_ */
