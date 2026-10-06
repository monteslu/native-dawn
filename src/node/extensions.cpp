// Additions to Dawn's Node bindings: window surfaces and raw handles.
// The SDL handle layouts follow @kmamal/sdl; see NOTICE.
#include "extensions.h"

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

#include "native_dawn/window.h"
#include "src/dawn/node/binding/Converter.h"
#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"

namespace native_dawn {
namespace {

#define FAIL_VOID(env, message) { Napi::Error::New(env, message).ThrowAsJavaScriptException(); return; }
#define FAIL_VALUE(env, message, value) { Napi::Error::New(env, message).ThrowAsJavaScriptException(); return value; }

template <typename T> T Read(const Napi::Buffer<uint8_t>& buffer, size_t offset) {
    T value;
    std::memcpy(&value, buffer.Data() + offset, sizeof(T));
    return value;
}

bool KindFromString(const std::string& name, NativeDawnWindowKind& kind) {
    if (name == "xlib" || name == "x11") kind = NATIVE_DAWN_WINDOW_XLIB;
    else if (name == "wayland") kind = NATIVE_DAWN_WINDOW_WAYLAND;
    else if (name == "win32" || name == "windows") kind = NATIVE_DAWN_WINDOW_WIN32;
    else if (name == "metal-layer" || name == "cocoa") kind = NATIVE_DAWN_WINDOW_METAL_LAYER;
    else return false;
    return true;
}

// @kmamal/sdl's `window.native.gpu` buffer. On Linux, SDL 0.11.x writes
// {display, window} for both X11 and Wayland without saying which, so the
// caller must name the video driver; a tagged {uint64 kind, display, window}
// layout is also accepted.
bool WindowFromSDLBuffer(Napi::Env env, Napi::Buffer<uint8_t> data, Napi::Value driver, NativeDawnWindow& window) {
    window = {};
#if defined(_WIN32)
    if (data.Length() != 2 * sizeof(void*)) FAIL_VALUE(env, "Expected an SDL Windows GPU handle", false);
    window.kind = NATIVE_DAWN_WINDOW_WIN32;
    window.handle = Read<void*>(data, 0);
    window.display = Read<void*>(data, sizeof(void*));
#elif defined(__APPLE__)
    if (data.Length() != sizeof(void*)) FAIL_VALUE(env, "Expected an SDL Metal GPU handle", false);
    window.kind = NATIVE_DAWN_WINDOW_METAL_LAYER;
    window.handle = Read<void*>(data, 0);
#else
    size_t offset = 0;
    if (data.Length() == sizeof(uint64_t) + 2 * sizeof(void*)) {
        const uint64_t tag = Read<uint64_t>(data, 0);
        if (tag != NATIVE_DAWN_WINDOW_XLIB && tag != NATIVE_DAWN_WINDOW_WAYLAND)
            FAIL_VALUE(env, "Unsupported SDL window subsystem", false);
        window.kind = static_cast<NativeDawnWindowKind>(tag);
        offset = sizeof(uint64_t);
    } else if (data.Length() == 2 * sizeof(void*)) {
        if (!driver.IsString())
            FAIL_VALUE(env, "This SDL handle does not say whether it is X11 or Wayland; pass the video driver (sdl.info.drivers.video.current)", false);
        const std::string name = driver.As<Napi::String>();
        if (name == "x11") window.kind = NATIVE_DAWN_WINDOW_XLIB;
        else if (name == "wayland") window.kind = NATIVE_DAWN_WINDOW_WAYLAND;
        else FAIL_VALUE(env, "SDL video driver '" + name + "' cannot present WebGPU; use x11 or wayland", false);
    } else {
        FAIL_VALUE(env, "Expected an SDL X11 or Wayland GPU handle", false);
    }
    window.display = Read<void*>(data, offset);
    const uintptr_t second = Read<uintptr_t>(data, offset + sizeof(void*));
    if (window.kind == NATIVE_DAWN_WINDOW_XLIB) window.xid = second;
    else window.handle = reinterpret_cast<void*>(second);
#endif
    return true;
}

bool Pointer(Napi::Env env, Napi::Object object, const char* name, uint64_t& out) {
    const auto value = object.Get(name);
    out = 0;
    if (value.IsUndefined() || value.IsNull()) return true;
    if (value.IsBigInt()) {
        bool lossless = false;
        out = value.As<Napi::BigInt>().Uint64Value(&lossless);
        if (!lossless) FAIL_VALUE(env, std::string(name) + " does not fit in 64 bits", false);
        return true;
    }
    if (value.IsNumber()) {
        const double number = value.As<Napi::Number>().DoubleValue();
        if (number < 0 || number > 9007199254740991.0 || number != static_cast<double>(static_cast<uint64_t>(number)))
            FAIL_VALUE(env, std::string(name) + " must be a non-negative integer or BigInt", false);
        out = static_cast<uint64_t>(number);
        return true;
    }
    FAIL_VALUE(env, std::string(name) + " must be a BigInt or number", false);
}

// { kind, display, handle, xid } with pointers as BigInt, for window libraries
// other than SDL.
bool WindowFromObject(Napi::Env env, Napi::Object object, NativeDawnWindow& window) {
    window = {};
    const auto kind = object.Get("kind");
    if (!kind.IsString() || !KindFromString(kind.As<Napi::String>(), window.kind))
        FAIL_VALUE(env, "window.kind must be 'xlib', 'wayland', 'win32' or 'metal-layer'", false);
    uint64_t display, handle;
    if (!Pointer(env, object, "display", display) || !Pointer(env, object, "handle", handle) || !Pointer(env, object, "xid", window.xid))
        return false;
    window.display = reinterpret_cast<void*>(static_cast<uintptr_t>(display));
    window.handle = reinterpret_cast<void*>(static_cast<uintptr_t>(handle));
    return true;
}

bool TextureFormat(Napi::Env env, Napi::Value value, wgpu::TextureFormat& native) {
    wgpu::interop::GPUTextureFormat js;
    auto result = wgpu::interop::FromJS(env, value, js);
    if (!result) FAIL_VALUE(env, result.error, false);
    wgpu::binding::Converter convert(env);
    return convert(native, js);
}

wgpu::Device UnwrapDevice(Napi::Value value) {
    if (!value.IsObject()) return nullptr;
    auto* binding = wgpu::interop::GPUDevice::Unwrap(value.As<Napi::Object>());
    if (!binding) return nullptr;
    return static_cast<wgpu::binding::GPUDevice*>(binding)->GetNativeDawnDevice();
}

class Surface final : public Napi::ObjectWrap<Surface> {
    wgpu::Device device_;
    wgpu::Adapter adapter_;
    wgpu::Surface surface_;
    bool configured_ = false;

