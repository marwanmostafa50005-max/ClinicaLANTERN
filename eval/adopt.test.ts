// Unit tests for the adoption helper: its rules (eval/adopt.ts, pure functions) and the tool itself
// (tools/adopt-wave.mjs), started the way a person starts it on made-up folders in the temp folder.
// No model. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExpectedCase } from '../shared/types.ts';
import { cleanEntry, formatJson, formatList, formatSheet, planAdoption, readList, readResultsLists, withCases, withFurther } from './adopt.ts';
import type { AdoptInput } from './adopt.ts';
import { draftedFact, draftedSupplies, makeWave, removeTempDirs, runScorer, tempDir, writeFile } from './fakes.ts';
import { expectedCase, makeCriterion, planted } from './testkit.ts';

afterEach(removeTempDirs);

// ---------- the rules ----------

function entries(id: string): ExpectedCase[] {
  return [
    expectedCase(`${id}/pos-brand.csv`, 'positive', [planted(id, ['L002', 'L003'])], `Planted for ${id}.`),
    expectedCase(`${id}/near-miss.csv`, 'near_miss', [], `A near miss for ${id}.`),
  ];
}

function input(over: Partial<AdoptInput> = {}): AdoptInput {
  return {
    wave: 'W950',
    criteria: [{ id: 'GOOD-1', drafted: true }],
    passing: ['GOOD-1'],
    notPassing: {},
    check: { 'GOOD-1': { status: 'ok', problems: [] } },
    changedSinceScored: {},
    repo: {},
    repoDetail: {},
    list: { active: ['TEN-1', 'TEN-2'], reserves: ['RES-1'], further: [] },
    sheetFiles: ['TEN-1/pos-brand.csv'],
    parts: { 'GOOD-1': entries('GOOD-1') },
    ...over,
  };
}

