import { describe, expect, it } from 'vitest';
import { formatFactLine, formatSupplyLine, parseCsv, readCsvTable } from './csv.ts';
import { factLineKind, isFactLine } from '../shared/facts.ts';

const HEADER = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';
// The header of a record that also carries conditions and results (docs/SPEC.md section 6a), as the drafted histories write it.
const RECORD_HEADER = 'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value';

describe('readCsvTable', () => {
  it('reads quoted fields with commas, doubled quotes and line breaks inside quotes', () => {
    const table = readCsvTable('a,b,c\r\n"one, two","say ""hi""","line 1\r\nline 2"\r\nx,y,z\r\n');
    expect(table.unclosedQuote).toBe(false);
    expect(table.rows).toEqual([
      ['a', 'b', 'c'],
      ['one, two', 'say "hi"', 'line 1\r\nline 2'],
      ['x', 'y', 'z']
    ]);
  });

  it('handles a BOM, CRLF, bare LF and a last row with no line break', () => {
    const table = readCsvTable('\uFEFFa,b\r\n1,2\n3,4');
    expect(table.rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps empty fields and reports a quote that is never closed', () => {
    expect(readCsvTable('a,,c\n').rows).toEqual([['a', '', 'c']]);
    expect(readCsvTable('a,"b\nc').unclosedQuote).toBe(true);
  });

  it('reads a file that uses semicolons', () => {
    expect(readCsvTable('a;b;c\n1;2;3\n').rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
});

describe('formatSupplyLine', () => {
  it('builds the line format of the specification', () => {
    expect(formatSupplyLine({
      date: '2026-08-21', medicine: 'celecoxib', brand: 'Celebrex', strength: '200 mg', form: 'capsule',
      quantity: '30', repeats: '2', directions: 'Take ONE capsule daily with food', prescriber: 'Dr G. Sample'
    })).toBe('2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample');
  });

  it('copes with a brand only, an ingredient only, and repeats of zero', () => {
    const base = { date: '2026-08-21', strength: '200 mg', form: 'capsule', quantity: '30', repeats: '0', directions: '', prescriber: '' };
    expect(formatSupplyLine({ ...base, medicine: '', brand: 'Celebrex' })).toBe('2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 0');
    expect(formatSupplyLine({ ...base, medicine: 'celecoxib', brand: '' })).toBe('2026-08-21 | celecoxib 200 mg capsule | qty 30 | repeats 0');
    expect(formatSupplyLine({ ...base, medicine: 'Celecoxib', brand: 'celecoxib' })).toBe('2026-08-21 | celecoxib 200 mg capsule | qty 30 | repeats 0');
  });
});

describe('parseCsv', () => {
  it('reads the patient header and numbers the lines in file order', () => {
    const csv = [
      HEADER,
      'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
      'F-001,72,F,2026-08-21,celecoxib,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
    ].join('\r\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-001', age: 72, sex: 'F', ageFrom: 'record' });
    expect(parsed.lines).toEqual([
      { id: 'L001', text: '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example' },
      { id: 'L002', text: '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample' }
    ]);
  });

  it('takes the header in any order, ignores extra columns and reads day-first dates', () => {
    const csv = [
      'Brand,notes,Dispense Date,MEDICINE,quantity,patient_ref',
      'Celebrex,"extra, ignored",21/08/2026,celecoxib,30,F-009',
      'Xarelto,,8 Aug 2026,,28,F-009'
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient.label).toBe('Fictional patient F-009');
    expect(parsed.lines.map(l => l.text)).toEqual([
      '2026-08-21 | Celebrex (celecoxib) | qty 30',
      '2026-08-08 | Xarelto | qty 28'
    ]);
  });

  it('keeps commas and line breaks that sit inside quotes', () => {
    const csv = `${HEADER}\r\nF-001,72,F,2026-04-19,amoxicillin,Amoxil,500 mg,capsule,20,0,"Take ONE capsule three times a day,\r\nuntil finished",Dr G. Sample\r\n`;
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].text).toBe('2026-04-19 | Amoxil (amoxicillin) 500 mg capsule | qty 20 | repeats 0 | Take ONE capsule three times a day, until finished | Dr G. Sample');
  });

  it('skips blank rows without using up a line number', () => {
    const csv = `${HEADER}\n\nF-001,72,F,2026-01-06,metformin,Diabex XR,1000 mg,tablet,60,4,Take ONE,Dr F. Example\n,,,,,,,,,,,\nF-001,72,F,2026-01-08,,Xarelto,20 mg,tablet,28,5,Take ONE,Dr F. Example\n`;
    const parsed = parseCsv(csv);
    expect(parsed.lines.map(l => l.id)).toEqual(['L001', 'L002']);
  });

  it('reports an empty file, a missing date column and a file with no supply rows', () => {
    expect(parseCsv('').problems).toEqual(['The file is empty.']);
    expect(parseCsv('medicine,brand\ncelecoxib,Celebrex\n').problems).toEqual(['The file has no "dispense_date" column.']);
    expect(parseCsv('dispense_date,quantity\n2026-01-01,3\n').problems).toEqual(['The file has no "medicine" or "brand" column.']);
    expect(parseCsv(HEADER + '\n').problems).toEqual(['The file has no supply rows.']);
  });

  it('reports no dated row, and each date that cannot be read', () => {
    const none = parseCsv('dispense_date,brand\nsoon,Celebrex\nlater,Xarelto\n');
    expect(none.problems).toEqual(['No row has a date that can be read.']);
    expect(none.lines).toHaveLength(2);

    const some = parseCsv('dispense_date,brand\n2026-08-21,Celebrex\n31/02/2026,Xarelto\n,Lipitor\n');
    expect(some.problems).toEqual(['Row 3: the date "31/02/2026" cannot be read.', 'Row 4 has no date.']);
  });

  it('holds a row whose width does not match the header', () => {
    const header = 'dispense_date,medicine,directions,prescriber';
    const shifted = parseCsv([
      header,
      '2026-08-21,Celebrex,"Take ONE, with food",Dr A. Example',
      '2026-08-22,Warfarin,Take ONE, with food,Dr B. Example'
    ].join('\n'));
    expect(shifted.lines).toHaveLength(2);
    expect(shifted.lines[0].text).toContain('Take ONE, with food');
    expect(shifted.lines[0].text).toContain('Dr A. Example');
    expect(shifted.problems.some(p => p.includes('Row 3') && p.includes('more fields'))).toBe(true);

    // A shorter row omits only the trailing cells. Those cells are empty, and the earlier columns stay put.
    const short = parseCsv([
      header,
      '2026-08-21,Celebrex,Take ONE,Dr A. Example',
      '2026-08-22,Warfarin,Take ONE'
    ].join('\n'));
    expect(short.problems).toEqual([]);
    expect(short.lines).toHaveLength(2);
    expect(short.lines[1].text).toContain('Warfarin');
    expect(short.lines[1].text).toContain('Take ONE');

    // The same missing trailing columns on every row are optional. A quoted comma is one field.
    const optional = parseCsv([
      header,
      '2026-08-21,Celebrex,Take ONE',
      '2026-08-22,Warfarin,Take ONE'
    ].join('\n'));
    expect(optional.problems).toEqual([]);
  });

  it('reports a row with no medicine name and a file that mixes two patients', () => {
    const parsed = parseCsv('patient_ref,dispense_date,medicine,brand\nF-001,2026-08-21,,Celebrex\nF-002,2026-08-22,,\n');
    expect(parsed.problems).toContain('Row 3 has no medicine name.');
    expect(parsed.problems.some(p => p.startsWith('The file holds more than one patient reference (F-001, F-002).'))).toBe(true);
  });

  it('does not cut a very long row short without saying so', () => {
    const parsed = parseCsv('dispense_date,brand,directions\n2026-08-21,Celebrex,' + 'x'.repeat(1200) + '\n2026-08-22,Xarelto,Take ONE\n');
    expect(parsed.problems).toEqual(['Row 2 is too long to read (over 1000 characters).']);
    expect(parsed.lines[0].text).toHaveLength(1000);
    expect(parsed.lines).toHaveLength(2);
  });

  it('reads the two demo histories without a problem', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(import.meta.dirname, '..', 'cases', '_demo');
    const positive = parseCsv(fs.readFileSync(path.join(dir, 'positive.csv'), 'utf8'));
    const nearMiss = parseCsv(fs.readFileSync(path.join(dir, 'near-miss.csv'), 'utf8'));
    expect(positive.problems).toEqual([]);
    expect(positive.lines).toHaveLength(45);
    expect(positive.lines[35].text).toBe('2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample');
    expect(nearMiss.problems).toEqual([]);
    expect(nearMiss.lines).toHaveLength(43);
    expect(nearMiss.lines.some(l => l.text.includes('Celebrex'))).toBe(false);
  });
});

