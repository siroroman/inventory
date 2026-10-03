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

const timestamp = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** The day of a moment in time (`2026-10-02T12:30:00.000Z`) in the user's own time zone: `2. 10. 2026`. */
export function formatTimestamp(value: string): string {
  return timestamp.format(new Date(value));
}

const crowns = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const crownsWithHellers = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', minimumFractionDigits: 2 });

/** An amount in CZK: `144 902 Kč`, or `144 902,50 Kč` when it has hellers. */
export function formatPrice(value: number): string {
  return (Number.isInteger(value) ? crowns : crownsWithHellers).format(value);
}

const megabytes = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });

/** A file size the way people read it: `512 B`, `120 kB`, `1,2 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = Math.round(bytes / 1024);
  // 1048575 bytes rounds to 1024 kB: call that a megabyte.
  if (kilobytes < 1024) return `${kilobytes} kB`;
  return `${megabytes.format(bytes / (1024 * 1024))} MB`;
}

/** A `tel:` link for a phone number as people write it ("+420 601 123 456"). */
export const telHref = (phone: string) => `tel:${phone.replace(/\s+/g, '')}`;
