// Builds test/c against an installed prefix with find_package(Dawn) and runs
// it, the way a C or C++ project outside Node would consume native-dawn.
//   node scripts/test-c.mjs [prefix]
// NATIVE_DAWN_TEST_SDL2=1 also builds and runs the SDL2 window test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { root, run, distDir } from './common.mjs'

const prefix = path.resolve(process.argv[2] || distDir)
const sdl2 = process.env.NATIVE_DAWN_TEST_SDL2 === '1'
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'native-dawn-c-'))
try {
  const args = ['-S', path.join(root, 'test/c'), '-B', build, '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_PREFIX_PATH=${prefix}`, `-DNATIVE_DAWN_TEST_SDL2=${sdl2 ? 'ON' : 'OFF'}`]
  if (process.platform !== 'win32' || process.env.VSCMD_VER) args.push('-G', 'Ninja')
  run('cmake', args)
  run('cmake', ['--build', build, '--config', 'Release'])
  const env = { ...process.env }
  if (process.platform === 'win32') env.PATH = `${path.join(prefix, 'bin')}${path.delimiter}${env.PATH}`
  const exe = name => {
    const file = name + (process.platform === 'win32' ? '.exe' : '')
    for (const dir of [build, path.join(build, 'Release')]) if (fs.existsSync(path.join(dir, file))) return path.join(dir, file)
    throw new Error(`${file} was not built`)
  }
  run(exe('compute'), [], { env })
  if (sdl2) run(exe('sdl2_window'), [], { env })
} finally {
  fs.rmSync(build, { recursive: true, force: true })
}
