#pragma once
#include <vector>

#include <webgpu/webgpu_cpp.h>

#include "src/dawn/node/interop/NodeAPI.h"

namespace native_dawn {
void Initialize(Napi::Env env, Napi::Object exports);
// The features addDeviceFeatures() registered for this adapter, appended to a
// requestDevice's (GPUAdapter::requestDevice calls it).
void AddRequestedFeatures(WGPUAdapter adapter, std::vector<wgpu::FeatureName>& features);
}
