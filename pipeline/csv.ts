// Reads a dispensing history from CSV text (docs/SPEC.md sections 6 and 6a).
// One supply per row. Columns in any order, extra columns ignored.
// A record may also carry facts (section 6a): a row whose record_type is "condition", "result" or
// "observation" is a fact, with its name in "detail" and its number in "value".
// A file without those three columns is read exactly as before.
// Line IDs follow the order of the rows in the file, supplies and facts alike: L001 is the first row.
import type { FactKind, HistoryLine, PatientHeader } from '../shared/types.ts';
import { FACT_WORDS } from '../shared/facts.ts';
import { parseBirthDate, resolvePatientAge } from './age.ts';
import { parseDateField } from './dates.ts';

export interface ParsedHistory {
  patient: PatientHeader;
  lines: HistoryLine[];
  problems: string[];                 // empty when the history can be screened
}

export interface SupplyFields {
  date: string;
  medicine: string;                   // active ingredient; may be empty when only the brand is known
  brand: string;
  strength: string;
  form: string;
  quantity: string;
  repeats: string;
  directions: string;
  prescriber: string;
}

const COLUMN_NAMES: Record<string, string> = {
  patient_ref: 'patient_ref', patient: 'patient_ref', patient_id: 'patient_ref', patient_reference: 'patient_ref',
  patient_age: 'patient_age', age: 'patient_age',
  patient_dob: 'patient_dob', dob: 'patient_dob', date_of_birth: 'patient_dob',
  patient_date_of_birth: 'patient_dob', birth_date: 'patient_dob', birthdate: 'patient_dob',
  patient_sex: 'patient_sex', sex: 'patient_sex', gender: 'patient_sex',
  dispense_date: 'dispense_date', date: 'dispense_date', dispensed: 'dispense_date',
  dispensed_date: 'dispense_date', date_dispensed: 'dispense_date', supply_date: 'dispense_date',
  medicine: 'medicine', generic: 'medicine', ingredient: 'medicine', active_ingredient: 'medicine', drug: 'medicine',
  brand: 'brand', brand_name: 'brand', product: 'brand',
  strength: 'strength',
  form: 'form',
  quantity: 'quantity', qty: 'quantity',
  repeats_left: 'repeats_left', repeats: 'repeats_left', rpts: 'repeats_left', repeats_remaining: 'repeats_left',
  directions: 'directions', sig: 'directions', instructions: 'directions',
  prescriber: 'prescriber', doctor: 'prescriber', prescriber_name: 'prescriber',
  // Section 6a: three optional columns for a record that also carries conditions and results.
  record_type: 'record_type', row_type: 'record_type', entry_type: 'record_type',
  detail: 'detail', fact: 'detail',
  value: 'value'
};

/** What "record_type" may say for a supply. An empty cell is a supply too. */
const SUPPLY_TYPES = new Set(['', 'dispensed', 'dispense', 'dispensing', 'supply', 'supplied']);

/** What "record_type" may say for a fact. */
const FACT_TYPES: Record<string, FactKind> = {
  condition: 'condition', conditions: 'condition',
  result: 'result', results: 'result',
  observation: 'observation', observations: 'observation'
};

/** The text a fact line shows in place of a date when its row has none. */
export const NO_DATE = 'no date';

export interface FactFields {
  date: string;                       // the date the fact was recorded; may be empty
  kind: FactKind;
  detail: string;                     // its name: "Heart failure", "eGFR", "Blood pressure"
  value: string;                      // the number with its unit when there is one: "28 mL/min/1.73 m2"
}

export function lineId(n: number): string {
  return 'L' + String(n).padStart(3, '0');
}

/** A supply line longer than this is not read: the history is shown as "Cannot assess". */
export const MAX_LINE_CHARS = 1000;

function pickSeparator(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const sep of [',', ';', '\t']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === sep && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = sep;
      bestCount = count;
    }
  }
  return best;
}

/** Splits CSV text into records and fields. Handles quotes, doubled quotes, line breaks inside quotes, CRLF and a BOM. */
export function readCsvTable(csvText: string): { rows: string[][]; unclosedQuote: boolean } {
  const text = csvText.replace(/^\uFEFF/, '');
  const firstBreak = text.search(/[\r\n]/);
  const sep = pickSeparator(firstBreak === -1 ? text : text.slice(0, firstBreak));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnything = false;
  const endRow = (): void => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
    sawAnything = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
      sawAnything = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
      sawAnything = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
      sawAnything = true;
    }
  }
  if (sawAnything || field !== '' || row.length > 0) endRow();
  return { rows, unclosedQuote: inQuotes };
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
}

