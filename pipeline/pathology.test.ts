// pipeline/pathology.ts reads one result from the text of an uploaded pathology test.
// Every report line here is fictional. No model is called.
import { describe, expect, it } from 'vitest';
import {
  analytesForFact, analyteName, collectionDate, dateIn, readLine, readPathology, readingWords, type PathologyReading
} from './pathology.ts';

const reading = (got: PathologyReading | string | null): PathologyReading => {
  if (got === null || typeof got === 'string') throw new Error(`expected a reading, got: ${String(got)}`);
  return got;
};

describe('which tests a needed result asks for', () => {
  it('knows the results the criteria ask for', () => {
    expect(analytesForFact('Serum sodium')).toEqual(['sodium']);
    expect(analytesForFact('Serum potassium')).toEqual(['potassium']);
    expect(analytesForFact('eGFR (estimated kidney function), the most recent result')).toEqual(['egfr']);
    expect(analytesForFact('Serum creatinine or creatinine-derived eGFR')).toEqual(['egfr', 'creatinine']);
    expect(analytesForFact('ALT or AST as a multiple of its laboratory upper limit')).toEqual(['alt', 'ast']);
    expect(analytesForFact('Most recent INR and test date')).toEqual(['inr']);
    expect(analytesForFact('Corrected serum calcium')).toEqual(['corrected_calcium']);
    expect(analytesForFact('Most recent HbA1c blood test')).toEqual(['hba1c']);
    expect(analytesForFact('Spot urine albumin to creatinine ratio (uACR) for Australian review')).toEqual(['uacr']);
    expect(analytesForFact('Kidney function and electrolytes (for example eGFR or creatinine, with sodium and potassium)')).toEqual(['egfr', 'creatinine', 'sodium', 'potassium']);
  });

  it('offers no upload for a result that is not on a pathology report', () => {
    for (const what of ['Creatinine clearance (unindexed, mL/min)', 'Blood pressure', 'Bone mineral density T-score', 'QTc interval',
      'Weight in kg at or just before treatment started', 'Average daily dose of pregabalin at supply (mg/day)', 'Left ventricular ejection fraction']) {
      expect(analytesForFact(what)).toEqual([]);
    }
  });

  it('names a test plainly', () => {
    expect(analyteName('sodium')).toBe('Sodium');
    expect(analyteName('uacr')).toBe('Urine albumin to creatinine ratio');
  });
});