describe('which criteria are adopted', () => {
  it('adopts a criterion that is in the passing list and ok in the case check', () => {
    const [decision] = planAdoption(input());
    expect(decision).toMatchObject({ id: 'GOOD-1', action: 'adopt', copyFolders: true, addToFurther: true });
    expect(decision.addCases.map((c) => c.file)).toEqual(['GOOD-1/pos-brand.csv', 'GOOD-1/near-miss.csv']);
    expect(decision.reason).toBe('copies criteria/GOOD-1 and cases/GOOD-1, adds the ID to the further list, adds 2 histories to the answer sheet');
  });

  it('skips a criterion that is not in the passing list, with the reason from the results', () => {
    const failed = planAdoption(input({ passing: [], notPassing: { 'GOOD-1': 'FAIL: pos-brand.csv: not suspected by Model 1.' } }));
    expect(failed).toEqual([{ id: 'GOOD-1', action: 'skip', reason: 'not in the passing list. FAIL: pos-brand.csv: not suspected by Model 1.', copyFolders: false, addToFurther: false, addCases: [] }]);
    const unknown = planAdoption(input({ passing: [] }));
    expect(unknown[0]).toMatchObject({ action: 'skip', reason: 'not in these results. The run that wrote them did not score this criterion.' });
  });

  it('skips a criterion the case check does not call ok, even when it passed', () => {
    const notOk = planAdoption(input({ check: { 'GOOD-1': { status: 'not_ok', problems: ['pos-brand.csv: L002: no medicine name.', 'one more'] } } }));
    expect(notOk[0]).toMatchObject({ action: 'skip', reason: 'the case check does not say ok. pos-brand.csv: L002: no medicine name. (and 1 more)' });
    const noVerdict = planAdoption(input({ check: {} }));
    expect(noVerdict[0]).toMatchObject({ action: 'skip', reason: 'the case check does not say ok. the case check gave no verdict for it' });
  });

  it('skips a criterion that was not drafted', () => {
    expect(planAdoption(input({ criteria: [{ id: 'GONE-3', drafted: false }] }))).toEqual([
      { id: 'GONE-3', action: 'skip', reason: 'not drafted', copyFolders: false, addToFurther: false, addCases: [] },
    ]);
  });

  it('skips a criterion whose files are not the files that were scored', () => {
    const changed = planAdoption(input({ changedSinceScored: { 'GOOD-1': 'cases/GOOD-1/pos-brand.csv' } }));
    expect(changed[0]).toMatchObject({ action: 'skip', reason: 'its files are not the files that were scored (cases/GOOD-1/pos-brand.csv). Score the wave folder again.' });
  });

  it('never writes over a folder that is already in the repository: it reports it and skips', () => {
    const there = planAdoption(input({ repo: { 'GOOD-1': 'different' }, repoDetail: { 'GOOD-1': 'criteria/GOOD-1' } }));
    expect(there).toEqual([
      { id: 'GOOD-1', action: 'skip', reason: 'criteria/GOOD-1 is already in the repository and is not the same. Nothing was written over.', copyFolders: false, addToFurther: false, addCases: [] },
    ]);
  });

  it('completes the list and the answer sheet when the same folders are already there', () => {
    const [half] = planAdoption(input({ repo: { 'GOOD-1': 'same' } }));
    expect(half).toMatchObject({ action: 'complete', copyFolders: false, addToFurther: true });
    expect(half.addCases).toHaveLength(2);
    expect(half.reason).toBe('the folders are already in the repository and are the same; adds the ID to the further list, adds 2 histories to the answer sheet');
    const done = planAdoption(input({
      repo: { 'GOOD-1': 'same' },
      list: { active: ['TEN-1'], reserves: [], further: ['GOOD-1'] },
      sheetFiles: ['GOOD-1/pos-brand.csv', 'GOOD-1/near-miss.csv'],
    }));
    expect(done[0]).toMatchObject({ action: 'skip', reason: 'already in the repository, in the list and in the answer sheet.' });
  });

  it('never adds an ID twice, and never adds one that is among the first ten or the reserves', () => {
    const inFurther = planAdoption(input({ list: { active: ['TEN-1'], reserves: [], further: ['GOOD-1'] } }));
    expect(inFurther[0]).toMatchObject({ action: 'adopt', addToFurther: false });
    const inReserves = planAdoption(input({ list: { active: ['TEN-1'], reserves: ['GOOD-1'], further: [] } }));
    expect(inReserves[0].addToFurther).toBe(false);
    const inActive = planAdoption(input({ list: { active: ['GOOD-1'], reserves: [], further: [] } }));
    expect(inActive[0].addToFurther).toBe(false);
    // Two folders with the same ID in one go: the second finds the first already planned.
    const twice = planAdoption(input({ criteria: [{ id: 'GOOD-1', drafted: true }, { id: 'GOOD-1', drafted: true }] }));
    expect(twice.map((d) => [d.addToFurther, d.addCases.length])).toEqual([[true, 2], [false, 0]]);
  });

  it('does not add a history that the answer sheet already lists', () => {
    const [decision] = planAdoption(input({ sheetFiles: ['good-1\\POS-BRAND.csv'] }));
    expect(decision.addCases.map((c) => c.file)).toEqual(['GOOD-1/near-miss.csv']);
  });

  it('decides each criterion of the wave folder on its own', () => {
    const decisions = planAdoption(input({
      criteria: [{ id: 'BAD-5', drafted: true }, { id: 'FACT-2', drafted: true }, { id: 'FAIL-4', drafted: true }, { id: 'GONE-3', drafted: false }, { id: 'GOOD-1', drafted: true }],
      passing: ['BAD-5', 'FACT-2', 'GOOD-1'],
      notPassing: { 'FAIL-4': 'FAIL: pos-brand.csv: turned back by Model 2.', 'GONE-3': 'NOT DRAFTED: not drafted' },
      check: {
        'BAD-5': { status: 'not_ok', problems: ['extra.csv: the file is in the folder, but expected.part.json does not list it.'] },
        'FACT-2': { status: 'ok', problems: [] },
        'FAIL-4': { status: 'ok', problems: [] },
        'GONE-3': { status: 'not_drafted', problems: [] },
        'GOOD-1': { status: 'ok', problems: [] },
      },
      parts: { 'FACT-2': entries('FACT-2'), 'GOOD-1': entries('GOOD-1') },
    }));
    expect(decisions.map((d) => [d.id, d.action])).toEqual([['BAD-5', 'skip'], ['FACT-2', 'adopt'], ['FAIL-4', 'skip'], ['GONE-3', 'skip'], ['GOOD-1', 'adopt']]);
  });
});

