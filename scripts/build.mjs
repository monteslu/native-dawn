import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { root, run, upstream, target, targets, pkg, distDir, binDir, assertTarget, isAndroid, hasAddon } from './common.mjs'

assertTarget()
const dawn = path.join(root, '.cache/dawn')

// The NDK: ANDROID_NDK_HOME or ANDROID_NDK_ROOT, else the newest under the SDK.
function androidNdk() {
  for (const name of ['ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT', 'ANDROID_NDK_LATEST_HOME']) {
    if (process.env[name] && fs.existsSync(process.env[name])) return process.env[name]
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const dir = sdk && path.join(sdk, 'ndk')
  const versions = dir && fs.existsSync(dir) ? fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []
  if (!versions.length) throw new Error('Android builds need the NDK: set ANDROID_NDK_HOME')
  return path.join(dir, versions.at(-1))
}

// A Go toolchain unpacked into .cache/go is used when none is on PATH.
const env = { ...process.env }
const localGo = path.join(root, '.cache/go/bin')
if (fs.existsSync(localGo)) env.PATH = `${localGo}${path.delimiter}${env.PATH}`

fs.mkdirSync(dawn, { recursive: true })
if (!fs.existsSync(path.join(dawn, '.git'))) run('git', ['init', '-q'], { cwd: dawn })
const rev = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dawn, encoding: 'utf8' }).stdout?.trim()
if (rev !== upstream.dawn.revision) {
  run('git', ['fetch', '--depth', '1', upstream.dawn.url, upstream.dawn.revision], { cwd: dawn })
  run('git', ['checkout', '--detach', upstream.dawn.revision], { cwd: dawn })
}
run(process.platform === 'win32' ? 'python' : 'python3', [path.join(root, 'scripts/fetch-dependencies.py'), dawn])

// Small, checked hooks into Dawn's Node bindings. Everything else lives in src/node.
function insert(relative, needle, replacement) {
  const file = path.join(dawn, relative)
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes(replacement)) return
  if (text.split(needle).length !== 2) throw new Error(`Dawn changed around a native-dawn hook in ${relative}; update scripts/build.mjs`)
  fs.writeFileSync(file, text.replace(needle, replacement))
}
insert('src/dawn/node/Module.cpp', '#include "dawn/dawn_proc.h"', '#include "dawn/dawn_proc.h"\n#include "extensions.h"')
// The addon calls webgpu_dawn's exported functions directly, so Dawn's proc
// table (and the dawn_proc library behind it) is not used.
insert('src/dawn/node/Module.cpp', '    dawnProcSetProcs(&dawn::native::GetProcs());', '    // native-dawn: wgpu* calls go straight to the shared webgpu_dawn library.')
insert('src/dawn/node/Module.cpp', '    return exports;', '    native_dawn::Initialize(env, exports);\n    return exports;')
insert('src/dawn/node/binding/GPUDevice.h', '    ~GPUDevice() override;', '    ~GPUDevice() override;\n    wgpu::Device GetNativeDawnDevice() const { return device_; }')

