// Age from a date of birth. Day first, Australian use.
import { describe, expect, it } from 'vitest';
import type { PatientHeader } from '../shared/types.ts';
import { ageOn, latestSupplyDate, parseBirthDate, resolvePatientAge } from './age.ts';

describe('parseBirthDate', () => {
  it('reads the four date forms and returns YYYY-MM-DD', () => {
    expect(parseBirthDate('1954-03-15')).toBe('1954-03-15');
    expect(parseBirthDate('15/03/1954')).toBe('1954-03-15');
    expect(parseBirthDate('5/3/1954')).toBe('1954-03-05');
    expect(parseBirthDate('15-03-1954')).toBe('1954-03-15');
  });

  it('reads a day-first date with the month written out', () => {
    expect(parseBirthDate('12 March 1952')).toBe('1952-03-12');
    expect(parseBirthDate('12 Mar 1952')).toBe('1952-03-12');
  });

  it('refuses a date that does not exist, a two-digit year and text that is not a date', () => {
    expect(parseBirthDate('31/04/1954')).toBeNull();
    expect(parseBirthDate('29/02/1953')).toBeNull();
    expect(parseBirthDate('15/03/54')).toBeNull();
    expect(parseBirthDate('not a date')).toBeNull();
    expect(parseBirthDate('')).toBeNull();
  });
});

describe('ageOn', () => {
  const dob = '1970-06-15';

  it('counts the birthday on the day itself, the day before and the day after', () => {
    expect(ageOn(dob, '1985-06-14')).toBe(14);
    expect(ageOn(dob, '1985-06-15')).toBe(15);
    expect(ageOn(dob, '1985-06-16')).toBe(15);
  });

  it('treats 29 February in a leap year and in a year that is not', () => {
    const leapBorn = '2000-02-29';
    expect(ageOn(leapBorn, '2024-02-29')).toBe(24);
    expect(ageOn(leapBorn, '2023-02-28')).toBe(22);
    expect(ageOn(leapBorn, '2023-03-01')).toBe(23);
    expect(ageOn(leapBorn, '2025-02-28')).toBe(24);
    expect(ageOn(leapBorn, '2025-03-01')).toBe(25);
  });

  it('returns nothing when the date of birth is after the day asked about', () => {
    expect(ageOn('2010-01-01', '2009-12-31')).toBeNull();
  });

  it('returns nothing when the result would be over one hundred and thirty', () => {
    expect(ageOn('1900-01-01', '2031-01-01')).toBeNull();
  });

  it('returns nothing when either date is not a real date', () => {
    expect(ageOn('1970-06-15', 'not-a-date')).toBeNull();
    expect(ageOn('bad', '2026-06-15')).toBeNull();
    expect(ageOn('2026-02-29', '2026-03-01')).toBeNull();
  });
});

describe('resolvePatientAge', () => {
  function header(): PatientHeader {
    return { label: 'Fictional patient F-001', age: 99, ageFrom: 'record', dateOfBirth: '1900-01-01' };
  }

  it('uses the date of birth at the last supply, and clears a stale age when nothing is given', () => {
    const born = header();
    const problems = resolvePatientAge(born, { birthDates: ['1960-06-15'], latestSupplyDate: '2026-05-06', recordAge: 65 });
    expect(problems).toEqual([]);
    expect(born).toMatchObject({ dateOfBirth: '1960-06-15', age: 65, ageFrom: 'date_of_birth' });

    const empty = header();
    expect(resolvePatientAge(empty, {})).toEqual([]);
    expect(empty.age).toBeUndefined();
    expect(empty.ageFrom).toBeUndefined();
    expect(empty.dateOfBirth).toBeUndefined();
  });

  it('keeps the first date of birth, and says when the age column disagrees by more than a year', () => {
    const two = header();
    const problems = resolvePatientAge(two, {
      birthDates: ['1960-06-15', '1961-01-01'],
      latestSupplyDate: '2026-05-06',
      recordAge: 70
    });
    expect(two.dateOfBirth).toBe('1960-06-15');
    expect(two.age).toBe(65);
    expect(two.ageFrom).toBe('date_of_birth');
    expect(problems).toEqual([
      'The rows give more than one date of birth. The first one was used.',
      'The age in the file (70) does not match the date of birth (age 65 at the last supply). The date of birth was used.'
    ]);

    const close = header();
    expect(resolvePatientAge(close, {
      birthDates: ['1960-06-15'], latestSupplyDate: '2026-05-06', recordAge: 66
    })).toEqual([]);
    expect(close.age).toBe(65);
  });

  it('uses the age column when the date of birth gives no age, and when the date of birth could not be read', () => {
    const noSupply = header();
    expect(resolvePatientAge(noSupply, { birthDates: ['1960-06-15'], recordAge: 64 })).toEqual([
      'The date of birth gave no age for the dates in the file. The age column was used.'
    ]);
    expect(noSupply).toMatchObject({ dateOfBirth: '1960-06-15', age: 64, ageFrom: 'record' });

    const unknown = header();
    expect(resolvePatientAge(unknown, { birthDates: ['1960-06-15'] })).toEqual([
      'The date of birth gave no age for the dates in the file. The age is not known.'
    ]);
    expect(unknown.age).toBeUndefined();

    const unread = header();
    expect(resolvePatientAge(unread, { unreadableDateOfBirth: true, recordAge: 64 })).toEqual([
      'The date of birth could not be read. The age column was used.'
    ]);
    expect(unread).toMatchObject({ age: 64, ageFrom: 'record' });
    expect(unread.dateOfBirth).toBeUndefined();

    const unreadOnly = header();
    expect(resolvePatientAge(unreadOnly, { unreadableDateOfBirth: true })).toEqual([
      'The date of birth could not be read. The age is not known.'
    ]);
    expect(unreadOnly.age).toBeUndefined();

    const column = header();
    expect(resolvePatientAge(column, { recordAge: 64 })).toEqual([]);
    expect(column).toMatchObject({ age: 64, ageFrom: 'record' });
    expect(column.dateOfBirth).toBeUndefined();
  });
});

describe('latestSupplyDate', () => {
  it('uses the supply lines and leaves out a line entered at the counter', () => {
    const supplies = ['2026-01-14 | diclofenac 50 mg tablet', '2026-04-08 | diclofenac 50 mg tablet'];
    const counter = 'no date | CONDITION | Peptic ulcer disease. Confirmed by the pharmacist at the counter on 19 November 2026.';
    expect(latestSupplyDate(supplies)).toBe('2026-04-08');
    expect(latestSupplyDate([...supplies, counter])).toBe('2026-04-08');
  });
});