// Unit tests for a wave run (--wave), with a fake pipeline. No model, no server.
// The wave folders are made up in the temp folder. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExpectedCase } from '../shared/types.ts';
import type { Pipeline } from './types.ts';
import { main, parseArgs } from './run.ts';
import { optionsText, waveSummaries, waveSummaryLine } from './report.ts';
import { findWaveFolders, readWaveFolder } from './wave.ts';
import { expectedCase, makeCriterion, makeFactCriterion, planted } from './testkit.ts';
import { fakePipeline, makeRepo, makeWave, plainLine, removeTempDirs, runScorer, shortHistory, tempDir, verdicts, writeFile } from './fakes.ts';
import type { WaveCriterionFiles } from './fakes.ts';

afterEach(removeTempDirs);

function part(id: string, ...entries: [string, ExpectedCase['kind'], string[][]?][]): ExpectedCase[] {
  return entries.map(([name, kind, mustCite]) => expectedCase(`${id}/${name}`, kind, mustCite ? [planted(id, ...mustCite)] : [], `A made-up history for ${id}.`));
}

// A criterion that is decided from the supplies alone: two planted histories and a near miss.
function suppliesOnly(id: string, nearMissMarks = ''): WaveCriterionFiles {
  return {
    histories: {
      'pos-brand.csv': shortHistory(`${id}-BRAND`, plainLine(1), `2026-03-05 | Examplex 200 mg capsule | qty 30 {screen:${id}}`),
      'pos-buried.csv': shortHistory(`${id}-BURIED`, plainLine(1), plainLine(2), `2026-04-01 | Examplex 200 mg capsule | qty 30 {screen:${id}}`, plainLine(4)),
      'near-miss.csv': shortHistory(`${id}-NEAR`, plainLine(1), `2025-01-02 | Examplex 200 mg capsule | qty 30 ${nearMissMarks}`.trim()),
    },
    part: part(id, ['pos-brand.csv', 'positive', [['L002']]], ['pos-buried.csv', 'positive', [['L003']]], ['near-miss.csv', 'near_miss']),
  };
}

// A criterion that needs a fact: a history that holds the fact, one with no line about it, and a near miss.
function needsFact(id: string, factMarks = `{screen:${id}}`): WaveCriterionFiles {
  return {
    criterion: makeFactCriterion(id, 'Heart failure'),
    histories: {
      'pos-fact.csv': shortHistory(`${id}-FACT`, `2026-07-10 | CONDITION | Heart failure ${factMarks}`.trim(), `2026-08-01 | Factorol 5 mg tablet | qty 30 {screen:${id}}`),
      'pos-nofact.csv': shortHistory(`${id}-NOFACT`, plainLine(1), `2026-08-01 | Factorol 5 mg tablet | qty 30 {screen:${id}} {missing:${id}=Heart failure}`),
      'near-miss.csv': shortHistory(`${id}-NEAR`, '2026-07-10 | CONDITION | Asthma', '2026-08-01 | Factorol 5 mg tablet | qty 30'),
    },
    part: part(id, ['pos-fact.csv', 'positive', [['L002'], ['L001']]], ['pos-nofact.csv', 'positive', [['L002']]], ['near-miss.csv', 'near_miss']),
  };
}

// Two wave folders beside each other, outside the repository.
//   W901: SUP-1 passes. FACT-2 passes, one finding as a possible finding. GONE-3 was not drafted.
//   W902: FACT-4 fails (the fact line is not cited). BAD-5 has a broken criterion file. BAD-6 has a
//         history that cannot be read. SUP-7 passes with a false flag on its near miss.
function twoWaves(): { root: string; w901: string; w902: string } {
  const root = tempDir('lantern-eval-waves-');
  const w901 = makeWave(root, 'W901', {
    'SUP-1': suppliesOnly('SUP-1'),
    'FACT-2': needsFact('FACT-2'),
    'GONE-3': { notDrafted: 'GONE-3 is not drafted. No record holds what it needs.' },
  });
  const bad6 = suppliesOnly('BAD-6');
  (bad6.histories as Record<string, string>)['pos-buried.csv'] = shortHistory('BAD-6-BURIED', 'BROKEN');
  const w902 = makeWave(root, 'W902', {
    'FACT-4': needsFact('FACT-4', ''),
    'BAD-5': { ...suppliesOnly('BAD-5'), criterion: '{ "id": "BAD-5", "label": ' },
    'BAD-6': bad6,
    'SUP-7': suppliesOnly('SUP-7', '{screen:SUP-7}'),
  });
  return { root, w901, w902 };
}

