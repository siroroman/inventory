import type { ReactNode } from 'react';

/**
 * The main action of a phone screen, pinned to the bottom edge within reach of the thumb. A spacer
 * after the content keeps the last rows from hiding behind it. Whoever renders it decides where it
 * applies (desktop puts the action next to the heading instead).
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-20" />
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-card px-4 py-3">{children}</div>
    </>
  );
}
