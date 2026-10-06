#!/usr/bin/env node
// Prints install locations for build systems, e.g.
//   cmake -DCMAKE_PREFIX_PATH="$(npx native-dawn prefix)" ...
import { paths } from '../paths.js'

const keys = { prefix: 'prefix', include: 'include', lib: 'lib', bin: 'bin', cmake: 'cmake', library: 'library', addon: 'addon', 'dawn-json': 'dawnJson', licenses: 'licenses' }
const name = process.argv[2]
if (!keys[name]) {
  console.error(`usage: native-dawn <${Object.keys(keys).join('|')}>`)
  process.exit(2)
}
console.log(paths[keys[name]])