const build = path.join(root, 'build', target)
const args = ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Release', `-DNATIVE_DAWN_NODE=${hasAddon ? 'ON' : 'OFF'}`]
// Ninja when a compiler environment is already set up (always on Linux and
// macOS, and on Windows inside a developer prompt); Visual Studio otherwise.
if (process.platform !== 'win32' || process.env.VSCMD_VER) args.push('-G', 'Ninja')
else args.push('-A', process.arch === 'arm64' ? 'ARM64' : 'x64')
const ndk = isAndroid ? androidNdk() : null
if (isAndroid) {
  args.push(
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(ndk, 'build/cmake/android.toolchain.cmake')}`,
    '-DANDROID_ABI=arm64-v8a',
    '-DANDROID_PLATFORM=android-26',
    '-DANDROID_STL=c++_static',
  )
} else if (target !== `${process.platform}-${process.arch}` || !targets.includes(target)) {
  throw new Error(`Cross-compiling ${target} is not supported; build it on a ${target} machine`)
}
if (process.platform === 'darwin') args.push(`-DCMAKE_OSX_ARCHITECTURES=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0')
if (process.env.NATIVE_DAWN_COMPILER_LAUNCHER) {
  const launcher = process.env.NATIVE_DAWN_COMPILER_LAUNCHER
  args.push(`-DCMAKE_C_COMPILER_LAUNCHER=${launcher}`, `-DCMAKE_CXX_COMPILER_LAUNCHER=${launcher}`)
  // sccache cannot cache MSVC's /Zi program databases.
  if (process.platform === 'win32') args.push('-DCMAKE_POLICY_DEFAULT_CMP0141=NEW', '-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded')
}
run('cmake', args, { env })
const jobs = process.env.NATIVE_DAWN_BUILD_JOBS || String(Math.min(8, os.availableParallelism()))
// Dawn loads dxcompiler.dll at runtime; upstream only builds it as a dependency
// of the static dawn_native, so ask for it by name.
const buildTargets = ['webgpu_dawn', ...(hasAddon ? ['dawn_node'] : []), ...(target.startsWith('win32-') ? ['dxcompiler'] : [])]
run('cmake', ['--build', build, '--config', 'Release', '--target', ...buildTargets, '--parallel', jobs], { env })

fs.rmSync(distDir, { recursive: true, force: true })
run('cmake', ['--install', build, '--config', 'Release', '--prefix', distDir], { env })

// Installed static helper libraries and CMake files for them are not part of
// the SDK: consumers link webgpu_dawn only.
const libDir = path.join(distDir, 'lib')
for (const name of fs.readdirSync(libDir)) {
  if (/\.(a)$/.test(name) || (target.startsWith('win32-') && name.endsWith('.lib') && name !== 'webgpu_dawn.lib')) {
    fs.rmSync(path.join(libDir, name))
  }
}

// A file from the newest Windows 10/11 SDK, e.g. bin/<version>/arm64/dxil.dll.
function windowsSdkFile(arch, name) {
  const roots = [process.env.WindowsSdkDir, path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10')].filter(Boolean)
  for (const root of roots) {
    const bin = path.join(root, 'bin')
    if (!fs.existsSync(bin)) continue
    const preferred = process.env.WindowsSDKVersion?.replace(/[\\/]+$/, '')
    const versions = fs.readdirSync(bin).filter(v => /^10\./.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of preferred ? [preferred, ...versions] : versions) {
      const file = path.join(bin, version, arch, name)
      if (fs.existsSync(file)) return file
    }
  }
  throw new Error(`No ${arch} ${name} in the Windows SDK`)
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return file
    if (entry.isDirectory()) { const found = findFile(file, name); if (found) return found }
  }
}
if (target.startsWith('win32-')) {
  const arch = target === 'win32-arm64' ? 'arm64' : 'x64'
  const dxcompiler = findFile(build, 'dxcompiler.dll')
  if (!dxcompiler) throw new Error('Build did not produce dxcompiler.dll')
  fs.copyFileSync(dxcompiler, path.join(distDir, 'bin', 'dxcompiler.dll'))
  // dxil.dll (the DXIL validator/signer) comes from the Windows SDK. Dawn's own
  // copy step always takes the x64 one, so pick the target's architecture here.
  fs.copyFileSync(windowsSdkFile(arch, 'dxil.dll'), path.join(distDir, 'bin', 'dxil.dll'))
  // A DLL for the wrong architecture fails to load at runtime with a misleading
  // error, so check every shipped binary's PE machine type.
  const machine = { x64: 0x8664, arm64: 0xaa64 }[arch]
  for (const name of fs.readdirSync(path.join(distDir, 'bin')).filter(n => /\.(dll|node)$/.test(n))) {
    const pe = fs.readFileSync(path.join(distDir, 'bin', name))
    const actual = pe.readUInt16LE(pe.readUInt32LE(0x3c) + 4)
    if (actual !== machine) throw new Error(`${name} is for machine 0x${actual.toString(16)}, not ${arch}`)
  }
}
if (isAndroid) {
  const strip = path.join(ndk, 'toolchains/llvm/prebuilt', `${process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'}-x86_64`, 'bin', `llvm-strip${process.platform === 'win32' ? '.exe' : ''}`)
  run(strip, ['--strip-unneeded', path.join(distDir, 'lib', 'libwebgpu_dawn.so')])
} else if (process.platform === 'linux') {
  for (const name of ['dawn.node', 'libwebgpu_dawn.so']) run('strip', ['--strip-unneeded', path.join(distDir, binDir, name)])
}
if (!isAndroid && process.platform === 'darwin') {
  for (const name of ['dawn.node', 'libwebgpu_dawn.dylib']) run('strip', ['-x', path.join(distDir, binDir, name)])
}

// Licenses for everything compiled into the binaries, without the sources.
const licenses = path.join(distDir, 'share/native-dawn/licenses')
fs.mkdirSync(licenses, { recursive: true })
fs.copyFileSync(path.join(dawn, 'LICENSE'), path.join(licenses, 'dawn-LICENSE'))
for (const entry of fs.readdirSync(path.join(dawn, 'third_party'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  for (const base of ['', 'src']) {
    const dir = path.join(dawn, 'third_party', entry.name, base)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (/^(LICENSE|COPYING|NOTICE|ThirdPartyNotices)(\.|$)/i.test(name) && fs.statSync(path.join(dir, name)).isFile()) {
        fs.copyFileSync(path.join(dir, name), path.join(licenses, `${entry.name}-${name}`))
      }
    }
  }
}
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(licenses, 'native-dawn-LICENSE'))
fs.copyFileSync(path.join(root, 'NOTICE'), path.join(distDir, 'share/native-dawn/NOTICE'))
fs.writeFileSync(path.join(distDir, 'build.json'), JSON.stringify({ version: pkg.version, target, dawn: upstream.dawn.revision }, null, 2) + '\n')
console.log(`Built ${distDir}`)
