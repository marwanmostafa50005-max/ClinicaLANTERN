// Tests for the twin builder of task K05. No model. Fictional data only.

import { describe, expect, it } from 'vitest';
import { buildPages, mergedPrintHtml, readCaseTable, ROWS_PER_PAGE } from './twins.ts';

const CSV = `patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value
F-T-01,70,F,,2026-01-05,metformin,Diabex XR,1000 mg,tablet,60,5,Take ONE tablet twice a day,Dr A. Example,,
F-T-01,70,F,result,2026-01-07,,,,,,,,,eGFR,55 mL/min/1.73 m2
`;

describe('the twin table', () => {
  it('keeps the patient label, age and sex in the heading and prints dates day first', () => {
    const t = readCaseTable(CSV);
    expect(t.patient).toBe('F-T-01, age 70, female');
    expect(t.rows[0][0]).toBe('05/01/2026');
  });

  it('turns a supply into a row with brand first and a fact into one fact line', () => {
    const t = readCaseTable(CSV);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][1]).toBe('Diabex XR (metformin)');
    expect(t.rows[1][1]).toBe('RESULT: eGFR 55 mL/min/1.73 m2');
  });

  it('says on every page that the patient is fictional, and never wraps a cell', () => {
    const t = readCaseTable(CSV);
    const pages = buildPages(t);
    for (const p of [...pages.print, ...pages.scan]) {
      expect(p).toContain('Fictional patient. No real person.');
      expect(p).toContain('white-space: nowrap');
    }
  });

  it('puts at most 22 data rows on a page, the same slices for print and scan, and keeps every row', () => {
    const many = ['patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber'];
    for (let i = 0; i < 50; i++) {
      many.push(`F-T-02,66,M,2026-0${(i % 9) + 1}-15,medicine${i},Brand${i},10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example`);
    }
    const t = readCaseTable(many.join('\n'));
    const pages = buildPages(t);
    const dataRows = (p: string) => (p.match(/<tr>/g) ?? []).length - 1; // minus the header row
    expect(pages.print.length).toBe(Math.ceil(50 / ROWS_PER_PAGE));
    expect(pages.scan.length).toBe(pages.print.length);
    const total = pages.print.reduce((n, p) => n + dataRows(p), 0);
    expect(total).toBe(50);
    for (const p of pages.print) expect(dataRows(p)).toBeLessThanOrEqual(ROWS_PER_PAGE);
  });

  it('prints on A4 landscape and makes scan pictures A4-on-its-side sized', () => {
    const t = readCaseTable(CSV);
    const pages = buildPages(t);
    for (const p of pages.print) expect(p).toContain('size: A4 landscape');
    for (const p of pages.scan) expect(p).toContain('width: 1754px');
    const merged = mergedPrintHtml(pages);
    expect(merged).toContain('page-break-after: always');
    expect(merged).toContain('F-T-01');
  });
});