describe('one line of a report', () => {
  it('reads value, unit, range and flag from a table line', () => {
    const r = reading(readLine('Sodium            128   mmol/L   (135-145)   L', ['sodium']));
    expect(r).toMatchObject({ analyte: 'sodium', name: 'Sodium', value: 128, valueWords: '128', unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L', sure: true });
    expect(r.line).toBe('Sodium 128 mmol/L (135-145) L');
  });

  it('reads a line that puts the flag before the range and the unit last', () => {
    const r = reading(readLine('Potassium   6.1  H   3.5 - 5.2   mmol/L', ['potassium']));
    expect(r).toMatchObject({ value: 6.1, unit: 'mmol/L', refLow: 3.5, refHigh: 5.2, flag: 'H', sure: true });
  });

  it('reads a short name only as a whole word at the start of the line', () => {
    expect(reading(readLine('Na 131 mmol/L (135-145) L', ['sodium'])).value).toBe(131);
    expect(readLine('Name: Fictional patient 131', ['sodium'])).toBeNull();
    expect(readLine('Urine sodium 40 mmol/L', ['sodium'])).toBeNull();
  });

  it('reads a specimen mark before the name', () => {
    expect(reading(readLine('S-Potassium 4.4 mmol/L (3.5-5.2)', ['potassium'])).value).toBe(4.4);
    expect(reading(readLine('Serum Sodium 139 mmol/L 135-145', ['sodium'])).value).toBe(139);
  });

  it('keeps a limit as the report writes it, and says it is not a measured number', () => {
    const r = reading(readLine('eGFR >90 mL/min/1.73m2 (>60)', ['egfr']));
    expect(r).toMatchObject({ value: 90, valueWords: '>90', unit: 'mL/min/1.73m2', refLow: 60, sure: false });
    expect(r.why).toContain('a limit (>90)');
  });

  it('works out the multiple of the upper limit', () => {
    const r = reading(readLine('ALT 142 U/L (5-40) H', ['alt', 'ast']));
    expect(r).toMatchObject({ analyte: 'alt', value: 142, refHigh: 40, multipleOfUpper: 3.6, flag: 'H', sure: true });
    expect(readingWords(r)).toBe('ALT 142 U/L (laboratory range 5 to 40)');
  });

  it('takes the wanted unit when HbA1c is given in two', () => {
    const r = reading(readLine('HbA1c 7.2 % 55 mmol/mol', ['hba1c']));
    expect(r).toMatchObject({ value: 55, unit: 'mmol/mol' });
  });

  it('reads INR, which has no unit', () => {
    expect(reading(readLine('INR 2.4 (2.0-3.0)', ['inr']))).toMatchObject({ value: 2.4, unit: '', sure: true });
  });

  it('does not take calcium for corrected calcium, or the other way round', () => {
    expect(readLine('Calcium corrected 2.71 mmol/L (2.10-2.60) H', ['calcium'])).toBeNull();
    expect(reading(readLine('Calcium corrected 2.71 mmol/L (2.10-2.60) H', ['corrected_calcium'])).value).toBe(2.71);
    expect(reading(readLine('Calcium 2.45 mmol/L (2.10-2.60)', ['calcium', 'corrected_calcium'])).analyte).toBe('calcium');
  });

  it('says the unit is missing, and does not invent one', () => {
    const r = reading(readLine('Lithium 0.9 (0.5-1.0)', ['lithium']));
    expect(r).toMatchObject({ value: 0.9, unit: '', sure: false });
    expect(r.why).toContain('the unit is not on the line');
  });

  it('abstains on a value no person can have (a slipped decimal)', () => {
    const got = readLine('Potassium 450 mmol/L (3.5-5.2) HH', ['potassium']);
    expect(typeof got).toBe('string');
    expect(got as string).toContain('lies outside what Potassium can be');
  });

  it('abstains on a unit that does not fit the test', () => {
    const got = readLine('Potassium 6.1 g/L (3.5-5.2) H', ['potassium']);
    expect(typeof got).toBe('string');
    expect(got as string).toContain('the unit g/L does not fit Potassium');
  });

  it('abstains when several numbers stand on the line', () => {
    const got = readLine('Sodium 139 141 128', ['sodium']);
    expect(typeof got).toBe('string');
    expect(got as string).toContain('more than one number');
  });

  it('abstains on a line with a character that could not be read', () => {
    const got = readLine('Sodium 1?8 mmol/L (135-145) L', ['sodium']);
    expect(typeof got).toBe('string');
    expect(got as string).toContain('could not be read');
  });

  it('doubts a line whose flag and range do not agree', () => {
    const r = reading(readLine('Sodium 139 mmol/L (135-145) L', ['sodium']));
    expect(r.sure).toBe(false);
    expect(r.why).toContain('do not agree');
  });

  it('passes over a heading and a line of another test', () => {
    expect(readLine('Sodium', ['sodium'])).toBeNull();
    expect(readLine('Chloride 101 mmol/L (95-110)', ['sodium'])).toBeNull();
    expect(readLine('Potassium 4.2 mmol/L (3.5-5.2)', ['sodium'])).toBeNull();
  });
});

describe('the date of the sample', () => {
  it('reads dates in Australian order', () => {
    expect(dateIn('12/03/2026')).toBe('2026-03-12');
    expect(dateIn('12 Mar 2026')).toBe('2026-03-12');
    expect(dateIn('12-March-2026 08:15')).toBe('2026-03-12');
    expect(dateIn('2026-03-12')).toBe('2026-03-12');
    expect(dateIn('31/02/2026')).toBeUndefined();
  });

  it('takes only a line that says the sample was collected', () => {
    const pages = [['Fictional Pathology', 'Reported: 14/03/2026 16:02', 'Collected: 12/03/2026 08:15', 'Sodium 128 mmol/L (135-145) L']];
    expect(collectionDate(pages)).toMatchObject({ date: '2026-03-12', line: 'Collected: 12/03/2026 08:15' });
  });

  it('gives no date when the document names none, or more than one', () => {
    expect(collectionDate([['Reported: 14/03/2026', 'Sodium 128 mmol/L']]).date).toBeUndefined();
    expect(collectionDate([['Reported: 14/03/2026', 'Sodium 128 mmol/L']]).note).toContain('does not say when the sample was collected');
    const two = collectionDate([['Collected: 12/03/2026'], ['Collected: 02/01/2026']]);
    expect(two.date).toBeUndefined();
    expect(two.note).toContain('more than one collection date');
  });
});

describe('a whole document', () => {
  const report = [[
    'FICTIONAL PATHOLOGY  (a made-up report for testing)',
    'Patient: Fictional patient P-01    DOB: 01/01/1950',
    'Requested by: Dr A. Example',
    'Date of collection: 12 March 2026 08:15     Reported: 12 March 2026 15:40',
    'ELECTROLYTES, UREA, CREATININE',
    'Sodium            128   mmol/L   (135-145)   L',
    'Potassium         4.4   mmol/L   (3.5-5.2)',
    'Chloride          96    mmol/L   (95-110)',
    'Urea              6.1   mmol/L   (3.0-8.0)',
    'Creatinine        82    umol/L   (60-110)',
    'eGFR              78    mL/min/1.73m2   (>60)'
  ]];

  it('reads the wanted test with the date of the sample, the page and the line', () => {
    const got = readPathology(report, analytesForFact('Serum sodium'));
    expect(got.abstained).toEqual([]);
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ analyte: 'sodium', value: 128, unit: 'mmol/L', flag: 'L', date: '2026-03-12', page: 1, sure: true });
    expect(got.collected).toEqual({ date: '2026-03-12', line: 'Date of collection: 12 March 2026 08:15 Reported: 12 March 2026 15:40' });
  });

  it('reads nothing that was not asked for', () => {
    const got = readPathology(report, analytesForFact('Serum lithium'));
    expect(got.readings).toEqual([]);
    expect(got.abstained).toEqual([]);
  });

  it('reads several wanted tests', () => {
    const got = readPathology(report, analytesForFact('Kidney function and electrolytes (for example eGFR or creatinine, with sodium and potassium)'));
    expect(got.readings.map(r => r.analyte).sort()).toEqual(['creatinine', 'egfr', 'potassium', 'sodium']);
  });

  it('is not sure of a test that stands twice with different values, and gives it no date', () => {
    const twice = [[...report[0], 'Sodium            139   mmol/L   (135-145)']];
    const got = readPathology(twice, ['sodium']);
    expect(got.readings).toHaveLength(2);
    expect(got.readings.every(r => r.sure === false && r.date === undefined)).toBe(true);
    expect(got.readings[0].why).toContain('more than one Sodium value');
  });

  it('carries the reason when a wanted line fails a check', () => {
    const bad = [['Collected: 12/03/2026', 'Potassium 450 mmol/L (3.5-5.2) HH']];
    const got = readPathology(bad, ['potassium']);
    expect(got.readings).toEqual([]);
    expect(got.abstained).toHaveLength(1);
    expect(got.abstained[0]).toContain('a misread is suspected');
  });
});


