import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './common.mjs'

// One process per file keeps each file's GPU devices and addon state separate.
for (const file of fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.mjs')).sort()) {
  const result = spawnSync(process.execPath, [path.join(root, 'test', file)], { cwd: root, stdio: 'inherit', timeout: 180000 })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
