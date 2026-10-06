/*
 * native-dawn: fill a NativeDawnWindow from an SDL2 window.
 *
 * Header-only and optional; include it only when the program already uses
 * SDL2 (X11, Wayland, Windows, macOS, Android). On macOS, create the window
 * with SDL_WINDOW_METAL. Call nativeDawnSDL2Release after releasing the
 * surface.
 */
#ifndef NATIVE_DAWN_SDL2_H_
#define NATIVE_DAWN_SDL2_H_

#include <SDL.h>
#include <SDL_syswm.h>
#if defined(SDL_VIDEO_DRIVER_COCOA) || defined(SDL_VIDEO_DRIVER_UIKIT)
#include <SDL_metal.h>
#endif
#include "native_dawn/window.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NativeDawnSDL2Window {
    NativeDawnWindow window;
    void* metalView; /* SDL_MetalView created for Cocoa windows */
} NativeDawnSDL2Window;

/* Returns 0 on success, or -1 with SDL_GetError() describing the failure. */
static inline int nativeDawnSDL2Window(SDL_Window* sdlWindow, NativeDawnSDL2Window* out) {
    SDL_SysWMinfo info;
    SDL_zerop(out);
    SDL_VERSION(&info.version);
    if (!SDL_GetWindowWMInfo(sdlWindow, &info)) return -1;
    switch (info.subsystem) {
#if defined(SDL_VIDEO_DRIVER_X11)
        case SDL_SYSWM_X11:
            out->window.kind = NATIVE_DAWN_WINDOW_XLIB;
            out->window.display = info.info.x11.display;
            out->window.xid = (uint64_t)info.info.x11.window;
            return 0;
#endif
#if defined(SDL_VIDEO_DRIVER_WAYLAND)
        case SDL_SYSWM_WAYLAND:
            out->window.kind = NATIVE_DAWN_WINDOW_WAYLAND;
            out->window.display = info.info.wl.display;
            out->window.handle = info.info.wl.surface;
            return 0;
#endif
#if defined(SDL_VIDEO_DRIVER_WINDOWS)
        case SDL_SYSWM_WINDOWS:
            out->window.kind = NATIVE_DAWN_WINDOW_WIN32;
            out->window.display = info.info.win.hinstance;
            out->window.handle = info.info.win.window;
            return 0;
#endif
#if defined(SDL_VIDEO_DRIVER_ANDROID)
        case SDL_SYSWM_ANDROID:
            out->window.kind = NATIVE_DAWN_WINDOW_ANDROID;
            out->window.handle = info.info.android.window;
            return 0;
#endif
#if defined(SDL_VIDEO_DRIVER_COCOA) || defined(SDL_VIDEO_DRIVER_UIKIT)
        case SDL_SYSWM_COCOA:
        case SDL_SYSWM_UIKIT:
            out->metalView = SDL_Metal_CreateView(sdlWindow);
            if (!out->metalView) return -1;
            out->window.kind = NATIVE_DAWN_WINDOW_METAL_LAYER;
            out->window.handle = SDL_Metal_GetLayer((SDL_MetalView)out->metalView);
            return 0;
#endif
        default:
            SDL_SetError("native-dawn: unsupported SDL window subsystem %d", (int)info.subsystem);
            return -1;
    }
}

static inline void nativeDawnSDL2Release(NativeDawnSDL2Window* window) {
#if defined(SDL_VIDEO_DRIVER_COCOA) || defined(SDL_VIDEO_DRIVER_UIKIT)
    if (window->metalView) SDL_Metal_DestroyView((SDL_MetalView)window->metalView);
#endif
    window->metalView = NULL;
}

#ifdef __cplusplus
}
#endif

#endif /* NATIVE_DAWN_SDL2_H_ */
