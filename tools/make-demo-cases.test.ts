// The demo histories that tools/make-demo-cases.mjs builds. Importing the script writes nothing:
// the three CSV files are written only when the file is run on its own. No model is called.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Row {
  date: string;
  brand: string;
  medicine: string;
  prescriber?: string;
}

interface DemoModule {
  cell: (value: unknown) => string;
  toCsv: (rows: Row[], patient: { ref: string; age: number; sex: string }) => string;
  history: () => Row[];
  longHistory: () => Row[];
  lineId: (i: number) => string;
  linesOf: (rows: Row[], test: (row: Row) => boolean) => string[];
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const demo = await import(new URL('./make-demo-cases.mjs', import.meta.url).href) as DemoModule;

describe('the demo histories', () => {
  it('puts Celebrex on the positive history and leaves it off the near miss, with Xarelto still there', () => {
    const positive = demo.history();
    const near = positive.filter(row => row.brand !== 'Celebrex');
    const celebrex = demo.linesOf(positive, row => row.brand === 'Celebrex');
    expect(celebrex).toEqual(['L036', 'L041']);
    expect(near.some(row => row.brand === 'Celebrex')).toBe(false);
    expect(near.some(row => row.brand === 'Xarelto')).toBe(true);
    expect(demo.linesOf(near, row => row.brand === 'Xarelto').length).toBe(10);
  });

  it('puts Xarelto at the start of the long history and Celebrex at the end, hundreds of lines later', () => {
    const rows = demo.longHistory();
    const xarelto = demo.linesOf(rows, row => row.brand === 'Xarelto');
    const celebrex = demo.linesOf(rows, row => row.brand === 'Celebrex');
    expect(xarelto[0]).toBe('L001');
    expect(celebrex).toEqual([demo.lineId(rows.length - 2), demo.lineId(rows.length - 1)]);
    const lastXarelto = Number(xarelto[xarelto.length - 1].slice(1));
    const firstCelebrex = Number(celebrex[0].slice(1));
    expect(firstCelebrex - lastXarelto).toBeGreaterThan(200);
    const recent = demo.linesOf(rows, row => row.brand === 'Xarelto' && row.date >= '2026-07-01');
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every(id => xarelto.includes(id))).toBe(true);
  });

  it('writes the same CSV the demo files already hold, and quotes a field that contains a comma', () => {
    const patient = { ref: 'F-001', age: 72, sex: 'F' };
    const csv = demo.toCsv(demo.history(), patient);
    expect(csv.startsWith('patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,')).toBe(true);
    expect(csv).toBe(fs.readFileSync(path.join(repoRoot, 'cases', '_demo', 'positive.csv'), 'utf8'));
    expect(demo.toCsv(demo.history().filter(row => row.brand !== 'Celebrex'), { ref: 'F-002', age: 72, sex: 'F' }))
      .toBe(fs.readFileSync(path.join(repoRoot, 'cases', '_demo', 'near-miss.csv'), 'utf8'));
    expect(demo.toCsv(demo.longHistory(), { ref: 'F-003', age: 74, sex: 'M' }))
      .toBe(fs.readFileSync(path.join(repoRoot, 'cases', '_demo', 'long-split.csv'), 'utf8'));
    expect(demo.cell('Take ONE, then stop')).toBe('"Take ONE, then stop"');
    expect(demo.cell('say "no"')).toBe('"say ""no"""');
    expect(demo.cell('plain')).toBe('plain');
  });

  it('quotes a line break, numbers a line from one, and finds nothing when no row matches', () => {
    expect(demo.cell('line\nbreak')).toBe('"line\nbreak"');
    expect(demo.cell('line\rbreak')).toBe('"line\rbreak"');
    expect(demo.lineId(0)).toBe('L001');
    expect(demo.lineId(9)).toBe('L010');
    expect(demo.lineId(99)).toBe('L100');
    expect(demo.linesOf([], () => true)).toEqual([]);
    expect(demo.linesOf(demo.history(), row => row.brand === 'Not a medicine')).toEqual([]);
  });

  it('puts Amoxil on the short history only in April, and twice on the long history', () => {
    const rows = demo.history();
    expect(rows).toHaveLength(45);
    const amoxil = rows.filter(row => row.brand === 'Amoxil');
    expect(amoxil.map(row => row.date)).toEqual(['2026-04-19']);
    expect(rows.filter(row => row.brand === 'Panadol Osteo').map(row => row.date)).toEqual(['2026-03-15', '2026-07-15']);
    expect(rows.some(row => row.brand === 'Celebrex' && row.date.startsWith('2026-10'))).toBe(false);
    expect(demo.longHistory().filter(row => row.brand === 'Amoxil').map(row => row.date)).toEqual(['2025-04-19', '2026-04-22']);
  });

  it('turns a number into text, quotes a patient ref that holds a comma, and stops the long history in October 2026', () => {
    expect(demo.cell(72)).toBe('72');
    expect(demo.cell(0)).toBe('0');
    expect(demo.cell('')).toBe('');
    const csv = demo.toCsv([], { ref: 'F-000', age: 70, sex: 'F' });
    expect(csv).toBe('patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber\r\n');
    const quoted = demo.toCsv(demo.history(), { ref: 'F,001', age: 72, sex: 'F' }).split('\r\n');
    expect(quoted[1].startsWith('"F,001",72,F,')).toBe(true);
    const rows = demo.longHistory();
    expect(rows.some(row => row.date.startsWith('2026-11'))).toBe(false);
    expect(rows.some(row => row.date.startsWith('2026-12'))).toBe(false);
    expect(rows.filter(row => row.brand === 'Xarelto')).toHaveLength(34);
    expect(demo.lineId(999)).toBe('L1000');
  });

  it('starts in January 2024, keeps December of the earlier years, and quotes a comma beside a quotation mark', () => {
    const rows = demo.longHistory();
    expect(rows[0]).toMatchObject({ date: '2024-01-08', brand: 'Xarelto', medicine: '' });
    expect(rows.some(row => row.date === '2024-12-08' && row.brand === 'Xarelto')).toBe(true);
    expect(rows.some(row => row.date === '2025-12-08' && row.brand === 'Xarelto')).toBe(true);
    expect(rows.some(row => row.date.startsWith('2023'))).toBe(false);
    expect(rows.filter(row => row.brand === 'Xarelto').at(-1)?.date).toBe('2026-10-08');
    expect(demo.cell('say "no", then stop')).toBe('"say ""no"", then stop"');
    const csv = demo.toCsv([rows[0]], { ref: 'F-003', age: 74, sex: 'M' });
    expect(csv).toContain('2024-01-08,,Xarelto,');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').filter(line => line !== '')).toHaveLength(2);
  });

  it('does not write the demo files when the script is imported', async () => {
    const files = ['positive.csv', 'near-miss.csv', 'long-split.csv'].map(name => path.join(repoRoot, 'cases', '_demo', name));
    const before = files.map(file => fs.statSync(file).mtimeMs);
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/make-demo-cases.mjs'"], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    expect(code).toBe(0);
    files.forEach((file, i) => expect(fs.statSync(file).mtimeMs).toBe(before[i]));
  });

  it('quotes a return and a newline together, and numbers the second row as L002', () => {
    expect(demo.cell(null)).toBe('null');
    expect(demo.cell('a\r\nb')).toBe('"a\r\nb"');
    expect(demo.cell('\t')).toBe('\t');
    expect(demo.cell('"')).toBe('""""');
    expect(demo.lineId(-1)).toBe('L000');
    const two: Row[] = [
      { date: '2026-01-06', brand: 'A', medicine: 'a' },
      { date: '2026-01-08', brand: 'B', medicine: 'b' }
    ];
    expect(demo.linesOf(two, row => row.brand === 'B')).toEqual(['L002']);
    const quoted = demo.toCsv([{ ...two[0], directions: 'one, two' } as Row], { ref: 'F-1', age: 70, sex: 'F' });
    expect(quoted).toContain('"one, two"');
    expect(quoted).toContain(',undefined,');
  });

  it('starts the short history in January, quotes a sex that holds a newline, and keeps Seretide through October 2026', () => {
    const rows = demo.history();
    expect(rows[0]).toMatchObject({ date: '2026-01-06', brand: 'Diabex XR', medicine: 'metformin', prescriber: 'Dr F. Example' });
    expect(rows.filter(row => row.brand === 'Xarelto')[0]).toMatchObject({ date: '2026-01-08', medicine: '', prescriber: 'Dr F. Example' });
    expect(rows.filter(row => row.brand === 'Celebrex').map(row => row.date)).toEqual(['2026-08-21', '2026-09-20']);
    expect(rows.filter(row => row.brand === 'Celebrex').every(row => row.prescriber === 'Dr G. Sample')).toBe(true);
    expect(demo.cell(undefined)).toBe('undefined');
    const csv = demo.toCsv([rows[0]], { ref: 'F-1', age: 70, sex: 'F\nM' });
    expect(csv).toContain('"F\nM"');
    const seretide = demo.longHistory().filter(row => row.brand === 'Seretide');
    expect(seretide).toHaveLength(34);
    expect(seretide[0]).toMatchObject({ date: '2024-01-20', medicine: 'fluticasone propionate with salmeterol' });
    expect(seretide.at(-1)?.date).toBe('2026-10-20');
    expect(seretide.some(row => row.date === '2024-12-20')).toBe(true);
    expect(seretide.some(row => row.date.startsWith('2026-11'))).toBe(false);
  });
});