describe('K-PATH-REVIEW Australian laboratory layouts', () => {
  const readable: { line: string; wanted: string[]; value: number; unit: string; refLow?: number; refHigh?: number; flag?: 'H' | 'L' }[] = [
    { line: 'Sodium 128 mmol/L 135 - 145 L', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'Sodium (135-145) 128 mmol/L L', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'Sodium 128 L (135-145) mmol/L', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'Sodium mmol/L 128 (135-145) L', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'S-Sodium 128 mmol/L (135-145) L', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'P-Potassium 6.1 mmol/L (3.5-5.2) H', wanted: ['potassium'], value: 6.1, unit: 'mmol/L', refLow: 3.5, refHigh: 5.2, flag: 'H' },
    { line: 'Potassium 6.1 HH 3.5-5.2 mmol/L', wanted: ['potassium'], value: 6.1, unit: 'mmol/L', refLow: 3.5, refHigh: 5.2, flag: 'H' },
    { line: 'Potassium 2.9 LL mmol/L 3.5-5.2', wanted: ['potassium'], value: 2.9, unit: 'mmol/L', refLow: 3.5, refHigh: 5.2, flag: 'L' },
    { line: 'Sodium 150 mmol/L (135-145) HIGH', wanted: ['sodium'], value: 150, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'H' },
    { line: 'Sodium 128 mmol/L (135-145) LOW', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'Sodium 150 mmol/L (135-145) *H', wanted: ['sodium'], value: 150, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'H' },
    { line: 'Sodium 128 mmol/L (135-145) L*', wanted: ['sodium'], value: 128, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'L' },
    { line: 'Sodium 150 mmol/L (135-145) *', wanted: ['sodium'], value: 150, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'H' },
    { line: 'eGFR 78 mL/min/1.73m2 (>60)', wanted: ['egfr'], value: 78, unit: 'mL/min/1.73m2', refLow: 60 },
    { line: 'eGFR 78 mL/min/1.73m2 > 60', wanted: ['egfr'], value: 78, unit: 'mL/min/1.73m2', refLow: 60 },
    { line: 'TSH 0.4 mIU/L <5.0', wanted: ['tsh'], value: 0.4, unit: 'mIU/L', refHigh: 5 },
    { line: 'ALT 142 U/L 5-40 H', wanted: ['alt'], value: 142, unit: 'U/L', refLow: 5, refHigh: 40, flag: 'H' },
    { line: 'AST 88 IU/L (<40) HH', wanted: ['ast'], value: 88, unit: 'IU/L', refHigh: 40, flag: 'H' },
    { line: 'HbA1c 7.2 % 55 mmol/mol', wanted: ['hba1c'], value: 55, unit: 'mmol/mol' },
    { line: 'INR 2.4 2.0-3.0', wanted: ['inr'], value: 2.4, unit: '', refLow: 2, refHigh: 3 },
    { line: 'Creatinine 82 umol/L 60-110', wanted: ['creatinine'], value: 82, unit: 'umol/L', refLow: 60, refHigh: 110 },
    { line: 'Ferritin 25 ng/mL (10-120) L', wanted: ['ferritin'], value: 25, unit: 'ng/mL', refLow: 10, refHigh: 120, flag: 'L' },
    { line: 'Corrected calcium 2.71 mmol/L (2.10-2.60) H', wanted: ['corrected_calcium'], value: 2.71, unit: 'mmol/L', refLow: 2.1, refHigh: 2.6, flag: 'H' },
    { line: 'Urine ACR 4.2 mg/mmol (<3.0) H', wanted: ['uacr'], value: 4.2, unit: 'mg/mmol', refHigh: 3, flag: 'H' }
  ];

  it.each(readable)('reads $line without inventing a value', ({ line, wanted, value, unit, refLow, refHigh, flag }) => {
    const got = reading(readLine(line, wanted));
    expect(got).toMatchObject({ value, unit, ...(refLow === undefined ? {} : { refLow }), ...(refHigh === undefined ? {} : { refHigh }), ...(flag === undefined ? {} : { flag }) });
  });

  const ambiguous = [
    'Sodium 128 139 mmol/L (135-145)',
    'Sodium 01/03/2026 128 02/03/2026 139 mmol/L (135-145)',
    'Sodium 128 139 150 mmol/L (135-145)',
    'ALT 42 88 U/L (5-40)',
    'Potassium 4,4 mmol/L (3.5-5.2)',
    'Creatinine 1,234 umol/L (60-110)'
  ];

  it.each(ambiguous)('abstains instead of choosing one number from %s', line => {
    const wanted = line.startsWith('Sodium') ? ['sodium'] : line.startsWith('ALT') ? ['alt'] : line.startsWith('Potassium') ? ['potassium'] : ['creatinine'];
    const got = readLine(line, wanted);
    expect(typeof got, JSON.stringify(got)).toBe('string');
  });

  it('report 1: reads a value-first report and keeps collection distinct from request', () => {
    const got = readPathology([[
      'FICTIONAL PATHOLOGY report 1', 'Requested: 11/03/2026 Collected: 12/03/2026 08:15',
      'Sodium 128 mmol/L 135 - 145 L', 'Comment under result: sample transported on ice.'
    ]], ['sodium']);
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ value: 128, unit: 'mmol/L', date: '2026-03-12', flag: 'L' });
    expect(got.collected?.date).toBe('2026-03-12');
  });

  it('report 2: reads a range-first report with a separate unit column and star flag', () => {
    const got = readPathology([[
      'FICTIONAL PATHOLOGY report 2', 'Collection date 12-Mar-2026',
      'Test Reference range Result Units Flag', 'Sodium (135-145) 150 mmol/L *'
    ]], ['sodium']);
    expect(got.readings).toHaveLength(1);
    expect(got.readings[0]).toMatchObject({ value: 150, unit: 'mmol/L', refLow: 135, refHigh: 145, flag: 'H', date: '2026-03-12' });
  });

  it('report 3: abstains on a cumulative report with several dated result columns', () => {
    const got = readPathology([[
      'FICTIONAL PATHOLOGY report 3', 'Collected: 02/03/2026', 'Results 01/03/2026 02/03/2026',
      'Sodium 138 139 mmol/L (135-145)'
    ]], ['sodium']);
    expect(got.readings).toEqual([]);
    expect(got.abstained).toHaveLength(1);
  });

  it('report 4: uses a complete ALT row but no value from a sodium result split over two lines', () => {
    const got = readPathology([[
      'FICTIONAL PATHOLOGY report 4', 'Sample date: 12/03/26',
      'Sodium', '128 mmol/L (135-145)', 'ALT 88 U/L (5-40) H', 'Comment: no haemolysis noted.'
    ]], ['sodium', 'alt']);
    expect(got.readings.map(item => ({ analyte: item.analyte, value: item.value }))).toEqual([{ analyte: 'alt', value: 88 }]);
  });

  it('report 5: keeps unbracketed one-sided laboratory limits', () => {
    const got = readPathology([[
      'FICTIONAL PATHOLOGY report 5', 'Specimen collected 2026-03-12',
      'eGFR 78 mL/min/1.73m2 > 60', 'TSH 6.2 mIU/L <5.0 HIGH'
    ]], ['egfr', 'tsh']);
    expect(got.readings.find(item => item.analyte === 'egfr')).toMatchObject({ value: 78, refLow: 60 });
    expect(got.readings.find(item => item.analyte === 'tsh')).toMatchObject({ value: 6.2, refHigh: 5, flag: 'H' });
  });
});

