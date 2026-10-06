export interface NativeDawnPaths {
  /** `${process.platform}-${process.arch}` */
  readonly target: string
  /** Install prefix: pass it as CMAKE_PREFIX_PATH to find_package(Dawn). */
  readonly prefix: string
  readonly include: string
  readonly lib: string
  readonly bin: string
  readonly cmake: string
  /** The shared library: libwebgpu_dawn.so, libwebgpu_dawn.dylib or webgpu_dawn.dll. */
  readonly library: string
  readonly addon: string
  /** Dawn's machine-readable description of the WebGPU API. */
  readonly dawnJson: string
  readonly licenses: string
}
export declare const paths: NativeDawnPaths
export default paths
