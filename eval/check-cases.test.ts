// Tests for the case check on a wave folder (tools/check-cases.mjs --wave). The tool is started the
// way a person starts it, on made-up wave folders in the temp folder. No model. Fictional data only.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { COLUMNS_12, csv15, draftedCriterion, draftedFact, draftedSupplies, factRow, makeWave, removeTempDirs, supplyRow, tempDir } from './fakes.ts';
import type { WaveCriterionFiles } from './fakes.ts';

afterEach(removeTempDirs);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'check-cases.mjs');

interface Verdict { id: string; status: 'ok' | 'not_ok' | 'not_drafted'; problems: string[]; notes: string[]; histories: number; needsFact: boolean }
interface Answer { all_ok: boolean; counts: { criteria: number; ok: number; not_ok: number; not_drafted: number }; waves: { name: string; criteria: Verdict[] }[] }

function check(...args: string[]): { code: number | null; out: string } {
  const done = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
  return { code: done.status, out: `${done.stdout}${done.stderr}` };
}

function checkJson(...waves: string[]): { code: number | null; answer: Answer; byId: Record<string, Verdict> } {
  const done = check(...waves.flatMap((w) => ['--wave', w]), '--json');
  const answer = JSON.parse(done.out) as Answer;
  const byId = Object.fromEntries(answer.waves.flatMap((w) => w.criteria).map((c) => [c.id, c]));
  return { code: done.code, answer, byId };
}

function wave(criteria: Record<string, WaveCriterionFiles>, name = 'W950'): string {
  return makeWave(tempDir('lantern-check-'), name, criteria);
}

// One criterion with one change made to it, checked alone.
function problemsOf(id: string, files: WaveCriterionFiles): string[] {
  return checkJson(wave({ [id]: files })).byId[id].problems;
}

