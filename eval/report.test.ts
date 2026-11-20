// Unit tests for the results table and the files, with hand-made inputs. No model is used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  duration,
  lettersCell,
  optionsText,
  rawBaseName,
  renderTable,
  resultLabel,
  resultSentence,
  stampOf,
  writeRaw,
  writeReport,
} from './report.ts';
import {
  SCENARIO_CASES,
  SCENARIO_PAIRS,
  checkConfirmed,
  checkNotCompleted,
  expectedCase,
  letterByModel,
  letterNotProduced,
  makeCriterion,
  makeResults,
  pair,
  planted,
  screenClear,
  screenSuspected,
} from './testkit.ts';

const A = makeCriterion('STOPP-A1');
const B = makeCriterion('STOPP-B2');

// The hand-made run: a catch, a miss, a false flag, a failed call and a template letter.
const results = makeResults({ criteria: [A, B], cases: SCENARIO_CASES, pairs: SCENARIO_PAIRS });
const table = renderTable(results);

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-eval-report-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('small pieces', () => {
  it('names the results folder yyyyMMdd-HHmmss in local time', () => {
    expect(stampOf(new Date(2026, 10, 18, 14, 5, 10))).toBe('20261118-140510');
    expect(stampOf(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });

  it('writes a length of time in plain words', () => {
    expect(duration(994)).toBe('16 min 34 s');
    expect(duration(42.4)).toBe('42 s');
    expect(duration(3725)).toBe('1 h 2 min 5 s');
    expect(duration(0)).toBe('0 s');
  });

  it('labels the four results', () => {
    expect(resultLabel('PASS')).toBe('PASS');
    expect(resultLabel('FAIL')).toBe('FAIL');
    expect(resultLabel('PASS_PART')).toBe('PASS (part run)');
    expect(resultLabel('NOT_TESTED')).toBe('NOT TESTED');
  });

  it('sums up the run in one line', () => {
    expect(resultSentence(results.score)).toBe('Criteria that PASS: 1 of 2. FAIL: 1.');
  });

  it('writes the options that were used', () => {
    expect(optionsText({ only: [], cases: [], limit: null, letters: true, sheet: null })).toBe('none');
    expect(optionsText({ only: ['STOPP-A1'], cases: ['_clean', 'STOPP-A1'], limit: 3, letters: false, sheet: 'cases/draft.json' })).toBe(
      '--only STOPP-A1 --cases _clean,STOPP-A1 --limit 3 --no-letters --sheet cases/draft.json',
    );
  });

  it('makes a safe file name for a raw answer', () => {
    expect(rawBaseName('STOPP-A1/pos-brand.csv', 'STOPP-A1')).toBe('STOPP-A1__pos-brand.csv__STOPP-A1');
    expect(rawBaseName('a b\\c:d.csv', 'X/1')).toBe('a_b__c_d.csv__X__1');
  });
});

describe('table.md', () => {
  it('says the patients are fictional and the stage is Prototype', () => {
    expect(table).toContain('# ClinicaLANTERN test results');
    expect(table).toContain('Fictional patients only. No real person is in these histories.');
    expect(table).toContain('Stage: Prototype. This is one measured run on one computer. It is not a validation.');
    expect(table).toContain('Not signed by the clinical reviewer yet.');
    expect(table).toContain('It took 16 min 34 s.');
  });

  it('has one row per criterion: result, caught of planted, text, false flags, failed calls, letters, seconds', () => {
    expect(table).toContain('| Criterion | Result | Caught / planted | Disputed | Criterion text | False flags | Failed calls | Letters | Seconds |');
    expect(table).toContain('| STOPP A1 | PASS | 2 / 2 | 0 | yes | 1 | 0 | 2 of 2: 1 by the model, 1 from the template | 91.0 |');
    expect(table).toContain('| STOPP B2 | FAIL | 1 / 2 | 0 | yes | 0 | 1 | 1 of 1: 1 by the model | 57.0 |');
    expect(table).toContain('- Criteria that PASS: 1 of 2. FAIL: 1.');
    expect(table).toContain('- Planted findings caught: 3 of 4.');
    expect(table).toContain('- Model calls made: 12 to screen, 5 to double-check, 3 to write letters.');
    expect(table).toContain(
      '- Time in model calls: 2 min 28 s. Screen: 85.0 s, 7.1 s each on average. Double-check: 53.0 s, 10.6 s each on average. Letters: 10.0 s, 3.3 s each on average.',
    );
  });

  it('says why a criterion failed', () => {
    expect(table).toContain('## Why each FAIL');
    expect(table).toContain('- **STOPP B2**: Missed 1 of 2 planted findings.');
  });

  it('lists every miss with its case file and its lines', () => {
    const section = table.slice(table.indexOf('## Misses'), table.indexOf('## False flags'));
    expect(section).toContain('- **STOPP B2** on `STOPP-B2/pos-buried.csv`. Mantle did not suspect it.');
    expect(section).toContain('  - Lines that had to be cited: L011.');
    expect(section).toContain('    - `L011: 2026-03-15 | Example medicine 11 10 mg tablet | qty 30`');
    expect(section).toContain('  - Lines cited by Mantle: none. Lines cited by Lumen: none.');
    expect(section).toContain('  - What was planted: Buried at line 11.');
    expect(section).not.toContain('STOPP A1');
  });

  it('lists every false flag with its case file and its lines, and says it is not a failure', () => {
    const section = table.slice(table.indexOf('## False flags'), table.indexOf('## Calls that could not be completed'));
    expect(section).toContain('It is not a failure.');
    expect(section).toContain('- **STOPP A1** on `STOPP-A1/near-miss.csv`, the near miss written for this criterion.');
    expect(section).toContain('  - Lines cited by Mantle: L004, L009. Lines cited by Lumen: L004.');
    expect(section).toContain('    - `L004: 2026-05-15 | Example medicine 4 10 mg tablet | qty 30`');
    expect(section).toContain('    - `L009: 2026-01-15 | Example medicine 9 10 mg tablet | qty 30`');
    expect(section).toContain('  - Mantle said: "Both medicines appear."');
    expect(section).toContain('  - Lumen said: "Lumen says these lines match."');
    expect(section).toContain('  - About this history: The second medicine stopped a year before.');
  });

  it('lists every call that could not be completed', () => {
    const section = table.slice(table.indexOf('## Calls that could not be completed'), table.indexOf('## Letters'));
    expect(section).toContain(
      '- **STOPP B2** on `_clean/clean-1.csv` (Mantle, screen). Mantle could not screen it. Error: Tried twice. The local model server answered with error 500.',
    );
  });

  it('lists the letters and marks the one built from the template', () => {
    const section = table.slice(table.indexOf('## Letters'), table.indexOf('## How to read the table'));
    expect(section).toContain('- **STOPP A1** on `STOPP-A1/pos-brand.csv`. Written by the model. The letter checks found nothing.');
    expect(section).toContain('- **STOPP A1** on `STOPP-A1/pos-buried.csv`. Built from the template, not written by the model. The check notes say why.');
    expect(section).toContain('  - Check note: "The date 2026-01-01 is not in the finding."');
    expect(table).toContain('Built from the template: 1.');
  });

  it('keeps the sections in a fixed order', () => {
    const order = ['## The run', '## The result', '| Criterion |', '## Why each FAIL', '## Misses', '## False flags', '## Calls that could not be completed', '## Letters', '## How to read the table'];
    const places = order.map((heading) => table.indexOf(heading));
    expect(places.every((p) => p >= 0)).toBe(true);
    expect([...places].sort((x, y) => x - y)).toEqual(places);
  });

  it('uses no long dash', () => {
    expect(table.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(table.includes(String.fromCharCode(0x2013))).toBe(false);
  });

  it('lists wave folders only in a wave run', () => {
    expect(table).not.toContain('## Each wave folder');
  });

  it('says so when there is nothing to list', () => {
    const pos = expectedCase('STOPP-A1/pos.csv', 'positive', [planted(A.id, ['L003'])]);
    const clean = makeResults({
      criteria: [A],
      cases: [pos],
      pairs: [pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel())],
    });
    const text = renderTable(clean);
    expect(text).toContain('| STOPP A1 | PASS | 1 / 1 | 0 | yes | 0 | 0 | 1 of 1: 1 by the model | 16.0 |');
    expect(text).toContain('None. Every planted finding in this run was caught.');
    expect(text.match(/None in this run\./g)).toHaveLength(2);
    expect(text).not.toContain('## Why each FAIL');
    expect(text).not.toContain('## What this run did not cover');
    expect(text).not.toContain('## Things to look at');
    expect(text).not.toContain('This is a part run');
  });

  it('marks a part run and a run without letters', () => {
    const pos = expectedCase('STOPP-A1/pos.csv', 'positive', [planted(A.id, ['L003'])]);
    const part = makeResults({
      criteria: [A, B],
      cases: [pos],
      pairs: [pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003'])), pair(pos.file, B.id, screenClear())],
      lettersRun: false,
      over: { partRun: true, options: { only: [], cases: ['STOPP-A1'], limit: null, letters: false, sheet: null } },
    });
    const text = renderTable(part);
    expect(text).toContain('**This is a part run.** It does not cover the whole test set. Do not use it for sign-off. Options used: `--cases STOPP-A1 --no-letters`.');
    expect(text).toContain('| STOPP A1 | PASS (part run) | 1 / 1 | 0 | yes | 0 | 0 | not run | 14.0 |');
    expect(text).toContain('| STOPP B2 | NOT TESTED | 0 / 0 | 0 | yes | 0 | 0 | not run | 5.0 |');
    expect(text).toContain('- Criteria that PASS: 0 of 2. PASS on a part run only: 1. Not tested: 1.');
    expect(text).toContain('- Letters: not run.');
    expect(text).toContain('## What this run did not cover');
    expect(text).toContain('- **STOPP A1**: Letters were not run.');
    expect(text).toContain('- **STOPP B2**: No planted finding for this criterion was in this run.');
    expect(text).toContain('Letters were not run.');
  });

  it('marks a run that stopped early', () => {
    const stopped = makeResults({
      criteria: [A, B],
      cases: SCENARIO_CASES,
      pairs: SCENARIO_PAIRS,
      over: { stoppedEarly: 'It was stopped before every call was made.' },
    });
    expect(renderTable(stopped)).toContain('**This run stopped early.** It was stopped before every call was made. Do not use it for sign-off.');
  });

  it('lists problems with the answer sheet and histories that could not be read', () => {
    const pos = expectedCase('STOPP-A1/pos.csv', 'positive', [planted(A.id, ['L003']), planted('OLD-9', ['L001'])]);
    const broken = makeResults({
      criteria: [A],
      cases: [pos],
      pairs: [pair(pos.file, A.id, { status: 'not_read', seconds: 0, error: 'The file was not found.' })],
    });
    broken.sheet.warnings = ['STOPP-A1/pos.csv: the sheet expects OLD-9, but that criterion is not in the active list. It is not scored.'];
    broken.cases[0].cannotAssess = 'The file was not found.';
    broken.cases[0].lines = [];
    const text = renderTable(broken);
    expect(text).toContain('| STOPP A1 | FAIL | 0 / 1 | 0 | yes | 0 | 1 | none needed | 0.0 |');
    expect(text).toContain('## Things to look at');
    expect(text).toContain('- STOPP-A1/pos.csv: the sheet expects OLD-9, but that criterion is not in the active list. It is not scored.');
    expect(text).toContain('- STOPP-A1/pos.csv: the history was not screened. The file was not found.');
    expect(text).toContain('- Planted findings for these criteria were not scored, because the criteria were not in this run: OLD-9.');
    expect(text).toContain('Could not be read: 1.');
    expect(text).toContain('- **STOPP A1** on `STOPP-A1/pos.csv` (reading the history), a history with a planted finding for this criterion. The history could not be read, so it was not screened. Error: The file was not found.');
    // The planted line has no text to show, so the ID is shown alone.
    expect(text).toContain('    - `L003`');
  });

  it('shows a missing letter and an uncompleted check', () => {
    const pos = expectedCase('STOPP-A1/pos.csv', 'positive', [planted(A.id, ['L003'])]);
    const other = expectedCase('STOPP-B2/pos.csv', 'positive', [planted(B.id, ['L002'])]);
    const run = makeResults({
      criteria: [A, B],
      cases: [pos, other],
      pairs: [
        pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), letterNotProduced()),
        pair(other.file, A.id, screenClear()),
        pair(pos.file, B.id, screenClear()),
        pair(other.file, B.id, screenSuspected(['L002']), checkNotCompleted()),
      ],
    });
    const text = renderTable(run);
    expect(text).toContain('| STOPP A1 | FAIL | 1 / 1 | 0 | yes | 0 | 1 | 0 of 1: 1 missing | 20.0 |');
    expect(text).toContain('| STOPP B2 | FAIL | 0 / 1 | 0 | yes | 0 | 1 | none needed | 40.0 |');
    expect(text).toContain('- **STOPP A1** on `STOPP-A1/pos.csv`. No letter was produced. Error: The letter call gave no letter text.');
    expect(text).toContain('- **STOPP B2** on `STOPP-B2/pos.csv`. Mantle suspected it. The second check was not completed.');
    expect(text).toContain('(Lumen, double-check), a history with a planted finding for this criterion. The second check was not completed. In the app this finding would still be shown under the bell.');
  });

  it('keeps a bar in a label from breaking the table', () => {
    const odd = makeCriterion('X-1', { label: 'X | 1' });
    const pos = expectedCase('X-1/pos.csv', 'positive', [planted('X-1', ['L001'])]);
    const text = renderTable(makeResults({ criteria: [odd], cases: [pos], pairs: [pair(pos.file, 'X-1', screenClear())] }));
    expect(text).toContain('| X / 1 | FAIL | 0 / 1 |');
  });

  it('writes the letters cell in each state', () => {
    const [a] = results.score.criteria;
    expect(lettersCell(a, true)).toBe('2 of 2: 1 by the model, 1 from the template');
    expect(lettersCell(a, false)).toBe('not run');
    const none = { ...a, letters: { needed: 0, produced: 0, modelClean: 0, modelWithNotes: 0, template: 0, notProduced: 0, withoutPlanted: 0 } };
    expect(lettersCell(none, true)).toBe('none needed');
    const mixed = { ...a, letters: { needed: 3, produced: 2, modelClean: 1, modelWithNotes: 1, template: 0, notProduced: 1, withoutPlanted: 0 } };
    expect(lettersCell(mixed, true)).toBe('2 of 3: 1 by the model, 1 by the model with check notes, 1 missing');
  });
});

describe('the files', () => {
  it('writes table.md, results.json and one raw file per call', () => {
    const out = path.join(tempDir(), '20261118-140510');
    const written = writeReport(out, results);

    expect(written.table).toBe(path.join(out, 'table.md'));
    expect(written.results).toBe(path.join(out, 'results.json'));
    expect(fs.readFileSync(written.table, 'utf8')).toBe(table);

    const saved = JSON.parse(fs.readFileSync(written.results, 'utf8'));
    expect(saved).toEqual(JSON.parse(JSON.stringify(results)));
    expect(saved.format).toBe('clinicalantern-eval-1');
    expect(saved.score.criteria.map((c: { verdict: string }) => c.verdict)).toEqual(['PASS', 'FAIL']);
    expect(saved.pairs).toHaveLength(12);
    expect(saved.cases[0].lines).toHaveLength(12);

    // 12 screen calls, 5 checks, 3 letters (each letter also as plain text).
    expect(fs.readdirSync(path.join(out, 'raw', 'screen'))).toHaveLength(12);
    expect(fs.readdirSync(path.join(out, 'raw', 'check'))).toHaveLength(5);
    expect(fs.readdirSync(path.join(out, 'raw', 'letter')).sort()).toEqual([
      'STOPP-A1__pos-brand.csv__STOPP-A1.json',
      'STOPP-A1__pos-brand.csv__STOPP-A1.txt',
      'STOPP-A1__pos-buried.csv__STOPP-A1.json',
      'STOPP-A1__pos-buried.csv__STOPP-A1.txt',
      'STOPP-B2__pos-brand.csv__STOPP-B2.json',
      'STOPP-B2__pos-brand.csv__STOPP-B2.txt',
    ]);
    expect(written.rawFiles).toBe(23);

    const screen = JSON.parse(fs.readFileSync(path.join(out, 'raw', 'screen', 'STOPP-A1__pos-brand.csv__STOPP-A1.json'), 'utf8'));
    expect(screen).toMatchObject({
      stage: 'screen',
      caseFile: 'STOPP-A1/pos-brand.csv',
      criterionId: 'STOPP-A1',
      status: 'suspected',
      seconds: 12,
      error: null,
      answer: { lineIds: ['L003', 'L007'], model: 'fake-screen' },
    });

    // A failed call has no answer. It is still on file, with its error.
    const failed = JSON.parse(fs.readFileSync(path.join(out, 'raw', 'screen', '_clean__clean-1.csv__STOPP-B2.json'), 'utf8'));
    expect(failed).toMatchObject({ status: 'failed', answer: null, error: 'Tried twice. The local model server answered with error 500.' });

    const letter = fs.readFileSync(path.join(out, 'raw', 'letter', 'STOPP-A1__pos-buried.csv__STOPP-A1.txt'), 'utf8');
    expect(letter.startsWith('Subject: Request for a medicine review\n\nDear Doctor,')).toBe(true);
    const letterJson = JSON.parse(fs.readFileSync(path.join(out, 'raw', 'letter', 'STOPP-A1__pos-buried.csv__STOPP-A1.json'), 'utf8'));
    expect(letterJson).toMatchObject({ stage: 'letter', status: 'template', answer: { origin: 'template' } });
  });

  it('writes no raw file for a call that was never made', () => {
    const out = tempDir();
    expect(writeRaw(out, 'screen', pair('a/x.csv', 'X-1', { status: 'not_run', seconds: 0 }))).toEqual([]);
    expect(writeRaw(out, 'screen', pair('a/x.csv', 'X-1', { status: 'not_read', seconds: 0, error: 'The file was not found.' }))).toEqual([]);
    expect(writeRaw(out, 'check', pair('a/x.csv', 'X-1', screenClear()))).toEqual([]);
    expect(writeRaw(out, 'letter', pair('a/x.csv', 'X-1', screenSuspected(['L001']), { status: 'not_run', seconds: 0 }))).toEqual([]);
    expect(fs.existsSync(path.join(out, 'raw'))).toBe(false);
    const files = writeRaw(out, 'screen', pair('a/x.csv', 'X-1', screenClear()));
    expect(files).toEqual([path.join(out, 'raw', 'screen', 'a__x.csv__X-1.json')]);
  });
});

describe('a full run with further criteria in use (G06)', () => {
  const ten = Array.from({ length: 10 }, (_, i) => makeCriterion(`STOPP-T${i + 1}`));
  const further = [makeCriterion('EU7-X1'), makeCriterion('EU7-X2')];

  function runWith(scoredFurther: boolean): { text: string; run: ReturnType<typeof makeResults> } {
    const criteria = scoredFurther ? [...ten, ...further] : ten;
    const cases = criteria.map((c) => expectedCase(`${c.id}/pos-brand.csv`, 'positive', [planted(c.id, ['L001'])]));
    const pairs = criteria.map((c, i) => pair(cases[i].file, c.id, screenSuspected(['L001']), checkConfirmed(['L001']), letterByModel()));
    const run = makeResults({
      criteria,
      cases,
      pairs,
      over: { furtherIds: further.map((c) => c.id) },
    });
    return { text: renderTable(run), run };
  }

  it('writes the first ten part and the further part, each with its count line', () => {
    const { text } = runWith(true);
    expect(text).toContain('## THE FIRST TEN: FULL RUN');
    expect(text).toContain('Count: 10 of 10 pass the planted-finding test. Signed by the clinical reviewer: 0 of 10.');
    expect(text).toContain('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)');
    expect(text).toContain('2 of 2 further criteria were scored. 0 were not reached.');
    expect(text).toContain('Count: 2 of 2 pass the planted-finding test. Signed by the clinical reviewer: 0 of 2.');
    expect(text.indexOf('## THE FIRST TEN: FULL RUN')).toBeLessThan(text.indexOf('## FURTHER CRITERIA: QUICK MODE'));
  });

  it('writes NOT RUN YET when no further criterion has been scored yet', () => {
    const { text } = runWith(false);
    expect(text).toContain('## FURTHER CRITERIA: NOT RUN YET');
    expect(text).not.toContain('QUICK MODE');
  });

  it('keeps the one-part table when no further criterion is in use', () => {
    const cases = ten.map((c) => expectedCase(`${c.id}/pos-brand.csv`, 'positive', [planted(c.id, ['L001'])]));
    const pairs = ten.map((c, i) => pair(cases[i].file, c.id, screenSuspected(['L001']), checkConfirmed(['L001']), letterByModel()));
    const run = makeResults({ criteria: ten, cases, pairs });
    const text = renderTable(run);
    expect(text).not.toContain('THE FIRST TEN');
    expect(text).not.toContain('FURTHER CRITERIA');
  });
});
