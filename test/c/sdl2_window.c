/* An SDL2 window presented through native_dawn/sdl2.h: no Node involved.
 * Clears a few frames, resizes, and presents again. */
#include "gpu.h"
#include "native_dawn/sdl2.h"

static void configure(Gpu* gpu, WGPUSurface surface, WGPUTextureFormat format, int width, int height) {
    WGPUSurfaceConfiguration config = WGPU_SURFACE_CONFIGURATION_INIT;
    config.device = gpu->device;
    config.format = format;
    config.usage = WGPUTextureUsage_RenderAttachment;
    config.width = (uint32_t)width;
    config.height = (uint32_t)height;
    config.presentMode = WGPUPresentMode_Fifo;
    config.alphaMode = WGPUCompositeAlphaMode_Opaque;
    wgpuSurfaceConfigure(surface, &config);
}

static void frame(Gpu* gpu, WGPUSurface surface, double red) {
    WGPUSurfaceTexture current = WGPU_SURFACE_TEXTURE_INIT;
    wgpuSurfaceGetCurrentTexture(surface, &current);
    CHECK(current.status == WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal ||
          current.status == WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal,
          "getCurrentTexture status %d", (int)current.status);
    WGPUTextureView view = wgpuTextureCreateView(current.texture, NULL);
    WGPURenderPassColorAttachment color = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    color.view = view;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = (WGPUColor){red, 0.2, 0.4, 1.0};
    WGPURenderPassDescriptor passDescriptor = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
    passDescriptor.colorAttachmentCount = 1;
    passDescriptor.colorAttachments = &color;
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(gpu->device, NULL);
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &passDescriptor);
    wgpuRenderPassEncoderEnd(pass);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, NULL);
    wgpuQueueSubmit(gpu->queue, 1, &commands);
    CHECK(wgpuSurfacePresent(surface) == WGPUStatus_Success, "present failed");
    wgpuCommandBufferRelease(commands);
    wgpuRenderPassEncoderRelease(pass);
    wgpuCommandEncoderRelease(encoder);
    wgpuTextureViewRelease(view);
    wgpuTextureRelease(current.texture);
}

static void pixelSize(SDL_Window* window, int* width, int* height) {
#if SDL_VERSION_ATLEAST(2, 26, 0)
    SDL_GetWindowSizeInPixels(window, width, height);
#else
    SDL_GetWindowSize(window, width, height);
#endif
}

int main(int argc, char** argv) {
    (void)argc; (void)argv;
    CHECK(SDL_Init(SDL_INIT_VIDEO) == 0, "SDL_Init: %s", SDL_GetError());
    Uint32 flags = SDL_WINDOW_RESIZABLE;
#if defined(__APPLE__)
    flags |= SDL_WINDOW_METAL;
#endif
    SDL_Window* window = SDL_CreateWindow("native-dawn C test", SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED, 96, 64, flags);
    CHECK(window, "SDL_CreateWindow: %s", SDL_GetError());
    printf("SDL video driver: %s\n", SDL_GetCurrentVideoDriver());

    Gpu gpu = gpuCreate();
    NativeDawnSDL2Window native;
    CHECK(nativeDawnSDL2Window(window, &native) == 0, "nativeDawnSDL2Window: %s", SDL_GetError());
    WGPUSurface surface = nativeDawnCreateSurface(gpu.instance, &native.window);
    CHECK(surface, "nativeDawnCreateSurface returned NULL");

    WGPUSurfaceCapabilities caps = WGPU_SURFACE_CAPABILITIES_INIT;
    CHECK(wgpuSurfaceGetCapabilities(surface, gpu.adapter, &caps) == WGPUStatus_Success && caps.formatCount > 0,
          "adapter cannot present to this window");
    const WGPUTextureFormat format = caps.formats[0];

    int width, height;
    pixelSize(window, &width, &height);
    configure(&gpu, surface, format, width, height);
    for (int i = 0; i < 3; ++i) {
        SDL_Event event;
        while (SDL_PollEvent(&event)) {}
        frame(&gpu, surface, i / 3.0);
    }
    SDL_SetWindowSize(window, 48, 32);
    pixelSize(window, &width, &height);
    configure(&gpu, surface, format, width, height);
    frame(&gpu, surface, 1.0);
    printf("presented 4 frames to a %dx%d %s window\n", width, height,
           native.window.kind == NATIVE_DAWN_WINDOW_XLIB ? "X11" :
           native.window.kind == NATIVE_DAWN_WINDOW_WAYLAND ? "Wayland" :
           native.window.kind == NATIVE_DAWN_WINDOW_WIN32 ? "Win32" : "Metal");

    wgpuSurfaceUnconfigure(surface);
    wgpuSurfaceCapabilitiesFreeMembers(caps);
    wgpuSurfaceRelease(surface);
    nativeDawnSDL2Release(&native);
    gpuRelease(&gpu);
    SDL_DestroyWindow(window);
    SDL_Quit();
    printf("C SDL2 window test passed\n");
    return 0;
}
