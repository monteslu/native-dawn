# native-dawn

Prebuilt [Dawn](https://dawn.googlesource.com/dawn), Google's WebGPU implementation, packaged for two kinds of users:

- **Native code.** A shared `webgpu_dawn` library, the WebGPU C and C++ headers, and a CMake package, so a C or C++ program can use WebGPU without building Dawn.
- **Node.js.** Dawn's own Node-API bindings, built against that same library, plus a swap chain for native windows.

It is the WebGPU counterpart of [native-gles](https://github.com/monteslu/native-gles): the native layer, kept separate from the browser-style JavaScript API that sits on top of it (webgpu-node, as [webgl-node](https://github.com/monteslu/webgl-node) is for native-gles).

Because the Node addon links the shared library instead of carrying its own copy of Dawn, JavaScript and native code in one process use the same Dawn. A `GPUDevice` created in JavaScript can be handed to a C++ addon as a `WGPUDevice`.

## Install

```sh
npm install native-dawn
```

Installation downloads the archive for your platform from this repository's GitHub releases, checks its SHA-256 and version, and loads the addon once to make sure it works.

| Platform | Architectures | Backend |
| --- | --- | --- |
| Linux (glibc; release builds run on Ubuntu 22.04 and newer) | x64, arm64 | Vulkan |
| macOS 11+ | x64, arm64 | Metal |
| Windows | x64, arm64 | D3D12 |
| Android 8.0+ (API 26), C SDK only | arm64 | Vulkan, OpenGL ES |

Linux builds support X11 and Wayland windows and also include the OpenGL ES backend (see [OpenGL ES](#opengl-es-compatibility-mode)). The Node addon needs Node.js 22 or newer.

## Using it from Node

```js
import { create, globals } from 'native-dawn'

const gpu = create([])  // Dawn instance flags, e.g. ['backend=vulkan']
const adapter = await gpu.requestAdapter()
const device = await adapter.requestDevice()

const buffer = device.createBuffer({ size: 16, usage: globals.GPUBufferUsage.COPY_DST | globals.GPUBufferUsage.MAP_READ })
```

`gpu`, `adapter` and `device` are standard WebGPU objects. `globals` holds the WebGPU classes and constants (`GPUBufferUsage`, `GPUDevice`, `GPUValidationError`, ...). Nothing is installed on `globalThis` or `navigator`; webgpu-node does that, along with a canvas and `GPUCanvasContext`.

Adapters and devices stay valid even if the `gpu` object is garbage collected. Call `device.destroy()` when you are done to release GPU memory promptly. Only pending asynchronous work (a `mapAsync`, `onSubmittedWorkDone`, pipeline creation and the like) keeps Node running; an idle device does not, and it costs no CPU. Dawn notices a lost device (a driver reset, for example) on the next WebGPU call or asynchronous operation, and `device.lost` settles then.

### Presenting to a window

`NativeSurface` is a swap chain for a native window. With [@kmamal/sdl](https://github.com/kmamal/node-sdl):

```js
import sdl from '@kmamal/sdl'
import { create, NativeSurface, globals } from 'native-dawn'

const window = sdl.video.createWindow({ width: 640, height: 480, webgpu: true })
const gpu = create([])
const device = await (await gpu.requestAdapter()).requestDevice()

const surface = new NativeSurface(device, window.native.gpu, sdl.info.drivers.video.current)
surface.configure({
  width: window.pixelWidth,
  height: window.pixelHeight,
  format: gpu.getPreferredCanvasFormat(),
  usage: globals.GPUTextureUsage.RENDER_ATTACHMENT,
})

// Each frame:
const texture = surface.getCurrentTexture()
// ... render into texture, submit ...
surface.present()
```

The third argument matters on Linux. @kmamal/sdl 0.11 hands over the same two pointers for X11 and Wayland windows without saying which they are, so `NativeSurface` needs the video driver name. Without it you get an error instead of a guess.

Windows from other libraries work too. Pass the native handles as BigInts:

```js
new NativeSurface(device, { kind: 'xlib', display, xid })
new NativeSurface(device, { kind: 'wayland', display, handle })     // wl_display*, wl_surface*
new NativeSurface(device, { kind: 'win32', display, handle })       // HINSTANCE, HWND
new NativeSurface(device, { kind: 'metal-layer', handle })          // CAMetalLayer*
```

`configure` accepts `alphaMode` (`opaque`, `premultiplied`), `presentMode` (`fifo` by default, or `fifoRelaxed`, `immediate`, `mailbox`) and `viewFormats`, and checks each against what the surface supports. Call `configure` again after the window resizes. The window belongs to you: call `surface.destroy()` before destroying it.

### Sharing a device with native code

```js
import { deviceHandle } from 'native-dawn'
const pointer = deviceHandle(device)  // BigInt: the WGPUDevice
```

The pointer is valid while the `GPUDevice` is alive. Native code that holds on to it longer should call `wgpuDeviceAddRef`. This works because the addon and your native code load the same `webgpu_dawn` library; build your addon against native-dawn's headers and library (see below).

## Using it from C or C++

The package holds a normal install prefix:

```
include/webgpu/webgpu.h          WebGPU C API
include/webgpu/webgpu_cpp.h      C++ wrapper
include/dawn/...                 Dawn extensions
include/native_dawn/window.h     window helpers (see below)
lib/libwebgpu_dawn.so            .dylib on macOS; bin/webgpu_dawn.dll and lib/webgpu_dawn.lib on Windows
lib/cmake/Dawn/                  CMake package: dawn::webgpu_dawn
share/native-dawn/dawn.json      Dawn's description of the whole API
share/native-dawn/licenses/      licenses for everything in the binaries
```

Point CMake at it:

```sh
cmake -B build -DCMAKE_PREFIX_PATH="$(npx native-dawn prefix)"
```

```cmake
find_package(Dawn REQUIRED)
target_link_libraries(my_app PRIVATE dawn::webgpu_dawn)
```

You don't need npm for this. Each GitHub release has a `native-dawn-v<version>-<platform>-<arch>.tar.gz` that unpacks to the same prefix. On Linux and macOS the library is found through the executable's rpath when CMake links it. On Windows, put `webgpu_dawn.dll`, `dxcompiler.dll` and `dxil.dll` next to your executable or on `PATH`.

[test/c/compute.c](test/c/compute.c) is a complete program: adapter and device setup, a compute shader, an offscreen render pass, and reading both back.

### Window helpers

`native_dawn/window.h` is header-only and needs nothing but `webgpu.h`. Describe the window, get a surface:

```c
#include <native_dawn/window.h>

NativeDawnWindow window = { NATIVE_DAWN_WINDOW_XLIB, display, NULL, xid };
WGPUSurface surface = nativeDawnCreateSurface(instance, &window);
```

If you use SDL2, `native_dawn/sdl2.h` fills that in from an `SDL_Window*` for X11, Wayland, Windows and macOS (create the window with `SDL_WINDOW_METAL` on macOS):

```c
#include <native_dawn/sdl2.h>

NativeDawnSDL2Window native;
if (nativeDawnSDL2Window(sdlWindow, &native) != 0) { /* SDL_GetError() */ }
WGPUSurface surface = nativeDawnCreateSurface(instance, &native.window);
/* ... */
wgpuSurfaceRelease(surface);
nativeDawnSDL2Release(&native);
```

[test/c/sdl2_window.c](test/c/sdl2_window.c) configures a surface, presents frames and handles a resize.

### OpenGL ES (compatibility mode)

GPUs without a Vulkan driver, such as the Mali-G31 in many Allwinner H700 handhelds, can still run WebGPU through Dawn's OpenGL ES backend. It needs OpenGL ES 3.1 or newer; ES 3.0 lacks the compute shaders and storage buffers that WebGPU requires. WGSL vertex, fragment and compute shaders are all translated to GLSL ES.

This backend implements WebGPU's compatibility mode, a reduced feature level for OpenGL ES 3.1 and Direct3D 11 class hardware. Ask for it explicitly:

```c
WGPURequestAdapterOptions options = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
options.featureLevel = WGPUFeatureLevel_Compatibility;
options.backendType = WGPUBackendType_OpenGLES;  // optional: prefer it over Vulkan
```

```js
const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' })
```

Code written for compatibility mode also runs on full WebGPU. On Linux the backend reaches the driver through EGL; without an X11 or Wayland session, set `EGL_PLATFORM=surfaceless`.

Known driver bug: with Mesa 26.0.x (seen on 26.0.8, radeonsi and llvmpipe), creating a render pipeline on this backend crashes inside Mesa whenever the GL program comes from Mesa's on-disk shader cache, so the first run works and later runs segfault. Set `MESA_SHADER_CACHE_DISABLE=true` until Mesa is fixed. The Vulkan backend is not affected. Presenting needs an X11, Wayland or Android window: Dawn has no surface type for direct KMS/DRM output, so on such systems this mode is limited to compute and offscreen rendering.

## Android

The Android archive (`android-arm64`) holds the C SDK: `libwebgpu_dawn.so`, headers, the CMake package and `dawn.json`. There is no Node addon for Android, and npm installs don't fetch these; download them from the GitHub release. The library uses the static C++ runtime, needs only system libraries, and is aligned for 16 KB pages.

With the NDK and CMake:

```sh
cmake -B build -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 \
  -DDawn_DIR=/path/to/native-dawn-android-arm64/lib/cmake/Dawn
```

Package `lib/libwebgpu_dawn.so` with your app's other native libraries (`jniLibs/arm64-v8a/`, or `IMPORTED_LOCATION` in an Android Gradle CMake build). For a window, pass the `ANativeWindow*` from your `Surface`:

```c
NativeDawnWindow window = { NATIVE_DAWN_WINDOW_ANDROID, NULL, aNativeWindow, 0 };
WGPUSurface surface = nativeDawnCreateSurface(instance, &window);
```

or use `native_dawn/sdl2.h` with an SDL2 Android app. Vulkan is used where the device has it; OpenGL ES 3.1+ is available through compatibility mode. Kotlin and Java apps are better served by Google's `androidx.webgpu` library, which is built from Dawn too.

### Bindings for other runtimes

`share/native-dawn/dawn.json` is the file Dawn generates its own headers and wrappers from: every object, method, struct, enum and callback in the API. A binding for another JavaScript engine or language can be generated from it rather than written by hand. `npx native-dawn dawn-json` prints its path.

## Building from source

You need Git, Python 3, Go 1.26+, CMake 3.22+, a C++20 compiler, and Ninja (Linux and macOS). On Windows use Visual Studio 2022 with the C++ tools and a recent Windows SDK; run the build from a developer command prompt to get Ninja and compiler caching, or from a plain prompt to use the Visual Studio generator.

Linux packages (Debian/Ubuntu names):

```sh
sudo apt-get install ninja-build libx11-dev libx11-xcb-dev libxcb1-dev libxrandr-dev libxinerama-dev \
  libxcursor-dev libxi-dev libwayland-dev libvulkan1 mesa-vulkan-drivers
```

Then:

```sh
npm ci --ignore-scripts
npm run build
```

The build fetches the Dawn revision pinned in `upstream.json` and the dependencies Dawn pins for it (no depot_tools), builds `webgpu_dawn` and the addon, and installs the result to `dist/<platform>-<arch>`. Sources go in `.cache/dawn`, build files in `build/<platform>-<arch>`. A first build takes a while; Dawn is large.

Android builds cross-compile from Linux, macOS or Windows with the NDK (r27 or newer) and need no Go:

```sh
NATIVE_DAWN_TARGET=android-arm64 npm run build
```

The NDK is found through `ANDROID_NDK_HOME`, `ANDROID_NDK_ROOT`, or the newest one under `$ANDROID_HOME/ndk`.

Environment variables:

| Variable | Effect |
| --- | --- |
| `NATIVE_DAWN_TARGET` | `android-arm64` to cross-compile; default is this machine |
| `NATIVE_DAWN_BUILD_JOBS` | Parallel compile jobs (default: up to 8) |
| `NATIVE_DAWN_COMPILER_LAUNCHER` | Compiler launcher such as `sccache` or `ccache` |
| `NATIVE_DAWN_BUILD_FROM_SOURCE=1` | Make `npm install` build instead of downloading |
| `NATIVE_DAWN_BINARY=/path/to/archive.tar.gz` | Install a local archive (with its `.sha256` beside it) |
| `NATIVE_DAWN_SKIP_INSTALL=1` | Skip the install step entirely |

## Tests

```sh
npm test                          # Node: compute, mapping, validation, rendering, surface errors, installer
npm run test:types                # TypeScript declarations
npm run test:c                    # C programs built against dist/ with find_package(Dawn)
NATIVE_DAWN_TEST_SDL2=1 npm run test:c    # plus the SDL2 window test
npm run test:window               # Node + @kmamal/sdl window (needs a display)
npm run test:package              # pack, install into a scratch project, run from Node and C
NATIVE_DAWN_TARGET=android-arm64 npm run test:android   # C test on the device or emulator adb sees
```

Tests need a working adapter, hardware or software (Mesa's lavapipe on Linux, WARP on Windows), and fail without one rather than skipping. `NATIVE_DAWN_TEST_BACKEND=vulkan|metal|d3d12|opengles` picks a backend, `NATIVE_DAWN_TEST_COMPAT=1` requests compatibility mode (required for `opengles`), and `NATIVE_DAWN_TEST_FALLBACK=1` asks for a fallback adapter. The Android emulator only offers OpenGL ES 3.0, so it tests Vulkan; on Linux, `EGL_PLATFORM=surfaceless NATIVE_DAWN_TEST_BACKEND=opengles NATIVE_DAWN_TEST_COMPAT=1 npm run test:c` tests OpenGL ES. On headless Linux, run the window tests under `xvfb-run -a` with `SDL_VIDEODRIVER=x11`.

## CI and releases

[CI](.github/workflows/ci.yml) builds the six desktop targets on native runners and runs every suite above on each one, on Node 22 and 24, against the runner's software adapter. Linux also runs the C tests on OpenGL ES in compatibility mode. The window tests run everywhere except Windows ARM64, which has no @kmamal/sdl build. Android is cross-compiled on Linux and its C tests run on an x86_64 Android emulator, through Android's ARM translation.

Pushing a `v<version>` tag that matches `package.json` runs the same jobs, and if all seven pass, creates a GitHub release with the seven archives and their checksums. npm publishing is a separate, manual step after that, since `npm install` downloads from the release.

## License

MIT for this package. Dawn and its dependencies keep their own licenses; see [NOTICE](NOTICE) and `share/native-dawn/licenses` in each archive.
