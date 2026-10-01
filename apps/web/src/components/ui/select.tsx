import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

// A native <select>: the phone's own picker, keyboard support for free, and a handful of options
// does not need more. Looks like Input; the chevron is drawn here so its size and the trailing padding
// match the leading padding of the text (px-3.5, as in Input).
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative w-full min-w-0">
      <select
        data-slot="select"
        className={cn(
          'h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-card pr-11 pl-3.5 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30',
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-6 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { Select };
