import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

// Pills, as designed. `danger` is overdue service or expired warranty, `warning` is service due
// within 30 days, `success` is found or finished (inventory), `info` is in progress or new
// (the accent), `neutral` is a plain tag such as a location type.
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-neutral-tag-soft text-neutral-tag',
        danger: 'bg-danger-soft text-destructive',
        warning: 'bg-warning-soft text-warning',
        success: 'bg-success-soft text-success',
        info: 'bg-primary-soft text-primary',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
