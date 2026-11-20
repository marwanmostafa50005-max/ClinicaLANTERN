// Date reading shared by the CSV reader, the import check and the letter fact check.
// Dates are day first (Australian use): 03/04/2026 is 3 April 2026.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_WORD = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// The same list, but the month must start with a capital letter. Used where there is no day or
// no year, so that "these 2 may interact" is not read as the second of May.
const MONTH_WORD_CAPITAL = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string | null {
  return isRealDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

function fullYear(text: string): number {
  const n = Number(text);
  return text.length === 2 ? 2000 + n : n;
}

/** Reads one date field (a CSV cell). Returns yyyy-mm-dd, or null when it cannot be read. */
export function parseDateField(value: string): string | null {
  const s = value.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?: .*)?$/.exec(s);
  if (m) return toIso(fullYear(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?[- ]([A-Za-z]{3,9})\.?,?[- ](\d{4}|\d{2})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? toIso(fullYear(m[3]), month, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? toIso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

export type FoundDateKind = 'full' | 'month_year' | 'day_month';

export interface FoundDate {
  raw: string;              // the text as written
  index: number;            // where it starts in the text
  kind: FoundDateKind;
  iso: string | null;       // yyyy-mm-dd for "full"; null when it is not a real date
  yearMonth?: string;       // yyyy-mm for "month_year"
  monthDay?: string;        // mm-dd for "day_month"
}

type Reading = Omit<FoundDate, 'index'> | null;

/**
 * Finds every date written in a piece of text: 2026-08-21, 21/08/2026, 21 August 2026,
 * August 21, 2026, August 2026 and 21 August. Also returns the text with the dates blanked out,
 * so that the numbers inside a date are not read again as amounts.
 */
export function findDates(text: string): { dates: FoundDate[]; rest: string } {
  const dates: FoundDate[] = [];
  let rest = text;
  const take = (pattern: RegExp, read: (m: string[]) => Reading): void => {
    rest = rest.replace(pattern, (...args: unknown[]) => {
      const whole = String(args[0]);
      const index = Number(args[args.length - 2]);
      const found = read(args.slice(0, -2).map(a => String(a)));
      if (!found) return whole;
      dates.push({ ...found, index });
      return ' '.repeat(whole.length);
    });
  };

  // 2026-08-21 and 2026/08/21
  take(/(?<![\d/.-])(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?![\d/-])/g, m => ({
    raw: m[0], kind: 'full', iso: toIso(Number(m[1]), Number(m[2]), Number(m[3]))
  }));
  // 21/08/2026, 21.08.2026, 21-08-2026, 21/08/26
  take(/(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/-])/g, m => ({
    raw: m[0], kind: 'full', iso: toIso(fullYear(m[4]), Number(m[3]), Number(m[1]))
  }));
  // 21 August 2026, 21st of August 2026, 21-Aug-2026
  take(new RegExp(`(?<![\\d/.-])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s-]+(${MONTH_WORD})\\b\\.?,?[\\s-]+(\\d{4})(?!\\d)`, 'gi'), m => ({
    raw: m[0], kind: 'full', iso: toIso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]))
  }));
  // August 21, 2026
  take(new RegExp(`\\b(${MONTH_WORD})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, 'gi'), m => ({
    raw: m[0], kind: 'full', iso: toIso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]))
  }));
  // August 2026 (month and year only)
  take(new RegExp(`\\b(${MONTH_WORD_CAPITAL})\\b\\.?,?\\s+(\\d{4})(?!\\d)`, 'g'), m => {
    const year = Number(m[2]);
    if (year < 1900 || year > 2100) return null;
    return { raw: m[0], kind: 'month_year', iso: null, yearMonth: `${year}-${pad2(MONTHS[m[1].toLowerCase()])}` };
  });
  // 21 August (no year)
  take(new RegExp(`(?<![\\d/.-])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_WORD_CAPITAL})\\b`, 'g'), m => {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    return { raw: m[0], kind: 'day_month', iso: null, monthDay: `${pad2(MONTHS[m[2].toLowerCase()])}-${pad2(day)}` };
  });
  dates.sort((a, b) => a.index - b.index);
  return { dates, rest };
}

/**
 * The date a number of months before a date, both as yyyy-mm-dd. The day is kept, or moved back to
 * the last day of a shorter month: one month before 2026-03-31 is 2026-02-28.
 * Returns null when the date cannot be read.
 */
export function monthsBefore(iso: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !Number.isInteger(months) || months < 0) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isRealDate(year, month, day)) return null;
  const index = year * 12 + (month - 1) - months;
  const toYear = Math.floor(index / 12);
  const toMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(toYear, toMonth, 0)).getUTCDate();
  return toIso(toYear, toMonth, Math.min(day, lastDay));
}

/** "2026-08-21" becomes "21 August 2026". Anything else is returned unchanged. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

/** A date in local time as "18 November 2026". */
export function longDateOf(when: Date): string {
  return `${when.getDate()} ${MONTH_NAMES[when.getMonth()]} ${when.getFullYear()}`;
}