describe('the list of criteria', () => {
  const raw = { active: ['TEN-1', 'TEN-2'], reserves: ['RES-1'] };

  it('adds IDs to the further list and never touches the first ten or the reserves', () => {
    const next = withFurther(raw, ['GOOD-1', 'FACT-2']);
    expect(next).toEqual({ active: ['TEN-1', 'TEN-2'], reserves: ['RES-1'], further: ['GOOD-1', 'FACT-2'] });
    expect(next.active).toBe(raw.active);          // the very same lists, not copies that could differ
    expect(next.reserves).toBe(raw.reserves);
    expect(raw).toEqual({ active: ['TEN-1', 'TEN-2'], reserves: ['RES-1'] });   // what was read is left as it was
    expect(Object.keys(next)).toEqual(['active', 'reserves', 'further']);
  });

  it('never adds an ID twice, wherever it already is', () => {
    const next = withFurther({ ...raw, further: ['GOOD-1'] }, ['GOOD-1', 'TEN-2', 'RES-1', 'NEW-9', 'NEW-9']);
    expect(next.further).toEqual(['GOOD-1', 'NEW-9']);
  });

  it('keeps the other entries of the file and the place of the further list', () => {
    const next = withFurther({ note: 'kept', further: ['A-1'], active: ['TEN-1'], reserves: [] }, ['B-2']);
    expect(Object.keys(next)).toEqual(['note', 'further', 'active', 'reserves']);
    expect(next).toMatchObject({ note: 'kept', further: ['A-1', 'B-2'] });
  });

  it('refuses a list file it cannot use', () => {
    expect(() => readList([])).toThrow('criteria/active.json is not a JSON object.');
    expect(() => readList({ reserves: [] })).toThrow('criteria/active.json has no "active" list.');
    expect(() => readList({ active: [], further: 'GOOD-1' })).toThrow('The "further" entry of criteria/active.json is not a list.');
    expect(readList({ active: ['A'], reserves: ['B'] })).toEqual({ active: ['A'], reserves: ['B'], further: [] });
    expect(formatList({ active: ['A'], reserves: [], further: ['B'] })).toBe('{\n  "active": [\n    "A"\n  ],\n  "reserves": [],\n  "further": [\n    "B"\n  ]\n}\n');
  });
});

