import { describe, expect, it } from 'vitest';
import { serviceStatus } from '../src/lib/service-status.ts';

// Noon local time, so "today" is unambiguous in any time zone.
const now = new Date(2026, 8, 29, 12);

describe('serviceStatus', () => {
  it('has nothing to say without a next service date', () => {
    expect(serviceStatus(null, now)).toBeUndefined();
  });

  it('is overdue once the date has passed, not on the day itself', () => {
    expect(serviceStatus('2026-09-28', now)).toBe('overdue');
    expect(serviceStatus('2026-09-29', now)).toBe('soon');
  });

  it('is due soon up to and including 30 days ahead', () => {
    expect(serviceStatus('2026-10-29', now)).toBe('soon');
    expect(serviceStatus('2026-10-30', now)).toBeUndefined();
  });

  it('counts 30 days across a month and a year boundary', () => {
    expect(serviceStatus('2027-01-08', new Date(2026, 11, 9, 12))).toBe('soon');
    expect(serviceStatus('2027-01-09', new Date(2026, 11, 9, 12))).toBeUndefined();
  });
});
