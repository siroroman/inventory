import type * as React from 'react';

import { cn } from '@/lib/utils';

// A native <select>: the phone's own picker, keyboard support for free, and a handful of options
// does not need more. Looks like Input.
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
