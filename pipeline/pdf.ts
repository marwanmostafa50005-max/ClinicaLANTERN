// Reads the rows the page sends from a PDF that has text inside.
// The page sends every printed row, including the title, the patient line and the column headings.
// Those are not dispensing lines. The headings name the cells, and the supply lines are written
// the same way a CSV row is written, so a number is never left without its column name.
import type { PatientHeader } from '../shared/types.ts';
import { latestSupplyDate, parseBirthDate, resolvePatientAge } from './age.ts';
import { formatSupplyLine, type SupplyFields } from './csv.ts';
import { findDates, parseDateField } from './dates.ts';

export interface PdfTextRead {
  patient: PatientHeader;
  /** One supply per entry. Title rows and column headings are not included. */
  rows: string[];
  problems?: string[];
}

const SUPPLY: Record<string, keyof SupplyFields> = {
  date: 'date', dispense_date: 'date', dispensed: 'date', dispensed_date: 'date', supply_date: 'date',
  medicine: 'medicine', drug: 'medicine', medication: 'medicine', generic: 'medicine', ingredient: 'medicine',
  brand: 'brand', product: 'brand',
  strength: 'strength',
  form: 'form',
  qty: 'quantity', quantity: 'quantity',
  repeats: 'repeats', repeats_left: 'repeats', rpts: 'repeats',
  directions: 'directions', direction: 'directions', sig: 'directions',
  prescriber: 'prescriber', doctor: 'prescriber'
};

/**
 * A birth date is patient data. It is used only to work out the age.
 * The heading and the value never stand in a supply line a model reads or a letter shows.
 * The names are the CSV date-of-birth columns, plus the labels a printed patient line already uses.
 */
const BIRTH_COLUMN = new Set([
  'patient_dob', 'dob', 'date_of_birth', 'patient_date_of_birth', 'birth_date', 'birthdate', 'd_o_b', 'born'
]);

type ColumnField = keyof SupplyFields | 'birth' | 'extra';

interface Column {
  field: ColumnField;
  name: string;
}

function cellsOf(row: string): string[] {
  // Trimming the row drops a blank first cell (" | Warfarin" becomes "| Warfarin").
  const text = row.startsWith('|') ? ` ${row}` : row;
  return text.split(' | ').map(cell => cell.replace(/\s+/g, ' ').trim());
}

function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function fieldOf(name: string): ColumnField {
  const key = headerKey(name);
  if (BIRTH_COLUMN.has(key)) return 'birth';
  return SUPPLY[key] ?? 'extra';
}

function columnsOf(row: string): Column[] {
  return cellsOf(row).map(name => ({ field: fieldOf(name), name }));
}

/** A row of column names: it names a date and a medicine, and it is not itself a supply. */
function isHeading(row: string): boolean {
  const cells = cellsOf(row);
  if (cells.length < 2) return false;
  if (cells.some(cell => parseDateField(cell) !== null)) return false;
  const fields = cells.map(cell => fieldOf(cell)).filter(field => field !== 'extra');
  const hasDate = fields.includes('date');
  const hasMedicine = fields.includes('medicine') || fields.includes('brand');
  return hasDate && hasMedicine && fields.length >= 2 && fields.length * 2 >= cells.length;
}

function looksLikeDate(cell: string): boolean {
  return parseDateField(cell) !== null || /^\d{1,4}\s*[/.-]/.test(cell) || /^\d{1,2}\s+[A-Za-z]{3,9}\b/.test(cell);
}

function isSupply(cells: string[], columns: Column[]): boolean {
  const dateAt = columns.findIndex(column => column.field === 'date');
  const dateCell = dateAt >= 0 ? (cells[dateAt] ?? '') : (cells[0] ?? '');
  return looksLikeDate(dateCell);
}

/** The medicine or brand written in a row, once the table headings are known. */
function namedMedicine(cells: string[], columns: Column[]): string {
  for (let index = 0; index < columns.length; index++) {
    const field = columns[index].field;
    if (field !== 'medicine' && field !== 'brand') continue;
    const value = (cells[index] ?? '').trim();
    if (value && /[A-Za-z0-9]/.test(value)) return value;
  }
  return '';
}

function supplyLine(cells: string[], columns: Column[]): string {
  const fields: SupplyFields = {
    date: '', medicine: '', brand: '', strength: '', form: '', quantity: '', repeats: '', directions: '', prescriber: ''
  };
  const extras: string[] = [];
  columns.forEach((column, index) => {
    const value = (cells[index] ?? '').trim();
    if (!value) return;
    // A birth date column is not part of the supply. The caller keeps it for the age only.
    if (column.field === 'birth') return;
    if (column.field === 'extra') {
      extras.push(`${column.name} ${value}`);
      return;
    }
    if (column.field === 'date') {
      fields.date = parseDateField(value) ?? value;
      return;
    }
    if (column.field === 'quantity') {
      fields.quantity = value.replace(/^qty\s+/i, '');
      return;
    }
    if (column.field === 'repeats') {
      fields.repeats = value.replace(/^repeats\s+/i, '');
      return;
    }
    if (!fields[column.field]) fields[column.field] = value;
  });
  for (let index = columns.length; index < cells.length; index++) {
    const value = cells[index].trim();
    if (value) extras.push(value);
  }
  const line = formatSupplyLine(fields);
  return extras.length > 0 ? `${line} | ${extras.join(' | ')}` : line;
}

