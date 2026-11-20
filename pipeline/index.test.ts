// The pipeline entry other parts import. No model is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from './config.ts';
import { checkLetterFacts, loadConfig, loadCriteria, loadCriteriaFrom, parseCsv } from './index.ts';
import { testCriterion } from './testkit.ts';

const made: string[] = [];
const errors: string[] = [];
let spy: { mockRestore: () => void } | undefined;

afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
  errors.length = 0;
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-index-'));
  made.push(dir);
  return dir;
}

function watchErrors(): void {
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
}

const CSV = [
  'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
  'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example'
].join('\n');

describe('loadConfig and parseCsv', () => {
  it('uses the defaults when there is no settings file, and refuses a file that is not JSON', () => {
    const dir = tempDir();
    expect(loadConfig(dir)).toEqual(normalizeConfig({}));
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), '{');
    expect(() => loadConfig(dir)).toThrow(/lantern.config.json could not be read/);
  });

  it('reads one supply row and gives it a line id', () => {
    const read = parseCsv(CSV);
    expect(read.problems).toEqual([]);
    expect(read.lines.map(line => line.id)).toEqual(['L001']);
    expect(read.lines[0].text).toContain('Xarelto');
    expect(read.patient.age).toBe(72);
  });

  it('reads a settings file, and names a history with no date column and two patients', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'lantern.config.json'), JSON.stringify({
      port: 8790,
      pharmacy: { pharmacist: '  A. Pharmacist  ' }
    }));
    const cfg = loadConfig(dir);
    expect(cfg.port).toBe(8790);
    expect(cfg.pharmacy.pharmacist).toBe('A. Pharmacist');
    expect(cfg.modelNames.screen).toBe(normalizeConfig({}).modelNames.screen);

    const noDate = parseCsv('medicine\nXarelto\n');
    expect(noDate.problems).toEqual(['The file has no "dispense_date" column.']);
    expect(noDate.lines).toEqual([]);

    const header = CSV.split('\n')[0];
    const second = 'F-002,80,M,2026-09-01,celecoxib,,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample';
    const two = parseCsv([header, CSV.split('\n')[1], second].join('\n'));
    expect(two.problems).toEqual([
      'The file holds more than one patient reference (F-001, F-002). Import one patient at a time.'
    ]);
    expect(two.lines.map(line => line.id)).toEqual(['L001', 'L002']);
    expect(two.patient.label).toBe('Fictional patient F-001');
  });

  it('reports an empty file with no lines, and names a date that cannot be read', () => {
    expect(parseCsv('').problems).toEqual(['The file is empty.']);
    expect(parseCsv('').lines).toEqual([]);
    const header = CSV.split('\n')[0];
    const bad = parseCsv([
      header,
      'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
      'F-001,72,F,31/02/2026,,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
    ].join('\n'));
    expect(bad.problems).toEqual(['Row 3: the date "31/02/2026" cannot be read.']);
    expect(bad.lines.map(line => line.id)).toEqual(['L001', 'L002']);
  });
});

describe('the letter fact check at the pipeline entry', () => {
  it('names a date the letter invented, and accepts a date that is in the allowed lines', () => {
    const allowed = '2026-08-08 | Xarelto 20 mg tablet';
    expect(checkLetterFacts(['Supplied on 20/10/2026.'], allowed)).toEqual([
      'The date "20/10/2026" is not in the dispensing lines.'
    ]);
    expect(checkLetterFacts(['Supplied on 2026-08-08.'], allowed)).toEqual([]);
    expect(checkLetterFacts(['Atorvastatin was supplied.'], allowed)).toEqual([
      'The medicine name "atorvastatin" is not in the dispensing lines or the criterion.'
    ]);
  });

  it('reads a fact row through the entry, in the same numbering as a supply', () => {
    const header = 'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,detail,value';
    const read = parseCsv([
      header,
      'F-001,72,F,result,2026-08-03,,eGFR,28 mL/min/1.73 m2',
      'F-001,72,F,,2026-08-08,Xarelto,,'
    ].join('\n'));
    expect(read.problems).toEqual([]);
    expect(read.lines.map(line => line.id)).toEqual(['L001', 'L002']);
    expect(read.lines[0].text).toBe('2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2');
    expect(read.lines[1].text).toContain('Xarelto');
  });
});

describe('a criterion file that does not load', () => {
  it('names it on the error output and still returns the ones that did load', async () => {
    const folder = tempDir();
    fs.mkdirSync(path.join(folder, 'GOOD'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'BAD'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'GOOD', 'criterion.json'), JSON.stringify(testCriterion));
    fs.writeFileSync(path.join(folder, 'BAD', 'criterion.json'), JSON.stringify({ label: 'No statement' }));
    watchErrors();
    const loaded = await loadCriteriaFrom(folder, ['BAD', 'GOOD']);
    expect(loaded.map(c => c.id)).toEqual(['GOOD']);
    expect(errors).toEqual(['Criterion BAD was not loaded. Criterion BAD: "statement" is missing.']);
  });

  it('stops with the reason when none loads, and writes no line', async () => {
    const folder = tempDir();
    fs.mkdirSync(path.join(folder, 'BAD'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'BAD', 'criterion.json'), JSON.stringify({ label: 'No statement' }));
    watchErrors();
    await expect(loadCriteriaFrom(folder, ['BAD'])).rejects.toThrow('Criterion BAD: "statement" is missing.');
    expect(errors).toEqual([]);
  });

  it('loads a repeated id once', async () => {
    const folder = tempDir();
    fs.mkdirSync(path.join(folder, 'GOOD'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'GOOD', 'criterion.json'), JSON.stringify(testCriterion));
    const loaded = await loadCriteriaFrom(folder, ['GOOD', 'GOOD']);
    expect(loaded.map(c => c.id)).toEqual(['GOOD']);
  });

  it('refuses a repository that has no list of criteria', async () => {
    await expect(loadCriteria(tempDir())).rejects.toThrow(/The list of criteria could not be read/);
  });

  it('names a further criterion that does not load, and writes no line when one of the ten does not', async () => {
    const repo = tempDir();
    const criteria = path.join(repo, 'criteria');
    fs.mkdirSync(path.join(criteria, 'GOOD'), { recursive: true });
    fs.mkdirSync(path.join(criteria, 'BAD'), { recursive: true });
    fs.writeFileSync(path.join(criteria, 'GOOD', 'criterion.json'), JSON.stringify({ ...testCriterion, id: 'GOOD', label: 'Good' }));
    fs.writeFileSync(path.join(criteria, 'BAD', 'criterion.json'), JSON.stringify({ label: 'No statement' }));
    fs.writeFileSync(path.join(criteria, 'active.json'), JSON.stringify({ active: ['GOOD'], further: ['BAD'], reserves: [] }));
    watchErrors();
    const loaded = await loadCriteria(repo);
    expect(loaded.map(c => c.id)).toEqual(['GOOD']);
    expect(errors).toEqual(['Criterion BAD was not loaded. Criterion BAD: "statement" is missing.']);

    fs.writeFileSync(path.join(criteria, 'active.json'), JSON.stringify({ active: ['BAD'], further: ['GOOD'], reserves: [] }));
    errors.length = 0;
    await expect(loadCriteria(repo)).rejects.toThrow('Criterion BAD: "statement" is missing.');
    expect(errors).toEqual([]);
  });
});
