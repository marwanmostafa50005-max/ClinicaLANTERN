// Unit tests for a quick run (--quick), with a fake pipeline. No model, no server, made-up histories.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExpectedSheet } from '../shared/types.ts';
import { USAGE, parseArgs } from './run.ts';
import { optionsText } from './report.ts';
import { SAMPLE_SEED } from './plan.ts';
import { expectedCase, makeCriterion, makeFactCriterion, planted } from './testkit.ts';
import { makeRepo, plainLine, removeTempDirs, runScorer, shortHistory, verdicts, writeFile } from './fakes.ts';

afterEach(removeTempDirs);

const A = makeCriterion('STOPP-A1');
const B = makeCriterion('STOPP-B2');
const C = makeFactCriterion('FACT-C3', 'Heart failure');

// Eight histories. Three criteria: A1 and B2 are the first ten, C3 is a further one that needs a fact.
// A history written for one criterion also holds a line that sets off another one, so that the
// false-flag sample has something to find whichever history it draws.
const FILES: Record<string, string> = {
  'STOPP-A1/pos-brand.csv': shortHistory('A1-POS', plainLine(1), '2026-03-05 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}', '2026-03-06 | Samplol 5 mg tablet | qty 30 {screen:STOPP-B2}'),
  'STOPP-A1/near-miss.csv': shortHistory('A1-NEAR', plainLine(1), '2025-01-02 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}', '2026-03-06 | Samplol 5 mg tablet | qty 30 {screen:STOPP-B2}'),
  'STOPP-B2/pos-brand.csv': shortHistory('B2-POS', '2026-05-01 | Testazol 10 mg tablet | qty 30 {screen:STOPP-B2}', '2026-05-02 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}'),
  'STOPP-B2/near-miss.csv': shortHistory('B2-NEAR', '2024-05-01 | Testazol 10 mg tablet | qty 30 {screen:STOPP-B2} {check-no:STOPP-B2}', '2026-05-02 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}'),
  'FACT-C3/pos-fact.csv': shortHistory('C3-FACT', '2026-07-10 | CONDITION | Heart failure {screen:FACT-C3}', '2026-08-01 | Factorol 5 mg tablet | qty 30 {screen:FACT-C3}', '2026-08-02 | Samplol 5 mg tablet | qty 30 {screen:STOPP-B2}'),
  'FACT-C3/pos-nofact.csv': shortHistory('C3-NOFACT', '2026-08-01 | Factorol 5 mg tablet | qty 30 {screen:FACT-C3} {missing:FACT-C3=Heart failure}', '2026-08-02 | Samplol 5 mg tablet | qty 30 {screen:STOPP-B2}'),
  'FACT-C3/near-miss.csv': shortHistory('C3-NEAR', '2026-07-10 | CONDITION | Asthma', '2026-08-01 | Factorol 5 mg tablet | qty 30', '2026-08-02 | Samplol 5 mg tablet | qty 30 {screen:STOPP-B2}'),
  '_clean/clean-1.csv': shortHistory('CLEAN-1', plainLine(1), plainLine(2), '2026-08-02 | Factorol 5 mg tablet | qty 30 {screen:FACT-C3}'),
};

const SHEET: ExpectedSheet = {
  signed_by_clinical_reviewer: null,
  cases: [
    expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L002'])]),
    expectedCase('STOPP-A1/near-miss.csv', 'near_miss'),
    expectedCase('STOPP-B2/pos-brand.csv', 'positive', [planted('STOPP-B2', ['L001'])]),
    expectedCase('STOPP-B2/near-miss.csv', 'near_miss'),
    expectedCase('FACT-C3/pos-fact.csv', 'positive', [planted('FACT-C3', ['L002'], ['L001'])], 'The record holds the fact.'),
    expectedCase('FACT-C3/pos-nofact.csv', 'positive', [planted('FACT-C3', ['L001'])], 'possible finding: the record holds no line about heart failure.'),
    expectedCase('FACT-C3/near-miss.csv', 'near_miss'),
    expectedCase('_clean/clean-1.csv', 'clean'),
  ],
};

