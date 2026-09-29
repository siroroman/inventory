import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toasts (e.g. "Uloženo"), themed from our tokens and following the system light/dark setting. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-center"
      toastOptions={{ classNames: { toast: 'text-sm font-medium' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-md)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