/** Builds the one-line text for a supply, in the format of docs/SPEC.md section 6. */
export function formatSupplyLine(f: SupplyFields): string {
  const brand = clean(f.brand);
  const medicine = clean(f.medicine);
  let name = brand || medicine;
  if (brand && medicine && brand.toLowerCase() !== medicine.toLowerCase()) name = `${brand} (${medicine})`;
  const product = [name, clean(f.strength), clean(f.form)].filter(Boolean).join(' ');
  const quantity = clean(f.quantity);
  const repeats = clean(f.repeats);
  const parts = [
    clean(f.date),
    product,
    quantity ? `qty ${quantity}` : '',
    repeats ? `repeats ${repeats}` : '',
    clean(f.directions),
    clean(f.prescriber)
  ];
  return parts.filter(Boolean).join(' | ');
}

/**
 * Builds the one-line text for a fact, in the format of docs/SPEC.md section 6a:
 * "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2", "2026-07-10 | CONDITION | Heart failure".
 * A fact with no date is still a line: it shows "no date".
 */
export function formatFactLine(f: FactFields): string {
  const what = [clean(f.detail), clean(f.value)].filter(Boolean).join(' ');
  return [clean(f.date) || NO_DATE, FACT_WORDS[f.kind], what].filter(Boolean).join(' | ');
}

/** Fields a row actually holds. Empty cells at the end do not count. */
function usedWidth(record: string[]): number {
  let width = record.length;
  while (width > 0 && (record[width - 1] ?? '').trim() === '') width--;
  return width;
}

function listSome(items: string[], max: number): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max), `There are ${items.length - max} more rows like this.`];
}

