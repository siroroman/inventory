import { cn } from '@/lib/utils';

/** `84 / 128` as a whole percent, never above 100; nothing to measure (max 0) is 0. */
export const progressPercent = (value: number, max: number) =>
  max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

/**
 * A bar for "84 of 128". The numbers are also written next to it, so the bar is for the eye; it
 * still names itself for a screen reader. Nothing to measure (max 0) shows an empty bar.
 */
export function Progress({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const percent = progressPercent(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}
