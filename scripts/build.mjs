import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { root, run, upstream, target, pkg, distDir, binDir, assertTarget } from './common.mjs'

assertTarget()
const dawn = path.join(root, '.cache/dawn')
const build = path.join(root, 'build')

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

// Two small hooks into Dawn's Node bindings. Everything else lives in src/node.
function insert(relative, needle, replacement) {
  const file = path.join(dawn, relative)
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes(replacement)) return
  if (text.split(needle).length !== 2) throw new Error(`Dawn changed around a native-dawn hook in ${relative}; update scripts/build.mjs`)
  fs.writeFileSync(file, text.replace(needle, replacement))
}
insert('src/dawn/node/Module.cpp', '#include "dawn/dawn_proc.h"', '#include "dawn/dawn_proc.h"\n#include "extensions.h"')
insert('src/dawn/node/Module.cpp', '    return exports;', '    native_dawn::Initialize(env, exports);\n    return exports;')
insert('src/dawn/node/binding/GPUDevice.h', '    ~GPUDevice() override;', '    ~GPUDevice() override;\n    wgpu::Device GetNativeDawnDevice() const { return device_; }')

const args = ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Release']
// Ninja when a compiler environment is already set up (always on Linux and
// macOS, and on Windows inside a developer prompt); Visual Studio otherwise.
if (process.platform !== 'win32' || process.env.VSCMD_VER) args.push('-G', 'Ninja')
else args.push('-A', process.arch === 'arm64' ? 'ARM64' : 'x64')
if (process.platform === 'darwin') args.push(`-DCMAKE_OSX_ARCHITECTURES=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0')
if (process.env.NATIVE_DAWN_COMPILER_LAUNCHER) {
  const launcher = process.env.NATIVE_DAWN_COMPILER_LAUNCHER
  args.push(`-DCMAKE_C_COMPILER_LAUNCHER=${launcher}`, `-DCMAKE_CXX_COMPILER_LAUNCHER=${launcher}`)
  // sccache cannot cache MSVC's /Zi program databases.
  if (process.platform === 'win32') args.push('-DCMAKE_POLICY_DEFAULT_CMP0141=NEW', '-DCMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded')
}
run('cmake', args, { env })
const jobs = process.env.NATIVE_DAWN_BUILD_JOBS || String(Math.min(8, os.availableParallelism()))
run('cmake', ['--build', build, '--config', 'Release', '--target', 'webgpu_dawn', 'dawn_node', '--parallel', jobs], { env })

fs.rmSync(distDir, { recursive: true, force: true })
run('cmake', ['--install', build, '--config', 'Release', '--prefix', distDir], { env })

// Installed static helper libraries and CMake files for them are not part of
// the SDK: consumers link webgpu_dawn only.
const libDir = path.join(distDir, 'lib')
for (const name of fs.readdirSync(libDir)) {
  if (/\.(a)$/.test(name) || (process.platform === 'win32' && name.endsWith('.lib') && name !== 'webgpu_dawn.lib')) {
    fs.rmSync(path.join(libDir, name))
  }
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return file
    if (entry.isDirectory()) { const found = findFile(file, name); if (found) return found }
  }
}
if (process.platform === 'win32') {
  for (const name of ['dxcompiler.dll', 'dxil.dll']) {
    const source = findFile(build, name)
    if (!source) throw new Error(`Build did not produce ${name}`)
    fs.copyFileSync(source, path.join(distDir, 'bin', name))
  }
}
if (process.platform === 'linux') {
  for (const name of ['dawn.node', 'libwebgpu_dawn.so']) run('strip', ['--strip-unneeded', path.join(distDir, binDir, name)])
}
if (process.platform === 'darwin') {
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
