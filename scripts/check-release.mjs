import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { root, pkg, targets } from './common.mjs'

if (process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error(`Tag ${process.env.GITHUB_REF_NAME} does not match package.json version ${pkg.version}`)
for (const target of targets) {
  const name = `native-dawn-v${pkg.version}-${target}.tar.gz`
  const archive = await fs.readFile(path.join(root, 'artifacts', name))
  const checksum = await fs.readFile(path.join(root, 'artifacts', `${name}.sha256`), 'utf8')
  if (createHash('sha256').update(archive).digest('hex') !== checksum.trim().split(/\s+/)[0]) throw new Error(`Checksum mismatch: ${name}`)
}
console.log(`Verified v${pkg.version}: ${targets.length} archives and checksums`)
