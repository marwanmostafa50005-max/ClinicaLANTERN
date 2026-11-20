// Date reading on its own. Day first, Australian use. No model is called.
import { describe, expect, it } from 'vitest';
import { findDates, isRealDate, longDate, longDateOf, monthsBefore, parseDateField } from './dates.ts';

describe('isRealDate', () => {
  it('accepts a real day and refuses a day the month does not have', () => {
    expect(isRealDate(2024, 2, 29)).toBe(true);
    expect(isRealDate(2100, 12, 31)).toBe(true);
    expect(isRealDate(2026, 2, 29)).toBe(false);
    expect(isRealDate(2026, 4, 31)).toBe(false);
    expect(isRealDate(2026, 0, 1)).toBe(false);
    expect(isRealDate(2026, 13, 1)).toBe(false);
    expect(isRealDate(1899, 1, 1)).toBe(false);
    expect(isRealDate(2101, 1, 1)).toBe(false);
    expect(isRealDate(2026.5, 1, 1)).toBe(false);
    expect(isRealDate(2026, 1.5, 1)).toBe(false);
  });
});

describe('parseDateField', () => {
  it('reads the forms a CSV cell can hold, day first', () => {
    expect(parseDateField('  21.08.2026  ')).toBe('2026-08-21');
    expect(parseDateField('2026/8/3')).toBe('2026-08-03');
    expect(parseDateField('2024-02-29')).toBe('2024-02-29');
    expect(parseDateField('2026-02-29')).toBeNull();
    expect(parseDateField('2026-08-21 10:30')).toBe('2026-08-21');
    expect(parseDateField('3/4/2026 extra')).toBe('2026-04-03');
    expect(parseDateField('21st August 2026')).toBe('2026-08-21');
    expect(parseDateField('21-Aug-26')).toBe('2026-08-21');
    expect(parseDateField('August 21st, 2026')).toBe('2026-08-21');
    expect(parseDateField('Sept. 9, 2026')).toBe('2026-09-09');
  });

  it('gives nothing when the words are not a date', () => {
    expect(parseDateField('   ')).toBeNull();
    expect(parseDateField('21 Smarch 2026')).toBeNull();
    expect(parseDateField('1899-01-01')).toBeNull();
    expect(parseDateField('2101-01-01')).toBeNull();
    expect(parseDateField('32/01/2026')).toBeNull();
  });
});

describe('findDates', () => {
  it('finds a full date, a date that is not real, a month and year, and a day and month', () => {
    const text = 'Seen 21st of August 2026, also 31/02/2026, in August 2026, and on 21 August. Not 32 August. Not August 1899.';
    const { dates, rest } = findDates(text);
    expect(dates.map(d => ({ raw: d.raw, kind: d.kind, iso: d.iso, yearMonth: d.yearMonth, monthDay: d.monthDay }))).toEqual([
      { raw: '21st of August 2026', kind: 'full', iso: '2026-08-21', yearMonth: undefined, monthDay: undefined },
      { raw: '31/02/2026', kind: 'full', iso: null, yearMonth: undefined, monthDay: undefined },
      { raw: 'August 2026', kind: 'month_year', iso: null, yearMonth: '2026-08', monthDay: undefined },
      { raw: '21 August', kind: 'day_month', iso: null, yearMonth: undefined, monthDay: '08-21' }
    ]);
    expect(dates.map(d => text.slice(d.index, d.index + d.raw.length))).toEqual(dates.map(d => d.raw));
    expect(dates.map(d => d.index)).toEqual([5, 31, 46, 66]);
    expect(rest.includes('21st of August 2026')).toBe(false);
    expect(rest.includes('32 August')).toBe(true);
    expect(rest.includes('August 1899')).toBe(true);
    expect(rest.length).toBe(text.length);
  });

  it('keeps the same mark on both sides of a dotted or dashed day', () => {
    const { dates } = findDates('On 21.08.2026 and on 21-08-26 and on 21/08/2026.');
    expect(dates.map(d => d.iso)).toEqual(['2026-08-21', '2026-08-21', '2026-08-21']);
  });

  it('does not read a month that does not start with a capital when the year or the day is missing', () => {
    expect(findDates('Seen in august 2026 and on 21 august.').dates).toEqual([]);
  });
});