// The repository: A1 and B2 come from the pipeline's own loader. C3 is only in the "further" list
// and its file, so the scorer has to ask for it by name.
function repo(): string {
  const root = makeRepo(FILES, SHEET, { active: ['STOPP-A1', 'STOPP-B2'], further: ['FACT-C3'] });
  writeFile(path.join(root, 'criteria', 'FACT-C3', 'criterion.json'), JSON.stringify(C, null, 2));
  return root;
}

const OWN = [
  'screen:A1-POS:STOPP-A1',
  'screen:A1-NEAR:STOPP-A1',
  'screen:B2-POS:STOPP-B2',
  'screen:B2-NEAR:STOPP-B2',
  'screen:C3-FACT:FACT-C3',
  'screen:C3-NOFACT:FACT-C3',
  'screen:C3-NEAR:FACT-C3',
  'screen:CLEAN-1:STOPP-A1',
  'screen:CLEAN-1:STOPP-B2',
];

describe('a quick run with a fake pipeline', () => {
  it('screens a history against its own criterion only, and a clean history against the first ten', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const results = ran.results();
    expect(results.mode).toBe('quick');
    const own = results.pairs.filter((p) => p.role !== 'sample');
    expect(own.map((p) => `screen:${p.caseFile}:${p.criterionId}:${p.role}`)).toEqual([
      'screen:STOPP-A1/pos-brand.csv:STOPP-A1:own',
      'screen:STOPP-A1/near-miss.csv:STOPP-A1:own',
      'screen:STOPP-B2/pos-brand.csv:STOPP-B2:own',
      'screen:STOPP-B2/near-miss.csv:STOPP-B2:own',
      'screen:FACT-C3/pos-fact.csv:FACT-C3:own',
      'screen:FACT-C3/pos-nofact.csv:FACT-C3:own',
      'screen:FACT-C3/near-miss.csv:FACT-C3:own',
      'screen:_clean/clean-1.csv:STOPP-A1:clean',
      'screen:_clean/clean-1.csv:STOPP-B2:clean',
    ]);
    const screens = ran.fake.calls.filter((c) => c.startsWith('screen:'));
    for (const call of OWN) expect(screens).toContain(call);
    // A full run would make 8 x 3 = 24 screen calls. A quick run makes the 9 above and the sample.
    expect(results.quick).toMatchObject({ ownCriterionOnly: true, firstTen: ['STOPP-A1', 'STOPP-B2'], planned: { own: 7, clean: 2 }, notScreened: [] });
    expect(screens).toHaveLength(9 + (results.quick?.planned.sample ?? 0));
    expect(screens.length).toBeLessThan(24);
  });

  it('takes the false-flag sample: one history in ten, chosen by a fixed seed, against the other criteria', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const results = ran.results();
    const sample = results.quick?.sample;
    expect(sample).toMatchObject({ seed: SAMPLE_SEED, oneIn: 10, perHistory: 30, eligible: 8 });
    expect(sample?.histories).toHaveLength(1);                          // 8 histories, one in ten, rounded up
    const sampled = results.pairs.filter((p) => p.role === 'sample');
    expect(sampled.length).toBe(sample?.screenings);
    expect(sampled.length).toBeGreaterThan(0);
    expect(sampled.every((p) => p.caseFile === sample?.histories[0])).toBe(true);
    // Never the criterion the history is already screened against.
    const ownKeys = new Set(results.pairs.filter((p) => p.role !== 'sample').map((p) => `${p.caseFile}|${p.criterionId}`));
    expect(sampled.some((p) => ownKeys.has(`${p.caseFile}|${p.criterionId}`))).toBe(false);
    // The same test set gives the same sample.
    const again = await runScorer(repo(), ['--quick'], [A, B]);
    expect(again.results().quick?.sample).toEqual(sample);
    expect(again.fake.calls).toEqual(ran.fake.calls);
  });

  it('keeps the stages: every screen call first, then every check, then the letters', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const stages = ran.fake.calls.map((c) => c.split(':')[0]);
    const firstCheck = stages.indexOf('check');
    const firstLetter = stages.indexOf('letter');
    expect(firstCheck).toBeGreaterThan(0);
    expect(firstLetter).toBeGreaterThan(firstCheck);
    expect(stages.slice(0, firstCheck).every((s) => s === 'screen')).toBe(true);
    expect(stages.slice(firstCheck, firstLetter).every((s) => s === 'check')).toBe(true);
    expect(stages.slice(firstLetter).every((s) => s === 'letter')).toBe(true);
    // A letter for each caught planted finding, and for nothing else.
    expect(ran.fake.calls.filter((c) => c.startsWith('letter:'))).toEqual(['letter:A1-POS:STOPP-A1', 'letter:B2-POS:STOPP-B2', 'letter:C3-FACT:FACT-C3', 'letter:C3-NOFACT:FACT-C3']);
    // Inside the screen stage the calls for one history stay together, so the model reads it once.
    const order = ran.fake.calls.filter((c) => c.startsWith('screen:')).map((c) => c.split(':')[1]);
    expect(order.filter((ref, i) => i === 0 || order[i - 1] !== ref)).toEqual(['A1-POS', 'A1-NEAR', 'B2-POS', 'B2-NEAR', 'C3-FACT', 'C3-NOFACT', 'C3-NEAR', 'CLEAN-1']);
  });

  it('gives PASS the same meaning as a full run, and lists what passes', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const results = ran.results();
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'PASS', 'STOPP-B2': 'PASS', 'FACT-C3': 'PASS' });
    expect(results.passing).toEqual(['STOPP-A1', 'STOPP-B2', 'FACT-C3']);
    expect(results.not_passing).toEqual([]);
    expect(results.partRun).toBe(false);
    expect(results.options).toEqual({ only: [], cases: [], limit: null, letters: true, sheet: null, quick: true });
    expect(results.activeCriteria).toEqual(['STOPP-A1', 'STOPP-B2', 'FACT-C3']);
    expect(results.score.ownCriterionOnly).toBe(true);
    expect(ran.code).toBe(0);
    // A criterion is not marked down for histories it was never meant to be screened on.
    const [a] = results.score.criteria;
    expect(a.notCompleted).toEqual([]);
    expect(a).toMatchObject({ planted: 1, caught: 1, class: 'supplies_only' });
  });

  it('counts a near miss that is confirmed as a false flag, and never as a failure', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const results = ran.results();
    const [a, b] = results.score.criteria;
    expect(a.falseFlags.filter((f) => f.role === 'own').map((f) => [f.caseFile, f.ownFolder])).toEqual([['STOPP-A1/near-miss.csv', true]]);
    expect(a.verdict).toBe('PASS');
    expect(b.falseFlags.filter((f) => f.role === 'own')).toEqual([]);      // Model 2 turned its near miss back
    // The split by where a false flag was found adds up, and the sample is counted on its own.
    const by = results.score.totals.falseFlagsByRole;
    expect(by.own + by.clean + by.sample + by.full).toBe(results.score.totals.falseFlags);
    expect(by.full).toBe(0);
    expect(by.own).toBe(1);
    const sampleFlags = results.score.criteria.flatMap((s) => s.falseFlags).filter((f) => f.role === 'sample').length;
    expect(results.score.totals.sample.falseFlags).toBe(sampleFlags);
    expect(results.score.totals.sample.screenings).toBe(results.quick?.sample?.screenings);
    expect(results.score.totals.sample.answered + results.score.totals.sample.notCompleted).toBe(results.score.totals.sample.screenings);
  });

  it('says in the table that it was a quick run, and shows the sampled estimate on its own', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    const table = ran.table();
    const results = ran.results();
    const s = results.score.totals.sample;
    expect(table).toContain('**This was a quick run.** Each history was screened against its own criterion only. Clean histories were screened against the first ten criteria. One history in 10 was also screened against up to 30 other criteria, to estimate false flags. PASS means the same as in a full run. False flags were counted only where the run looked.');
    expect(table).toContain(`- Screenings planned: ${9 + s.screenings}. A history against its own criterion: 7. A clean history against the first ten: 2. The false-flag sample: ${s.screenings}.`);
    expect(table).toContain('## Sampled false-flag estimate');
    expect(table).toContain(`- Histories sampled: 1 of the 8 that could be sampled.`);
    expect(table).toContain(`- False flags in the sample: ${s.falseFlags} of ${s.answered} (`);
    expect(table).toContain('- This is an estimate from a sample. It is not a count of the whole test set, and it is not a failure.');
    expect(table).toContain(`- Where the false flags were found: on a history written for the criterion 1, on a clean history 0, in the false-flag sample ${s.falseFlags}.`);
    expect(table).toContain('- Criteria that need a fact the supplies do not hold: 1. Criteria decided from the supplies alone: 2.');
    expect(table).not.toContain('This is a part run');
    // The estimate has its own section, after the false flags and before the calls that could not be completed.
    const places = ['## False flags', '## Sampled false-flag estimate', '## Calls that could not be completed'].map((h) => table.indexOf(h));
    expect([...places].sort((x, y) => x - y)).toEqual(places);
    expect(table.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(ran.log).toContain('Quick run. Each history is screened against its own criterion only. Clean histories are screened against the first ten.');
    expect(ran.log.some((l) => l.startsWith('Sampled false-flag estimate: '))).toBe(true);
    expect(ran.log).toContain('Passing: 3. Not passing: 0. Both lists are in results.json.');
  });

  it('asks for a further criterion by name when the pipeline loader did not bring it', async () => {
    const ran = await runScorer(repo(), ['--quick'], [A, B]);
    expect(ran.fake.loaded.map((l) => l.split('/')[1])).toEqual(['FACT-C3']);
    expect(ran.results().criteria.map((c) => c.id)).toEqual(['STOPP-A1', 'STOPP-B2', 'FACT-C3']);
    // A clean history is screened against the first ten only: never against the further criterion, unless it is sampled.
    expect(ran.results().pairs.filter((p) => p.caseFile === '_clean/clean-1.csv' && p.role === 'clean').map((p) => p.criterionId)).toEqual(['STOPP-A1', 'STOPP-B2']);
  });

  it('lists a criterion of the list whose file does not load, and still runs the others', async () => {
    const root = repo();
    writeFile(path.join(root, 'criteria', 'FACT-C3', 'criterion.json'), '{ "id": "FACT-C3", "statement": "No label here." }');
    const ran = await runScorer(root, ['--quick'], [A, B]);
    const results = ran.results();
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'PASS', 'STOPP-B2': 'PASS' });
    expect(results.not_passing).toEqual([
      { id: 'FACT-C3', result: 'FILES_NOT_USABLE', reason: 'files not usable: Criterion FACT-C3: "label" is missing.', reasons: ['files not usable: Criterion FACT-C3: "label" is missing.'], class: null, wave: null },
    ]);
    expect(ran.table()).toContain('| FACT-C3 | FILES NOT USABLE | | | | | | | | FACT-C3 | | files not usable: Criterion FACT-C3: "label" is missing. |');
    expect(ran.table()).toContain('## Files not usable');
    // Its histories are left out with a note. Its near miss is not mistaken for a clean history.
    expect(results.sheet.warnings).toContain(
      '3 histories were left out of this run, because no criterion in the run is planned for them: FACT-C3/pos-fact.csv, FACT-C3/pos-nofact.csv, FACT-C3/near-miss.csv.',
    );
    expect(ran.fake.calls.some((c) => c.includes(':C3-'))).toBe(false);
    expect(ran.code).toBe(1);                                  // never a clean end when a criterion could not be scored
    expect(fs.readFileSync(path.join(ran.out, 'results.json'), 'utf8').includes(root)).toBe(false);
  });

  it('a failed call never stops a quick run, and it is never a clean result', async () => {
    const files = { ...FILES, 'STOPP-B2/pos-brand.csv': shortHistory('B2-POS', '2026-05-01 | Testazol 10 mg tablet | qty 30 {screen-fail:STOPP-B2}') };
    const root = makeRepo(files, SHEET, { active: ['STOPP-A1', 'STOPP-B2'], further: ['FACT-C3'] });
    writeFile(path.join(root, 'criteria', 'FACT-C3', 'criterion.json'), JSON.stringify(C, null, 2));
    const ran = await runScorer(root, ['--quick'], [A, B]);
    const results = ran.results();
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'PASS', 'STOPP-B2': 'FAIL', 'FACT-C3': 'PASS' });
    const b = results.score.criteria[1];
    expect(b.failures).toEqual([{ caseFile: 'STOPP-B2/pos-brand.csv', step: 'call_not_completed', text: 'pos-brand.csv: call could not be completed (Model 1, screen).' }]);
    expect(results.not_passing).toEqual([
      { id: 'STOPP-B2', result: 'FAIL', reason: 'pos-brand.csv: call could not be completed (Model 1, screen).', reasons: ['pos-brand.csv: call could not be completed (Model 1, screen).'], class: 'supplies_only', wave: null },
    ]);
    expect(results.passing).toEqual(['STOPP-A1', 'FACT-C3']);
    expect(ran.fake.calls.filter((c) => c.startsWith('letter:'))).toHaveLength(3);      // the run went on
    expect(ran.code).toBe(1);
  });

  it('--only in a quick run leaves out the histories of the other criteria, and says so', async () => {
    const ran = await runScorer(repo(), ['--quick', '--only', 'FACT-C3'], [A, B]);
    const results = ran.results();
    expect(results.cases.map((c) => c.file)).toEqual(['FACT-C3/pos-fact.csv', 'FACT-C3/pos-nofact.csv', 'FACT-C3/near-miss.csv']);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toEqual(['screen:C3-FACT:FACT-C3', 'screen:C3-NOFACT:FACT-C3', 'screen:C3-NEAR:FACT-C3']);
    expect(results.partRun).toBe(true);
    expect(results.quick?.notScreened).toHaveLength(5);
    expect(results.quick?.sample).toMatchObject({ eligible: 0, histories: [], screenings: 0 });     // no other criterion to sample against
    expect(results.sheet.warnings).toEqual([
      '5 histories were left out of this run, because no criterion in the run is planned for them: STOPP-A1/pos-brand.csv, STOPP-A1/near-miss.csv, STOPP-B2/pos-brand.csv, STOPP-B2/near-miss.csv, _clean/clean-1.csv.',
    ]);
    expect(verdicts(results)).toEqual({ 'FACT-C3': 'PASS' });
    expect(ran.table()).toContain('Options used: `--quick --only FACT-C3`.');
  });

  it('never leaves out a near miss whose folder names no criterion: it is screened like a clean history', async () => {
    const files = { '_odd/positive.csv': shortHistory('DEMO-POS', `${plainLine(1)} {screen:STOPP-A1}`), '_odd/near-miss.csv': shortHistory('DEMO-NEAR', plainLine(1)) };
    const sheet = { signed_by_clinical_reviewer: null, cases: [expectedCase('_odd/positive.csv', 'positive', [planted('STOPP-A1', ['L001'])]), expectedCase('_odd/near-miss.csv', 'near_miss')] };
    const ran = await runScorer(makeRepo(files, sheet), ['--quick'], [A, B]);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:DEMO-NEAR:'))).toEqual(['screen:DEMO-NEAR:STOPP-A1', 'screen:DEMO-NEAR:STOPP-B2']);
    expect(ran.results().sheet.warnings).toContain('_odd/near-miss.csv: it lists no finding, and its folder names no criterion. It was screened like a clean history, against the first ten.');
    // No list file in this repository: the first ten are the first ten criteria the pipeline gave.
    expect(ran.results().quick?.firstTen).toEqual(['STOPP-A1', 'STOPP-B2']);
  });

  it('--check with --quick says how many screen calls a quick run would make, and calls no model', async () => {
    const ran = await runScorer(repo(), ['--quick', '--check'], [A, B]);
    expect(ran.fake.calls).toEqual([]);
    expect(fs.existsSync(ran.out)).toBe(false);
    const line = ran.log.find((l) => l.startsWith('A quick run would make '));
    expect(line).toMatch(/^A quick run would make \d+ screen calls \(own criterion 7, clean histories against the first ten 2, false-flag sample \d+\), then one check for each suspected finding\.$/);
    expect(ran.log[ran.log.length - 1]).toBe('Nothing needs a look.');
    expect(ran.code).toBe(0);
  });
});

