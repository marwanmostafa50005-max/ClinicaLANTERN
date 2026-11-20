// tools/check-cases.mjs checks a wave folder in place. These tests build a small folder
// in a temporary directory. They do not read the repository histories, and they do not
// start the tool. No model is called. tools/adopt-wave.mjs is left alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface WaveItem {
  id: string;
  status: string;
  problems: string[];
  notes: string[];
  histories: number;
  needsFact: boolean;
}

interface CheckCases {
  checkWaveCriterion: (waveDir: string, id: string) => WaveItem;
  checkWaveFolder: (waveDir: string, name?: string) => { name: string; criteria: WaveItem[] };
  verdictLine: (item: WaveItem, all?: boolean) => string;
}

const tool = await import(new URL('./check-cases.mjs', import.meta.url).href) as CheckCases;

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempWave(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-check-cases-'));
  made.push(dir);
  return dir;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const COLUMNS = [
  'patient_ref', 'patient_age', 'patient_sex', 'dispense_date', 'medicine', 'brand',
  'strength', 'form', 'quantity', 'repeats_left', 'directions', 'prescriber'
].join(',');

function supplyRow(medicine: string, brand = '', date = '2026-03-01'): string {
  return `P-01,72,F,${date},${medicine},${brand},5 mg,tablet,28,0,one daily,Dr A`;
}

function historyCsv(rows: string[]): string {
  return `${COLUMNS}\n${rows.join('\n')}\n`;
}

function criterionText(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'TEST-1',
    label: 'Test 1',
    statement: 'A published statement.',
    rule_for_models: 'Suspect when the named medicine is supplied.',
    source: { credit: 'A credit line for the test.' },
    medicine_groups: [{ key: 'A', name: 'The medicine', ingredients: ['warfarin'], brands: {} }],
    ...extra
  });
}

function plant(file: string, findings: unknown[], kind = 'positive', about = 'The named medicine is supplied.'): string {
  return JSON.stringify([{ file, kind, about, findings }]);
}

function item(over: Partial<WaveItem> = {}): WaveItem {
  return {
    id: 'TEST-1',
    status: 'ok',
    problems: [],
    notes: [],
    histories: 1,
    needsFact: false,
    ...over
  };
}

describe('verdictLine', () => {
  it('names a criterion that was not drafted, and an ok one by how many histories it has', () => {
    expect(tool.verdictLine(item({ status: 'not_drafted', histories: 0 }))).toBe('TEST-1  not drafted');
    expect(tool.verdictLine(item())).toBe('TEST-1  ok  (1 history, supplies only)');
    expect(tool.verdictLine(item({ histories: 2, needsFact: true }))).toBe('TEST-1  ok  (2 histories, needs a fact)');
    expect(tool.verdictLine(item({ notes: ['read this'] }))).toBe('TEST-1  ok  (1 history, supplies only, 1 note to read)');
    expect(tool.verdictLine(item({ notes: ['one', 'two'] }))).toBe('TEST-1  ok  (1 history, supplies only, 2 notes to read)');
  });

  it('shows the first three problems, and every problem when asked', () => {
    const problems = ['one', 'two', 'three', 'four'];
    expect(tool.verdictLine(item({ status: 'not_ok', problems }))).toBe(
      'TEST-1  NOT OK  one | two | three | and 1 more (--all shows every one)'
    );
    expect(tool.verdictLine(item({ status: 'not_ok', problems: ['only'] }), true)).toBe('TEST-1  NOT OK  only');
    expect(tool.verdictLine(item({ status: 'not_ok', problems }), true)).toBe('TEST-1  NOT OK  one | two | three | four');
  });
});

