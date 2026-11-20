// The answer a confirmed pathology reading sends, and the words on the block that shows it.
// The typed form does not use this. A value the pharmacist types sends no source.
import type { PathologyReading } from '../../pipeline/pathology.ts';

export interface PathologySource {
  kind: 'pathology';
  fileName: string;
  page: number;
  line: string;
  readBy: 'text' | 'model';
}

/** The body of the answer route when the pharmacist uses a reading. */
export interface PathologyAnswer {
  value: string;
  unit: string;
  date: string;
  source: PathologySource;
}

export type ReadReading = PathologyReading & { readBy: 'text' | 'model' };

/** Shown once above the readings. The words carry the warning. The colour does not. */
export const CHECK_THE_REPORT = 'Check the value against the report before you use it.';

/** A multiple-of-upper-limit fact cannot be answered when the line has no upper limit. */
export const NO_UPPER_LIMIT =
  'This reading has no laboratory upper limit, so it cannot answer this question. Type the result.';

const MULTIPLE_FACT = 'multiple of its laboratory upper limit';

const longDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

/** "12 March 2026". The year-month-day is read as a local calendar day, not as UTC. */
export function pathologyDate(iso: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? '').trim());
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return longDate.format(date);
}

export function collectedWords(iso: string | undefined): string {
  const long = pathologyDate(iso);
  return long === '' ? '' : `Sample collected ${long}`;
}

export function readByWords(readBy: 'text' | 'model'): string {
  return readBy === 'text'
    ? 'Read by: the text of the document'
    : 'Read by: the reading model, twice, and both readings agreed';
}

export function reportLineWords(page: number, line: string): string {
  return `Line of the report (page ${page}): "${line}"`;
}

export function isMultipleFact(fact: string): boolean {
  return fact.includes(MULTIPLE_FACT);
}

/** The sentence that replaces USE THIS RESULT when this reading cannot answer a multiple fact. */
export function upperLimitBlock(fact: string, reading: { multipleOfUpper?: number; refHigh?: number }): string | null {
  if (!isMultipleFact(fact)) return null;
  if (reading.multipleOfUpper === undefined || reading.refHigh === undefined) return NO_UPPER_LIMIT;
  return null;
}

function withRange(unit: string, reading: { refLow?: number; refHigh?: number }): string {
  const base = unit.trim();
  let extra = '';
  if (reading.refLow !== undefined && reading.refHigh !== undefined) {
    extra = `(laboratory range ${reading.refLow} to ${reading.refHigh})`;
  } else if (reading.refHigh !== undefined) {
    extra = `(laboratory upper limit ${reading.refHigh})`;
  } else if (reading.refLow !== undefined) {
    extra = `(laboratory lower limit ${reading.refLow})`;
  }
  if (extra === '') return base;
  return base === '' ? extra : `${base} ${extra}`;
}

/**
 * The value, unit, date and source USE THIS RESULT sends.
 * `date` is the reading's date, or the date the pharmacist filled. It is not empty.
 */
export function answerFromReading(fact: string, fileName: string, reading: ReadReading, date: string): PathologyAnswer {
  const source: PathologySource = {
    kind: 'pathology',
    fileName,
    page: reading.page,
    line: reading.line,
    readBy: reading.readBy,
  };
  if (isMultipleFact(fact) && reading.multipleOfUpper !== undefined && reading.refHigh !== undefined) {
    const measured = [reading.name, reading.valueWords, reading.unit].filter((part) => part !== '').join(' ');
    return {
      value: String(reading.multipleOfUpper),
      unit: `times the laboratory upper limit (${measured}, upper limit ${reading.refHigh})`,
      date,
      source,
    };
  }
  return {
    value: reading.valueWords,
    unit: withRange(reading.unit, reading),
    date,
    source,
  };
}

/** The card the pharmacist is on. TYPE IT MYSELF goes back to typing and keeps the draft. */
export interface TypingCard {
  way: 'type' | 'upload';
  draft: { value: string; unit: string; date: string };
  showingReading: boolean;
}

export function typeItMyself(card: TypingCard): TypingCard {
  return { way: 'type', draft: card.draft, showingReading: false };
}

/** A refusal of the read goes back to the typed form. The draft is not part of this, so it stays. */
export function afterReadRefusal(way: Record<string, 'type' | 'upload'>, id: string): Record<string, 'type' | 'upload'> {
  return { ...way, [id]: 'type' };
}

/** The dates the pharmacist typed for readings that had none, keyed by the reading's place. */
export function datesForReadings(filled: Record<string, string>, id: string, count: number): Record<number, string> {
  const dates: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const value = filled[`${id}:${i}`];
    if (value !== undefined) dates[i] = value;
  }
  return dates;
}
