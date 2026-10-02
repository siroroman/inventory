import { cn } from '@/lib/utils';

/** The app icon (clipboard with a check mark) in a rounded square, shown in the top bar, side menu and login. */
export function AppLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="size-[62%]">
        <rect x="10" y="9" width="28" height="34" rx="4" stroke="currentColor" strokeWidth="3" />
        <rect x="17" y="5" width="14" height="8" rx="2" fill="currentColor" />
        <path
          d="M15 21 L18 24 L24 17"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="27" y="20" width="7" height="3" rx="1.5" fill="currentColor" />
        <rect x="15" y="29" width="19" height="3" rx="1.5" fill="currentColor" />
        <rect x="15" y="36" width="13" height="3" rx="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}
