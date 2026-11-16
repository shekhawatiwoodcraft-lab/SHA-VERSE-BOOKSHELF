import { describe, it, expect } from 'vitest';
import {
  toDurationMs,
  formatDurationLabel,
  computeExpiresAt,
  isStatusActive,
  formatRemainingTime,
  getDaysInCurrentMonth,
} from './statusDuration';

describe('statusDuration helpers', () => {
  it('returns exact calendar days in month (28, 29, 30, 31)', () => {
    expect(getDaysInCurrentMonth(new Date(2026, 0, 15))).toBe(31); // January
    expect(getDaysInCurrentMonth(new Date(2026, 1, 10))).toBe(28); // Feb non-leap
    expect(getDaysInCurrentMonth(new Date(2024, 1, 10))).toBe(29); // Feb leap year
    expect(getDaysInCurrentMonth(new Date(2026, 3, 5))).toBe(30); // April
    expect(getDaysInCurrentMonth(new Date(2026, 10, 15))).toBe(30); // November
    expect(getDaysInCurrentMonth(new Date(2026, 11, 1))).toBe(31); // December
  });

  it('enforces minimum 5 seconds and converts units accurately', () => {
    expect(toDurationMs(1, 'seconds')).toBe(5000);
    expect(toDurationMs(5, 'seconds')).toBe(5000);
    expect(toDurationMs(30, 'seconds')).toBe(30000);
    expect(toDurationMs(15, 'minutes')).toBe(900000);
    expect(toDurationMs(3, 'hours')).toBe(10800000);
    expect(toDurationMs(2, 'days')).toBe(172800000);
  });

  it('formats human-readable labels for singular and plural durations', () => {
    expect(formatDurationLabel(2, 'seconds')).toBe('5 seconds');
    expect(formatDurationLabel(1, 'hours')).toBe('1 hour');
    expect(formatDurationLabel(3, 'hours')).toBe('3 hours');
    expect(formatDurationLabel(1, 'days')).toBe('1 day');
  });

  it('auto-expires status items once expires_at is reached', () => {
    const base = 1_700_000_000_000;
    const expiresAt = computeExpiresAt(5000, base);
    expect(isStatusActive(expiresAt, base + 4999)).toBe(true);
    expect(isStatusActive(expiresAt, base + 5000)).toBe(false);
    expect(isStatusActive(expiresAt, base + 10_000)).toBe(false);
  });

  it('formats remaining countdown text', () => {
    const base = 1_700_000_000_000;
    expect(formatRemainingTime(new Date(base + 5000).toISOString(), base)).toBe('5s left');
    expect(formatRemainingTime(new Date(base + 3 * 3600 * 1000).toISOString(), base)).toBe('3h left');
    expect(formatRemainingTime(new Date(base + 2 * 24 * 3600 * 1000).toISOString(), base)).toBe('2d left');
  });
});
