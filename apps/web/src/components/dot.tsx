/**
 * The dot between the pieces of a card's grey line on mobile ("INV-00042 · Centrála › Přízemí").
 * It is text with non-breaking spaces, so a wrapping line never starts or ends on a lone dot; the
 * table layout (from `md`) shows the pieces in columns and hides it.
 */
export function Dot() {
  return (
    <span aria-hidden className="md:hidden">
      {' · '}
    </span>
  );
}