describe('a quick run without the sample', () => {
  it('--no-sample leaves the false-flag sample out, and the table does not show an estimate', async () => {
    const ran = await runScorer(repo(), ['--quick', '--no-sample'], [A, B]);
    const results = ran.results();
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toEqual(OWN);
    expect(results.quick).toMatchObject({ planned: { own: 7, clean: 2, sample: 0 }, sample: null });
    expect(results.pairs.some((p) => p.role === 'sample')).toBe(false);
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'PASS', 'STOPP-B2': 'PASS', 'FACT-C3': 'PASS' });
    expect(results.options).toEqual({ only: [], cases: [], limit: null, letters: true, sheet: null, quick: true, noSample: true });
    const table = ran.table();
    expect(table).toContain('**This was a quick run.** Each history was screened against its own criterion only. Clean histories were screened against the first ten criteria. PASS means the same as in a full run. False flags were counted only where the run looked.');
    expect(table).not.toContain('## Sampled false-flag estimate');
    expect(table).toContain('- Where the false flags were found: on a history written for the criterion 1, on a clean history 0, in the false-flag sample 0.');
    expect(ran.log.some((l) => l.startsWith('Sampled false-flag estimate'))).toBe(false);
  });

  it('--no-sample goes with --quick only', () => {
    expect(parseArgs(['--no-sample']).errors).toEqual(['Option --no-sample goes with --quick. No other run takes the false-flag sample.']);
    expect(parseArgs(['--quick', '--no-sample']).errors).toEqual([]);
    expect(optionsText({ only: [], cases: [], limit: null, letters: true, sheet: null, quick: true, noSample: true })).toBe('--quick --no-sample');
  });
});