describe('K-PATH-REVIEW collection-date ambiguity', () => {
  it('reads laboratory date forms without confusing request and collection dates', () => {
    expect(collectionDate([['Request date 10/03/2026 Collection date 12/3/26']]).date).toBe('2026-03-12');
    expect(collectionDate([['Specimen collected 12-Mar-2026']]).date).toBe('2026-03-12');
    expect(collectionDate([['Sample date 12 March 2026']]).date).toBe('2026-03-12');
    expect(collectionDate([['Collected 2026-03-12']]).date).toBe('2026-03-12');
  });

  it('does not read a DOB as the collection date on either side of the label', () => {
    expect(collectionDate([['DOB 01/01/1950 Collected: 12/03/2026']]).date).toBe('2026-03-12');
    expect(collectionDate([['Collected: 12/03/2026 DOB 01/01/1950']]).date).toBe('2026-03-12');
    expect(collectionDate([['Collected: DOB 01/01/1950']]).date).toBeUndefined();
  });

  it('gives no date when the collection field holds only another labelled date', () => {
    expect(collectionDate([['Collected: Requested 10/03/2026 12/03/2026']]).date).toBeUndefined();
    expect(collectionDate([['Not collected: 12/03/2026']]).date).toBeUndefined();
  });

  it('gives no shared date for two specimens', () => {
    const got = collectionDate([['Specimen 1 collected 11/03/2026'], ['Specimen 2 collected 12/03/2026']]);
    expect(got.date).toBeUndefined();
    expect(got.note).toContain('more than one collection date');
  });
});