    bool Check(Napi::Env env) {
        if (!surface_) FAIL_VALUE(env, "Surface has been destroyed", false);
        return true;
    }

  public:
    static void Init(Napi::Env env, Napi::Object exports) {
        exports.Set("NativeSurface", DefineClass(env, "NativeSurface", {
            InstanceMethod("configure", &Surface::Configure),
            InstanceMethod("getCurrentTexture", &Surface::GetCurrentTexture),
            InstanceMethod("present", &Surface::Present),
            InstanceMethod("unconfigure", &Surface::Unconfigure),
            InstanceMethod("destroy", &Surface::Destroy),
        }));
    }

    // new NativeSurface(device, sdlGpuBuffer, videoDriver?) or
    // new NativeSurface(device, { kind, display, handle, xid })
    explicit Surface(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Surface>(info) {
        const auto env = info.Env();
        device_ = UnwrapDevice(info[0]);
        if (!device_) FAIL_VOID(env, "Expected a GPUDevice from native-dawn");
        NativeDawnWindow window;
        if (info[1].IsBuffer()) {
            if (!WindowFromSDLBuffer(env, info[1].As<Napi::Buffer<uint8_t>>(), info[2], window)) return;
        } else if (info[1].IsObject()) {
            if (!WindowFromObject(env, info[1].As<Napi::Object>(), window)) return;
        } else {
            FAIL_VOID(env, "Expected an SDL GPU handle buffer or a { kind, display, handle, xid } window");
        }
        if (const char* error = nativeDawnWindowError(&window)) FAIL_VOID(env, error);
        adapter_ = device_.GetAdapter();
        wgpu::Instance instance = adapter_.GetInstance();
        surface_ = wgpu::Surface::Acquire(nativeDawnCreateSurface(instance.Get(), &window));
        wgpu::SurfaceCapabilities caps{};
        if (!surface_ || surface_.GetCapabilities(adapter_, &caps) != wgpu::Status::Success || caps.formatCount == 0) {
            surface_ = nullptr;
            FAIL_VOID(env, "This GPU adapter cannot present to the window");
        }
    }
    ~Surface() override {
        if (surface_ && configured_) surface_.Unconfigure();
    }

    void Configure(const Napi::CallbackInfo& info) {
        auto env = info.Env();
        if (!Check(env)) return;
        if (!info[0].IsObject()) FAIL_VOID(env, "Expected a configuration object");
        auto config = info[0].As<Napi::Object>();
        wgpu::SurfaceConfiguration desc{};
        desc.device = device_;
        desc.width = config.Get("width").As<Napi::Number>().Uint32Value();
        desc.height = config.Get("height").As<Napi::Number>().Uint32Value();
        if (!TextureFormat(env, config.Get("format"), desc.format)) return;
        desc.usage = static_cast<wgpu::TextureUsage>(config.Get("usage").As<Napi::Number>().Uint32Value());
        const std::string alpha = config.Get("alphaMode").IsString() ? config.Get("alphaMode").As<Napi::String>() : std::string("opaque");
        if (alpha == "opaque") desc.alphaMode = wgpu::CompositeAlphaMode::Opaque;
        else if (alpha == "premultiplied") desc.alphaMode = wgpu::CompositeAlphaMode::Premultiplied;
        else FAIL_VOID(env, "Invalid alphaMode");
        const std::string present = config.Get("presentMode").IsString() ? config.Get("presentMode").As<Napi::String>() : std::string("fifo");
        if (present == "fifo") desc.presentMode = wgpu::PresentMode::Fifo;
        else if (present == "immediate") desc.presentMode = wgpu::PresentMode::Immediate;
        else if (present == "mailbox") desc.presentMode = wgpu::PresentMode::Mailbox;
        else if (present == "fifoRelaxed") desc.presentMode = wgpu::PresentMode::FifoRelaxed;
        else FAIL_VOID(env, "Invalid presentMode");
        wgpu::SurfaceCapabilities caps{};
        if (surface_.GetCapabilities(adapter_, &caps) != wgpu::Status::Success)
            FAIL_VOID(env, "Cannot query surface capabilities");
        if (std::find(caps.formats, caps.formats + caps.formatCount, desc.format) == caps.formats + caps.formatCount)
            FAIL_VOID(env, "Texture format is unsupported by this surface");
        if (std::find(caps.presentModes, caps.presentModes + caps.presentModeCount, desc.presentMode) == caps.presentModes + caps.presentModeCount)
            FAIL_VOID(env, "Present mode is unsupported by this surface");
        if (std::find(caps.alphaModes, caps.alphaModes + caps.alphaModeCount, desc.alphaMode) == caps.alphaModes + caps.alphaModeCount)
            FAIL_VOID(env, "Alpha mode is unsupported by this surface");
        if ((desc.usage & caps.usages) != desc.usage)
            FAIL_VOID(env, "Texture usage is unsupported by this surface");
        std::vector<wgpu::TextureFormat> views;
        const auto jsViews = config.Get("viewFormats");
        if (jsViews.IsArray()) {
            auto array = jsViews.As<Napi::Array>();
            for (uint32_t i = 0; i < array.Length(); ++i) {
                wgpu::TextureFormat format;
                if (!TextureFormat(env, array.Get(i), format)) return;
                views.push_back(format);
            }
        }
        desc.viewFormats = views.data();
        desc.viewFormatCount = views.size();
        surface_.Configure(&desc);
        configured_ = true;
    }

    Napi::Value GetCurrentTexture(const Napi::CallbackInfo& info) {
        const auto env = info.Env();
        if (!Check(env)) return env.Undefined();
        if (!configured_) FAIL_VALUE(env, "Surface is not configured", env.Undefined());
        wgpu::SurfaceTexture texture{};
        surface_.GetCurrentTexture(&texture);
        if (texture.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessOptimal &&
            texture.status != wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal)
            FAIL_VALUE(env, "Could not acquire a surface texture (status " + std::to_string(static_cast<int>(texture.status)) + "); reconfigure and retry", env.Undefined());
        return wgpu::interop::GPUTexture::Create<wgpu::binding::GPUTexture>(env, device_, wgpu::TextureDescriptor{}, std::move(texture.texture));
    }

    void Present(const Napi::CallbackInfo& info) {
        if (!Check(info.Env())) return;
        if (!configured_) FAIL_VOID(info.Env(), "Surface is not configured");
        if (surface_.Present() != wgpu::Status::Success) FAIL_VOID(info.Env(), "Surface presentation failed");
    }

    void Unconfigure(const Napi::CallbackInfo&) {
        if (surface_ && configured_) surface_.Unconfigure();
        configured_ = false;
    }

    void Destroy(const Napi::CallbackInfo& info) {
        Unconfigure(info);
        surface_ = nullptr;
        adapter_ = nullptr;
        device_ = nullptr;
    }
};

// The WGPUDevice behind a GPUDevice, as a BigInt, for native code in the same
// process. It stays valid while the GPUDevice is alive; native code that keeps
// it longer must call wgpuDeviceAddRef.
Napi::Value DeviceHandle(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    wgpu::Device device = UnwrapDevice(info[0]);
    if (!device) FAIL_VALUE(env, "Expected a GPUDevice from native-dawn", env.Undefined());
    return Napi::BigInt::New(env, static_cast<uint64_t>(reinterpret_cast<uintptr_t>(device.Get())));
}

// Test hook: loses the device as a driver reset would, so tests can check how
// device.lost is delivered. Not part of the public API.
Napi::Value ForceDeviceLoss(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    if (!info[0].IsObject()) FAIL_VALUE(env, "Expected a GPUDevice from native-dawn", env.Undefined());
    auto* binding = wgpu::interop::GPUDevice::Unwrap(info[0].As<Napi::Object>());
    if (!binding) FAIL_VALUE(env, "Expected a GPUDevice from native-dawn", env.Undefined());
    static_cast<wgpu::binding::GPUDevice*>(binding)->ForceLoss(wgpu::DeviceLostReason::Unknown, "forced by native-dawn test hook");
    return env.Undefined();
}

}  // namespace

void Initialize(Napi::Env env, Napi::Object exports) {
    Surface::Init(env, exports);
    exports.Set("deviceHandle", Napi::Function::New(env, DeviceHandle, "deviceHandle"));
    exports.Set("_forceDeviceLoss", Napi::Function::New(env, ForceDeviceLoss, "_forceDeviceLoss"));
}

}  // namespace native_dawn
