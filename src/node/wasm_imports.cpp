// wasmImports(): a WebAssembly module's hot webgpu.h imports as direct calls
// into Dawn.
//
// A wasm program built against webgpu.h (emdawnwebgpu's ABI: objects are
// 32-bit pointers in its memory, 64-bit sizes and offsets are BigInt) gets its
// WebGPU from JavaScript glue that turns each call into a call on this addon's
// WebGPU objects. Pass encoding is most of a frame's calls, and each costs the
// glue's lookups plus the binding's argument conversion: about 1.5 us, where
// the Dawn call itself is a few tens of nanoseconds. These functions take the
// same arguments as the glue's and call Dawn's C API straight away.
//
// The glue still makes every object: it reports each one with the pointer the
// wasm program holds (register), and its release (forget). A call naming a
// pointer that is not registered, or memory outside the view it was given,
// goes to the glue's function instead, so the result is the same either way.

#include "extensions.h"

#include <cstring>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include <webgpu/webgpu.h>

namespace native_dawn {
namespace {

struct Table;
struct Call { Table* table; int index; };

struct Table {
    std::unordered_map<uint32_t, void*> handles;
    napi_ref memory = nullptr;  // a Uint8Array over the wasm memory (memory(view))
    std::vector<napi_ref> fallback;
    std::vector<Call> calls;
    double nativeCalls = 0, fallbackCalls = 0;
    int holders = 0;  // the object wasmImports returned, and each import function
};

// The table goes once nothing that uses it is left.
void Release(napi_env env, void* data, void*) {
    auto* t = static_cast<Table*>(data);
    if (--t->holders > 0) return;
    for (napi_ref r : t->fallback) if (r) napi_delete_reference(env, r);
    if (t->memory) napi_delete_reference(env, t->memory);
    delete t;
}

constexpr size_t kMaxArgs = 8;

struct Args {
    napi_env env;
    size_t argc = kMaxArgs;
    napi_value argv[kMaxArgs];
    Table* t;
};

inline uint32_t U32(Args& a, size_t i) {
    uint32_t v = 0;
    if (i < a.argc) napi_get_value_uint32(a.env, a.argv[i], &v);
    return v;
}
inline int32_t I32(Args& a, size_t i) {
    int32_t v = 0;
    if (i < a.argc) napi_get_value_int32(a.env, a.argv[i], &v);
    return v;
}
inline double F64(Args& a, size_t i) {
    double v = 0;
    if (i < a.argc) napi_get_value_double(a.env, a.argv[i], &v);
    return v;
}
// i64: a BigInt (-1n, WGPU_WHOLE_SIZE, wraps to all ones), or a Number
inline uint64_t U64(Args& a, size_t i) {
    if (i >= a.argc) return 0;
    uint64_t v = 0;
    bool lossless;
    if (napi_get_value_bigint_uint64(a.env, a.argv[i], &v, &lossless) == napi_ok) return v;
    double d = 0;
    napi_get_value_double(a.env, a.argv[i], &d);
    return d < 0 ? ~uint64_t(0) : static_cast<uint64_t>(d);
}
inline void* H(Args& a, size_t i) {
    uint32_t p = U32(a, i);
    if (!p) return nullptr;
    auto it = a.t->handles.find(p);
    return it == a.t->handles.end() ? nullptr : it->second;
}
// The wasm memory at ptr, or null when [ptr, ptr + size) is outside the view.
// Read from the view every time: growing a memory that is not shared detaches
// its old buffer (length 0 here), and the glue's function then answers the
// call, after which the host hands over a view of the new buffer.
inline const uint8_t* Mem(Args& a, uint32_t ptr, uint64_t size) {
    if (!a.t->memory) return nullptr;
    napi_value view;
    if (napi_get_reference_value(a.env, a.t->memory, &view) != napi_ok || !view) return nullptr;
    napi_typedarray_type type;
    size_t length = 0, offset = 0;
    void* data = nullptr;
    if (napi_get_typedarray_info(a.env, view, &type, &length, &data, nullptr, &offset) != napi_ok || !data) return nullptr;
    if (static_cast<uint64_t>(ptr) + size > length) return nullptr;
    return static_cast<const uint8_t*>(data) + ptr;
}

#define NEED(x) if (!(x)) return false
// an optional object: 0 is null, anything else must be registered
#define OPT(var, i) uint32_t var##Ptr = U32(a, i); void* var = H(a, i); if (var##Ptr) NEED(var)

using Body = bool (*)(Args&);
struct Native { const char* name; Body body; };

const Native kNatives[] = {
    { "wgpuRenderPassEncoderSetPipeline", [](Args& a) {
        void* pass = H(a, 0); void* pipe = H(a, 1); NEED(pass); NEED(pipe);
        wgpuRenderPassEncoderSetPipeline(static_cast<WGPURenderPassEncoder>(pass), static_cast<WGPURenderPipeline>(pipe));
        return true; } },
    { "wgpuRenderPassEncoderSetBindGroup", [](Args& a) {
        void* pass = H(a, 0); NEED(pass); OPT(group, 2);
        uint32_t count = U32(a, 3);
        const uint32_t* offsets = nullptr;
        if (count) { auto* m = Mem(a, U32(a, 4), uint64_t(count) * 4); NEED(m); offsets = reinterpret_cast<const uint32_t*>(m); }
        wgpuRenderPassEncoderSetBindGroup(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1), static_cast<WGPUBindGroup>(group), count, offsets);
        return true; } },
    { "wgpuRenderPassEncoderSetVertexBuffer", [](Args& a) {
        void* pass = H(a, 0); NEED(pass); OPT(buffer, 2);
        wgpuRenderPassEncoderSetVertexBuffer(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1), static_cast<WGPUBuffer>(buffer), U64(a, 3), U64(a, 4));
        return true; } },
    { "wgpuRenderPassEncoderSetIndexBuffer", [](Args& a) {
        void* pass = H(a, 0); void* buffer = H(a, 1); NEED(pass); NEED(buffer);
        wgpuRenderPassEncoderSetIndexBuffer(static_cast<WGPURenderPassEncoder>(pass), static_cast<WGPUBuffer>(buffer),
                                            static_cast<WGPUIndexFormat>(U32(a, 2)), U64(a, 3), U64(a, 4));
        return true; } },
    { "wgpuRenderPassEncoderDraw", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderDraw(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1), U32(a, 2), U32(a, 3), U32(a, 4));
        return true; } },
    { "wgpuRenderPassEncoderDrawIndexed", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderDrawIndexed(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1), U32(a, 2), U32(a, 3), I32(a, 4), U32(a, 5));
        return true; } },
    { "wgpuRenderPassEncoderDrawIndirect", [](Args& a) {
        void* pass = H(a, 0); void* buffer = H(a, 1); NEED(pass); NEED(buffer);
        wgpuRenderPassEncoderDrawIndirect(static_cast<WGPURenderPassEncoder>(pass), static_cast<WGPUBuffer>(buffer), U64(a, 2));
        return true; } },
    { "wgpuRenderPassEncoderDrawIndexedIndirect", [](Args& a) {
        void* pass = H(a, 0); void* buffer = H(a, 1); NEED(pass); NEED(buffer);
        wgpuRenderPassEncoderDrawIndexedIndirect(static_cast<WGPURenderPassEncoder>(pass), static_cast<WGPUBuffer>(buffer), U64(a, 2));
        return true; } },
    { "wgpuRenderPassEncoderSetViewport", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderSetViewport(static_cast<WGPURenderPassEncoder>(pass), float(F64(a, 1)), float(F64(a, 2)), float(F64(a, 3)),
                                         float(F64(a, 4)), float(F64(a, 5)), float(F64(a, 6)));
        return true; } },
    { "wgpuRenderPassEncoderSetScissorRect", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderSetScissorRect(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1), U32(a, 2), U32(a, 3), U32(a, 4));
        return true; } },
    { "wgpuRenderPassEncoderSetStencilReference", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderSetStencilReference(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1));
        return true; } },
    { "wgpuRenderPassEncoderSetBlendConstant", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        uint32_t c = U32(a, 1);
        auto* m = Mem(a, c, sizeof(WGPUColor)); NEED(m && !(c & 7));
        wgpuRenderPassEncoderSetBlendConstant(static_cast<WGPURenderPassEncoder>(pass), reinterpret_cast<const WGPUColor*>(m));
        return true; } },
    { "wgpuRenderPassEncoderBeginOcclusionQuery", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderBeginOcclusionQuery(static_cast<WGPURenderPassEncoder>(pass), U32(a, 1));
        return true; } },
    { "wgpuRenderPassEncoderEndOcclusionQuery", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderEndOcclusionQuery(static_cast<WGPURenderPassEncoder>(pass));
        return true; } },
    { "wgpuRenderPassEncoderExecuteBundles", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        uint32_t n = U32(a, 1), list = U32(a, 2);
        auto* m = Mem(a, list, uint64_t(n) * 4); NEED(m && !(list & 3) && n <= 4096);
        std::vector<WGPURenderBundle> bundles(n);
        for (uint32_t i = 0; i < n; i++) {
            uint32_t p; std::memcpy(&p, m + i * 4, 4);
            auto it = a.t->handles.find(p);
            NEED(p && it != a.t->handles.end());
            bundles[i] = static_cast<WGPURenderBundle>(it->second);
        }
        wgpuRenderPassEncoderExecuteBundles(static_cast<WGPURenderPassEncoder>(pass), n, bundles.data());
        return true; } },
    { "wgpuRenderPassEncoderEnd", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuRenderPassEncoderEnd(static_cast<WGPURenderPassEncoder>(pass));
        return true; } },
    { "wgpuComputePassEncoderSetPipeline", [](Args& a) {
        void* pass = H(a, 0); void* pipe = H(a, 1); NEED(pass); NEED(pipe);
        wgpuComputePassEncoderSetPipeline(static_cast<WGPUComputePassEncoder>(pass), static_cast<WGPUComputePipeline>(pipe));
        return true; } },
    { "wgpuComputePassEncoderSetBindGroup", [](Args& a) {
        void* pass = H(a, 0); NEED(pass); OPT(group, 2);
        uint32_t count = U32(a, 3);
        const uint32_t* offsets = nullptr;
        if (count) { auto* m = Mem(a, U32(a, 4), uint64_t(count) * 4); NEED(m); offsets = reinterpret_cast<const uint32_t*>(m); }
        wgpuComputePassEncoderSetBindGroup(static_cast<WGPUComputePassEncoder>(pass), U32(a, 1), static_cast<WGPUBindGroup>(group), count, offsets);
        return true; } },
    { "wgpuComputePassEncoderDispatchWorkgroups", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuComputePassEncoderDispatchWorkgroups(static_cast<WGPUComputePassEncoder>(pass), U32(a, 1), U32(a, 2), U32(a, 3));
        return true; } },
    { "wgpuComputePassEncoderDispatchWorkgroupsIndirect", [](Args& a) {
        void* pass = H(a, 0); void* buffer = H(a, 1); NEED(pass); NEED(buffer);
        wgpuComputePassEncoderDispatchWorkgroupsIndirect(static_cast<WGPUComputePassEncoder>(pass), static_cast<WGPUBuffer>(buffer), U64(a, 2));
        return true; } },
    { "wgpuComputePassEncoderEnd", [](Args& a) {
        void* pass = H(a, 0); NEED(pass);
        wgpuComputePassEncoderEnd(static_cast<WGPUComputePassEncoder>(pass));
        return true; } },
    { "wgpuQueueWriteBuffer", [](Args& a) {
        void* queue = H(a, 0); void* buffer = H(a, 1); NEED(queue); NEED(buffer);
        uint32_t size = U32(a, 4);
        auto* m = Mem(a, U32(a, 3), size); NEED(m);
        wgpuQueueWriteBuffer(static_cast<WGPUQueue>(queue), static_cast<WGPUBuffer>(buffer), U64(a, 2), m, size);
        return true; } },
};
#undef NEED
#undef OPT
constexpr int kNativeCount = static_cast<int>(sizeof kNatives / sizeof kNatives[0]);

