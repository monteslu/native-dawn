// Builds test/c with the NDK against an Android prefix, pushes it to the
// device or emulator adb is connected to, and runs it there.
//   NATIVE_DAWN_TARGET=android-arm64 node scripts/test-android.mjs [prefix]
// On an x86_64 emulator, the arm64 binary runs through Android's ARM translation.
// NATIVE_DAWN_TEST_* variables are passed through to the device.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, run, target, distDir, isAndroid } from './common.mjs'

if (!isAndroid) throw new Error('Set NATIVE_DAWN_TARGET=android-arm64')
const prefix = path.resolve(process.argv[2] || distDir)
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
function ndk() {
  for (const name of ['ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT', 'ANDROID_NDK_LATEST_HOME']) {
    if (process.env[name] && fs.existsSync(process.env[name])) return process.env[name]
  }
  const dir = path.join(sdk, 'ndk')
  return path.join(dir, fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1))
}
const adb = sdk && fs.existsSync(path.join(sdk, 'platform-tools/adb')) ? path.join(sdk, 'platform-tools/adb') : 'adb'

const build = fs.mkdtempSync(path.join(os.tmpdir(), 'native-dawn-android-'))
const remote = '/data/local/tmp/native-dawn'
try {
  run('cmake', ['-S', path.join(root, 'test/c'), '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(ndk(), 'build/cmake/android.toolchain.cmake')}`,
    '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-26',
    `-DDawn_DIR=${path.join(prefix, 'lib/cmake/Dawn')}`, `-DCMAKE_FIND_ROOT_PATH=${prefix}`])
  run('cmake', ['--build', build])
  run(adb, ['shell', `rm -rf ${remote} && mkdir -p ${remote}`])
  run(adb, ['push', path.join(build, 'compute'), path.join(prefix, 'lib/libwebgpu_dawn.so'), `${remote}/`])
  const vars = Object.entries(process.env).filter(([k]) => k.startsWith('NATIVE_DAWN_TEST_')).map(([k, v]) => `${k}=${v}`).join(' ')
  const result = spawnSync(adb, ['shell', `cd ${remote} && chmod 755 compute && ${vars} LD_LIBRARY_PATH=${remote} ./compute; echo "exit=$?"`], { encoding: 'utf8' })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (!/exit=0\s*$/.test(result.stdout)) throw new Error(`compute failed on the device (${target})`)
  console.log(`Android ${target}: C test passed on the device`)
} finally {
  spawnSync(adb, ['shell', `rm -rf ${remote}`])
  fs.rmSync(build, { recursive: true, force: true })
}