describe('a full run that has grown very large', () => {
  it('says so before it starts, and points to the quick run', async () => {
    // Eleven criteria and 190 histories: a full run would make 2,090 screen calls.
    const criteria = Array.from({ length: 11 }, (_, i) => makeCriterion(`MANY-${i + 1}`));
    const files: Record<string, string> = {};
    for (let i = 1; i <= 190; i++) files[`_clean/clean-${i}.csv`] = shortHistory(`CLEAN-${i}`, plainLine(1));
    const sheet = { signed_by_clinical_reviewer: null, cases: Object.keys(files).map((file) => expectedCase(file, 'clean')) };
    const root = makeRepo(files, sheet);
    const full = await runScorer(root, ['--check'], criteria);
    expect(full.log).toContain('A run would make 2090 screen calls, then one check for each suspected finding.');
    expect(full.log).toContain('That is a full run: every criterion on every history. With 11 criteria it is very long. A quick run (--quick) screens each history against its own criterion only.');
    // The quick run of the same set: each clean history against the first ten only.
    const quick = await runScorer(root, ['--check', '--quick', '--no-sample'], criteria);
    expect(quick.log).toContain('A quick run would make 1900 screen calls (own criterion 0, clean histories against the first ten 1900, false-flag sample 0), then one check for each suspected finding.');
    expect(quick.log.some((l) => l.startsWith('That is a full run'))).toBe(false);
    expect(full.fake.calls).toEqual([]);
  });
});

describe('the quick option', () => {
  it('is read, takes no value, and is left out when it is not given', () => {
    expect(parseArgs(['--quick']).options.quick).toBe(true);
    expect(parseArgs(['--quick=yes']).errors).toEqual(['Option --quick takes no value.']);
    expect('quick' in parseArgs([]).options).toBe(false);
    expect(USAGE).toContain('--quick');
    expect(optionsText({ only: [], cases: [], limit: null, letters: true, sheet: null, quick: true })).toBe('--quick');
  });
});