describe('longDate and monthsBefore', () => {
  it('writes a date in words, and leaves anything else as it is', () => {
    expect(longDate('2026-01-01')).toBe('1 January 2026');
    expect(longDate('2026-12-31')).toBe('31 December 2026');
    expect(longDate('soon')).toBe('soon');
    expect(longDateOf(new Date(2026, 10, 18))).toBe('18 November 2026');
  });

  it('gives nothing when counting back leaves the years this reader accepts', () => {
    expect(monthsBefore('2026-01-01', 2000)).toBeNull();
    expect(monthsBefore('not-a-date', 1)).toBeNull();
  });

  it('reads a dotted year-first cell, and does not read that shape inside a sentence', () => {
    expect(parseDateField('2026.08.21')).toBe('2026-08-21');
    expect(parseDateField('21.8.26')).toBe('2026-08-21');
    expect(findDates('On 2026.08.21.').dates).toEqual([]);
    expect(findDates('In August, 2026.').dates.map(d => d.yearMonth)).toEqual(['2026-08']);
    expect(findDates('On 21st of August.').dates.map(d => ({ raw: d.raw, monthDay: d.monthDay }))).toEqual([
      { raw: '21st of August', monthDay: '08-21' }
    ]);
    expect(findDates('Seen 0 August.').dates).toEqual([]);
    expect(isRealDate(2026, 1, 1.5)).toBe(false);
    expect(isRealDate(2026, 1, 0)).toBe(false);
    expect(longDate('2026-08')).toBe('2026-08');
    expect(longDate('2026-13-01')).toBe('1 undefined 2026');
    expect(monthsBefore('2026-03-31', 13)).toBe('2025-02-28');
    expect(monthsBefore('2026-03-31', 14)).toBe('2025-01-31');
  });

  it('counts back into a shorter month, and does not read may as a month', () => {
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBefore('2024-03-31', 1)).toBe('2024-02-29');
    expect(monthsBefore('2026-01-31', 1)).toBe('2025-12-31');
    expect(monthsBefore('2026-08-21', 0)).toBe('2026-08-21');
    expect(monthsBefore('2026-08-21', -1)).toBeNull();
    expect(monthsBefore('2026-08-21', 1.5)).toBeNull();
    expect(monthsBefore('2026-02-29', 0)).toBeNull();
    expect(findDates('these 2 may interact').dates).toEqual([]);
    expect(findDates('Seen 2 May.').dates.map(d => d.monthDay)).toEqual(['05-02']);
    expect(findDates('On 2026-08-21.').dates.map(d => d.iso)).toEqual(['2026-08-21']);
    expect(parseDateField('21/08/26')).toBe('2026-08-21');
    expect(parseDateField('2026-08-21T10:30')).toBe('2026-08-21');
  });

  it('refuses a 32nd day, reads a mixed mark in a cell, and keeps a slash year inside a sentence', () => {
    expect(isRealDate(2026, 1, 32)).toBe(false);
    expect(isRealDate(1900, 1, 1)).toBe(true);
    expect(isRealDate(1900, 2, 29)).toBe(false);
    expect(isRealDate(2000, 2, 29)).toBe(true);
    expect(parseDateField('21-08/2026')).toBe('2026-08-21');
    expect(parseDateField('21 August, 2026')).toBe('2026-08-21');
    expect(parseDateField('August 2026')).toBeNull();
    expect(findDates('On 2026/08/21.').dates.map(d => d.iso)).toEqual(['2026-08-21']);
    expect(findDates('On 21-08/2026.').dates).toEqual([]);
    expect(findDates('In August 2101.').dates).toEqual([]);
    expect(findDates('On 31 August.').dates.map(d => d.monthDay)).toEqual(['08-31']);
    expect(monthsBefore('2026-08-21', 12)).toBe('2025-08-21');
  });
});
