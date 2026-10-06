// NativeSurface argument handling that needs no window: every bad input must
// be a JavaScript exception, never a crash in the driver.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeSurface } from '../index.js'
import { setup } from './helpers.mjs'

const pointerSize = 8

test('rejects anything that is not a GPUDevice', () => {
  assert.throws(() => new NativeSurface({}, Buffer.alloc(16)), /GPUDevice/)
  assert.throws(() => new NativeSurface(null, Buffer.alloc(16)), /GPUDevice/)
})

test('rejects malformed window descriptions before touching the driver', async () => {
  const { device } = await setup()
  try {
    assert.throws(() => new NativeSurface(device, 42), /SDL GPU handle buffer/)
    assert.throws(() => new NativeSurface(device, Buffer.alloc(3)), /Expected an SDL/)
    assert.throws(() => new NativeSurface(device, { kind: 'carrier-pigeon' }), /window.kind/)
    assert.throws(() => new NativeSurface(device, { kind: 'xlib', display: 1n }), /needs display and xid/)
    assert.throws(() => new NativeSurface(device, { kind: 'wayland', display: 1n }), /needs display and handle/)
    assert.throws(() => new NativeSurface(device, { kind: 'win32' }), /needs handle/)
    assert.throws(() => new NativeSurface(device, { kind: 'metal-layer', handle: -1 }), /non-negative/)
    assert.throws(() => new NativeSurface(device, { kind: 'metal-layer', handle: 'x' }), /BigInt or number/)
    if (process.platform === 'linux') {
      // SDL 0.11 writes {display, window} for both X11 and Wayland. Guessing
      // X11 for a Wayland window crashed inside libX11, so the driver is required.
      const untagged = Buffer.alloc(2 * pointerSize, 1)
      assert.throws(() => new NativeSurface(device, untagged), /X11 or Wayland/)
      assert.throws(() => new NativeSurface(device, untagged, 'KMSDRM'), /cannot present WebGPU/)
      const tagged = Buffer.alloc(8 + 2 * pointerSize, 1)
      tagged.writeBigUInt64LE(9n, 0)
      assert.throws(() => new NativeSurface(device, tagged), /Unsupported SDL window subsystem/)
    }
  } finally { device.destroy() }
})
