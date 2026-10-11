#pragma once
#include <cstdint>
#include <vector>

#include <webgpu/webgpu_cpp.h>

#include "src/dawn/node/interop/NodeAPI.h"

namespace native_dawn {
void Initialize(Napi::Env env, Napi::Object exports);
// The features addDeviceFeatures() registered for this adapter, appended to a
// requestDevice's (GPUAdapter::requestDevice calls it).
void AddRequestedFeatures(WGPUAdapter adapter, std::vector<wgpu::FeatureName>& features);
// The webgpu.h handle behind a WebGPU object from this addon (false for anything else).
bool NativeHandleOf(Napi::Object object, uint64_t& handle);
// wasmImports() (src/node/wasm_imports.cpp).
void InitWasmImports(Napi::Env env, Napi::Object exports);
}
