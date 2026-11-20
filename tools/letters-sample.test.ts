import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeConfig } from '../pipeline/config.ts';
import { testCriterion } from '../pipeline/testkit.ts';
import type { ExpectedSheet } from '../shared/types.ts';
import { acceptedFinding, citedIds, firstPlantedCase, main, sampleOne } from './letters-sample.ts';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const sheet: ExpectedSheet = {
  signed_by_clinical_reviewer: null,
  cases: [
    { file: 'STOPP-C10/near-miss.csv', kind: 'near_miss', about: 'No finding.', findings: [] },
    { file: 'STOPP-B3/pos-brand.csv', kind: 'positive', about: 'Another criterion.', findings: [{ criterion: 'STOPP-B3', must_cite: [['L001']] }] },
    {
      file: 'STOPP-C10/pos-brand.csv', kind: 'positive', about: 'The first planted history.',
      findings: [{ criterion: 'STOPP-C10', must_cite: [['L022', 'L026'], ['L001', 'L004']] }]
    },
    {
      file: 'STOPP-C10/pos-buried.csv', kind: 'positive', about: 'A later history.',
      findings: [{ criterion: 'STOPP-C10', must_cite: [['L036']] }]
    }
  ]
};

describe('letters-sample', () => {
  it('takes the first history where the criterion is planted', () => {
    expect(firstPlantedCase(sheet, 'STOPP-C10')?.file).toBe('STOPP-C10/pos-brand.csv');
    expect(firstPlantedCase(sheet, 'STOPP-B3')?.file).toBe('STOPP-B3/pos-brand.csv');
    expect(firstPlantedCase(sheet, 'STOPP-A3')).toBeUndefined();
  });

  it('builds the accepted finding from every line the answer sheet names', () => {
    const finding = sheet.cases[2].findings[0];
    expect(citedIds(finding)).toEqual(['L022', 'L026', 'L001', 'L004']);
    const accepted = acceptedFinding(testCriterion, citedIds(finding), 'Marwan Morsy', '2026-11-18T00:00:00.000Z');
    expect(accepted.state).toBe('accepted');
    expect(accepted.screen.lineIds).toEqual(['L022', 'L026', 'L001', 'L004']);
    expect(accepted.check?.lineIds).toEqual(accepted.screen.lineIds);
    expect(accepted.check?.confirmed).toBe(true);
    expect(accepted.decision).toMatchObject({ action: 'accept', by: 'Marwan Morsy' });
  });

  it('finds a planted history for each of the first ten', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const live = JSON.parse(fs.readFileSync(path.join(root, 'cases', 'expected.json'), 'utf8')) as ExpectedSheet;
    const active = JSON.parse(fs.readFileSync(path.join(root, 'criteria', 'active.json'), 'utf8')) as { active: string[] };
    for (const id of active.active) {
      const row = firstPlantedCase(live, id);
      expect(row, id).toBeTruthy();
      const planted = row?.findings.find(f => f.criterion === id);
      expect(citedIds(planted!), id).not.toHaveLength(0);
    }
  });

  it('tidies line ids, and does not take a finding that names no line', () => {
    expect(citedIds({ criterion: 'STOPP-C10', must_cite: [[' l002 ', 'L002', ''], []] })).toEqual(['L002']);
    const empty: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{ file: 'x.csv', kind: 'positive', about: 'No line.', findings: [{ criterion: 'STOPP-C10', must_cite: [[]] }] }]
    };
    expect(firstPlantedCase(empty, 'STOPP-C10')).toBeUndefined();
  });

  it('matches the criterion id exactly, and keeps a line id that is only digits', () => {
    const sheet: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{
        file: 'mixed.csv', kind: 'positive', about: 'Two criteria.',
        findings: [
          { criterion: 'OTHER', must_cite: [['L001']] },
          { criterion: 'STOPP-C10', must_cite: [['  12 ', 'L12']] }
        ]
      }]
    };
    expect(firstPlantedCase(sheet, 'stopp-c10')).toBeUndefined();
    expect(firstPlantedCase(sheet, 'STOPP-C10')?.file).toBe('mixed.csv');
    const planted = sheet.cases[0]?.findings[1];
    expect(citedIds(planted!)).toEqual(['12', 'L12']);
  });

  it('skips an empty planting, drops a repeated line, and records an accepted finding that has no lines', () => {
    const later: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [
        { file: 'first.csv', kind: 'positive', about: 'No line.', findings: [{ criterion: 'STOPP-C10', must_cite: [[]] }] },
        { file: 'second.csv', kind: 'positive', about: 'Has a line.', findings: [{ criterion: 'STOPP-C10', must_cite: [['L009']] }] }
      ]
    };
    expect(firstPlantedCase(later, 'STOPP-C10')?.file).toBe('second.csv');
    expect(citedIds({ criterion: 'STOPP-C10', must_cite: [['l001'], ['L001', 'L003']] })).toEqual(['L001', 'L003']);

    const accepted = acceptedFinding(testCriterion, [], 'Marwan Morsy', '2026-11-18T00:00:00.000Z');
    expect(accepted.id).toBe('F0001');
    expect(accepted.caseId).toBe('sample');
    expect(accepted.possible).toBe(false);
    expect(accepted.seenByPharmacist).toBe(true);
    expect(accepted.screen.linesVerified).toBe(false);
    expect(accepted.screen.at).toBe('2026-11-18T00:00:00.000Z');
    expect(accepted.check?.whatCannotBeSeen).toBe(testCriterion.cannot_be_seen);
    expect(accepted.check?.completed).toBe(true);
    expect(accepted.decision).toEqual({ action: 'accept', by: 'Marwan Morsy', at: '2026-11-18T00:00:00.000Z' });
  });

  it('stops before any model call when there is no history, no line, or the file cannot be assessed', async () => {
    const cfg = normalizeConfig({});
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-letters-'));
    made.push(outDir);
    const none: ExpectedSheet = { signed_by_clinical_reviewer: null, cases: [] };
    expect(await sampleOne(outDir, cfg, testCriterion, none, outDir)).toBe(
      'DEMO-NSAID-ANTICOAG origin=none notes=No planted history in cases/expected.json.'
    );

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-letters-'));
    made.push(repo);
    const caseDir = path.join(repo, 'cases', 'DEMO-NSAID-ANTICOAG');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'blank.csv'), 'dispense_date,medicine\n');
    const noLines: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{
        file: 'DEMO-NSAID-ANTICOAG/blank.csv', kind: 'positive', about: 'Blank ids.',
        findings: [{ criterion: 'DEMO-NSAID-ANTICOAG', must_cite: [['  ']] }]
      }]
    };
    expect(await sampleOne(repo, cfg, testCriterion, noLines, outDir)).toBe(
      'DEMO-NSAID-ANTICOAG origin=none notes=The answer sheet names no lines.'
    );
    const noRows: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{
        file: 'DEMO-NSAID-ANTICOAG/blank.csv', kind: 'positive', about: 'No supply rows.',
        findings: [{ criterion: 'DEMO-NSAID-ANTICOAG', must_cite: [['L001']] }]
      }]
    };
    expect(await sampleOne(repo, cfg, testCriterion, noRows, outDir)).toBe(
      'DEMO-NSAID-ANTICOAG origin=none notes=Cannot assess: The file has no supply rows.'
    );
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it('refuses a bad start, and names a criterion file that cannot be read', async () => {
    await expect(main(['--wat'])).rejects.toThrow(/Unknown option/);
    await expect(main(['--only'])).rejects.toThrow(/after --only/);
    await expect(main(['extra'])).rejects.toThrow(/Unexpected argument/);
    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      await main(['--only', 'NOT-A-CRITERION']);
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(['NOT-A-CRITERION origin=none notes=The criterion file could not be read.']);
  });

  it('takes a near miss that names a line, and a second --only replaces the first', async () => {
    const near: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [
        { file: 'near.csv', kind: 'near_miss', about: 'Still planted.', findings: [{ criterion: 'STOPP-C10', must_cite: [['   ']] }] },
        { file: 'later.csv', kind: 'positive', about: 'Later.', findings: [{ criterion: 'STOPP-C10', must_cite: [['L002']] }] }
      ]
    };
    expect(firstPlantedCase(near, 'STOPP-C10')?.file).toBe('near.csv');
    expect(citedIds(near.cases[0].findings[0])).toEqual([]);

    const accepted = acceptedFinding(testCriterion, ['L001'], 'Marwan Morsy', '2026-11-18T00:00:00.000Z');
    expect(accepted.screen.linesVerified).toBe(true);
    expect(accepted.screen.medicines).toEqual([]);
    expect(accepted.screen.model).toBe('lantern-screen');
    expect(accepted.screen.seconds).toBe(0);
    expect(accepted.check?.model).toBe('lantern-check');

    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      await main(['--only', 'NOT-A-CRITERION', '--only', 'ALSO-MISSING']);
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(['ALSO-MISSING origin=none notes=The criterion file could not be read.']);
  });

  it('uses the first finding of the criterion, and names a file with no date column', async () => {
    const cfg = normalizeConfig({});
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-letters-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-letters-'));
    made.push(repo, outDir);
    const two: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{
        file: 'DEMO-NSAID-ANTICOAG/gone.csv',
        kind: 'positive',
        about: 'The first finding names nothing.',
        findings: [
          { criterion: 'DEMO-NSAID-ANTICOAG', must_cite: [[' ']] },
          { criterion: 'DEMO-NSAID-ANTICOAG', must_cite: [['L001']] }
        ]
      }]
    };
    expect(firstPlantedCase(two, 'DEMO-NSAID-ANTICOAG')?.file).toBe('DEMO-NSAID-ANTICOAG/gone.csv');
    expect(await sampleOne(repo, cfg, testCriterion, two, outDir)).toBe(
      'DEMO-NSAID-ANTICOAG origin=none notes=The answer sheet names no lines.'
    );

    const caseDir = path.join(repo, 'cases', 'DEMO-NSAID-ANTICOAG');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'nodate.csv'), 'medicine\nCelebrex\n');
    const noDate: ExpectedSheet = {
      signed_by_clinical_reviewer: null,
      cases: [{
        file: 'DEMO-NSAID-ANTICOAG/nodate.csv',
        kind: 'positive',
        about: 'No date column.',
        findings: [{ criterion: 'DEMO-NSAID-ANTICOAG', must_cite: [['L001']] }]
      }]
    };
    expect(await sampleOne(repo, cfg, testCriterion, noDate, outDir)).toBe(
      'DEMO-NSAID-ANTICOAG origin=none notes=Cannot assess: The file has no "dispense_date" column.'
    );
    expect(fs.readdirSync(outDir)).toEqual([]);
    await expect(main(['--only', 'NOT-A-CRITERION', 'extra'])).rejects.toThrow(/Unexpected argument/);
  });
});
