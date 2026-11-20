import { describe, expect, it } from 'vitest';
import { linesFromRows } from './history.ts';
import { assembleLetter, letterMessages, type LetterParagraphs } from './letter.ts';
import { readPdfTextRows } from './pdf.ts';
import { screenMessages } from './screen.ts';
import { testConfig, testCriterion } from './testkit.ts';

const HEAD = 'Date | Medicine | Strength | Form | Qty | Repeats | Directions | Prescriber';

describe('readPdfTextRows', () => {
  it('names the columns, leaves the title rows unnumbered, and names the patient as a CSV does', () => {
    const read = readPdfTextRows([
      'Dispensing history',
      'Example Community Pharmacy (fictional). Patient: Fictional patient F-001. Age 72. Female.',
      'Fictional patient. No real person.',
      HEAD,
      '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 5 | Take ONE tablet daily with food | Dr F. Example',
      '21/08/2026 | Celebrex (celecoxib) | 200 mg | capsule | 30 | 2 | Take ONE capsule daily with food | Dr G. Sample',
      HEAD
    ]);
    expect(read.patient).toEqual({ label: 'Fictional patient F-001', age: 72, sex: 'F', ageFrom: 'record' });
    expect(read.rows).toEqual([
      '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example',
      '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample'
    ]);
    const lined = linesFromRows(read.rows);
    expect(lined.problems).toEqual([]);
    expect(lined.lines.map(line => line.id)).toEqual(['L001', 'L002']);
    expect(lined.lines.some(line => line.text.includes('Dispensing history') || line.text.startsWith('Date |'))).toBe(false);
  });

  it('keeps a dated row that has no table head, and still drops a title', () => {
    const read = readPdfTextRows([
      'Example Pharmacy (FICTIONAL)',
      '2026-08-08 Xarelto 20 mg tablet 28',
      '2026-08-21 Celebrex 200 mg capsule 30'
    ]);
    expect(read.patient).toEqual({ label: 'Fictional patient' });
    expect(read.rows).toEqual([
      '2026-08-08 Xarelto 20 mg tablet 28',
      '2026-08-21 Celebrex 200 mg capsule 30'
    ]);
  });

  it('keeps a date that cannot be read, and keeps a column whose name is not one of the usual ones', () => {
    const read = readPdfTextRows([
      'Date | Medicine | Strength | Form | Qty | Repeats | Directions | Prescriber | Pharmacist note',
      '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 5 | Take one | Dr F. Example | Checked',
      '31/02/2026 | Celebrex | 200 mg | capsule | 30 | 2 | Take one | Dr A | With food'
    ]);
    expect(read.rows[1]).toBe('31/02/2026 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take one | Dr A | Pharmacist note With food');
    expect(linesFromRows(read.rows).problems).toEqual(['Line L002: the date "31/02/2026" cannot be read.']);
  });

  it('reads nothing from a value that is not a list of rows', () => {
    for (const raw of [undefined, null, 'Date | Medicine', 3, { rows: [] }]) {
      expect(readPdfTextRows(raw)).toEqual({ patient: { label: 'Fictional patient' }, rows: [] });
    }
  });

  it('skips a blank and a cell that is not text, and keeps a dated row that only looks like a heading', () => {
    const read = readPdfTextRows([
      '',
      '   ',
      4,
      null,
      'Date | 21/08/2026 | Medicine | warfarin'
    ]);
    expect(read.rows).toEqual(['Date | 21/08/2026 | Medicine | warfarin']);
    expect(read.patient).toEqual({ label: 'Fictional patient' });
  });

  it('names the patient from a title, and keeps the first age and sex that can be read', () => {
    const read = readPdfTextRows([
      'Dispensing history. Patient: Mrs Ada Example. Age 130. Male.',
      'Fictional patient. No real person.',
      'Also seen. Age 40. Female.',
      'Patient: someone else',
      HEAD,
      '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 0 | Take one | Dr A'
    ]);
    expect(read.patient).toEqual({ label: 'Fictional patient Mrs Ada Example', age: 130, sex: 'M', ageFrom: 'record' });
    expect(read.rows).toHaveLength(1);

    const tooOld = readPdfTextRows(['Patient: Mr Bram. Age 131. Female.']);
    expect(tooOld.patient).toEqual({ label: 'Fictional patient Mr Bram', sex: 'F' });
  });

  it('reads the other column names, strips a qty or repeats prefix, and writes a brand beside its ingredient', () => {
    const read = readPdfTextRows([
      'Date | Drug | Brand | Strength | Form | Qty | Rpts | Sig | Doctor | Note',
      '21.08.2026 | warfarin | Coumadin | 5 mg | tablet | qty 30 | Repeats 2 | Take one | Dr A | extra note',
      '22/08/2026 | celebrex | CELEBREX | 200 mg | capsule | 30 | 0 | Take one | Dr B'
    ]);
    expect(read.rows).toEqual([
      '2026-08-21 | Coumadin (warfarin) 5 mg tablet | qty 30 | repeats 2 | Take one | Dr A | Note extra note',
      '2026-08-22 | CELEBREX 200 mg capsule | qty 30 | repeats 0 | Take one | Dr B'
    ]);
  });

  it('keeps the first medicine, and does not read a long word as a date', () => {
    const read = readPdfTextRows([
      'Date | Medicine | Ingredient | Qty | Repeats',
      '08/08/2026 | Xarelto | warfarin | quantity 28 | rpts 3',
      'Dispensed | Product',
      '21 Septembers | Celebrex'
    ]);
    expect(read.rows[0]).toBe('2026-08-08 | Xarelto | qty quantity 28 | repeats rpts 3');
    // "21 Septembers" is not read as a date. The row is kept, and the history is not screened without it.
    expect(read.rows.some(row => row.startsWith('21 Septembers') && row.includes('Celebrex'))).toBe(true);
    expect((read.problems ?? []).join(' ')).toContain('Celebrex');
    expect(read.patient).toEqual({ label: 'Fictional patient' });
  });

  it('keeps a row whose date only looks like a date, and a cell past the last column', () => {
    const read = readPdfTextRows([
      'Dispensed date | Medication | Strength',
      '21 Aug | Xarelto | 20 mg | packed separately',
      'not a supply'
    ]);
    expect(read.rows).toEqual(['21 Aug | Xarelto 20 mg | packed separately']);
    expect(read.patient.label).toBe('Fictional patient');
  });

  it('reads a brand with no ingredient, a date that is not the first cell, and a patient line that already says fictional', () => {
    const brandOnly = readPdfTextRows([
      'Supply date | Product | Strength',
      '21/08/2026 | Coumadin | 5 mg',
      ' |  | '
    ]);
    expect(brandOnly.rows).toEqual(['2026-08-21 | Coumadin 5 mg']);

    const swapped = readPdfTextRows([
      'Medicine | Date',
      'Xarelto | 21/08/2026'
    ]);
    expect(swapped.rows).toEqual(['2026-08-21 | Xarelto']);

    const wide = readPdfTextRows([
      'Date | Brand | Note | Extra | More',
      '21/08/2026 | Coumadin | a | b | c'
    ]);
    expect(wide.rows).toEqual(['21/08/2026 | Coumadin | a | b | c']);
    expect(wide.patient).toEqual({ label: 'Fictional patient' });

    const named = readPdfTextRows([
      'Seen on 21 August, with no year.',
      'Fictional patient. No real person',
      'Patient: Fictional Ada. Age 0. MALE.'
    ]);
    expect(named.rows).toEqual([]);
    expect(named.patient).toEqual({ label: 'Fictional Ada', age: 0, sex: 'M', ageFrom: 'record' });

    expect(readPdfTextRows(['Patient: . Age 200.']).patient).toEqual({ label: 'Fictional patient' });
  });

  it('turns a pipe in a medicine into a slash, and replaces the headings', () => {
    const piped = readPdfTextRows([
      'Date | Medicine | Qty',
      '08/08/2026 | |warfarin | QTY 28'
    ]);
    expect(piped.rows).toEqual(['2026-08-08 | /warfarin | qty 28']);

    const replaced = readPdfTextRows([
      'Date | Medicine',
      '08/08/2026 | Xarelto',
      'Date | Brand | Strength',
      '21/08/2026 | Coumadin | 5 mg'
    ]);
    expect(replaced.rows).toEqual([
      '2026-08-08 | Xarelto',
      '2026-08-21 | Coumadin 5 mg'
    ]);

    const notATable = readPdfTextRows([
      'Date | Note',
      '08/08/2026 | hello'
    ]);
    expect(notATable.rows).toEqual(['08/08/2026 | hello']);

    const age = readPdfTextRows(['Patient: Ada. Age 072. Female.']);
    expect(age.patient).toEqual({ label: 'Fictional patient Ada', age: 72, sex: 'F', ageFrom: 'record' });

    const slash = readPdfTextRows([
      'Date | Medicine',
      '99/99 | Xarelto'
    ]);
    expect(slash.rows).toEqual(['99/99 | Xarelto']);
  });

  it('does not join two patients under the first name when the file gives no birth date', () => {
    const read = readPdfTextRows([
      'Patient: Ada Example. Age 70. Female.',
      'Date | Medicine | Directions',
      '2026-01-02 | Celebrex | Take ONE',
      'Patient: Bram Other. Age 68. Male.',
      '2026-02-03 | Warfarin | Take as directed'
    ]);
    const problem = (read.problems ?? []).join(' ');
    expect(problem).toContain('more than one patient');
    expect(problem).toContain('Ada Example');
    expect(problem).toContain('Bram Other');
    expect(read.rows.some(row => row.includes('Celebrex'))).toBe(true);
    expect(read.rows.some(row => row.includes('Warfarin'))).toBe(true);

    const same = readPdfTextRows([
      'Patient: Ada Example. Age 70. Female.',
      'Date | Medicine',
      '2026-01-02 | Celebrex',
      'Patient: Ada Example. Age 70. Female.',
      '2026-02-03 | Celebrex'
    ]);
    expect(same.problems).toBeUndefined();
    expect(same.patient.label).toBe('Fictional patient Ada Example');
    expect(same.rows).toHaveLength(2);
  });

  it('keeps a supply whose date is missing or not a date, and does not screen the rest without it', () => {
    const read = readPdfTextRows([
      'Patient: Ada Example. Age 70. Female.',
      'Date | Medicine | Directions',
      '2026-01-02 | Celebrex | Take ONE',
      ' | Warfarin | Take as directed',
      'see note | Apixaban | Take ONE'
    ]);
    expect(read.rows.some(row => row.includes('Celebrex'))).toBe(true);
    expect(read.rows.some(row => row.includes('Warfarin'))).toBe(true);
    expect(read.rows.some(row => row.includes('Apixaban'))).toBe(true);
    const problem = (read.problems ?? []).join(' ');
    expect(problem).toContain('no date');
    expect(problem).toContain('Warfarin');
    expect(problem).toContain('Apixaban');
  });
});

