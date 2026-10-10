// Reads the import, delay-load import and export tables of a Windows PE file
// (PE32 or PE32+), for checks that must not depend on dumpbin's text format.
import fs from 'node:fs'

/**
 * @param {string} file
 * @returns {{ imports: Map<string, string[]>, delayImports: Map<string, string[]>, exports: string[] }}
 *   DLL names are as written in the file; functions imported by ordinal are '#<n>'.
 */
export function readPe(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error(`${file}: not a PE file`)
  const pe = b.readUInt32LE(0x3c)
  if (b.readUInt32LE(pe) !== 0x4550) throw new Error(`${file}: no PE signature`)
  const sectionCount = b.readUInt16LE(pe + 6)
  const optional = pe + 24
  const pe32plus = b.readUInt16LE(optional) === 0x20b
  const dirs = optional + (pe32plus ? 112 : 96)
  const dir = i => ({ rva: b.readUInt32LE(dirs + i * 8), size: b.readUInt32LE(dirs + i * 8 + 4) })
  const sectionTable = optional + b.readUInt16LE(pe + 20)
  const sections = []
  for (let i = 0; i < sectionCount; i++) {
    const s = sectionTable + i * 40
    sections.push({ va: b.readUInt32LE(s + 12), vsize: Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16)), raw: b.readUInt32LE(s + 20) })
  }
  const off = rva => {
    const s = sections.find(s => rva >= s.va && rva < s.va + s.vsize)
    if (!s) throw new Error(`${file}: RVA 0x${rva.toString(16)} is in no section`)
    return rva - s.va + s.raw
  }
  const str = rva => { const o = off(rva); return b.toString('latin1', o, b.indexOf(0, o)) }
  const thunkSize = pe32plus ? 8 : 4
  const names = tableRva => {
    const out = []
    for (let o = off(tableRva); ; o += thunkSize) {
      const t = pe32plus ? b.readBigUInt64LE(o) : BigInt(b.readUInt32LE(o))
      if (t === 0n) break
      const byOrdinal = pe32plus ? t >> 63n : t >> 31n
      out.push(byOrdinal ? `#${Number(t & 0xffffn)}` : str(Number(t & 0x7fffffffn) + 2))
    }
    return out
  }

  const imports = new Map()
  const imp = dir(1)
  if (imp.rva) {
    for (let o = off(imp.rva); b.readUInt32LE(o + 12); o += 20) {
      imports.set(str(b.readUInt32LE(o + 12)), names(b.readUInt32LE(o) || b.readUInt32LE(o + 16)))
    }
  }
  const delayImports = new Map()
  const delay = dir(13)
  if (delay.rva) {
    for (let o = off(delay.rva); b.readUInt32LE(o + 4); o += 32) {
      delayImports.set(str(b.readUInt32LE(o + 4)), names(b.readUInt32LE(o + 16)))
    }
  }
  const exports = []
  const exp = dir(0)
  if (exp.rva) {
    const o = off(exp.rva)
    const count = b.readUInt32LE(o + 24)
    const nameTable = off(b.readUInt32LE(o + 32))
    for (let i = 0; i < count; i++) exports.push(str(b.readUInt32LE(nameTable + i * 4)))
  }
  return { imports, delayImports, exports }
}

/** The map key for a DLL name, matched case-insensitively as Windows does. */
export function findDll(map, name) {
  for (const [key, value] of map) if (key.toLowerCase() === name.toLowerCase()) return value
  return null
}