describe('checkWaveCriterion', () => {
  it('says a missing folder is not ok, and a note that it was not drafted is not a failure', () => {
    const wave = tempWave();
    const missing = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(missing.status).toBe('not_ok');
    expect(missing.problems).toEqual(['The folder has no criterion.json and no NOT_DRAFTED.md.']);

    write(path.join(wave, 'criteria', 'TEST-1', 'NOT_DRAFTED.md'), 'No published wording was found.\n');
    const drafted = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(drafted.status).toBe('not_drafted');
    expect(drafted.problems).toEqual([]);
    expect(drafted.histories).toBe(0);
  });

  it('names a criterion file that cannot be read, and one that is not an object', () => {
    const wave = tempWave();
    const file = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    write(file, '{');
    const broken = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(broken.status).toBe('not_ok');
    expect(broken.problems[0]).toMatch(/^criterion\.json could not be read\./);

    write(file, '[]');
    const list = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(list.problems).toContain('criterion.json is not a JSON object.');
    expect(list.problems).toContain('cases/TEST-1/expected.part.json was not found.');
  });

  it('names a wrong id, missing text, a group that is not a group, and a fact the file does not describe', () => {
    const wave = tempWave();
    write(path.join(wave, 'criteria', 'TEST-1', 'criterion.json'), JSON.stringify({
      id: 'OTHER',
      source: {},
      medicine_groups: [
        'no',
        { key: 'B', ingredients: 'warfarin', brands: [] },
        { key: 'C', ingredients: ['  '], brands: {} }
      ],
      needs_facts: ['no', { kind: 'dose', what: '  ', meets: '' }]
    }));
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), '[]');
    const result = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(result.needsFact).toBe(true);
    expect(result.problems).toEqual(expect.arrayContaining([
      'criterion.json gives the ID "OTHER", but its folder is named TEST-1.',
      'criterion.json has no "label".',
      'criterion.json has no "statement".',
      'criterion.json has no "rule_for_models".',
      'criterion.json has no credit line (source.credit). A finding is shown with it.',
      'Medicine group A is not an object.',
      'Medicine group B: "ingredients" must be a list of names.',
      'Medicine group B: "brands" must give a list of brand names for each ingredient.',
      'Medicine group C names no medicine.',
      'Needed fact 1 is not an object.',
      'Needed fact 2: "kind" must be condition, result or observation.',
      'Needed fact 2: "what" is missing.',
      'Needed fact 2: "meets" is missing.',
      'expected.part.json lists no history.'
    ]));
  });

  it('names an answer part that is missing, unreadable, or not a list, and one that lists no history', () => {
    const wave = tempWave();
    const criterionFile = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    const partFile = path.join(wave, 'cases', 'TEST-1', 'expected.part.json');
    write(criterionFile, criterionText());
    const missing = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(missing.problems).toEqual(['cases/TEST-1/expected.part.json was not found.']);
    expect(missing.needsFact).toBe(false);

    write(criterionFile, criterionText({
      needs_facts: [{ kind: 'result', what: 'eGFR', meets: 'below 30 mL/min/1.73 m2' }]
    }));
    write(partFile, '{');
    const broken = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(broken.needsFact).toBe(true);
    expect(broken.problems[0]).toMatch(/^expected\.part\.json could not be read\./);

    write(partFile, '{"cases":{}}');
    expect(tool.checkWaveCriterion(wave, 'TEST-1').problems).toEqual(['expected.part.json is not a list of histories.']);

    write(partFile, '{"cases":[]}');
    expect(tool.checkWaveCriterion(wave, 'TEST-1').problems).toEqual(['expected.part.json lists no history.']);
  });

  it('names a history path that is not this criterion, a repeat, and a sheet row the scorer cannot use', () => {
    const wave = tempWave();
    write(path.join(wave, 'criteria', 'TEST-1', 'criterion.json'), criterionText());
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), JSON.stringify([
      { kind: 'positive' },
      { file: 'OTHER/pos.csv', kind: 'positive', about: 'Wrong folder.', findings: [] },
      { file: 'TEST-1/../pos.csv', kind: 'positive', about: 'Leaves the folder.', findings: [] },
      { file: 'TEST-1/pos-one.csv', kind: 'maybe', about: '', findings: 'no' },
      { file: 'TEST-1/pos-one.csv', kind: 'positive', about: 'Again.', findings: [] },
      { file: 'TEST-1/near.csv', kind: 'near_miss', about: 'A near miss.', findings: [{ criterion: 'TEST-1', must_cite: [['L001']] }] },
      { file: 'TEST-1/pos-named.csv', kind: 'clean', about: 'The name says otherwise.', findings: [] },
      { file: 'TEST-1/clean-empty.csv', kind: 'positive', about: 'Nothing planted.', findings: [] }
    ]));
    const problems = tool.checkWaveCriterion(wave, 'TEST-1').problems;
    expect(problems).toEqual(expect.arrayContaining([
      'An entry of expected.part.json has no "file".',
      'expected.part.json names OTHER/pos.csv. A history of this criterion is written as TEST-1/<file>.csv.',
      'expected.part.json names TEST-1/../pos.csv. A history of this criterion is written as TEST-1/<file>.csv.',
      'pos-one.csv: "kind" must be positive, near_miss or clean.',
      'pos-one.csv: it has no "about" sentence.',
      'pos-one.csv: "findings" must be a list.',
      'pos-one.csv: it is listed twice in expected.part.json.',
      'near.csv: it is marked near_miss, but the sheet lists a finding.',
      'pos-named.csv: its name says a finding is planted, but it is marked clean.',
      'clean-empty.csv: it is marked positive, but the sheet lists no finding.'
    ]));
  });

  it('names a missing file, a file that is not CSV, a file the sheet omits, and a sheet with no planted finding', () => {
    const wave = tempWave();
    const casesDir = path.join(wave, 'cases', 'TEST-1');
    write(path.join(wave, 'criteria', 'TEST-1', 'criterion.json'), criterionText());
    write(path.join(casesDir, 'notes.txt'), 'not a history');
    write(path.join(casesDir, 'extra.csv'), historyCsv([supplyRow('warfarin')]));
    write(path.join(casesDir, 'expected.part.json'), JSON.stringify([
      { file: 'TEST-1/gone.csv', kind: 'positive', about: 'Missing.', findings: [{ criterion: 'TEST-1', must_cite: [['L001']] }] },
      { file: 'TEST-1/notes.txt', kind: 'clean', about: 'Not a CSV.', findings: [] }
    ]));
    const result = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(result.problems).toEqual(expect.arrayContaining([
      'gone.csv: the file was not found.',
      'notes.txt: only CSV histories can be scored.',
      'extra.csv: the file is in the folder, but expected.part.json does not list it.',
      'The answer part has no planted finding for this criterion. It cannot pass.'
    ]));
    expect(result.status).toBe('not_ok');
  });

  it('accepts one planted supply, a fact the sheet must cite, and a letter the list does not hold', () => {
    const wave = tempWave();
    const casesDir = path.join(wave, 'cases', 'TEST-1');
    write(path.join(wave, 'criteria', 'TEST-1', 'criterion.json'), '\uFEFF' + criterionText({
      needs_facts: [{ kind: 'Result', what: 'eGFR', meets: 'below 30 mL/min/1.73 m2' }]
    }));
    const factHeader = `${COLUMNS},record_type,detail,value`;
    write(path.join(casesDir, 'pos-fact.csv'), [
      factHeader,
      `${supplyRow('warfarin', 'Coumadin')},dispensed,,`,
      'P-01,72,F,2026-03-02,,,,,,,,,result,eGFR,28'
    ].join('\n') + '\n');
    write(path.join(casesDir, 'pos-nofact.csv'), historyCsv([supplyRow('paracetamol', '', '2026-04-01')]));
    write(path.join(casesDir, 'expected.part.json'), JSON.stringify({
      cases: [
        {
          file: 'TEST-1/pos-fact.csv',
          kind: 'positive',
          about: 'Warfarin is supplied and the record holds a low eGFR.',
          findings: [{ criterion: 'TEST-1', must_cite: [['L001'], ['L002']] }]
        },
        {
          file: 'TEST-1/pos-nofact.csv',
          kind: 'positive',
          about: 'The listed medicine is not supplied.',
          findings: [{ criterion: 'TEST-1', must_cite: [['L001']] }]
        }
      ]
    }));
    const ok = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(ok.status).toBe('ok');
    expect(ok.needsFact).toBe(true);
    expect(ok.histories).toBe(2);
    expect(ok.problems).toEqual([]);
    expect(ok.notes).toEqual([
      'pos-nofact.csv: No medicine listed by TEST-1 is supplied in this history, so the lines the sheet names (L001) were not checked against its list. Read the rule: it is about a medicine that is not supplied.'
    ]);

    write(path.join(casesDir, 'expected.part.json'), plant('TEST-1/pos-fact.csv', [
      { criterion: 'OTHER', must_cite: [['L002']] },
      { must_cite: [['L001']] },
      { criterion: 'TEST-1', must_cite: 'L001' },
      { criterion: 'TEST-1', must_cite: [['L099']] },
      { criterion: 'TEST-1', must_cite: [['L001']] }
    ]));
    const cited = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(cited.status).toBe('not_ok');
    expect(cited.problems).toEqual(expect.arrayContaining([
      'pos-fact.csv: the sheet expects OTHER. A history in this folder is scored for TEST-1 only.',
      'pos-fact.csv: a finding has no "criterion".',
      'pos-fact.csv: "must_cite" must be a list of lists of line IDs.',
      'pos-fact.csv: The sheet names line L099 for TEST-1, but the history has no such line.',
      'pos-fact.csv: it is named pos-fact, but the sheet names no fact line that must be cited.'
    ]));
  });

  it('names groups and facts that are not lists, and a criterion file with no id', () => {
    const wave = tempWave();
    write(path.join(wave, 'criteria', 'TEST-1', 'criterion.json'), JSON.stringify({
      label: 'Test 1',
      statement: 'A published statement.',
      rule_for_models: 'Suspect when the named medicine is supplied.',
      source: { credit: 'A credit line for the test.' },
      medicine_groups: { key: 'A' },
      needs_facts: { kind: 'result' }
    }));
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), '[]');
    const result = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(result.needsFact).toBe(false);
    expect(result.histories).toBe(0);
    expect(result.problems).toEqual([
      'criterion.json gives the ID "", but its folder is named TEST-1.',
      '"medicine_groups" must be a list of groups.',
      '"needs_facts" must be a list of facts.',
      'expected.part.json lists no history.'
    ]);
    expect(tool.verdictLine(item({ histories: 0 }))).toBe('TEST-1  ok  (0 histories, supplies only)');
    expect(tool.verdictLine(item({ status: 'not_ok', problems: ['one', 'two', 'three'] }))).toBe('TEST-1  NOT OK  one | two | three');
  });
});

