import { describe, expect, it } from 'vitest';
import { badgeText, daysFromTo, formatDate, formatDateTime, formatShortDate, patientWords, plural } from './format.ts';

describe('words and numbers', () => {
  it('says one or many', () => {
    expect(plural(1, 'letter', 'letters')).toBe('1 letter');
    expect(plural(0, 'letter', 'letters')).toBe('0 letters');
    expect(plural(3, 'criterion', 'criteria')).toBe('3 criteria');
  });

  it('shows real badge numbers up to 99', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('describes a patient, always as written in the history', () => {
    expect(patientWords({ label: 'Fictional patient A', age: 74, sex: 'F' })).toBe('Fictional patient A, age 74, female');
    expect(patientWords({ label: 'Fictional patient B', sex: 'male' })).toBe('Fictional patient B, male');
    expect(patientWords({ label: 'Fictional patient C' })).toBe('Fictional patient C');
    expect(patientWords(undefined)).toBe('Fictional patient');
  });

  it('counts whole days that have passed, and tolerates missing times', () => {
    expect(daysFromTo('2026-11-15T09:00:00Z', '2026-11-18T09:00:00Z')).toBe(3);
    // The review of 18 November: 3 days and 5 minutes was shown as "4 days".
    expect(daysFromTo('2026-11-15T09:00:00Z', '2026-11-18T09:05:00Z')).toBe(3);
    expect(daysFromTo('2026-11-17T09:00:00Z', '2026-11-18T09:05:00Z')).toBe(1);
    expect(daysFromTo('2026-11-15T09:00:00Z', '2026-11-18T08:55:00Z')).toBe(2);
    expect(daysFromTo('2026-11-18T08:00:00Z', '2026-11-18T09:00:00Z')).toBe(0);
    expect(daysFromTo('2026-11-18T09:00:00Z', '2026-11-18T08:00:00Z')).toBe(0);
    expect(daysFromTo(undefined, '2026-11-18T09:00:00Z')).toBe(0);
    expect(formatDate('not a date')).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('writes dates the Australian way, day first', () => {
    // The day depends on the time zone of the computer, so the test allows the day before and after.
    expect(formatDate('2026-11-18T03:00:00Z')).toMatch(/^1[789] November 2026$/);
    expect(formatShortDate('2026-11-18T03:00:00Z')).toMatch(/^1[789] Nov 2026$/);
    expect(formatDateTime('2026-11-18T03:00:00Z')).toMatch(/^1[789] Nov 2026, \d{1,2}:\d{2}\s?(am|pm)$/i);
  });
});
