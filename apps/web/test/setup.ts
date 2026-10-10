import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, vi } from 'vitest';
import '../src/i18n';

// The default 1 s for findBy/waitFor is too short on a busy CI runner: the first test of a file also
// pays for loading the lazy route chunks. A passing test does not wait any longer for it.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia (sonner and the theme code read it): default to a light system.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom has no pointer capture; sonner's toasts call it on a press (their buttons, such as "Vrátit").
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// The router restores scroll positions; jsdom only logs "not implemented".
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // sonner keeps its toasts in a module-level store and shows the active ones again in the next
  // Toaster that mounts, so a toast would live on into the next test of the file.
  toast.dismiss();
});