const DISCLAIMER = /^fictional patient\.\s*no real person\.?$/i;
const DOB_LABEL = /\b(?:D\.?\s*O\.?\s*B\.?|Date\s+of\s+birth|Born)\s*:?\s*/i;
const DOB_VALUE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/;
const PATIENT_ROW = /\bPatient\s*:|\b(?:D\.?\s*O\.?\s*B\.?|Date\s+of\s+birth|Born)\s*:?/i;
const PATIENT_NAME = /Patient:\s*(.*?)(?=\s*(?:D\.?\s*O\.?\s*B\.?|Date\s+of\s+birth|Born\b|Age\s+\d{1,3}\b|Female\b|Male\b)|[.|]|$)/i;

interface BirthText {
  dates: string[];
  unreadable: boolean;
}

function rememberBirth(value: string, birth: BirthText): void {
  const dob = parseBirthDate(value);
  if (dob) birth.dates.push(dob);
  else birth.unreadable = true;
}

function takePatient(text: string, patient: PatientHeader, birth: BirthText, names: string[]): void {
  if (DISCLAIMER.test(text)) return;
  const named = PATIENT_NAME.exec(text);
  if (named) {
    let label = named[1].replace(/\s+/g, ' ').trim();
    if (label && !/fictional/i.test(label)) label = `Fictional patient ${label}`;
    // Every named patient is kept. A later page must not disappear under the first name.
    if (label && label !== 'Fictional patient' && !names.some(known => known.toLowerCase() === label.toLowerCase())) {
      names.push(label);
    }
    if (label && patient.label === 'Fictional patient') patient.label = label;
  }
  if (patient.age === undefined) {
    const age = /\bAge\s+(\d{1,3})\b/i.exec(text);
    if (age) {
      const n = Number(age[1]);
      if (n <= 130) patient.age = n;
    }
  }
  if (!patient.sex) {
    const sex = /\b(female|male)\b/i.exec(text);
    if (sex) patient.sex = sex[1].toLowerCase() === 'female' ? 'F' : 'M';
  }
  const printedDob = DOB_LABEL.exec(text);
  if (printedDob) {
    const value = DOB_VALUE.exec(text.slice(printedDob.index + printedDob[0].length))?.[0] ?? '';
    const dob = parseBirthDate(value);
    if (dob) birth.dates.push(dob);
    else birth.unreadable = true;
  }
}

/**
 * Turns the printed rows of a text PDF into supply lines and the patient those rows name.
 * A row with no date and no column heading is a title: it is not returned as a line.
 * A row that has a date but no heading above it is kept as it was printed.
 */
export function readPdfTextRows(rows: unknown): PdfTextRead {
  const patient: PatientHeader = { label: 'Fictional patient' };
  const birth: BirthText = { dates: [], unreadable: false };
  const names: string[] = [];
  const undated: string[] = [];
  const out: string[] = [];
  const list = Array.isArray(rows) ? rows : [];
  let columns: Column[] | null = null;
  for (const raw of list) {
    const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    if (isHeading(text)) {
      columns = columnsOf(text);
      continue;
    }
    if (columns) {
      const cells = cellsOf(text);
      const dated = isSupply(cells, columns);
      const medicine = namedMedicine(cells, columns);
      // A medicine with a blank or unreadable date is still a supply. Dropping it would screen an incomplete record.
      if (dated || medicine) {
        columns.forEach((column, index) => {
          if (column.field !== 'birth') return;
          const value = (cells[index] ?? '').trim();
          if (value) rememberBirth(value, birth);
        });
        const line = supplyLine(cells, columns);
        if (line) out.push(line);
        if (!dated && medicine) undated.push(medicine);
        continue;
      }
    }
    if (PATIENT_ROW.test(text)) {
      takePatient(text, patient, birth, names);
      continue;
    }
    if (!columns && findDates(text).dates.some(date => date.kind === 'full')) {
      out.push(text);
      continue;
    }
    takePatient(text, patient, birth, names);
  }
  const problems = resolvePatientAge(patient, {
    birthDates: birth.dates,
    unreadableDateOfBirth: birth.unreadable,
    recordAge: patient.age,
    latestSupplyDate: latestSupplyDate(out)
  });
  // Two names and no shared birth date used to screen both histories as the first patient.
  if (names.length > 1) {
    problems.push(`The file holds more than one patient (${names.slice(0, 4).join(', ')}). Import one patient at a time.`);
  }
  if (undated.length > 0) {
    problems.push(`A supply has no date that can be read (${undated.slice(0, 4).join(', ')}). It was kept. The history is not screened until that row is corrected.`);
  }
  return problems.length > 0 ? { patient, rows: out, problems } : { patient, rows: out };
}
