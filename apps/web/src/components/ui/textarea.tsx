import type * as React from 'react';

import { cn } from '@/lib/utils';

// Same look as Input; 16 px text so iOS does not zoom on focus.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 rounded-md border border-input bg-card px-3.5 py-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
