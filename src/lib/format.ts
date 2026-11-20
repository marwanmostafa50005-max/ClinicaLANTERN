// Small helpers for the words and dates the pharmacist reads.
import type { PatientHeader } from '../../shared/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Fictional patient A, age 74, female". Patients are always fictional. */
export function patientWords(patient: PatientHeader | undefined): string {
  if (!patient) return 'Fictional patient';
  const bits = [patient.label || 'Fictional patient'];
  if (typeof patient.age === 'number') bits.push(`age ${patient.age}`);
  const sex = (patient.sex ?? '').trim();
  if (/^f(emale)?$/i.test(sex)) bits.push('female');
  else if (/^m(ale)?$/i.test(sex)) bits.push('male');
  else if (sex !== '') bits.push(sex);
  return bits.join(', ');
}

const dateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "18 November 2026". Empty text when the time is missing or unreadable. */
export function formatDate(iso: string | undefined): string {
  const d = toDate(iso);
  return d ? dateFormat.format(d) : '';
}

/** "18 Nov 2026". */
export function formatShortDate(iso: string | undefined): string {
  const d = toDate(iso);
  return d ? shortDateFormat.format(d) : '';
}

/** "18 Nov 2026, 9:41 am". */
export function formatDateTime(iso: string | undefined): string {
  const d = toDate(iso);
  return d ? `${shortDateFormat.format(d)}, ${timeFormat.format(d)}` : '';
}

/**
 * Whole days that have passed from one time to another. Three days and five minutes is 3, not 4.
 * Zero when either time is missing, and for less than one whole day.
 */
export function daysFromTo(fromIso: string | undefined, toIso: string | undefined): number {
  const a = toDate(fromIso);
  const b = toDate(toIso);
  if (!a || !b) return 0;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY_MS));
}

/** "1 letter" or "3 letters". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Badge text: real numbers up to 99, then "99+". */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}
