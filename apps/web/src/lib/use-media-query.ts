import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches right now, following changes (rotating a phone, resizing). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Tailwind's `lg` breakpoint: the width from which Home has its side menu instead of tabs. */
export const desktopScreen = '(min-width: 1024px)';
