import { describe, expect, it } from 'vitest';
import { asItemCode, createScanGate, repeatWindowMs } from '../src/features/scanner/scan-gate.ts';

describe('asItemCode', () => {
  it('reads a label as an ID, trimmed and upper-cased', () => {
    expect(asItemCode('INV-73-2023016')).toBe('INV-73-2023016');
    expect(asItemCode(' inv-00042\n')).toBe('INV-00042');
  });

  it('refuses text that is not the form of an ID: other QR codes never reach the API', () => {
    for (const text of ['https://example.com/q/INV-1', 'WIFI:S:office;T:WPA;;', 'INV 1', '', 'A'.repeat(31)]) {
      expect(asItemCode(text)).toBeNull();
    }
  });
});

describe('createScanGate', () => {
  function setup() {
    let time = 1_000_000;
    const advance = (ms: number) => {
      time += ms;
    };
    return { gate: createScanGate(() => time), advance };
  }

  it('accepts a code the first time and ignores it while it is read again within the window', () => {
    const { gate, advance } = setup();
    expect(gate.accept('INV-1')).toBe(true);
    advance(repeatWindowMs - 1);
    expect(gate.accept('INV-1')).toBe(false);
  });

  it('accepts the code again once it was not seen for the whole window', () => {
    const { gate, advance } = setup();
    gate.accept('INV-1');
    advance(repeatWindowMs);
    expect(gate.accept('INV-1')).toBe(true);
  });

  it('renews the window on every reading, so a label held in view is reported once', () => {
    const { gate, advance } = setup();
    expect(gate.accept('INV-1')).toBe(true);
    for (let i = 0; i < 20; i++) {
      advance(repeatWindowMs - 100);
      expect(gate.accept('INV-1')).toBe(false);
    }
  });

  it('keeps codes apart, also when two labels alternate in view', () => {
    const { gate, advance } = setup();
    expect(gate.accept('INV-1')).toBe(true);
    advance(100);
    expect(gate.accept('INV-2')).toBe(true);
    advance(100);
    expect(gate.accept('INV-1')).toBe(false);
    expect(gate.accept('INV-2')).toBe(false);
  });

  it('forgets everything on reset', () => {
    const { gate } = setup();
    gate.accept('INV-1');
    gate.reset();
    expect(gate.accept('INV-1')).toBe(true);
  });
});
