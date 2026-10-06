/*
 * native-dawn: create a WebGPU surface from a native window.
 *
 * Header-only. Include it after linking dawn::webgpu_dawn; it uses nothing
 * but the WebGPU C API. The caller owns the window and must release the
 * surface (wgpuSurfaceRelease) before destroying it.
 */
#ifndef NATIVE_DAWN_WINDOW_H_
#define NATIVE_DAWN_WINDOW_H_

#include <stddef.h>
#include <stdint.h>
#include <webgpu/webgpu.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum NativeDawnWindowKind {
    NATIVE_DAWN_WINDOW_XLIB = 1,        /* display: Display*, xid: Window */
    NATIVE_DAWN_WINDOW_WAYLAND = 2,     /* display: wl_display*, handle: wl_surface* */
    NATIVE_DAWN_WINDOW_WIN32 = 3,       /* display: HINSTANCE, handle: HWND */
    NATIVE_DAWN_WINDOW_METAL_LAYER = 4  /* handle: CAMetalLayer* */
} NativeDawnWindowKind;

typedef struct NativeDawnWindow {
    NativeDawnWindowKind kind;
    void* display;
    void* handle;
    uint64_t xid;
} NativeDawnWindow;

/* Returns NULL when the window is complete, otherwise what is missing. */
static inline const char* nativeDawnWindowError(const NativeDawnWindow* window) {
    if (!window) return "window is NULL";
    switch (window->kind) {
        case NATIVE_DAWN_WINDOW_XLIB:
            return window->display && window->xid ? NULL : "Xlib window needs display and xid";
        case NATIVE_DAWN_WINDOW_WAYLAND:
            return window->display && window->handle ? NULL : "Wayland window needs display and handle (wl_surface)";
        case NATIVE_DAWN_WINDOW_WIN32:
            return window->handle ? NULL : "Win32 window needs handle (HWND)";
        case NATIVE_DAWN_WINDOW_METAL_LAYER:
            return window->handle ? NULL : "Metal window needs handle (CAMetalLayer)";
    }
    return "unknown window kind";
}

/*
 * Creates a surface for the window, or returns NULL if the window description
 * is incomplete. A kind the platform does not support yields an error surface
 * from Dawn, which fails wgpuSurfaceGetCapabilities.
 */
static inline WGPUSurface nativeDawnCreateSurface(WGPUInstance instance, const NativeDawnWindow* window) {
    WGPUSurfaceDescriptor descriptor = WGPU_SURFACE_DESCRIPTOR_INIT;
    if (!instance || nativeDawnWindowError(window)) return NULL;
    switch (window->kind) {
        case NATIVE_DAWN_WINDOW_XLIB: {
            WGPUSurfaceSourceXlibWindow source = WGPU_SURFACE_SOURCE_XLIB_WINDOW_INIT;
            source.display = window->display;
            source.window = window->xid;
            descriptor.nextInChain = &source.chain;
            return wgpuInstanceCreateSurface(instance, &descriptor);
        }
        case NATIVE_DAWN_WINDOW_WAYLAND: {
            WGPUSurfaceSourceWaylandSurface source = WGPU_SURFACE_SOURCE_WAYLAND_SURFACE_INIT;
            source.display = window->display;
            source.surface = window->handle;
            descriptor.nextInChain = &source.chain;
            return wgpuInstanceCreateSurface(instance, &descriptor);
        }
        case NATIVE_DAWN_WINDOW_WIN32: {
            WGPUSurfaceSourceWindowsHWND source = WGPU_SURFACE_SOURCE_WINDOWS_HWND_INIT;
            source.hinstance = window->display;
            source.hwnd = window->handle;
            descriptor.nextInChain = &source.chain;
            return wgpuInstanceCreateSurface(instance, &descriptor);
        }
        case NATIVE_DAWN_WINDOW_METAL_LAYER: {
            WGPUSurfaceSourceMetalLayer source = WGPU_SURFACE_SOURCE_METAL_LAYER_INIT;
            source.layer = window->handle;
            descriptor.nextInChain = &source.chain;
            return wgpuInstanceCreateSurface(instance, &descriptor);
        }
    }
    return NULL;
}

#ifdef __cplusplus
}
#endif

#endif /* NATIVE_DAWN_WINDOW_H_ */
