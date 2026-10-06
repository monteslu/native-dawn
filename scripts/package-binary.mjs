import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { c as tar } from 'tar'
import { root, assetName, distDir, binDir, hasAddon, manifestMatches } from './common.mjs'

if (!manifestMatches(JSON.parse(await fs.readFile(path.join(distDir, 'build.json'))))) throw new Error('Refusing to package a stale native build')
await fs.access(path.join(distDir, binDir, hasAddon ? 'dawn.node' : 'libwebgpu_dawn.so'))
await fs.mkdir(path.join(root, 'artifacts'), { recursive: true })
const file = path.join(root, 'artifacts', assetName)
await tar({ file, cwd: distDir, gzip: { level: 9 }, portable: true }, await fs.readdir(distDir))
const hash = createHash('sha256').update(await fs.readFile(file)).digest('hex')
await fs.writeFile(`${file}.sha256`, `${hash}  ${assetName}\n`)
console.log(file)