// The repository of a wave run holds nothing the run needs: no criterion, no history, no sheet.
function emptyRepo(): string {
  const root = tempDir('lantern-eval-repo-');
  fs.mkdirSync(path.join(root, 'cases'), { recursive: true });
  return root;
}

describe('a wave run with a fake pipeline', () => {
  it('scores the criteria of a wave folder in place, each history against its own criterion only', async () => {
    const { w901 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w901]);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toEqual([
      'screen:FACT-2-FACT:FACT-2',
      'screen:FACT-2-NOFACT:FACT-2',
      'screen:FACT-2-NEAR:FACT-2',
      'screen:SUP-1-BRAND:SUP-1',
      'screen:SUP-1-BURIED:SUP-1',
      'screen:SUP-1-NEAR:SUP-1',
    ]);
    const results = ran.results();
    expect(results.mode).toBe('wave');
    expect(verdicts(results)).toEqual({ 'FACT-2': 'PASS', 'SUP-1': 'PASS' });
    expect(results.passing).toEqual(['FACT-2', 'SUP-1']);
    expect(results.not_passing).toEqual([{ id: 'GONE-3', result: 'NOT_DRAFTED', reason: 'not drafted', reasons: ['not drafted'], class: null, wave: 'W901' }]);
    expect(results.pairs.every((p) => p.role === 'own')).toBe(true);
    expect(results.quick).toMatchObject({ ownCriterionOnly: true, firstTen: [], planned: { own: 6, clean: 0, sample: 0 }, sample: null });
    expect(results.partRun).toBe(false);
    // The criteria came through the pipeline's own loader, from the wave folder, one at a time.
    expect(ran.fake.loaded).toEqual(['W901/FACT-2', 'W901/SUP-1']);
    // A wave with nothing wrong ends with code 0. A criterion that was not drafted is not an error.
    expect(ran.code).toBe(0);
  });

  it('lets many wave folders share one run: each of the three stages runs once', async () => {
    const { w901, w902 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w901, '--wave', w902]);
    const stages = ran.fake.calls.map((c) => c.split(':')[0]);
    const firstCheck = stages.indexOf('check');
    const firstLetter = stages.indexOf('letter');
    expect(stages.slice(0, firstCheck).every((s) => s === 'screen')).toBe(true);
    expect(stages.slice(firstCheck, firstLetter).every((s) => s === 'check')).toBe(true);
    expect(stages.slice(firstLetter).every((s) => s === 'letter')).toBe(true);
    // Both wave folders are in each stage.
    const waveOf = (call: string): string => (/^(FACT-2|SUP-1)/.test(call.split(':')[1]) ? 'W901' : 'W902');
    for (const stage of ['screen', 'check', 'letter']) {
      expect([...new Set(ran.fake.calls.filter((c) => c.startsWith(`${stage}:`)).map(waveOf))]).toEqual(['W901', 'W902']);
    }
    expect(ran.log.filter((l) => l.startsWith('Stage 1 of 3.'))).toEqual(['Stage 1 of 3. Model 1 screens. Calls to make: 12.']);
    expect(ran.log.filter((l) => l.startsWith('Stage 2 of 3.'))).toHaveLength(1);
    expect(ran.log.filter((l) => l.startsWith('Stage 3 of 3.'))).toHaveLength(1);
    expect(ran.results().waves?.map((w) => w.name)).toEqual(['W901', 'W902']);
  });

  it('lists a folder with NOT_DRAFTED.md and no criterion.json as not drafted, and skips it', async () => {
    const { w901 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w901]);
    expect(ran.fake.calls.some((c) => c.includes('GONE-3'))).toBe(false);
    expect(ran.fake.loaded).not.toContain('W901/GONE-3');
    const wave = ran.results().waves?.[0];
    expect(wave?.criteria.map((c) => [c.id, c.status, c.reason])).toEqual([
      ['FACT-2', 'in_run', ''],
      ['GONE-3', 'not_drafted', 'not drafted'],
      ['SUP-1', 'in_run', ''],
    ]);
    expect(ran.log).toContain('Not scored: W901 GONE-3: not drafted');
    expect(ran.log).toContain('Not drafted: 1. Files not usable: 0.');
    const table = ran.table();
    expect(table).toContain('| GONE-3 | NOT DRAFTED | | | | | | | | GONE-3 | | not drafted |');
    expect(table).toContain('## Not drafted');
    expect(table).toContain('- **GONE-3** (W901): not drafted.');
    expect(table).not.toContain('## Files not usable');
  });

  it('reports a criterion file or a history that will not load as files not usable, and runs the others', async () => {
    const { w902 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w902]);
    const results = ran.results();
    expect(ran.fake.calls.some((c) => c.includes('BAD-5') || c.includes('BAD-6'))).toBe(false);
    expect(verdicts(results)).toEqual({ 'FACT-4': 'FAIL', 'SUP-7': 'PASS' });
    const unusable = results.not_passing.filter((n) => n.result === 'FILES_NOT_USABLE');
    expect(unusable.map((n) => n.id)).toEqual(['BAD-5', 'BAD-6']);
    expect(unusable[0].reason.startsWith('files not usable: criterion.json: Criterion BAD-5 could not be read (W902')).toBe(true);
    expect(unusable[1]).toEqual({
      id: 'BAD-6',
      result: 'FILES_NOT_USABLE',
      reason: 'files not usable: pos-buried.csv: The CSV reader reported a problem. No row has a date that can be read.',
      reasons: ['files not usable: pos-buried.csv: The CSV reader reported a problem. No row has a date that can be read.'],
      class: null,
      wave: 'W902',
    });
    expect(results.passing).toEqual(['SUP-7']);
    const table = ran.table();
    expect(table).toContain('## Files not usable');
    expect(table).toContain('- **BAD-6** (W902): files not usable: pos-buried.csv: The CSV reader reported a problem. No row has a date that can be read.');
    expect(table).toContain('| BAD-6 | FILES NOT USABLE | | | | | | | | BAD-6 | | files not usable: pos-buried.csv: The CSV reader reported a problem. No row has a date that can be read. |');
    expect(ran.log).toContain('Not drafted: 0. Files not usable: 2.');
    // Never a clean end when a criterion could not be scored.
    expect(ran.code).toBe(1);
  });

  it('gives each FAIL a plain reason, and says when the missing line is the fact line', async () => {
    const { w902 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w902]);
    const results = ran.results();
    const fact4 = results.score.criteria.find((s) => s.criterionId === 'FACT-4');
    expect(fact4).toMatchObject({ verdict: 'FAIL', class: 'needs_a_fact', planted: 2, caught: 1 });
    expect(fact4?.failures).toEqual([
      { caseFile: 'FACT-4/pos-fact.csv', step: 'lines_not_cited', text: 'pos-fact.csv: it reached the bell, but the fact line L001 was not cited.' },
    ]);
    expect(fact4?.whyFailed).toBe('pos-fact.csv: it reached the bell, but the fact line L001 was not cited.');
    expect(results.not_passing.find((n) => n.id === 'FACT-4')).toEqual({
      id: 'FACT-4',
      result: 'FAIL',
      reason: 'pos-fact.csv: it reached the bell, but the fact line L001 was not cited.',
      reasons: ['pos-fact.csv: it reached the bell, but the fact line L001 was not cited.'],
      class: 'needs_a_fact',
      wave: 'W902',
    });
    expect(ran.table()).toContain('| FACT-4 | needs a fact | pos-fact.csv: it reached the bell, but the fact line L001 was not cited. |');
    expect(ran.log).toContain('        pos-fact.csv: it reached the bell, but the fact line L001 was not cited.');
    // A near miss that is confirmed is a false flag. It is counted, and the criterion still passes.
    const sup7 = results.score.criteria.find((s) => s.criterionId === 'SUP-7');
    expect(sup7?.verdict).toBe('PASS');
    expect(sup7?.falseFlags.map((f) => [f.caseFile, f.caseKind, f.ownFolder, f.role])).toEqual([['SUP-7/near-miss.csv', 'near_miss', true, 'own']]);
  });

  it('says in the table that it was a wave run, and which folders', async () => {
    const { w901, w902 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', `${w901},${w902}`]);
    const table = ran.table();
    expect(table).toContain('**This was a wave run.** It scored the criteria of 2 wave folders in place: W901, W902. Each history was screened against its own criterion only. PASS means the same as in a full run. False flags were counted only where the run looked.');
    expect(table).toContain('- Answer sheet: built from the answer parts (`expected.part.json`) in the wave folders. Not signed by the clinical reviewer yet.');
    expect(table).toContain('- Criteria: 4 of the 4 that could be read in the wave folders. Signed by the clinical reviewer: 0 of 4. Not drafted: 1. Files not usable: 2.');
    expect(table).toContain('  - W901: 2 criteria in the run, 1 not drafted.');
    expect(table).toContain('  - W902: 2 criteria in the run, 2 with files that are not usable.');
    expect(table).toContain('- Not drafted: 1. Files not usable: 2. Neither was scored, and neither passes.');
    expect(table).toContain('| Criterion | Result | Caught / planted | Disputed | Criterion text | False flags | Failed calls | Letters | Seconds | ID | Class | Why it failed |');
    expect(table).toContain('| FACT 2 | PASS | 2 / 2 | 0 | yes | 0 | 0 | 2 of 2: 2 by the model | 3.5 | FACT-2 | needs a fact |  |');
    expect(table).toContain('| SUP 1 | PASS | 2 / 2 | 0 | yes | 0 | 0 | 2 of 2: 2 by the model | 3.5 | SUP-1 | supplies only |  |');
    expect(table).not.toContain('## Sampled false-flag estimate');
    expect(table.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(ran.log).toContain('Wave run. Wave folders: W901, W902. Each history is screened against its own criterion only.');
    expect(ran.log).toContain('Passing: 3. Not passing: 4. Both lists are in results.json.');
    expect(ran.results().options).toEqual({ only: [], cases: [], limit: null, letters: true, sheet: null, waves: ['W901', 'W902'] });
  });

  it('gives each wave folder its own row and its own last line: how many pass, and the time its model calls took', async () => {
    const { w901, w902 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', `${w901},${w902}`]);
    const results = ran.results();
    const summaries = waveSummaries(results.waves, results.score);
    expect(summaries.map((w) => [w.name, w.scored, w.pass, w.notPassing, w.notDrafted, w.notUsable, w.leftOut, w.caught, w.planted, w.falseFlags])).toEqual([
      ['W901', 2, 2, 0, 1, 0, 0, 4, 4, 0],
      ['W902', 2, 1, 1, 0, 2, 0, 3, 4, 1],
    ]);
    // The seconds of a wave folder are the seconds of its own criteria, and nothing else.
    const secondsOf = (ids: string[]): number =>
      Math.round(results.score.criteria.filter((s) => ids.includes(s.criterionId)).reduce((sum, s) => sum + s.seconds, 0) * 10) / 10;
    expect(summaries[0].seconds).toBe(secondsOf(['FACT-2', 'SUP-1']));
    expect(summaries[1].seconds).toBe(secondsOf(['FACT-4', 'SUP-7']));
    expect(summaries[0].seconds).toBe(7);
    expect(summaries[0].seconds + summaries[1].seconds).toBeCloseTo(results.score.totals.seconds, 5);

    const table = ran.table();
    expect(table).toContain('## Each wave folder');
    expect(table).toContain('| Wave folder | Criteria scored | PASS | Not passing | Not drafted | Files not usable | Caught / planted | Disputed | False flags | Seconds in model calls |');
    expect(table).toContain('| W901 | 2 | 2 | 0 | 1 | 0 | 4 / 4 | 0 | 0 | 7.0 |');
    expect(table).toContain(`| W902 | 2 | 1 | 1 | 0 | 2 | 3 / 4 | 0 | 1 | ${summaries[1].seconds.toFixed(1)} |`);
    // The section stands after the row for each criterion and before the reasons.
    expect(table.indexOf('| Criterion |')).toBeLessThan(table.indexOf('## Each wave folder'));
    expect(table.indexOf('## Each wave folder')).toBeLessThan(table.indexOf('## Why each FAIL'));

    expect(ran.log).toContain('  W901: PASS 2 of 2 scored, not passing 0, not drafted 1. Planted findings caught: 4 of 4, disputed 0. Time in model calls: 7 s.');
    expect(ran.log.find((l) => l.startsWith('  W902:'))).toMatch(/^  W902: PASS 1 of 2 scored, not passing 1, files not usable 2\. Planted findings caught: 3 of 4, disputed 0\. Time in model calls: \d+ s\.$/);
    expect(waveSummaryLine({ name: 'W9', scored: 1, pass: 1, notPassing: 0, leftOut: 2, notDrafted: 0, notUsable: 0, planted: 2, caught: 2, disputed: 0, falseFlags: 0, seconds: 75.2 }))
      .toBe('W9: PASS 1 of 1 scored, not passing 0, left out by an option 2. Planted findings caught: 2 of 2, disputed 0. Time in model calls: 1 min 15 s.');
    // A run that is not a wave run has no wave folders to list.
    expect(waveSummaries(null, results.score)).toEqual([]);
  });

  it('keeps a fingerprint of every file it scored, and no folder of this computer', async () => {
    const { root, w901 } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', w901]);
    const saved = fs.readFileSync(path.join(ran.out, 'results.json'), 'utf8');
    expect(saved.includes(root)).toBe(false);
    expect(saved.includes(root.split(path.sep).join('/'))).toBe(false);
    expect(ran.table().includes(root)).toBe(false);
    const sup1 = ran.results().waves?.[0].criteria.find((c) => c.id === 'SUP-1');
    expect(Object.keys(sup1?.files ?? {}).sort()).toEqual([
      'cases/SUP-1/expected.part.json',
      'cases/SUP-1/near-miss.csv',
      'cases/SUP-1/pos-brand.csv',
      'cases/SUP-1/pos-buried.csv',
      'criteria/SUP-1/criterion.json',
    ]);
    expect(Object.values(sup1?.files ?? {}).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(ran.results().cases.every((c) => c.wave === 'W901')).toBe(true);
    // The fact lines of a history are kept, so a reason can say "the fact line".
    expect(ran.results().cases.find((c) => c.file === 'FACT-2/pos-fact.csv')?.factLineIds).toEqual(['L001']);
  });

  it('takes a folder that holds wave folders as all of them, in name order', async () => {
    const { root } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', root]);
    expect(ran.results().waves?.map((w) => w.name)).toEqual(['W901', 'W902']);
    expect(ran.results().criteria.map((c) => c.id)).toEqual(['FACT-2', 'SUP-1', 'FACT-4', 'SUP-7']);
  });

  it('--only keeps the chosen criteria of the wave folders, and the run is then a part run', async () => {
    const { root } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', root, '--only', 'SUP-7,sup 1']);
    const results = ran.results();
    expect(results.criteria.map((c) => c.id)).toEqual(['SUP-1', 'SUP-7']);
    expect(results.cases).toHaveLength(6);
    expect(results.partRun).toBe(true);
    expect(results.waves?.[0].criteria.map((c) => [c.id, c.status])).toEqual([['FACT-2', 'left_out'], ['GONE-3', 'not_drafted'], ['SUP-1', 'in_run']]);
    expect(ran.table()).toContain('  - W901: 1 criterion in the run, 1 left out by an option, 1 not drafted.');
    const unknown = await runScorer(emptyRepo(), ['--wave', root, '--only', 'NOPE-1']);
    expect(unknown.code).toBe(2);
    expect(unknown.log).toEqual(['Not in the wave folders: NOPE-1. The criteria that could be read there are: FACT-2, SUP-1, FACT-4, SUP-7.']);
  });

  it('adds the false-flag sample to a wave run when --quick is given too', async () => {
    const { root } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', root, '--quick']);
    const results = ran.results();
    expect(results.mode).toBe('wave');
    expect(results.quick?.sample).toMatchObject({ eligible: 12, oneIn: 10 });
    expect(results.quick?.sample?.histories).toHaveLength(2);            // 12 histories, one in ten, rounded up
    expect(results.pairs.filter((p) => p.role === 'sample')).toHaveLength(6);   // each against the 3 other criteria
    expect(ran.table()).toContain('## Sampled false-flag estimate');
    expect(ran.table()).toContain('One history in 10 was also screened against up to 30 other criteria, to estimate false flags.');
    expect(results.options).toMatchObject({ quick: true, waves: ['W901', 'W902'] });
  });

  it('--check with --wave lists what is ready and what is not, and calls no model', async () => {
    const { root } = twoWaves();
    const ran = await runScorer(emptyRepo(), ['--wave', root, '--check']);
    expect(ran.fake.calls).toEqual([]);
    expect(fs.existsSync(ran.out)).toBe(false);
    expect(ran.log.slice(0, 3)).toEqual([
      'ClinicaLANTERN scorer. Check only. No model is called and nothing is written.',
      'Wave folders: W901, W902. Answer sheet: the answer parts (expected.part.json) in the wave folders. Not signed by the clinical reviewer yet.',
      'Histories: 12 of 12. Criteria: 4 of 4.',
    ]);
    expect(ran.log).toContain('W901 GONE-3: not drafted');
    expect(ran.log).toContain('W902 BAD-6: files not usable: pos-buried.csv: The CSV reader reported a problem. No row has a date that can be read.');
    expect(ran.log).toContain('A wave run would make 12 screen calls (own criterion 12, clean histories against the first ten 0, false-flag sample 0), then one check for each suspected finding.');
    expect(ran.log[ran.log.length - 1]).toBe('Things that need a look: 2.');      // the two with files that are not usable
    expect(ran.code).toBe(1);
  });

  it('still writes its results when no criterion of the wave folder can be used', async () => {
    const root = tempDir('lantern-eval-waves-');
    const wave = makeWave(root, 'W903', { 'BAD-1': { ...suppliesOnly('BAD-1'), part: null }, 'GONE-2': { notDrafted: 'Not drafted.' } });
    const ran = await runScorer(emptyRepo(), ['--wave', wave]);
    expect(ran.fake.calls).toEqual([]);
    expect(ran.results().passing).toEqual([]);
    expect(ran.results().not_passing.map((n) => [n.id, n.reason])).toEqual([
      ['BAD-1', 'files not usable: cases/BAD-1/expected.part.json was not found'],
      ['GONE-2', 'not drafted'],
    ]);
    expect(ran.code).toBe(1);
  });
});

describe('what stops a wave run before it starts', () => {
  it('refuses --sheet with --wave, a folder that is not there, and a folder that is not a wave folder', async () => {
    expect(parseArgs(['--wave', 'W101', '--sheet', 'x.json']).errors).toEqual(['Option --sheet cannot be used with --wave. A wave folder brings its own answer parts.']);
    expect(parseArgs(['--wave']).errors).toEqual(['Option --wave needs a wave folder, for example --wave C:\\waves\\W101.']);
    expect(parseArgs(['--wave', 'a,b', '--wave=c']).options.waves).toEqual(['a', 'b', 'c']);
    expect('waves' in parseArgs([]).options).toBe(false);
    expect(optionsText({ only: [], cases: [], limit: null, letters: true, sheet: null, waves: ['W101', 'W102'] })).toBe('--wave W101,W102');

    const repo = emptyRepo();
    const missing = await runScorer(repo, ['--wave', 'no-such-wave']);
    expect(missing.code).toBe(2);
    expect(missing.log).toEqual(['The wave folder was not found: no-such-wave']);
    const plain = tempDir('lantern-eval-plain-');
    const notWave = await runScorer(repo, ['--wave', plain]);
    expect(notWave.code).toBe(2);
    expect(notWave.log[0]).toContain('It has no "criteria" folder, and no folder inside it has one.');
    expect(notWave.fake.calls).toEqual([]);
  });

  it('refuses a pipeline that cannot load criteria from a folder', async () => {
    const { w901 } = twoWaves();
    const { loadCriteriaFrom: _left, ...older } = fakePipeline().pipeline;
    const log: string[] = [];
    const code = await main(older as Pipeline, ['--wave', w901, '--out', path.join(tempDir(), 'out')], { repoRoot: emptyRepo(), log: (l) => log.push(l) });
    expect(code).toBe(2);
    expect(log).toEqual(['A wave folder cannot be scored. The pipeline does not have: loadCriteriaFrom.']);
  });

  it('never opens a folder of the earlier test data', () => {
    const root = tempDir('lantern-eval-waves-');
    fs.mkdirSync(path.join(root, 'sealed-set', 'criteria'), { recursive: true });
    expect(findWaveFolders([path.join(root, 'sealed-set')], root)).toEqual({ waves: [], errors: [`This folder is never opened: ${path.join(root, 'sealed-set')}`] });
    // Inside a folder of wave folders such a folder is passed over.
    makeWave(root, 'W904', { 'SUP-1': suppliesOnly('SUP-1') });
    expect(findWaveFolders([root], root).waves.map((w) => w.name)).toEqual(['W904']);
  });
});

describe('reading a wave folder', () => {
  it('finds wave folders by name order, once each, and refuses two with the same name', () => {
    const root = tempDir('lantern-eval-waves-');
    for (const name of ['W10', 'W9', 'W101']) makeWave(root, name, {});
    expect(findWaveFolders([root], root).waves.map((w) => w.name)).toEqual(['W9', 'W10', 'W101']);
    expect(findWaveFolders(['W9', path.join(root, 'W9'), 'W10'], root).waves.map((w) => w.name)).toEqual(['W9', 'W10']);
    const other = tempDir('lantern-eval-waves-');
    makeWave(other, 'W9', {});
    expect(findWaveFolders([path.join(root, 'W9'), path.join(other, 'W9')], root).errors).toEqual(['Two wave folders have the same name: W9. Give each wave folder a name of its own.']);
  });

  it('reports each thing that makes the files of a criterion not usable', async () => {
    const root = tempDir('lantern-eval-waves-');
    const ok = suppliesOnly('OK-1');
    const wave = makeWave(root, 'W905', {
      'OK-1': ok,
      'NO-FILES': { criterion: null },
      'NO-PART': { ...suppliesOnly('NO-PART'), part: null },
      'BAD-PART': { ...suppliesOnly('BAD-PART'), part: '{ not json' },
      'ODD-PART': { ...suppliesOnly('ODD-PART'), part: '{ "histories": [] }' },
      'WRONG-KIND': { ...suppliesOnly('WRONG-KIND'), part: JSON.stringify([{ file: 'WRONG-KIND/pos-brand.csv', kind: 'maybe', about: 'x', findings: [] }]) },
      'OTHER-FOLDER': { ...suppliesOnly('OTHER-FOLDER'), part: part('OK-1', ['pos-brand.csv', 'positive', [['L002']]]) },
      'OTHER-ID': { ...suppliesOnly('OTHER-ID'), criterion: JSON.stringify({ ...makeCriterion('SOMETHING-ELSE') }) },
      'MISSING-FILE': { ...suppliesOnly('MISSING-FILE'), part: part('MISSING-FILE', ['pos-brand.csv', 'positive', [['L002']]], ['gone.csv', 'near_miss']) },
    });
    // The fake loader takes the folder name as the ID, as the real one does. One that does not is caught too.
    const fake = fakePipeline();
    const keepId: Pipeline = {
      ...fake.pipeline,
      loadCriteriaFrom: async (folder, ids) => ids.map((id) => JSON.parse(fs.readFileSync(path.join(folder, id, 'criterion.json'), 'utf8'))),
    };
    const items = await readWaveFolder(keepId, { name: 'W905', dir: wave }, 0, new Map());
    const reasons = Object.fromEntries(items.map((item) => [item.id, `${item.status}: ${item.reason}`]));
    expect(reasons).toEqual({
      'BAD-PART': expect.stringMatching(/^not_usable: expected\.part\.json could not be read\. /),
      'MISSING-FILE': 'not_usable: gone.csv: The file was not found.',
      'NO-FILES': 'not_usable: the folder has no criterion.json and no NOT_DRAFTED.md',
      'NO-PART': 'not_usable: cases/NO-PART/expected.part.json was not found',
      'ODD-PART': 'not_usable: expected.part.json is not a list of histories',
      'OK-1': 'ready: ',
      'OTHER-FOLDER': 'not_usable: expected.part.json names OK-1/pos-brand.csv, which is not in the folder OTHER-FOLDER',
      'OTHER-ID': 'not_usable: criterion.json gives the ID "SOMETHING-ELSE", but its folder is named OTHER-ID',
      'WRONG-KIND': 'not_usable: expected.part.json: WRONG-KIND/pos-brand.csv: "kind" must be positive, near_miss or clean.',
    });
    const ready = items.find((item) => item.id === 'OK-1');
    expect(ready?.cases.map((c) => [c.caseId, c.file, c.wave])).toEqual([
      ['C0001', 'OK-1/pos-brand.csv', 'W905'],
      ['C0002', 'OK-1/pos-buried.csv', 'W905'],
      ['C0003', 'OK-1/near-miss.csv', 'W905'],
    ]);
  });

  it('makes the second of two folders with the same ID not usable, and warns about a history the part does not list', async () => {
    const root = tempDir('lantern-eval-waves-');
    const extra = suppliesOnly('SUP-1');
    (extra.histories as Record<string, string>)['pos-extra.csv'] = shortHistory('SUP-1-EXTRA', plainLine(1));
    const one = makeWave(root, 'W906', { 'SUP-1': extra });
    const two = makeWave(root, 'W907', { 'SUP-1': suppliesOnly('SUP-1') });
    const ran = await runScorer(emptyRepo(), ['--wave', one, '--wave', two]);
    const results = ran.results();
    expect(results.criteria.map((c) => c.id)).toEqual(['SUP-1']);
    expect(results.not_passing).toEqual([
      { id: 'SUP-1', result: 'FILES_NOT_USABLE', reason: 'files not usable: the same criterion ID is also in W906. An ID must be in one wave folder only', reasons: ['files not usable: the same criterion ID is also in W906. An ID must be in one wave folder only'], class: null, wave: 'W907' },
    ]);
    expect(results.sheet.warnings).toEqual(['SUP-1/pos-extra.csv: the file is in the wave folder, but expected.part.json does not list it. It was not scored.']);
    expect(results.passing).toEqual(['SUP-1']);
  });

  it('does not need the repository to hold the criteria or an answer sheet', async () => {
    // A repository with its own criteria in use and no answer sheet: a wave run does not read either.
    const repo = makeRepo({}, { signed_by_clinical_reviewer: null, cases: [] }, { active: ['STOPP-A1'] });
    fs.rmSync(path.join(repo, 'cases', 'expected.json'));
    writeFile(path.join(repo, 'criteria', 'STOPP-A1', 'criterion.json'), '{ broken');
    const { w901 } = twoWaves();
    const ran = await runScorer(repo, ['--wave', w901], [makeCriterion('STOPP-A1')]);
    expect(ran.code).toBe(0);
    expect(ran.results().criteria.map((c) => c.id)).toEqual(['FACT-2', 'SUP-1']);
    expect(ran.results().activeCriteria).toEqual(['FACT-2', 'SUP-1']);
  });
});
