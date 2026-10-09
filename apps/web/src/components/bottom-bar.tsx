import type { ReactNode } from 'react';

/**
 * The main action of a phone screen, kept in reach of the thumb: it follows the content and sticks
 * to the bottom edge while the content is longer than the screen. Whoever renders it decides
 * where it applies (desktop puts the action next to the heading instead).
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 border-t bg-card px-4 py-3">{children}</div>;
}
