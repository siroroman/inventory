const date = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  // Date-only values (`2026-09-27`) parse as UTC midnight; formatting in UTC keeps the day.
  timeZone: 'UTC',
});

/** A date-only API value (`YYYY-MM-DD`) as Czech shows it: `27. 9. 2026`. */
export function formatDate(value: string): string {
  return date.format(new Date(value));
}