describe('the answer sheet', () => {
  const sheet = { signed_by_clinical_reviewer: null, cases: [expectedCase('TEN-1/pos-brand.csv', 'positive', [planted('TEN-1', ['L001'], ['L004', 'L008'])], 'First ten.')] };

  it('adds the histories at the end and keeps what was there', () => {
    const next = withCases(sheet, entries('GOOD-1'));
    expect(next.added).toBe(2);
    expect((next.sheet.cases as ExpectedCase[]).map((c) => c.file)).toEqual(['TEN-1/pos-brand.csv', 'GOOD-1/pos-brand.csv', 'GOOD-1/near-miss.csv']);
    expect((next.sheet.cases as ExpectedCase[])[0]).toBe(sheet.cases[0]);
    expect(next.sheet.signed_by_clinical_reviewer).toBeNull();
    expect(sheet.cases).toHaveLength(1);
  });

  it('never adds a history twice', () => {
    const once = withCases(sheet, entries('GOOD-1'));
    const twice = withCases(once.sheet, [...entries('GOOD-1'), expectedCase('ten-1/POS-BRAND.csv', 'positive')]);
    expect(twice.added).toBe(0);
    expect(twice.sheet.cases).toHaveLength(3);
    expect(() => withCases({ signed_by_clinical_reviewer: null }, entries('GOOD-1'))).toThrow('The answer sheet has no "cases" list.');
  });

  it('writes an entry with its four fields only, in the order of the sheet', () => {
    const odd = { about: 'x', findings: [{ must_cite: [['L001']], criterion: 'A-1', extra: 1 }], kind: 'positive', file: 'A-1\\pos.csv', note: 'dropped' } as unknown as ExpectedCase;
    expect(JSON.stringify(cleanEntry(odd))).toBe('{"file":"A-1/pos.csv","kind":"positive","about":"x","findings":[{"criterion":"A-1","must_cite":[["L001"]]}]}');
  });

  it('is written in the style of the sheet: the line IDs of a group on one line', () => {
    const text = formatSheet(withCases(sheet, [entries('GOOD-1')[1]]).sheet);
    expect(text).toBe([
      '{',
      '  "signed_by_clinical_reviewer": null,',
      '  "cases": [',
      '    {',
      '      "file": "TEN-1/pos-brand.csv",',
      '      "kind": "positive",',
      '      "about": "First ten.",',
      '      "findings": [',
      '        {',
      '          "criterion": "TEN-1",',
      '          "must_cite": [',
      '            ["L001"],',
      '            ["L004", "L008"]',
      '          ]',
      '        }',
      '      ]',
      '    },',
      '    {',
      '      "file": "GOOD-1/near-miss.csv",',
      '      "kind": "near_miss",',
      '      "about": "A near miss for GOOD-1.",',
      '      "findings": []',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n'));
    // Whatever the style, it reads back as the same value.
    const value = { a: [1, 'two', null, { b: [], c: {} }], d: 'text with "quotes" and a \\ slash', e: true, f: [['x'], []] };
    expect(JSON.parse(formatJson(value))).toEqual(value);
  });
});

describe('reading the results of a wave run', () => {
  it('reads the two lists, the fingerprints and the wave of each criterion', () => {
    const lists = readResultsLists({
      mode: 'wave',
      stoppedEarly: null,
      passing: ['GOOD-1', 'FACT-2', 'GOOD-1'],
      not_passing: [
        { id: 'FAIL-4', result: 'FAIL', reason: 'pos-brand.csv: turned back by Model 2.' },
        { id: 'GONE-3', result: 'NOT_DRAFTED', reason: 'not drafted' },
        { id: 'OLD-5', reasons: ['one', 'two'] },
      ],
      waves: [{ name: 'W950', criteria: [{ id: 'GOOD-1', status: 'in_run', files: { 'criteria/GOOD-1/criterion.json': 'abc' } }, { id: 'GONE-3', status: 'not_drafted', files: {} }] }],
    });
    expect(lists.passing).toEqual(['GOOD-1', 'FACT-2']);
    expect(lists.notPassing).toEqual({ 'FAIL-4': 'FAIL: pos-brand.csv: turned back by Model 2.', 'GONE-3': 'NOT DRAFTED: not drafted', 'OLD-5': 'NOT PASSING: one two' });
    expect(lists.scoredFiles).toEqual({ 'GOOD-1': { 'criteria/GOOD-1/criterion.json': 'abc' } });
    expect(lists.waveOf).toEqual({ 'GOOD-1': 'W950', 'GONE-3': 'W950' });
    expect(lists).toMatchObject({ mode: 'wave', stoppedEarly: null });
  });

  it('takes a passing entry that is an object with an id, and refuses a file with no passing list', () => {
    expect(readResultsLists({ passing: [{ id: 'GOOD-1' }, ' FACT-2 ', 7, {}] }).passing).toEqual(['GOOD-1', 'FACT-2']);
    expect(() => readResultsLists({ score: {} })).toThrow('The results file has no "passing" list.');
    expect(() => readResultsLists(null)).toThrow('The results file is not a JSON object.');
  });
});

// ---------- the tool, started for real ----------

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'adopt-wave.mjs');

function adopt(...args: string[]): { code: number | null; lines: string[]; out: string } {
  const done = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
  const out = `${done.stdout}${done.stderr}`;
  return { code: done.status, lines: out.split(/\r?\n/), out };
}

// Every file under a folder with its bytes, so a test can say "nothing was written".
function snapshot(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(folder, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(folder);
  return out;
}

const FIRST_TEN_SHEET = {
  signed_by_clinical_reviewer: null,
  cases: [expectedCase('TEN-1/pos-brand.csv', 'positive', [planted('TEN-1', ['L001'])], 'One of the first ten.')],
};

// A repository with one of the first ten and a reserve, a wave folder with five criterion folders,
// and the results of a wave run on it, made by the scorer with a fake pipeline.
//   BAD-5 passes its run but the case check finds a history the answer part does not list.
//   FACT-2 and GOOD-1 pass and are ok. FAIL-4 does not pass. GONE-3 was not drafted.
async function setUp(): Promise<{ repo: string; wave: string; results: string; listFile: string; sheetFile: string }> {
  const repo = tempDir('lantern-adopt-repo-');
  writeFile(path.join(repo, 'criteria', 'active.json'), `${JSON.stringify({ active: ['TEN-1'], reserves: ['RES-1'] }, null, 2)}\n`);
  writeFile(path.join(repo, 'criteria', 'TEN-1', 'criterion.json'), JSON.stringify(makeCriterion('TEN-1'), null, 2));
  writeFile(path.join(repo, 'cases', 'TEN-1', 'pos-brand.csv'), 'kept as it is\n');
  writeFile(path.join(repo, 'cases', 'expected.json'), `${JSON.stringify(FIRST_TEN_SHEET, null, 2)}\n`);

  const bad = draftedSupplies('BAD-5');
  (bad.histories as Record<string, string>)['extra.csv'] = (bad.histories as Record<string, string>)['near-miss.csv'];
  const wave = makeWave(tempDir('lantern-adopt-waves-'), 'W950', {
    'BAD-5': bad,
    'FACT-2': draftedFact('FACT-2'),
    'FAIL-4': draftedSupplies('FAIL-4', false),
    'GONE-3': { notDrafted: 'GONE-3 is not drafted.' },
    'GOOD-1': draftedSupplies('GOOD-1'),
  });
  const ran = await runScorer(repo, ['--wave', wave]);
  expect(ran.results().passing).toEqual(['BAD-5', 'FACT-2', 'GOOD-1']);
  expect(ran.results().not_passing.map((n) => [n.id, n.result])).toEqual([['FAIL-4', 'FAIL'], ['GONE-3', 'NOT_DRAFTED']]);
  return { repo, wave, results: path.join(ran.out, 'results.json'), listFile: path.join(repo, 'criteria', 'active.json'), sheetFile: path.join(repo, 'cases', 'expected.json') };
}

describe('the adoption tool', () => {
  it('writes nothing in a dry run, and says what it would do', async () => {
    const { repo, wave, results } = await setUp();
    const before = snapshot(repo);
    const done = adopt('--wave', wave, '--results', results, '--repo', repo, '--dry-run');
    expect(done.code).toBe(0);
    expect(snapshot(repo)).toEqual(before);
    expect(done.lines[0]).toBe('ClinicaLANTERN adoption helper. DRY RUN: nothing is written. Fictional patients only.');
    expect(done.lines).toContain('Wave folder W950: 5 criterion folders.');
    expect(done.lines).toContain('SKIPPED  BAD-5  the case check does not say ok. extra.csv: the file is in the folder, but expected.part.json does not list it.');
    expect(done.lines).toContain('WOULD ADOPT  FACT-2  would copy criteria/FACT-2 and cases/FACT-2; would add the ID to the further list; would add 3 histories to the answer sheet.');
    expect(done.lines).toContain('SKIPPED  FAIL-4  not in the passing list. FAIL: pos-brand.csv: not suspected by Model 1. pos-buried.csv: not suspected by Model 1.');
    expect(done.lines).toContain('SKIPPED  GONE-3  not drafted');
    expect(done.lines).toContain('WOULD ADOPT  GOOD-1  would copy criteria/GOOD-1 and cases/GOOD-1; would add the ID to the further list; would add 3 histories to the answer sheet.');
    expect(done.lines).toContain('DRY RUN. Nothing was written. This is what would be done:');
    expect(done.lines).toContain('  Adopted: 2. Completed: 0. Skipped: 3. Failed: 0.');
    expect(done.lines).toContain('  IDs added to the further list of criteria/active.json: 2. The first ten and the reserves were not touched.');
    expect(done.lines).toContain('  Histories added to cases/expected.json: 6.');
    expect(done.out.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it('copies the folders, adds the IDs to the further list and the histories to the answer sheet', async () => {
    const { repo, wave, results, listFile, sheetFile } = await setUp();
    const done = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(done.code).toBe(0);
    expect(done.lines).toContain('ADOPTED  FACT-2  copied criteria/FACT-2 and cases/FACT-2; added the ID to the further list; added 3 histories to the answer sheet.');
    expect(done.lines).toContain('ADOPTED  GOOD-1  copied criteria/GOOD-1 and cases/GOOD-1; added the ID to the further list; added 3 histories to the answer sheet.');
    expect(done.lines).toContain('What was done:');
    expect(done.lines).toContain('  Adopted: 2. Completed: 0. Skipped: 3. Failed: 0.');

    // The folders are byte for byte the ones of the wave folder.
    for (const id of ['FACT-2', 'GOOD-1']) {
      expect(snapshot(path.join(repo, 'criteria', id))).toEqual(snapshot(path.join(wave, 'criteria', id)));
      expect(snapshot(path.join(repo, 'cases', id))).toEqual(snapshot(path.join(wave, 'cases', id)));
    }
    // Nothing of the three that were skipped came along.
    expect(fs.readdirSync(path.join(repo, 'criteria')).sort()).toEqual(['FACT-2', 'GOOD-1', 'TEN-1', 'active.json']);
    expect(fs.readdirSync(path.join(repo, 'cases')).sort()).toEqual(['FACT-2', 'GOOD-1', 'TEN-1', 'expected.json']);
    // The list: the first ten and the reserves as they were, the two IDs in "further".
    expect(JSON.parse(fs.readFileSync(listFile, 'utf8'))).toEqual({ active: ['TEN-1'], reserves: ['RES-1'], further: ['FACT-2', 'GOOD-1'] });
    // The answer sheet: what was there first, then the six histories as their answer parts give them.
    const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8')) as { signed_by_clinical_reviewer: null; cases: ExpectedCase[] };
    expect(sheet.cases[0]).toEqual(FIRST_TEN_SHEET.cases[0]);
    expect(sheet.cases.map((c) => c.file)).toEqual([
      'TEN-1/pos-brand.csv',
      'FACT-2/pos-fact.csv', 'FACT-2/pos-nofact.csv', 'FACT-2/near-miss.csv',
      'GOOD-1/pos-brand.csv', 'GOOD-1/pos-buried.csv', 'GOOD-1/near-miss.csv',
    ]);
    const part = JSON.parse(fs.readFileSync(path.join(wave, 'cases', 'FACT-2', 'expected.part.json'), 'utf8')) as ExpectedCase[];
    expect(sheet.cases.slice(1, 4)).toEqual(part);
    expect(fs.readFileSync(sheetFile, 'utf8')).toContain('            ["L003", "L004"],\n            ["L001"]');
    // No staging folder or file is left behind.
    expect(Object.keys(snapshot(repo)).some((f) => f.includes('.adopting-'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'cases', 'TEN-1', 'pos-brand.csv'), 'utf8')).toBe('kept as it is\n');
  });

  it('changes nothing when it is run a second time', async () => {
    const { repo, wave, results } = await setUp();
    expect(adopt('--wave', wave, '--results', results, '--repo', repo).code).toBe(0);
    const after = snapshot(repo);
    const again = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(again.code).toBe(0);
    expect(snapshot(repo)).toEqual(after);
    expect(again.lines).toContain('SKIPPED  GOOD-1  already in the repository, in the list and in the answer sheet.');
    expect(again.lines).toContain('  Adopted: 0. Completed: 0. Skipped: 5. Failed: 0.');
  });

  it('never writes over a criterion folder that is already there: it reports it and skips', async () => {
    const { repo, wave, results, listFile } = await setUp();
    writeFile(path.join(repo, 'criteria', 'GOOD-1', 'criterion.json'), '{ "id": "GOOD-1", "label": "An earlier draft" }\n');
    const done = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(done.code).toBe(0);
    expect(done.lines).toContain('SKIPPED  GOOD-1  criteria/GOOD-1 is already in the repository and is not the same. Nothing was written over.');
    expect(fs.readFileSync(path.join(repo, 'criteria', 'GOOD-1', 'criterion.json'), 'utf8')).toBe('{ "id": "GOOD-1", "label": "An earlier draft" }\n');
    expect(fs.existsSync(path.join(repo, 'cases', 'GOOD-1'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(listFile, 'utf8')).further).toEqual(['FACT-2']);
    // A cases folder alone is not written over either.
    const second = await setUp();
    writeFile(path.join(second.repo, 'cases', 'FACT-2', 'pos-fact.csv'), 'something else\n');
    const other = adopt('--wave', second.wave, '--results', second.results, '--repo', second.repo);
    expect(other.lines).toContain('SKIPPED  FACT-2  cases/FACT-2 is already in the repository and is not the same. Nothing was written over.');
    expect(fs.existsSync(path.join(second.repo, 'criteria', 'FACT-2'))).toBe(false);
    expect(fs.readFileSync(path.join(second.repo, 'cases', 'FACT-2', 'pos-fact.csv'), 'utf8')).toBe('something else\n');
  });

  it('completes the list and the sheet when an earlier run was stopped after the copy', async () => {
    const { repo, wave, results, listFile, sheetFile } = await setUp();
    fs.cpSync(path.join(wave, 'criteria', 'GOOD-1'), path.join(repo, 'criteria', 'GOOD-1'), { recursive: true });
    fs.cpSync(path.join(wave, 'cases', 'GOOD-1'), path.join(repo, 'cases', 'GOOD-1'), { recursive: true });
    const done = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(done.code).toBe(0);
    expect(done.lines).toContain('COMPLETED  GOOD-1  the folders were already in the repository, the same files; added the ID to the further list; added 3 histories to the answer sheet.');
    expect(done.lines).toContain('  Adopted: 1. Completed: 1. Skipped: 3. Failed: 0.');
    expect(JSON.parse(fs.readFileSync(listFile, 'utf8')).further).toEqual(['FACT-2', 'GOOD-1']);
    expect((JSON.parse(fs.readFileSync(sheetFile, 'utf8')) as { cases: unknown[] }).cases).toHaveLength(7);
  });

  it('does not adopt a criterion whose files changed after they were scored', async () => {
    const { repo, wave, results, listFile } = await setUp();
    fs.appendFileSync(path.join(wave, 'cases', 'GOOD-1', 'pos-brand.csv'), 'F-GOOD-1,72,F,,2026-04-05,examplol,Examplex,10 mg,tablet,30,2,Take ONE tablet daily,Dr A. Example,,\n');
    const done = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(done.lines).toContain('SKIPPED  GOOD-1  its files are not the files that were scored (cases/GOOD-1/pos-brand.csv). Score the wave folder again.');
    expect(fs.existsSync(path.join(repo, 'criteria', 'GOOD-1'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(listFile, 'utf8')).further).toEqual(['FACT-2']);
  });

  it('makes the answer sheet when it does not exist, and says so', async () => {
    const { repo, wave, results, sheetFile } = await setUp();
    fs.rmSync(sheetFile);
    const before = snapshot(repo);
    const dry = adopt('--wave', wave, '--results', results, '--repo', repo, '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.lines).toContain('Answer sheet: cases/expected.json was not found. A real run would make it, not signed. It would hold the adopted histories only: the histories of the first ten are not in it.');
    expect(dry.lines).toContain('  Histories added to cases/expected.json: 6. The sheet did not exist. It would be made, not signed.');
    expect(snapshot(repo)).toEqual(before);
    const made = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(made.code).toBe(0);
    expect(made.lines).toContain('Answer sheet: cases/expected.json was not found. It is made when a history is added, and it is not signed. It holds the adopted histories only: the histories of the first ten are not in it.');
    expect(made.lines).toContain('  Histories added to cases/expected.json: 6. The sheet did not exist. It was made, not signed.');
    const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8')) as { signed_by_clinical_reviewer: null; cases: ExpectedCase[] };
    expect(sheet.signed_by_clinical_reviewer).toBeNull();
    expect(sheet.cases.map((c) => c.file.split('/')[0])).toEqual(['FACT-2', 'FACT-2', 'FACT-2', 'GOOD-1', 'GOOD-1', 'GOOD-1']);
    // Another sheet can be named. It is made in the same way when it is not there.
    const other = await setUp();
    const named = adopt('--wave', other.wave, '--results', other.results, '--repo', other.repo, '--sheet', 'cases/expected.waves.json');
    expect(named.code).toBe(0);
    expect((JSON.parse(fs.readFileSync(path.join(other.repo, 'cases', 'expected.waves.json'), 'utf8')) as { cases: unknown[] }).cases).toHaveLength(6);
    expect(fs.readFileSync(other.sheetFile, 'utf8')).toBe(`${JSON.stringify(FIRST_TEN_SHEET, null, 2)}\n`);   // the sheet that was not named is left as it was
  });

  it('never changes a signed answer sheet without a word', async () => {
    // A signed sheet is changed only with the clinical reviewer's word.
    const second = await setUp();
    fs.writeFileSync(second.sheetFile, JSON.stringify({ ...FIRST_TEN_SHEET, signed_by_clinical_reviewer: { name: 'A. Reviewer', date: '2026-11-19' } }), 'utf8');
    const kept = snapshot(second.repo);
    const signed = adopt('--wave', second.wave, '--results', second.results, '--repo', second.repo);
    expect(signed.code).toBe(2);
    expect(signed.lines[0]).toBe('The answer sheet cases/expected.json is signed by A. Reviewer on 2026-11-19. A signed sheet is changed only with his word (docs/SPEC.md section 9). Nothing was written. With his word, run this again with --signed-sheet-ok.');
    expect(snapshot(second.repo)).toEqual(kept);
    const allowed = adopt('--wave', second.wave, '--results', second.results, '--repo', second.repo, '--signed-sheet-ok');
    expect(allowed.code).toBe(0);
    const after = JSON.parse(fs.readFileSync(second.sheetFile, 'utf8')) as { signed_by_clinical_reviewer: unknown; cases: unknown[] };
    expect(after.signed_by_clinical_reviewer).toEqual({ name: 'A. Reviewer', date: '2026-11-19' });
    expect(after.cases).toHaveLength(7);
  });

  it('says what it needs, and stops before it writes when it cannot run', async () => {
    const { repo, wave, results } = await setUp();
    const noArgs = adopt();
    expect(noArgs.code).toBe(2);
    expect(noArgs.lines.slice(0, 2)).toEqual(['Give the wave folder: --wave <folder>.', 'Give the results of its wave run: --results <results.json>.']);
    expect(adopt('--help').lines[0]).toBe('Use: node tools/adopt-wave.mjs --wave <folder> --results <results.json of a wave run> [--dry-run]');
    expect(adopt('--wave', wave, '--results', results, '--repo', repo, '--fast').lines[0]).toBe('Unknown option: --fast');

    const before = snapshot(repo);
    const noResults = adopt('--wave', wave, '--results', path.join(repo, 'nowhere.json'), '--repo', repo);
    expect(noResults.code).toBe(2);
    expect(noResults.lines[0]).toContain('The results file was not found:');
    const older = path.join(tempDir('lantern-adopt-old-'), 'results.json');
    fs.writeFileSync(older, JSON.stringify({ format: 'clinicalantern-eval-1', score: {} }), 'utf8');
    expect(adopt('--wave', wave, '--results', older, '--repo', repo).lines[0]).toContain('The results file has no "passing" list.');
    expect(adopt('--wave', path.join(repo, 'no-wave'), '--results', results, '--repo', repo).lines[0]).toContain('The wave folder was not found:');
    expect(adopt('--wave', wave, '--results', results, '--repo', tempDir('lantern-adopt-empty-')).lines[0]).toContain('This is not the repository:');
    expect(snapshot(repo)).toEqual(before);
  });

  it('runs one adoption at a time, and takes over a lock that a stopped run left behind', async () => {
    const { repo, wave, results, listFile } = await setUp();
    const lock = path.join(repo, 'criteria', '.adopt-wave.lock');
    // A lock held by a process that is running: this test itself.
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: '2026-11-18T03:00:00.000Z' }), 'utf8');
    const before = snapshot(repo);
    const refused = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(refused.code).toBe(2);
    expect(refused.lines[0]).toBe(`Another adoption is running (process ${process.pid}, started 2026-11-18T03:00:00.000Z). Wait for it to end, then run this again. Nothing was written.`);
    expect(snapshot(repo)).toEqual(before);
    // A dry run only reads, so it needs no lock.
    expect(adopt('--wave', wave, '--results', results, '--repo', repo, '--dry-run').code).toBe(0);
    expect(snapshot(repo)).toEqual(before);
    // A lock left by a process that is gone is taken over, and no lock stays behind.
    const gone = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    fs.writeFileSync(lock, JSON.stringify({ pid: gone.pid, at: '2026-11-18T03:00:00.000Z' }), 'utf8');
    const done = adopt('--wave', wave, '--results', results, '--repo', repo);
    expect(done.code).toBe(0);
    expect(fs.existsSync(lock)).toBe(false);
    expect(JSON.parse(fs.readFileSync(listFile, 'utf8')).further).toEqual(['FACT-2', 'GOOD-1']);
  });

  it('adopts nothing from results that never scored the wave folder', async () => {
    const { repo, wave } = await setUp();
    const other = path.join(tempDir('lantern-adopt-other-'), 'results.json');
    fs.writeFileSync(other, JSON.stringify({ mode: 'wave', passing: ['ELSE-1'], not_passing: [] }), 'utf8');
    const before = snapshot(repo);
    const done = adopt('--wave', wave, '--results', other, '--repo', repo);
    expect(done.code).toBe(0);
    expect(done.lines).toContain('SKIPPED  GOOD-1  not in these results. The run that wrote them did not score this criterion.');
    expect(done.lines).toContain('  Adopted: 0. Completed: 0. Skipped: 5. Failed: 0.');
    expect(snapshot(repo)).toEqual(before);
  });

  it('says so when the results hold no fingerprints, and still adopts what passed', async () => {
    const { repo, wave } = await setUp();
    const bare = path.join(tempDir('lantern-adopt-bare-'), 'results.json');
    fs.writeFileSync(bare, JSON.stringify({ mode: 'wave', passing: ['GOOD-1'], not_passing: [] }), 'utf8');
    const done = adopt('--wave', wave, '--results', bare, '--repo', repo);
    expect(done.code).toBe(0);
    expect(done.lines).toContain('Note: the results hold no file fingerprints for GOOD-1. It could not be checked that these are the files that were scored.');
    expect(done.lines).toContain('ADOPTED  GOOD-1  copied criteria/GOOD-1 and cases/GOOD-1; added the ID to the further list; added 3 histories to the answer sheet.');
  });
});