napi_value CallImport(napi_env env, napi_callback_info info) {
    Args a;
    a.env = env;
    void* data = nullptr;
    napi_get_cb_info(env, info, &a.argc, a.argv, nullptr, &data);
    if (a.argc > kMaxArgs) a.argc = kMaxArgs;
    auto* call = static_cast<Call*>(data);
    a.t = call->table;
    if (kNatives[call->index].body(a)) { a.t->nativeCalls++; return nullptr; }
    a.t->fallbackCalls++;
    napi_value fn, global, result = nullptr;
    napi_get_reference_value(env, a.t->fallback[call->index], &fn);
    napi_get_global(env, &global);
    napi_call_function(env, global, fn, a.argc, a.argv, &result);
    return result;
}

Table* TableOf(const Napi::CallbackInfo& info) { return static_cast<Table*>(info.Data()); }

// wasmImports(glue): { imports, register(pointer, object), forget(pointer), memory(view), stats() }
Napi::Value WasmImports(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "wasmImports: expected an object of the glue's import functions").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const auto glue = info[0].As<Napi::Object>();
    auto* t = new Table();
    t->fallback.assign(kNativeCount, nullptr);
    t->calls.reserve(kNativeCount);  // never reallocated: each import keeps a pointer into it
    for (int i = 0; i < kNativeCount; i++) t->calls.push_back(Call{ t, i });

    auto result = Napi::Object::New(env);
    auto imports = Napi::Object::New(env);
    for (int i = 0; i < kNativeCount; i++) {
        Napi::Value fn = glue.Get(kNatives[i].name);
        if (!fn.IsFunction()) continue;
        napi_create_reference(env, fn, 1, &t->fallback[i]);
        napi_value native;
        napi_create_function(env, kNatives[i].name, NAPI_AUTO_LENGTH, CallImport, &t->calls[i], &native);
        t->holders++;
        napi_add_finalizer(env, native, t, Release, nullptr, nullptr);
        imports.Set(kNatives[i].name, native);
    }
    result.Set("imports", imports);
    result.Set("register", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        Table* t = TableOf(info);
        uint64_t h = 0;
        const uint32_t ptr = info[0].As<Napi::Number>().Uint32Value();
        if (ptr && info[1].IsObject() && NativeHandleOf(info[1].As<Napi::Object>(), h) && h)
            t->handles[ptr] = reinterpret_cast<void*>(static_cast<uintptr_t>(h));
        else if (ptr)
            t->handles.erase(ptr);
        return info.Env().Undefined();
    }, "register", t));
    result.Set("forget", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        TableOf(info)->handles.erase(info[0].As<Napi::Number>().Uint32Value());
        return info.Env().Undefined();
    }, "forget", t));
    result.Set("memory", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        Table* t = TableOf(info);
        const auto env = info.Env();
        if (t->memory) { napi_delete_reference(env, t->memory); t->memory = nullptr; }
        napi_typedarray_type type;
        if (info[0].IsTypedArray() &&
            napi_get_typedarray_info(env, info[0], &type, nullptr, nullptr, nullptr, nullptr) == napi_ok && type == napi_uint8_array)
            napi_create_reference(env, info[0], 1, &t->memory);
        return env.Undefined();
    }, "memory", t));
    result.Set("stats", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        Table* t = TableOf(info);
        auto o = Napi::Object::New(info.Env());
        o.Set("native", t->nativeCalls);
        o.Set("fallback", t->fallbackCalls);
        o.Set("handles", static_cast<double>(t->handles.size()));
        return o;
    }, "stats", t));
    // The table lives while the object handed back or any import function does.
    t->holders++;
    napi_add_finalizer(env, result, t, Release, nullptr, nullptr);
    return result;
}

}  // namespace

void InitWasmImports(Napi::Env env, Napi::Object exports) {
    exports.Set("wasmImports", Napi::Function::New(env, WasmImports, "wasmImports"));
}

}  // namespace native_dawn
