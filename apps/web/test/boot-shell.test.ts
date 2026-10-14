import { describe, expect, it } from 'vitest';
import { removeBootShellWhenReady } from '@/lib/boot-shell';

function fakeRouter() {
  let listener: (() => void) | undefined;
  return {
    subscribe: (_event: 'onResolved', fn: () => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    resolve: () => listener?.(),
    subscribed: () => listener !== undefined,
  };
}

describe('boot shell', () => {
  it('stays until the router has resolved, then goes and stops listening', () => {
    document.body.innerHTML = '<div id="boot"></div><div id="root"></div>';
    const router = fakeRouter();
    removeBootShellWhenReady(router);
    expect(document.getElementById('boot')).not.toBeNull();

    router.resolve();
    expect(document.getElementById('boot')).toBeNull();
    expect(document.getElementById('root')).not.toBeNull();
    expect(router.subscribed()).toBe(false);
  });

  it('does not fail when there is no shell (tests, a cached older index.html)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const router = fakeRouter();
    removeBootShellWhenReady(router);
    expect(() => router.resolve()).not.toThrow();
  });
});