describe('readPdfTextRows: age from the date of birth', () => {
  const supplies = [
    HEAD,
    '08/08/2026 | Xarelto | 20 mg | tablet | 28 | 5 | Take ONE | Dr A. Example',
    '21/08/2026 | Celebrex | 200 mg | capsule | 30 | 2 | Take ONE | Dr B. Example'
  ];

  it('reads the printed date-of-birth labels and uses the latest supply date', () => {
    for (const label of ['DOB 15/08/1952', 'D.O.B. 15/08/1952', 'Date of birth: 15 August 1952', 'Born 15/08/1952']) {
      const read = readPdfTextRows([`Patient: Fictional patient F-100. ${label}.`, ...supplies]);
      expect(read.patient).toEqual({
        label: 'Fictional patient F-100', dateOfBirth: '1952-08-15', age: 74, ageFrom: 'date_of_birth'
      });
      expect(read.problems ?? []).toEqual([]);
    }
  });

  it('bounds compact patient headers at DOB and Age labels without leaking the date into the label', () => {
    for (const header of [
      'Patient: Fictional patient F-100 DOB 15/08/1952 Age 80.',
      'Patient: Fictional patient F-100 D.O.B. 15/08/1952 Age 80.'
    ]) {
      const read = readPdfTextRows([header, ...supplies]);
      expect(read.patient).toEqual({
        label: 'Fictional patient F-100', dateOfBirth: '1952-08-15', age: 74, ageFrom: 'date_of_birth'
      });
      expect(read.rows).toHaveLength(2);
      expect(read.problems).toContain(
        'The age in the file (80) does not match the date of birth (age 74 at the last supply). The date of birth was used.'
      );
    }
  });

  it('uses the date of birth when it and the printed age agree', () => {
    const read = readPdfTextRows(['Patient: Fictional patient F-100. Age 74. DOB 15/08/1952.', ...supplies]);
    expect(read.patient.age).toBe(74);
    expect(read.patient.ageFrom).toBe('date_of_birth');
    expect(read.problems ?? []).toEqual([]);
  });

  it('uses the date of birth and reports an age that differs by more than one year', () => {
    const read = readPdfTextRows(['Patient: Fictional patient F-100. Age 80. DOB 15/08/1952.', ...supplies]);
    expect(read.patient.age).toBe(74);
    expect(read.patient.ageFrom).toBe('date_of_birth');
    expect(read.problems).toContain(
      'The age in the file (80) does not match the date of birth (age 74 at the last supply). The date of birth was used.'
    );
  });

  it('uses the printed age and reports a date of birth that cannot be read', () => {
    const read = readPdfTextRows(['Patient: Fictional patient F-100. Age 72. DOB not-a-date.', ...supplies]);
    expect(read.patient).toEqual({ label: 'Fictional patient F-100', age: 72, ageFrom: 'record' });
    expect(read.problems).toContain('The date of birth could not be read. The age column was used.');
  });

  it('uses a birth date column for the age and keeps the heading and the date out of every line a model or a letter reads', () => {
    const headings = ['DOB', 'D.O.B.', 'Date of birth', 'Born', 'Birth date', 'patient_dob', 'birthdate'];
    for (const heading of headings) {
      const read = readPdfTextRows([
        'Patient: Fictional patient F-100. Female.',
        `Date | Medicine | ${heading} | Directions`,
        `08/08/2026 | Xarelto | 15 August 1952 | Take ONE tablet daily`,
        `21/08/2026 | Celebrex | 15/08/1952 | Take ONE capsule daily`
      ]);
      expect(read.patient).toEqual({
        label: 'Fictional patient F-100', sex: 'F', dateOfBirth: '1952-08-15', age: 74, ageFrom: 'date_of_birth'
      });
      expect(read.problems ?? []).toEqual([]);
      expect(read.rows).toEqual([
        '2026-08-08 | Xarelto | Take ONE tablet daily',
        '2026-08-21 | Celebrex | Take ONE capsule daily'
      ]);
    }

    const read = readPdfTextRows([
      'Patient: Fictional patient F-100. Female.',
      'Date | Medicine | DOB | Directions',
      '08/08/2026 | Xarelto | 15/08/1952 | Take ONE tablet daily',
      '21/08/2026 | Celebrex | 15/08/1952 | Take ONE capsule daily'
    ]);
    const lined = linesFromRows(read.rows);
    expect(lined.problems).toEqual([]);
    const hidden = ['1952-08-15', '15/08/1952', '15 August 1952', 'DOB', 'D.O.B', 'Date of birth', 'Born'];
    const shownToModels = screenMessages(read.patient, lined.lines, testCriterion).map(message => message.content).join('\n');
    const cited = [lined.lines[0]];
    const paragraphs: LetterParagraphs = {
      subject: 'Review request: a supply for Fictional patient F-100',
      finding_paragraph: 'I am writing about a possible medicines issue for this patient.',
      evidence_paragraph: 'Xarelto was supplied on 8 August 2026.',
      request_paragraph: 'Could you please review this when you next see the patient?'
    };
    const finding = {
      id: 'F0001',
      caseId: 'C0001',
      criterionId: testCriterion.id,
      state: 'accepted' as const,
      possible: false,
      screen: {
        lineIds: ['L001'], medicines: ['rivaroxaban'], reason: 'A supply.',
        linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-20T00:00:00.000Z', seconds: 1
      },
      seenByPharmacist: true
    };
    const letterToTheModel = letterMessages(read.patient, testCriterion, finding, cited).map(message => message.content).join('\n');
    const letter = assembleLetter({
      cfg: testConfig, patient: read.patient, criterion: testCriterion, cited, paragraphs, origin: 'model', when: new Date(2026, 10, 20, 9, 0)
    });
    for (const secret of hidden) {
      expect(shownToModels).not.toContain(secret);
      expect(letterToTheModel).not.toContain(secret);
      expect(letter).not.toContain(secret);
    }
    expect(shownToModels).toContain('74 years');
    expect(shownToModels).toContain('2026-08-08 | Xarelto | Take ONE tablet daily');
    expect(letter).toContain('2026-08-08 | Xarelto | Take ONE tablet daily');
    expect(letter).toContain('Fictional patient F-100, female, 74 years');
  });

  it('rejects a table whose birth date column does not name one date, so it is not screened', () => {
    const read = readPdfTextRows([
      'Patient: Fictional patient F-100. Female.',
      'Date | Medicine | DOB',
      '08/08/2026 | Xarelto | 15/08/1952',
      '21/08/2026 | Celebrex | 01/01/1940'
    ]);
    expect(read.rows.join('\n')).not.toContain('1952');
    expect(read.rows.join('\n')).not.toContain('1940');
    expect(read.rows.join('\n')).not.toContain('DOB');
    expect(read.problems).toContain('The rows give more than one date of birth. The first one was used.');
  });
});