describe('the case check on a wave folder', () => {
  it('prints one verdict for each criterion and ends with code 0 when all are ok', () => {
    const dir = wave({ 'GOOD-1': draftedSupplies('GOOD-1'), 'FACT-2': draftedFact('FACT-2'), 'GONE-3': { notDrafted: 'Not drafted.' } });
    const done = check('--wave', dir);
    expect(done.code).toBe(0);
    const lines = done.out.split(/\r?\n/);
    expect(lines).toContain('Wave folder W950: 3 criterion folders.');
    expect(lines).toContain('FACT-2  ok  (3 histories, needs a fact)');
    expect(lines).toContain('GONE-3  not drafted');
    expect(lines).toContain('GOOD-1  ok  (3 histories, supplies only)');
    expect(lines).toContain('Criteria: 3. Ok: 2. Not ok: 0. Not drafted: 1.');
    expect(lines).toContain('Every drafted criterion is ok.');
    expect(done.out.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it('says what is wrong, and ends with code 1 when a criterion is not ok', () => {
    const broken = draftedSupplies('BAD-4');
    (broken.histories as Record<string, string>)['extra.csv'] = csv15(supplyRow('F-BAD-4', '2026-01-05', 'otherol', 'Othex'));
    const dir = wave({ 'GOOD-1': draftedSupplies('GOOD-1'), 'BAD-4': broken });
    const done = check('--wave', dir);
    expect(done.code).toBe(1);
    const lines = done.out.split(/\r?\n/);
    expect(lines).toContain('BAD-4  NOT OK  extra.csv: the file is in the folder, but expected.part.json does not list it.');
    expect(lines).toContain('GOOD-1  ok  (3 histories, supplies only)');
    expect(lines).toContain('Criteria: 2. Ok: 1. Not ok: 1. Not drafted: 0.');
    expect(lines).toContain('Fix what is not ok, then run this again.');
  });

  it('gives the same answer as JSON for a script', () => {
    const dir = wave({ 'GOOD-1': draftedSupplies('GOOD-1'), 'FACT-2': draftedFact('FACT-2'), 'GONE-3': { notDrafted: 'Not drafted.' } });
    const { code, answer, byId } = checkJson(dir);
    expect(code).toBe(0);
    expect(answer).toMatchObject({ all_ok: true, counts: { criteria: 3, ok: 2, not_ok: 0, not_drafted: 1 } });
    expect(answer.waves.map((w) => w.name)).toEqual(['W950']);
    expect(byId['GOOD-1']).toEqual({ id: 'GOOD-1', status: 'ok', problems: [], notes: [], histories: 3, needsFact: false });
    expect(byId['FACT-2']).toMatchObject({ status: 'ok', histories: 3, needsFact: true });
    expect(byId['GONE-3']).toMatchObject({ status: 'not_drafted', problems: [] });
  });

  it('checks several wave folders in one go, and a folder that holds wave folders', () => {
    const root = tempDir('lantern-check-');
    const one = makeWave(root, 'W951', { 'GOOD-1': draftedSupplies('GOOD-1') });
    const two = makeWave(root, 'W952', { 'FACT-2': draftedFact('FACT-2') });
    expect(checkJson(one, two).answer.waves.map((w) => w.name)).toEqual(['W951', 'W952']);
    expect(checkJson(root).answer.waves.map((w) => w.name)).toEqual(['W951', 'W952']);
    expect(checkJson(`${one},${two}`).answer.counts).toMatchObject({ criteria: 2, ok: 2 });
    const missing = check('--wave', path.join(root, 'W999'));
    expect(missing.code).toBe(2);
    expect(missing.out).toContain('The case check could not run. The wave folder was not found:');
  });
});

describe('the two headers and fact rows', () => {
  it('accepts the 12 columns, the 15 columns, and fact rows', () => {
    const twelve = draftedSupplies('OLD-1');
    twelve.histories = {
      'pos-brand.csv': `${COLUMNS_12}\nF-OLD-1,72,F,2026-01-05,otherol,Othex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example\nF-OLD-1,72,F,2026-02-05,,Examplex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example\nF-OLD-1,72,F,2026-03-05,,Slowex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example\n`,
      'pos-buried.csv': (twelve.histories as Record<string, string>)['pos-buried.csv'],
      'near-miss.csv': (twelve.histories as Record<string, string>)['near-miss.csv'],
    };
    const { byId } = checkJson(wave({ 'OLD-1': twelve, 'FACT-2': draftedFact('FACT-2') }));
    expect(byId['OLD-1']).toMatchObject({ status: 'ok', problems: [] });
    expect(byId['FACT-2']).toMatchObject({ status: 'ok', problems: [] });
  });

  it('accepts a must_cite line that points at a fact row', () => {
    // FACT-2/pos-fact.csv: the sheet names L001, a condition row, beside the supplies L003 and L004.
    expect(problemsOf('FACT-2', draftedFact('FACT-2'))).toEqual([]);
  });

  it('counts a line ID for a fact row like any other row', () => {
    const files = draftedFact('FACT-2');
    // The supplies of pos-fact.csv are rows 3 and 4. Naming rows 1 and 2 as supplies is a slip.
    files.part = [{ file: 'FACT-2/pos-fact.csv', kind: 'positive', about: 'x', findings: [{ criterion: 'FACT-2', must_cite: [['L005'], ['L001']] }] }, ...(files.part as never[]).slice(1)];
    expect(problemsOf('FACT-2', files)).toEqual(['pos-fact.csv: The sheet names line L005 for FACT-2, but the history has no such line.']);
  });

  it('needs a fact line among the lines of a history named pos-fact', () => {
    const files = draftedFact('FACT-2');
    files.part = [{ file: 'FACT-2/pos-fact.csv', kind: 'positive', about: 'x', findings: [{ criterion: 'FACT-2', must_cite: [['L003', 'L004']] }] }, ...(files.part as never[]).slice(1)];
    expect(problemsOf('FACT-2', files)).toEqual(['pos-fact.csv: it is named pos-fact, but the sheet names no fact line that must be cited.']);
  });

  it('reports a fact row that is not well formed', () => {
    const files = draftedFact('FACT-2');
    (files.histories as Record<string, string>)['near-miss.csv'] = csv15(
      'F-FACT-2,72,F,condition,2025-12-01,,,,,,,,,,',                                                    // no detail
      'F-FACT-2,72,F,result,01/12/2025,,,,,,,,,eGFR,64 mL/min/1.73 m2',                                  // a date that is not YYYY-MM-DD
      'F-FACT-2,72,F,observation,2025-12-03,examplol,Examplex,,,,,,,Blood pressure,168/94 mmHg',         // a fact row that names a medicine
      'F-FACT-2,72,F,diagnosis,2025-12-04,otherol,Othex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example,,',   // a record type nobody knows
      supplyRow('F-FACT-2', '2026-01-05', 'examplol', 'Examplex'),
    );
    expect(problemsOf('FACT-2', files)).toEqual([
      'near-miss.csv: L001: a condition row needs its name in the "detail" column.',
      'near-miss.csv: L002: the date "01/12/2025" of this result row is not in the form YYYY-MM-DD.',
      'near-miss.csv: L003: an observation row must not name a medicine. A row holds a supply or a fact, not both.',
      'near-miss.csv: L004: the record type "diagnosis" is not known. Use dispensed, condition, result or observation, or leave it empty for a supply.',
    ]);
  });

  it('reports a header that has only some of the three fact columns', () => {
    const files = draftedSupplies('GOOD-1');
    (files.histories as Record<string, string>)['near-miss.csv'] = `${COLUMNS_12},record_type\nF-GOOD-1,72,F,2026-01-05,otherol,Othex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example,\n`;
    expect(problemsOf('GOOD-1', files)).toEqual([
      'near-miss.csv: The header has record_type but not detail and value. A record with facts needs all three: record_type, detail, value.',
    ]);
  });

  it('does not ask a fact row to be in date order with the supplies', () => {
    const files = draftedFact('FACT-2');
    // A result recorded after the last supply, written at the top of the file.
    (files.histories as Record<string, string>)['near-miss.csv'] = csv15(factRow('F-FACT-2', '2026-06-01', 'result', 'eGFR', '72 mL/min/1.73 m2'), supplyRow('F-FACT-2', '2026-01-05', 'examplol', 'Examplex'));
    expect(problemsOf('FACT-2', files)).toEqual([]);
    // Supplies out of order are still reported.
    const out = draftedSupplies('GOOD-1');
    (out.histories as Record<string, string>)['near-miss.csv'] = csv15(supplyRow('F-GOOD-1', '2026-02-05', 'otherol', 'Othex'), supplyRow('F-GOOD-1', '2026-01-05', 'otherol', 'Othex'));
    expect(problemsOf('GOOD-1', out)).toEqual(['near-miss.csv: L002: the date is earlier than the supply before it.']);
  });
});

describe('what the case check reports for one criterion', () => {
  it('a line the sheet names that holds no listed medicine', () => {
    const files = draftedSupplies('GOOD-1');
    files.part = [{ file: 'GOOD-1/pos-brand.csv', kind: 'positive', about: 'x', findings: [{ criterion: 'GOOD-1', must_cite: [['L001', 'L002']] }] }, ...(files.part as never[]).slice(1)];
    expect(problemsOf('GOOD-1', files)).toEqual(['pos-brand.csv: The sheet names line L001 for GOOD-1, but that line holds no medicine listed by GOOD-1.']);
  });

  it('a brand with a note in brackets is matched by its name', () => {
    // GOOD-1/pos-brand.csv names L003, a pack of "Slowex". The criterion lists "Slowex (examplol, slow release)".
    expect(problemsOf('GOOD-1', draftedSupplies('GOOD-1'))).toEqual([]);
  });

  it('leaves a criterion about a medicine that is not supplied to a person, with a note', () => {
    const files = draftedFact('OMIT-1');
    // The medicine that should be there is not supplied, and the rule says to cite the last supply line.
    (files.histories as Record<string, string>)['pos-nofact.csv'] = csv15(supplyRow('F-OMIT-1', '2026-01-05', 'otherol', 'Othex'), supplyRow('F-OMIT-1', '2026-02-05', 'otherol', 'Othex'));
    (files.part as { findings: { must_cite: string[][] }[] }[])[1].findings[0].must_cite = [['L002']];
    const verdict = checkJson(wave({ 'OMIT-1': files })).byId['OMIT-1'];
    expect(verdict.status).toBe('ok');
    expect(verdict.notes).toEqual([
      'pos-nofact.csv: No medicine listed by OMIT-1 is supplied in this history, so the lines the sheet names (L002) were not checked against its list. Read the rule: it is about a medicine that is not supplied.',
    ]);
  });

  it('a criterion file the pipeline would refuse, or the scorer would fail', () => {
    const noCredit = draftedCriterion('BAD-1');
    noCredit.source.credit = '';
    expect(problemsOf('BAD-1', { ...draftedSupplies('BAD-1'), criterion: noCredit })).toEqual(['criterion.json has no credit line (source.credit). A finding is shown with it.']);
    const wrongId = { ...draftedSupplies('BAD-2'), criterion: draftedCriterion('SOMETHING-ELSE') };
    expect(problemsOf('BAD-2', wrongId)).toEqual(['criterion.json gives the ID "SOMETHING-ELSE", but its folder is named BAD-2.']);
    const oddFact = { ...draftedCriterion('BAD-3'), needs_facts: [{ kind: 'diagnosis', what: '', meets: 'x' }] };
    expect(problemsOf('BAD-3', { ...draftedSupplies('BAD-3'), criterion: JSON.stringify(oddFact) })).toEqual([
      'Needed fact 1: "kind" must be condition, result or observation.',
      'Needed fact 1: "what" is missing.',
    ]);
    expect(problemsOf('BAD-4', { ...draftedSupplies('BAD-4'), criterion: '{ not json' })[0]).toMatch(/^criterion\.json could not be read\. /);
    expect(problemsOf('BAD-5', { criterion: null })).toEqual(['The folder has no criterion.json and no NOT_DRAFTED.md.']);
  });

  it('an answer part that cannot be scored', () => {
    expect(problemsOf('BAD-1', { ...draftedSupplies('BAD-1'), part: null })).toEqual(['cases/BAD-1/expected.part.json was not found.']);
    const noPlanted = draftedSupplies('BAD-2');
    noPlanted.part = [{ file: 'BAD-2/near-miss.csv', kind: 'near_miss', about: 'x', findings: [] }];
    expect(problemsOf('BAD-2', noPlanted)).toEqual([
      'pos-brand.csv: the file is in the folder, but expected.part.json does not list it.',
      'pos-buried.csv: the file is in the folder, but expected.part.json does not list it.',
      'The answer part has no planted finding for this criterion. It cannot pass.',
    ]);
    const marked = draftedSupplies('BAD-3');
    (marked.part as { kind: string }[])[0].kind = 'near_miss';
    expect(problemsOf('BAD-3', marked)).toEqual([
      'pos-brand.csv: it is marked near_miss, but the sheet lists a finding.',
      'pos-brand.csv: its name says a finding is planted, but it is marked near_miss.',
    ]);
    const elsewhere = draftedSupplies('BAD-4');
    (elsewhere.part as { file: string }[])[2].file = '../BAD-4/near-miss.csv';
    expect(problemsOf('BAD-4', elsewhere)).toEqual([
      'expected.part.json names ../BAD-4/near-miss.csv. A history of this criterion is written as BAD-4/<file>.csv.',
      'near-miss.csv: the file is in the folder, but expected.part.json does not list it.',
    ]);
  });
});