// ---------- records that also carry conditions and results (docs/SPEC.md section 6a) ----------

describe('formatFactLine', () => {
  it('builds the three fact lines of the specification', () => {
    expect(formatFactLine({ date: '2026-08-03', kind: 'result', detail: 'eGFR', value: '28 mL/min/1.73 m2' }))
      .toBe('2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2');
    expect(formatFactLine({ date: '2026-07-10', kind: 'condition', detail: 'Heart failure', value: '' }))
      .toBe('2026-07-10 | CONDITION | Heart failure');
    expect(formatFactLine({ date: '2026-08-03', kind: 'observation', detail: 'Blood pressure', value: '168/94 mmHg' }))
      .toBe('2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg');
  });

  it('shows "no date" for a fact with no date, and never lets a cell break the line apart', () => {
    expect(formatFactLine({ date: '', kind: 'condition', detail: 'Heart failure', value: 'NYHA class III' }))
      .toBe('no date | CONDITION | Heart failure NYHA class III');
    expect(formatFactLine({ date: '2026-08-03', kind: 'result', detail: 'eGFR | kidney', value: ' 28 \n mL/min ' }))
      .toBe('2026-08-03 | RESULT | eGFR / kidney 28 mL/min');
  });
});

describe('parseCsv: a record that also carries conditions and results', () => {
  const supply = (date: string, brand: string, type = ''): string =>
    `F-021,74,F,${type},${date},,${brand},250 microgram,tablet,100,1,Take ONE tablet daily,Dr A. Example,,`;
  const fact = (type: string, date: string, detail: string, value = ''): string =>
    `F-021,74,F,${type},${date},,,,,,,,,${detail},${value}`;

  it('reads a file without the three columns exactly as before', () => {
    const rows = [
      'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
      'F-001,72,F,2026-08-21,celecoxib,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample',
      'F-001,72,F,31/02/2026,,Lipitor,40 mg,tablet,30,4,Take ONE tablet at night,Dr F. Example'
    ];
    const before = parseCsv([HEADER, ...rows].join('\r\n'));
    expect(before.lines.map(l => l.text)).toEqual([
      '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example',
      '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample',
      '31/02/2026 | Lipitor 40 mg tablet | qty 30 | repeats 4 | Take ONE tablet at night | Dr F. Example'
    ]);
    expect(before.problems).toEqual(['Row 4: the date "31/02/2026" cannot be read.']);
    // The same supplies under the new header, with the three columns empty, give the same answer.
    const withColumns = parseCsv([
      RECORD_HEADER,
      ...rows.map(row => {
        const cells = row.split(',');
        return [...cells.slice(0, 3), '', ...cells.slice(3), '', ''].join(',');
      })
    ].join('\r\n'));
    expect(withColumns).toEqual(before);
    expect(before.lines.some(l => isFactLine(l.text))).toBe(false);
  });

  it('reads the new header: supplies and facts become lines, numbered together in file order', () => {
    const parsed = parseCsv([
      RECORD_HEADER,
      fact('condition', '2025-12-02', 'Atrial fibrillation'),
      supply('2025-12-09', 'Lanoxin'),
      fact('result', '2026-05-12', 'eGFR', '24 mL/min/1.73 m2'),
      supply('2026-06-02', 'Lanoxin', 'dispensed'),
      fact('observation', '2026-06-02', 'Blood pressure', '168/94 mmHg')
    ].join('\r\n'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-021', age: 74, sex: 'F', ageFrom: 'record' });
    expect(parsed.lines).toEqual([
      { id: 'L001', text: '2025-12-02 | CONDITION | Atrial fibrillation' },
      { id: 'L002', text: '2025-12-09 | Lanoxin 250 microgram tablet | qty 100 | repeats 1 | Take ONE tablet daily | Dr A. Example' },
      { id: 'L003', text: '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2' },
      { id: 'L004', text: '2026-06-02 | Lanoxin 250 microgram tablet | qty 100 | repeats 1 | Take ONE tablet daily | Dr A. Example' },
      { id: 'L005', text: '2026-06-02 | OBSERVATION | Blood pressure 168/94 mmHg' }
    ]);
    expect(parsed.lines.map(l => factLineKind(l.text))).toEqual(['condition', null, 'result', null, 'observation']);
  });

  it('takes the columns in any order and the record type in any case', () => {
    const parsed = parseCsv([
      'value,Detail,Record Type,brand,dispense_date',
      ',,,Lanoxin,2026-06-02',
      '28 mL/min/1.73 m2,eGFR,RESULT,,03/08/2026',
      ',Heart failure,Condition,,10 Jul 2026'
    ].join('\n'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines.map(l => l.text)).toEqual([
      '2026-06-02 | Lanoxin',
      '2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2',
      '2026-07-10 | CONDITION | Heart failure'
    ]);
  });

  it('keeps a comma that sits inside a quoted detail or value', () => {
    const parsed = parseCsv([
      RECORD_HEADER,
      supply('2026-06-02', 'Lanoxin'),
      'F-021,74,F,observation,2025-07-14,,,,,,,,,"COVID-19 vaccine, last dose recorded",1 dose given',
      'F-021,74,F,observation,2026-03-10,,,,,,,,,Blood pressure,"lying 150/90, standing 128/78 mmHg"',
      'F-021,74,F,condition,2026-03-10,,,,,,,,,"Falls, ""at home""","2 falls, no fracture"'
    ].join('\r\n'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines.slice(1).map(l => l.text)).toEqual([
      '2025-07-14 | OBSERVATION | COVID-19 vaccine, last dose recorded 1 dose given',
      '2026-03-10 | OBSERVATION | Blood pressure lying 150/90, standing 128/78 mmHg',
      '2026-03-10 | CONDITION | Falls, "at home" 2 falls, no fracture'
    ]);
  });

  it('keeps a fact row with no date and shows "no date"; it is not a problem', () => {
    const parsed = parseCsv([RECORD_HEADER, supply('2026-06-02', 'Lanoxin'), fact('condition', '', 'Heart failure')].join('\n'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines[1]).toEqual({ id: 'L002', text: 'no date | CONDITION | Heart failure' });
    expect(factLineKind(parsed.lines[1].text)).toBe('condition');
    // A supply with no date is still a problem, as before.
    const supplyNoDate = parseCsv([RECORD_HEADER, supply('2026-06-02', 'Lanoxin'), supply('', 'Lasix')].join('\n'));
    expect(supplyNoDate.problems).toEqual(['Row 3 has no date.']);
  });

  it('reports a fact whose date is written but cannot be read, as it does for a supply', () => {
    const parsed = parseCsv([RECORD_HEADER, supply('2026-06-02', 'Lanoxin'), fact('result', '31/02/2026', 'eGFR', '24 mL/min/1.73 m2')].join('\n'));
    expect(parsed.problems).toEqual(['Row 3: the date "31/02/2026" cannot be read.']);
    expect(parsed.lines[1].text).toBe('31/02/2026 | RESULT | eGFR 24 mL/min/1.73 m2');
  });

  it('reports a record type it does not know, a fact with no detail, and a fact row that names a medicine', () => {
    const parsed = parseCsv([
      RECORD_HEADER,
      supply('2026-06-02', 'Lanoxin'),
      supply('2026-06-03', 'Lasix', 'allergy'),
      fact('result', '2026-05-12', '', ''),
      'F-021,74,F,condition,2026-05-12,furosemide,,,,,,,,Heart failure,'
    ].join('\n'));
    expect(parsed.problems).toEqual([
      'Row 3: the record type "allergy" is not known. Use dispensed, condition, result or observation.',
      'Row 4 is a result row with no detail.',
      'Row 5 is a condition row and also names a medicine. A row holds a supply or a fact, not both.'
    ]);
    expect(parsed.lines).toHaveLength(4);                // every row keeps its line number
  });

  it('does not take a record that holds facts and no supply as a dispensing history', () => {
    const parsed = parseCsv([RECORD_HEADER, fact('condition', '2026-05-12', 'Heart failure')].join('\n'));
    expect(parsed.problems).toEqual(['The file has no supply rows.']);
    expect(parsed.lines).toHaveLength(1);
  });

  it('counts dated rows among the supplies only, as before', () => {
    const parsed = parseCsv([RECORD_HEADER, supply('soon', 'Lanoxin'), fact('result', '2026-05-12', 'eGFR', '24 mL/min/1.73 m2')].join('\n'));
    expect(parsed.problems).toEqual(['No row has a date that can be read.']);
  });

  it('reads a value with no detail, and takes the patient from a fact row too', () => {
    const parsed = parseCsv([
      'patient_ref,patient_age,patient_sex,record_type,dispense_date,brand,detail,value',
      'F-030,81,M,observation,2026-01-05,,,Weight 61 kg',
      'F-030,81,M,,2026-01-06,Lasix,,'
    ].join('\n'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-030', age: 81, sex: 'M', ageFrom: 'record' });
    expect(parsed.lines[0].text).toBe('2026-01-05 | OBSERVATION | Weight 61 kg');
  });
});

describe('parseCsv: age from the date of birth', () => {
  const supplyRow = (dob: string, age: string, date: string, brand: string) =>
    `F-100,${age},F,${dob},${date},,${brand},20 mg,tablet,28,5,Take ONE,Dr A. Example`;
  const headerDob = 'patient_ref,patient_age,patient_sex,patient_dob,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';

  it('takes the age at the last supply, not at a later test or observation', () => {
    // Born 19 Nov 1961. The last supply is the day before the 65th birthday. A later observation must not make the age 65.
    const csv = [
      'patient_ref,patient_sex,patient_dob,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value',
      'F-065,F,19/11/1961,dispensed,2026-11-18,,Celebrex,200 mg,capsule,30,2,Take ONE,Dr G. Sample,,',
      'F-065,F,19/11/1961,observation,2026-11-20,,,,,,,,,Weight,70 kg'
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient.age).toBe(64);
    expect(parsed.patient.ageFrom).toBe('date_of_birth');
    expect(parsed.patient.dateOfBirth).toBe('1961-11-19');
    expect(parsed.lines[1].text).toContain('2026-11-20');
    expect(parsed.lines[1].text).toContain('OBSERVATION');
  });

  it('works out age from the date of birth at the latest supply when there is no age column', () => {
    const csv = [
      'patient_ref,patient_sex,patient_dob,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
      'F-100,F,15/03/1954,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE,Dr A. Example',
      'F-100,F,15/03/1954,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE,Dr G. Sample'
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({
      label: 'Fictional patient F-100', sex: 'F', dateOfBirth: '1954-03-15', age: 72, ageFrom: 'date_of_birth'
    });
  });

  it('uses the date of birth when both agree', () => {
    const csv = [headerDob, supplyRow('15/03/1954', '72', '2026-08-21', 'Celebrex')].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient.age).toBe(72);
    expect(parsed.patient.ageFrom).toBe('date_of_birth');
    expect(parsed.patient.dateOfBirth).toBe('1954-03-15');
  });

  it('uses the date of birth and reports when the age column differs by more than one year', () => {
    const csv = [headerDob, supplyRow('15/03/1954', '80', '2026-08-21', 'Celebrex')].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.patient.age).toBe(72);
    expect(parsed.patient.ageFrom).toBe('date_of_birth');
    expect(parsed.problems).toContain(
      'The age in the file (80) does not match the date of birth (age 72 at the last supply). The date of birth was used.'
    );
  });

  it('uses the age column and reports when the date of birth cannot be read', () => {
    const csv = [headerDob, supplyRow('not-a-date', '65', '2026-08-21', 'Celebrex')].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-100', age: 65, sex: 'F', ageFrom: 'record' });
    expect(parsed.problems).toContain('The date of birth could not be read. The age column was used.');
  });

  it('leaves age unknown when there is neither column', () => {
    const csv = [
      'patient_ref,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
      'F-100,F,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE,Dr G. Sample'
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-100', sex: 'F' });
    expect(parsed.patient.age).toBeUndefined();
    expect(parsed.patient.ageFrom).toBeUndefined();
  });

  it('reads only patient_age as before and sets ageFrom to record', () => {
    const csv = [
      HEADER,
      'F-001,72,F,2026-08-21,celecoxib,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.patient).toEqual({ label: 'Fictional patient F-001', age: 72, sex: 'F', ageFrom: 'record' });
  });
});