export function parseCsv(csvText: string): ParsedHistory {
  const problems: string[] = [];
  const patient: PatientHeader = { label: 'Fictional patient' };
  const lines: HistoryLine[] = [];
  const table = readCsvTable(typeof csvText === 'string' ? csvText : '');
  const records = table.rows.filter(r => r.some(cell => cell.trim() !== ''));
  if (records.length === 0) {
    return { patient, lines, problems: ['The file is empty.'] };
  }

  const column: Record<string, number> = {};
  records[0].forEach((heading, index) => {
    const key = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const name = COLUMN_NAMES[key];
    if (name && (column[name] === undefined || key === name)) column[name] = index;
  });
  if (column.dispense_date === undefined) problems.push('The file has no "dispense_date" column.');
  if (column.medicine === undefined && column.brand === undefined) {
    problems.push('The file has no "medicine" or "brand" column.');
  }
  if (problems.length > 0) return { patient, lines, problems };

  const cell = (record: string[], name: string): string => {
    const index = column[name];
    return index === undefined ? '' : (record[index] ?? '').trim();
  };

  const badDates: string[] = [];
  const noNames: string[] = [];
  const oddFacts: string[] = [];
  const tooLong: string[] = [];
  const wideRows: string[] = [];
  const declared = usedWidth(records[0]);
  const refs: string[] = [];
  let supplyRows = 0;
  let datedRows = 0;
  let recordAge: number | undefined;
  let sex = '';
  let latestIso: string | null = null;
  const dobs: string[] = [];
  let unreadableDob = false;
  const hasDobCol = column.patient_dob !== undefined;

  for (let r = 1; r < records.length; r++) {
    const record = records[r];
    const rowNumber = r + 1;                     // the header is row 1, as in a spreadsheet
    const width = usedWidth(record);
    // An extra comma moves the later columns. A shorter row only leaves the trailing cells empty.
    if (width > declared) {
      wideRows.push(`Row ${rowNumber} has more fields than the header (${width}, header ${declared}). A comma in a field may have moved the later columns. The row was kept.`);
    }
    const rawDate = cell(record, 'dispense_date');
    const iso = parseDateField(rawDate);
    const medicine = cell(record, 'medicine');
    const brand = cell(record, 'brand');

    const ref = clean(cell(record, 'patient_ref'));
    if (ref && !refs.some(known => known.toLowerCase() === ref.toLowerCase())) refs.push(ref);
    const ageText = cell(record, 'patient_age');
    if (/^\d{1,3}$/.test(ageText)) {
      const n = Number(ageText);
      if (n <= 130 && (recordAge === undefined || n > recordAge)) recordAge = n;
    }
    if (!sex) sex = clean(cell(record, 'patient_sex'));
    if (hasDobCol) {
      const dobRaw = cell(record, 'patient_dob');
      if (dobRaw) {
        const dobIso = parseBirthDate(dobRaw);
        if (dobIso) dobs.push(dobIso);
        else unreadableDob = true;
      }
    }

    // A file without a "record_type" column gives an empty type for every row: every row is a supply, as before.
    const typeText = cell(record, 'record_type').toLowerCase().replace(/\s+/g, ' ');
    const kind = FACT_TYPES[typeText];
    let text: string;
    if (kind) {
      // A fact: a condition, a result or an observation. Its date is the date it was recorded.
      // A fact with no date is still kept. A date that is written but cannot be read is a problem, as for a supply.
      if (rawDate && !iso) badDates.push(`Row ${rowNumber}: the date "${clean(rawDate)}" cannot be read.`);
      const detail = cell(record, 'detail');
      const value = cell(record, 'value');
      if (!detail && !value) oddFacts.push(`Row ${rowNumber} is a ${kind} row with no detail.`);
      if (medicine || brand) {
        oddFacts.push(`Row ${rowNumber} is a ${kind} row and also names a medicine. A row holds a supply or a fact, not both.`);
      }
      text = formatFactLine({ date: iso ?? rawDate, kind, detail, value });
    } else {
      supplyRows++;
      if (!SUPPLY_TYPES.has(typeText)) {
        oddFacts.push(`Row ${rowNumber}: the record type "${clean(cell(record, 'record_type'))}" is not known. Use dispensed, condition, result or observation.`);
      }
      // The age is worked out at the last supply. A later test or observation must not move that date.
      if (iso && SUPPLY_TYPES.has(typeText) && (latestIso === null || iso > latestIso)) latestIso = iso;
      if (iso) datedRows++;
      else if (rawDate) badDates.push(`Row ${rowNumber}: the date "${clean(rawDate)}" cannot be read.`);
      else badDates.push(`Row ${rowNumber} has no date.`);
      if (!medicine && !brand) noNames.push(`Row ${rowNumber} has no medicine name.`);
      text = formatSupplyLine({
        date: iso ?? rawDate,
        medicine,
        brand,
        strength: cell(record, 'strength'),
        form: cell(record, 'form'),
        quantity: cell(record, 'quantity'),
        repeats: cell(record, 'repeats_left'),
        directions: cell(record, 'directions'),
        prescriber: cell(record, 'prescriber')
      });
    }
    // A row is never cut short without saying so: a row that is too long stops the history from being assessed.
    if (text.length > MAX_LINE_CHARS) tooLong.push(`Row ${rowNumber} is too long to read (over ${MAX_LINE_CHARS} characters).`);
    lines.push({ id: lineId(lines.length + 1), text: text.slice(0, MAX_LINE_CHARS) });
  }

  if (refs.length > 0) patient.label = `Fictional patient ${refs[0]}`;
  if (sex) patient.sex = sex;
  problems.push(...resolvePatientAge(patient, {
    birthDates: dobs,
    unreadableDateOfBirth: hasDobCol && unreadableDob,
    recordAge,
    latestSupplyDate: latestIso
  }));

  if (table.unclosedQuote) problems.push('The file ends inside a quoted field. It may be damaged.');
  if (supplyRows === 0) {
    problems.push('The file has no supply rows.');
  } else if (datedRows === 0) {
    problems.push('No row has a date that can be read.');
  } else {
    problems.push(...listSome(badDates, 5));
  }
  problems.push(...listSome(noNames, 5));
  problems.push(...listSome(oddFacts, 5));
  problems.push(...listSome(tooLong, 5));
  problems.push(...listSome(wideRows, 5));
  if (refs.length > 1) {
    problems.push(`The file holds more than one patient reference (${refs.slice(0, 4).join(', ')}). Import one patient at a time.`);
  }
  return { patient, lines, problems };
}
