import { createRequire } from 'node:module'
import { paths } from './paths.js'

let addon
try {
  addon = createRequire(import.meta.url)(paths.addon)
} catch (cause) {
  throw new Error(`native-dawn: cannot load the ${paths.target} addon from ${paths.addon}. Run npm install, or npm run build in a source checkout. ${cause.message}`, { cause })
}

export { paths }
export const { create, globals, NativeSurface, deviceHandle } = addon
export default addon
