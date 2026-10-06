// Locations inside the installed native build. Importing this module does not
// load the Node addon, so build scripts for C and C++ code can use it.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const target = `${process.platform}-${process.arch}`
const prefix = fileURLToPath(new URL(`./dist/${target}/`, import.meta.url))
const binaries = path.join(prefix, process.platform === 'win32' ? 'bin' : 'lib')

export const paths = Object.freeze({
  target,
  prefix,
  include: path.join(prefix, 'include'),
  lib: path.join(prefix, 'lib'),
  bin: path.join(prefix, 'bin'),
  cmake: path.join(prefix, 'lib', 'cmake'),
  library: path.join(binaries, { win32: 'webgpu_dawn.dll', darwin: 'libwebgpu_dawn.dylib' }[process.platform] ?? 'libwebgpu_dawn.so'),
  addon: path.join(binaries, 'dawn.node'),
  dawnJson: path.join(prefix, 'share', 'native-dawn', 'dawn.json'),
  licenses: path.join(prefix, 'share', 'native-dawn', 'licenses'),
})
export default paths
