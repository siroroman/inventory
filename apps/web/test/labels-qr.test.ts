import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { QUIET_MODULES } from '../src/features/labels/layout.ts';
import { qrModules } from '../src/features/labels/qr.ts';

/** Paints the modules with the quiet zone, `scale` pixels per module, the way a printer would. */
function render(modules: boolean[][], scale: number) {
  const total = modules.length + 2 * QUIET_MODULES;
  const side = total * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [r, row] of modules.entries()) {
    for (const [c, dark] of row.entries()) {
      if (!dark) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at = (((r + QUIET_MODULES) * scale + y) * side + (c + QUIET_MODULES) * scale + x) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
    }
  }
  return { data, side };
}

describe('qrModules', () => {
  it.each(['INV-73-2023016', 'INV-00042', 'LOC-004', 'A'.repeat(30)])('encodes %s so that a decoder reads it back', (text) => {
    const modules = qrModules(text);
    expect(modules.length).toBe(modules[0]!.length);
    const { data, side } = render(modules, 6);
    expect(jsQR(data, side, side)?.data).toBe(text);
  });

  it('is a square of modules, version 1 (21) for a short ID at level Q', () => {
    expect(qrModules('INV-00042')).toHaveLength(21);
    expect(qrModules('INV-73-2023016').length).toBeGreaterThanOrEqual(21);
  });

  it('is the same every time', () => {
    expect(qrModules('INV-00042')).toEqual(qrModules('INV-00042'));
  });
});
