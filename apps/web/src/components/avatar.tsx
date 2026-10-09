import { initials } from '@/features/auth/initials';
import { cn } from '@/lib/utils';

const sizes = { md: 'size-9 text-sm', sm: 'size-7 text-xs' };

/** A person as a circle with their initials. Decorative: whoever uses it also writes the name. */
export function Avatar({
  name,
  email = '',
  size = 'md',
  className,
}: {
  name: string;
  /** The initials fall back to the first letter of the email when the name is blank. */
  email?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground',
        sizes[size],
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}

/**
 * Overlapping avatars for the people who took part. The first `max` are drawn, the rest as "+N";
 * the names are in text for a screen reader (the circles are decorative).
 */
export function AvatarStack({ people, max = 4 }: { people: { id: string; name: string }[]; max?: number }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5">
      <span className="sr-only">{people.map((person) => person.name).join(', ')}</span>
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} size="sm" className="ring-2 ring-card" />
      ))}
      {rest > 0 && (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-card"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
