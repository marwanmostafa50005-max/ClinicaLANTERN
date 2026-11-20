// Age from a date of birth in CSV, text PDF and scanned dispensing histories.
import type { PatientHeader } from '../shared/types.ts';
import { enteredAtTheCounter } from '../shared/facts.ts';
import { findDates, isRealDate, parseDateField } from './dates.ts';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(year: number, month: number, day: number): string | null {
  return isRealDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

/** Accepts YYYY-MM-DD, day-first numeric dates and D Month YYYY. Rejects two-digit years. */
export function parseBirthDate(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(s)) return parseDateField(s);
  return null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The month and day the birthday falls on in a given year (29 February becomes 1 March when needed). */
function birthdayInYear(dateOfBirth: string, year: number): { month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) return null;
  const birthMonth = Number(m[2]);
  const birthDay = Number(m[3]);
  if (birthMonth === 2 && birthDay === 29 && !isLeapYear(year)) return { month: 3, day: 1 };
  if (!isRealDate(year, birthMonth, birthDay)) return null;
  return { month: birthMonth, day: birthDay };
}

/** Whole years completed on onDate. The birthday itself counts. Returns null when the dates are unusable. */
export function ageOn(dateOfBirth: string, onDate: string): number | null {
  const dobM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const onM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
  if (!dobM || !onM) return null;
  const birthYear = Number(dobM[1]);
  const birthMonth = Number(dobM[2]);
  const birthDay = Number(dobM[3]);
  const onYear = Number(onM[1]);
  const onMonth = Number(onM[2]);
  const onDay = Number(onM[3]);
  if (!isRealDate(birthYear, birthMonth, birthDay)) return null;
  if (!isRealDate(onYear, onMonth, onDay)) return null;
  if (dateOfBirth > onDate) return null;
  let age = onYear - birthYear;
  const bday = birthdayInYear(dateOfBirth, onYear);
  if (!bday) return null;
  if (onMonth < bday.month || (onMonth === bday.month && onDay < bday.day)) age--;
  if (age < 0 || age > 130) return null;
  return age;
}
export interface PatientAgeInput {
  birthDates?: string[];
  unreadableDateOfBirth?: boolean;
  recordAge?: number;
  latestSupplyDate?: string | null;
}

export function resolvePatientAge(patient: PatientHeader, input: PatientAgeInput): string[] {
  const problems: string[] = [];
  const birthDates = input.birthDates ?? [];
  const recordAge = input.recordAge;
  const latest = input.latestSupplyDate ?? null;
  delete patient.age;
  delete patient.ageFrom;
  delete patient.dateOfBirth;

  if (birthDates.length > 0) {
    const dob = birthDates[0];
    patient.dateOfBirth = dob;
    if (new Set(birthDates).size > 1) {
      problems.push('The rows give more than one date of birth. The first one was used.');
    }
    const fromDob = latest ? ageOn(dob, latest) : null;
    if (fromDob !== null) {
      patient.age = fromDob;
      patient.ageFrom = 'date_of_birth';
      if (recordAge !== undefined && Math.abs(recordAge - fromDob) > 1) {
        problems.push(
          `The age in the file (${recordAge}) does not match the date of birth (age ${fromDob} at the last supply). The date of birth was used.`
        );
      }
    }
    if (patient.age === undefined) {
      if (recordAge !== undefined) {
        patient.age = recordAge;
        patient.ageFrom = 'record';
        problems.push('The date of birth gave no age for the dates in the file. The age column was used.');
      } else {
        problems.push('The date of birth gave no age for the dates in the file. The age is not known.');
      }
    }
  } else if (input.unreadableDateOfBirth) {
    if (recordAge !== undefined) {
      patient.age = recordAge;
      patient.ageFrom = 'record';
      problems.push('The date of birth could not be read. The age column was used.');
    } else {
      problems.push('The date of birth could not be read. The age is not known.');
    }
  } else if (recordAge !== undefined) {
    patient.age = recordAge;
    patient.ageFrom = 'record';
  }
  return problems;
}

export function latestSupplyDate(rows: string[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (enteredAtTheCounter(row)) continue;
    const iso = findDates(row).dates.find(date => date.kind === 'full' && date.iso)?.iso ?? null;
    if (iso && (latest === null || iso > latest)) latest = iso;
  }
  return latest;
}