describe('options and ask_when', () => {
  it('accepts a good shape, and refuses a bad effect and a bad ask_when', () => {
    const wave = tempWave();
    const file = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    const part = path.join(wave, 'cases', 'TEST-1', 'expected.part.json');
    write(file, criterionText({
      needs_facts: [{
        kind: 'condition',
        what: 'Heart failure',
        meets: 'the patient has heart failure',
        options: [
          { words: 'Heart failure', effect: 'meets' },
          { words: 'No heart failure', effect: 'does_not_meet' },
          { words: 'Not known', effect: 'unknown' }
        ],
        ask_when: { group: 'A' }
      }]
    }));
    write(part, '[]');
    const good = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(good.problems.some(note => /options|ask_when/i.test(note))).toBe(false);
    expect(good.problems).toContain('expected.part.json lists no history.');

    write(file, criterionText({
      needs_facts: [{
        kind: 'condition',
        what: 'Heart failure',
        meets: 'present',
        options: [{ words: 'Heart failure', effect: 'maybe' }],
        ask_when: 'sometimes'
      }]
    }));
    const bad = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(bad.problems).toContain('Needed fact 1, option 1: "effect" must be meets, does_not_meet or unknown.');
    expect(bad.problems).toContain('Needed fact 1: "ask_when" must be "always" or an object with "group".');
  });

  it('accepts an unknown field on a needed fact, including close_when', () => {
    const wave = tempWave();
    const file = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    write(file, criterionText({
      needs_facts: [{
        kind: 'condition',
        what: 'Heart failure',
        meets: 'the patient has heart failure',
        ask_when: 'always',
        close_when: { group: 'A' },
        extra: 'not a known field'
      }]
    }));
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), '[]');
    const good = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(good.problems.some(note => /close_when|unknown|extra/i.test(note))).toBe(false);
    expect(good.problems).toEqual(['expected.part.json lists no history.']);

    write(file, criterionText({
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'present', close_when: 'not an object'
      }]
    }));
    const unchecked = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(unchecked.problems.some(note => /close_when/i.test(note))).toBe(false);
  });

  it('accepts only_sex and a close_when month count, and does not read either', () => {
    const wave = tempWave();
    const file = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    write(file, criterionText({
      only_sex: 'female',
      needs_facts: [{
        kind: 'condition', what: 'Heart failure', meets: 'present',
        ask_when: 'always', close_when: { group: 'A', months: 12 }
      }]
    }));
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), '[]');
    const good = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(good.problems.some(note => /only_sex|close_when|months|unknown/i.test(note))).toBe(false);
    expect(good.problems).toEqual(['expected.part.json lists no history.']);

    write(file, criterionText({ only_sex: 'both' }));
    const unchecked = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(unchecked.problems.some(note => /only_sex/i.test(note))).toBe(false);
  });

  it('accepts count_supplies on a criterion and does not ask for it', () => {
    const wave = tempWave();
    const file = path.join(wave, 'criteria', 'TEST-1', 'criterion.json');
    write(file, criterionText({
      count_supplies: { group: 'A', months: 12, window: 'last', form_has: ['inhaler'] }
    }));
    write(path.join(wave, 'cases', 'TEST-1', 'expected.part.json'), '[]');
    const good = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(good.problems.some(note => /count_supplies|unknown|extra/i.test(note))).toBe(false);
    expect(good.problems).toEqual(['expected.part.json lists no history.']);

    write(file, criterionText({
      count_supplies: {
        group: 'A', months: 12, window: 'last', form_has: ['inhaler'],
        packs: [{ form_has: 'capsule', per: 30 }]
      }
    }));
    const packed = tool.checkWaveCriterion(wave, 'TEST-1');
    expect(packed.problems.some(note => /packs|count_supplies|unknown|extra/i.test(note))).toBe(false);
    expect(packed.problems).toEqual(['expected.part.json lists no history.']);
  });
});

describe('checkWaveFolder', () => {
  it('reads each criterion folder, skips a protected name, and uses the folder name', () => {
    const wave = tempWave();
    write(path.join(wave, 'criteria', 'B10', 'NOT_DRAFTED.md'), 'Later.\n');
    write(path.join(wave, 'criteria', 'B2', 'NOT_DRAFTED.md'), 'Later.\n');
    write(path.join(wave, 'criteria', 'sealed-copy', 'criterion.json'), criterionText({ id: 'sealed-copy' }));
    const named = tool.checkWaveFolder(wave, 'W-test');
    expect(named.name).toBe('W-test');
    expect(named.criteria.map(row => row.id)).toEqual(['B2', 'B10']);
    expect(named.criteria.every(row => row.status === 'not_drafted')).toBe(true);

    const bare = tempWave();
    expect(tool.checkWaveFolder(bare)).toEqual({ name: path.basename(bare), criteria: [] });
  });
});
