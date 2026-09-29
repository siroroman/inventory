export type ServiceStatus = 'overdue' | 'soon';

const soonDays = 30;

/** A `Date` as `YYYY-MM-DD` in the local time zone: "today" is the user's calendar day. */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Where the next service stands: `overdue` once its date has passed, `soon` when it falls within
 * the next 30 days (today included), nothing otherwise. Dates are `YYYY-MM-DD`, which sort as text.
 */
export function serviceStatus(
  nextServiceOn: string | null,
  now: Date = new Date(),
): ServiceStatus | undefined {
  if (!nextServiceOn) return undefined;
  const limit = new Date(now);
  limit.setDate(limit.getDate() + soonDays);
  if (nextServiceOn < localDay(now)) return 'overdue';
  if (nextServiceOn <= localDay(limit)) return 'soon';
  return undefined;
}
