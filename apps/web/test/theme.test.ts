import { afterEach, describe, expect, it, vi } from 'vitest';
import { initTheme } from '../src/lib/theme.ts';

/** A controllable `matchMedia("(prefers-color-scheme: dark)")`. */
function stubSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    listeners,
    set(next: boolean) {
      media.matches = next;
      for (const fn of listeners) fn();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = '';
});

describe('initTheme', () => {
  it('applies the system theme immediately', () => {
    stubSystemTheme(true);
    initTheme();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('follows later changes of the system theme', () => {
    const system = stubSystemTheme(false);
    initTheme();
    expect(document.documentElement).not.toHaveClass('dark');
    system.set(true);
    expect(document.documentElement).toHaveClass('dark');
    system.set(false);
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('stops listening when cleaned up', () => {
    const system = stubSystemTheme(false);
    const stop = initTheme();
    stop();
    expect(system.listeners.size).toBe(0);
  });
});
