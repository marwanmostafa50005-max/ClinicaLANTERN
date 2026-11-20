// Unit tests for the runner, with a fake pipeline. No model, no server, made-up histories in a temp folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criterion, ExpectedSheet, Finding, HistoryLine, LanternConfig } from '../shared/types.ts';
import type { EvalResults, Pipeline } from './types.ts';
import { USAGE, folderOf, main, missingPipelineParts, parseArgs, readCase, selectCases, selectCriteria } from './run.ts';
import type { StopSwitch } from './run.ts';
import { AT, expectedCase, letterBody, makeCriterion, planted } from './testkit.ts';

const MARK = String.fromCharCode(0xfeff);   // a byte order mark, as some editors write it
const A = makeCriterion('STOPP-A1');
const B = makeCriterion('STOPP-B2');

const CONFIG: LanternConfig = {
  ollamaBase: 'http://127.0.0.1:27435',
  port: 8787,
  models: { screen: 'fake-screen', check: 'fake-check', letter: 'fake-letter' },
  think: { screen: false, check: false, letter: false },
  numCtx: 16384,
  keepAlive: '20m',
  maxLinesPerCall: 150,
  overlapLines: 30,
  overdueDays: 7,
  pharmacy: {
    name: 'Example Community Pharmacy (fictional)', address: '1 Example Street', phone: '(00) 0000 0000',
    pharmacist: 'Marwan Morsy', pharmacistTitle: 'Pharmacy Manager', registration: 'PHA0002761764'
  },
  modelNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' },
  modelsBehind: { screen: 'Gemma 4 31B', check: 'Qwen 3.8 27B', letter: 'Gemma 4 26B' },
  doctor: { name: 'Dr F. Example (fictional)', practice: 'Example Family Practice' },
};

// ---------- the fake pipeline ----------
// A made-up history file has "patient,<ref>" on its first line and one supply per line after it.
// Marks inside a line tell the fake models what to answer:
//   {screen:ID}  Model 1 suspects criterion ID and cites this line     {screen-fail:ID}  {screen-throw:ID}
//   {check-no:ID}  Model 2 does not confirm     {check-fail:ID}  {check-throw:ID}     {check-cite:ID}  Model 2 cites this line too
//   {letter-template:ID}  {letter-notes:ID}  {letter-throw:ID}  {letter-empty:ID}  {letter-stub:ID}

interface Fake {
  pipeline: Pipeline;
  calls: string[];              // "screen:<patient ref>:<criterion>", in the order the calls were made
  findings: Finding[];          // what draftLetter was given
  afterCall: (() => void) | null;
}

function fakePipeline(criteria: Criterion[]): Fake {
  const fake: Fake = { pipeline: undefined as unknown as Pipeline, calls: [], findings: [], afterCall: null };
  const marked = (lines: HistoryLine[], mark: string, id: string): string[] =>
    lines.filter((l) => l.text.includes(`{${mark}:${id}}`)).map((l) => l.id);
  const has = (lines: HistoryLine[], mark: string, id: string): boolean => marked(lines, mark, id).length > 0;
  const ref = (label: string): string => label.replace('Fictional patient ', '');
  const note = (stage: string, label: string, id: string): void => {
    fake.calls.push(`${stage}:${ref(label)}:${id}`);
    fake.afterCall?.();
  };

  fake.pipeline = {
    loadConfig: () => CONFIG,
    loadCriteria: async () => criteria,
    parseCsv(csvText) {
      const rows = csvText.split(/\r?\n/).filter((r) => r.trim() !== '');
      const first = rows[0] ?? '';
      const lines = rows.slice(1).map((text, i) => ({ id: `L${String(i + 1).padStart(3, '0')}`, text }));
      const problems: string[] = [];
      if (!first.startsWith('patient,')) problems.push('The file has no "dispense_date" column.');
      else if (lines.length === 0) problems.push('The file has no supply rows.');
      if (csvText.includes('BROKEN')) problems.push('No row has a date that can be read.');
      return { patient: { label: `Fictional patient ${first.slice('patient,'.length).trim()}` }, lines, problems };
    },
    async screenCriterion(_cfg, patient, lines, criterion) {
      note('screen', patient.label, criterion.id);
      if (has(lines, 'screen-throw', criterion.id)) throw new Error('boom in the screen step');
      if (has(lines, 'screen-fail', criterion.id)) return { ok: false, error: 'Tried twice. The local model server did not answer.' };
      const lineIds = marked(lines, 'screen', criterion.id);
      return {
        ok: true,
        suspected: lineIds.length > 0,
        result: {
          lineIds,
          medicines: lineIds.length > 0 ? ['examplex'] : [],
          reason: lineIds.length > 0 ? 'A medicine that counts was found.' : 'Nothing matches.',
          linesVerified: lineIds.length > 0,
          missingFacts: [],
          model: 'fake-screen',
          at: AT,
          seconds: 0.01,
        },
      };
    },
    async checkFinding(_cfg, patient, lines, criterion, screen) {
      note('check', patient.label, criterion.id);
      if (has(lines, 'check-throw', criterion.id)) throw new Error('boom in the check step');
      const completed = !has(lines, 'check-fail', criterion.id);
      const confirmed = completed && !has(lines, 'check-no', criterion.id);
      return {
        confirmed,
        lineIds: confirmed ? [...screen.lineIds, ...marked(lines, 'check-cite', criterion.id)] : [],
        whatMatches: completed ? (confirmed ? 'The lines match.' : 'The lines do not match.') : 'The second check did not finish, so this finding is shown without it. Tried twice.',
        whatCannotBeSeen: 'Why it was prescribed.',
        completed,
        model: 'fake-check',
        at: AT,
        seconds: 0.01,
      };
    },
    async draftLetter(_cfg, patient, lines, criterion, finding) {
      note('letter', patient.label, criterion.id);
      fake.findings.push(finding);
      if (has(lines, 'letter-throw', criterion.id)) throw new Error('boom in the letter step');
      const cited = finding.check && finding.check.lineIds.length > 0 ? finding.check.lineIds : finding.screen.lineIds;
      const shown = lines.filter((l) => cited.includes(l.id)).map((l) => l.text);
      const template = has(lines, 'letter-template', criterion.id);
      let body = letterBody(criterion, shown);
      if (has(lines, 'letter-empty', criterion.id)) body = '';
      if (has(lines, 'letter-stub', criterion.id)) body = 'Fictional patient. No real person.\n\nThe letter could not be built. Please write it by hand.';
      let checkNotes: string[] = [];
      if (template) checkNotes = ['First draft: The date 3 March 2026 is not in the finding.', 'Both drafts failed the checks.'];
      if (has(lines, 'letter-notes', criterion.id)) checkNotes = ['The letter was drafted again. The second draft passed the checks.'];
      return {
        subject: `Request for a medicines review: ${criterion.title}`,
        body,
        origin: template ? 'template' : 'model',
        checkNotes,
        model: 'fake-letter',
        at: AT,
        seconds: 0.01,
      };
    },
    transcribePageImage: async () => ({ ok: false, error: 'The scorer does not read page images.' }),
    checkLetterFacts: () => [],
  };
  return fake;
}

// ---------- a made-up repository in a temp folder ----------

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function history(ref: string, ...lines: string[]): string {
  return [`patient,${ref}`, ...lines].join('\n') + '\n';
}

const plain = (n: number): string => `2026-01-${String(n).padStart(2, '0')} | Otherol 5 mg tablet | qty 30`;

// Seven histories: A1 passes with a false flag and a template letter. B2 misses one and has a failed call.
const FILES: Record<string, string> = {
  'STOPP-A1/pos-brand.csv': history('A1-BRAND', plain(1), plain(2), '2026-03-05 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}', '2026-03-06 | Samplol 5 mg tablet | qty 30 {screen:STOPP-A1}'),
  'STOPP-A1/pos-buried.csv': history('A1-BURIED', plain(1), plain(2), plain(3), '2026-04-01 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1} {letter-template:STOPP-A1}', plain(5), plain(6)),
  'STOPP-A1/near-miss.csv': history('A1-NEAR', plain(1), '2025-01-02 | Examplex 200 mg capsule | qty 30 {screen:STOPP-A1}'),
  'STOPP-B2/pos-brand.csv': history('B2-BRAND', '2026-05-01 | Testazol 10 mg tablet | qty 30 {screen:STOPP-B2}', plain(2)),
  'STOPP-B2/pos-buried.csv': history('B2-BURIED', plain(1), '2026-05-02 | Testazol 10 mg tablet | qty 30', plain(3)),
  'STOPP-B2/near-miss.csv': history('B2-NEAR', '2024-05-01 | Testazol 10 mg tablet | qty 30 {screen:STOPP-B2} {check-no:STOPP-B2}'),
  '_clean/clean-1.csv': history('CLEAN-1', `${plain(1)} {screen-fail:STOPP-B2}`, plain(2)),
};

const SHEET: ExpectedSheet = {
  signed_by_clinical_reviewer: null,
  cases: [
    expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L003'], ['L004'])], 'Brand name only.'),
    expectedCase('STOPP-A1/pos-buried.csv', 'positive', [planted('STOPP-A1', ['L004'])], 'Buried in the middle.'),
    expectedCase('STOPP-A1/near-miss.csv', 'near_miss', [], 'Stopped a year before.'),
    expectedCase('STOPP-B2/pos-brand.csv', 'positive', [planted('STOPP-B2', ['L001'])], 'Brand name only.'),
    expectedCase('STOPP-B2/pos-buried.csv', 'positive', [planted('STOPP-B2', ['L002'])], 'Buried in the middle.'),
    expectedCase('STOPP-B2/near-miss.csv', 'near_miss', [], 'Two years old.'),
    expectedCase('_clean/clean-1.csv', 'clean', [], 'Nothing to find.'),
  ],
};

function makeRepo(files: Record<string, string> = FILES, sheet: unknown = SHEET): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-eval-run-'));
  tempDirs.push(root);
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, 'cases', file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  fs.mkdirSync(path.join(root, 'cases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cases', 'expected.json'), JSON.stringify(sheet, null, 2), 'utf8');
  return root;
}

interface Ran {
  code: number;
  log: string[];
  out: string;
  fake: Fake;
  results: () => EvalResults;
  table: () => string;
}

async function run(
  root: string,
  argv: string[] = [],
  criteria: Criterion[] = [A, B],
  setup?: (fake: Fake, stop: StopSwitch) => void,
  onLog?: (line: string, readTable: () => string) => void,
): Promise<Ran> {
  const fake = fakePipeline(criteria);
  const stop: StopSwitch = { requested: false };
  setup?.(fake, stop);
  const log: string[] = [];
  const out = path.join(root, 'out');
  let ms = 0;
  const code = await main(fake.pipeline, ['--out', out, ...argv], {
    repoRoot: root,
    cwd: root,
    log: (line) => {
      log.push(line);
      onLog?.(line, () => {
        const table = path.join(out, 'table.md');
        return fs.existsSync(table) ? fs.readFileSync(table, 'utf8') : '';
      });
    },
    now: () => new Date(2026, 10, 18, 14, 5, 10),
    timer: () => (ms += 500),   // a made-up timer: every call takes half a second
    stop,
  });
  return {
    code,
    log,
    out,
    fake,
    results: () => JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) as EvalResults,
    table: () => fs.readFileSync(path.join(out, 'table.md'), 'utf8'),
  };
}

function verdicts(results: EvalResults): Record<string, string> {
  return Object.fromEntries(results.score.criteria.map((s) => [s.criterionId, s.verdict]));
}

// ---------- the tests ----------

describe('a full run with a fake pipeline', () => {
  it('batches by stage: every screen call first, then every check, then the letters', async () => {
    const ran = await run(makeRepo());
    const stages = ran.fake.calls.map((c) => c.split(':')[0]);
    expect(stages.slice(0, 14).every((s) => s === 'screen')).toBe(true);
    expect(stages.slice(14, 19).every((s) => s === 'check')).toBe(true);
    expect(stages.slice(19).every((s) => s === 'letter')).toBe(true);
    expect(ran.fake.calls).toHaveLength(22);

    // Inside the screen stage: all criteria for one history, then the next history.
    expect(ran.fake.calls.slice(0, 4)).toEqual([
      'screen:A1-BRAND:STOPP-A1',
      'screen:A1-BRAND:STOPP-B2',
      'screen:A1-BURIED:STOPP-A1',
      'screen:A1-BURIED:STOPP-B2',
    ]);
    expect(ran.fake.calls.slice(14, 19)).toEqual([
      'check:A1-BRAND:STOPP-A1',
      'check:A1-BURIED:STOPP-A1',
      'check:A1-NEAR:STOPP-A1',
      'check:B2-BRAND:STOPP-B2',
      'check:B2-NEAR:STOPP-B2',
    ]);
    // A letter only for a caught planted finding. Not for the false flag.
    expect(ran.fake.calls.slice(19)).toEqual(['letter:A1-BRAND:STOPP-A1', 'letter:A1-BURIED:STOPP-A1', 'letter:B2-BRAND:STOPP-B2']);
  });

  it('scores the run and ends with code 1 when a criterion failed', async () => {
    const ran = await run(makeRepo());
    expect(ran.code).toBe(1);
    const results = ran.results();
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'PASS', 'STOPP-B2': 'FAIL' });
    const [a, b] = results.score.criteria;
    expect(a).toMatchObject({ planted: 2, caught: 2, turnedBack: 0 });
    expect(a.falseFlags.map((f) => f.caseFile)).toEqual(['STOPP-A1/near-miss.csv']);
    expect(a.letters).toEqual({ needed: 2, produced: 2, modelClean: 1, modelWithNotes: 0, template: 1, notProduced: 0, withoutPlanted: 0 });
    expect(b).toMatchObject({ planted: 2, caught: 1, turnedBack: 1 });
    expect(b.misses.map((m) => [m.caseFile, m.why])).toEqual([['STOPP-B2/pos-buried.csv', 'not_suspected']]);
    expect(b.notCompleted.map((n) => [n.caseFile, n.stage, n.planted])).toEqual([['_clean/clean-1.csv', 'screen', false]]);
    // Seconds: with the made-up timer every call takes half a second.
    expect(a.calls).toEqual({ screen: 7, check: 3, letter: 2 });
    expect(a.secondsByStage).toEqual({ screen: 3.5, check: 1.5, letter: 1 });
    expect(a.seconds).toBe(6);
    expect(b.calls).toEqual({ screen: 7, check: 2, letter: 1 });
    expect(b.seconds).toBe(5);
    expect(results.score.totals.seconds).toBe(11);
    expect(results.partRun).toBe(false);
    expect(results.stoppedEarly).toBeNull();
    expect(results.stamp).toBe('20261118-140510');
    expect(results.sheet).toMatchObject({ path: 'cases/expected.json', caseCount: 7, signed_by_clinical_reviewer: null, warnings: [] });
    expect(results.settings.models).toEqual(CONFIG.models);
    expect(results.criteria.map((c) => c.statement)).toEqual([A.statement, B.statement]);
    expect(results.cases.map((c) => c.caseId)).toEqual(['C0001', 'C0002', 'C0003', 'C0004', 'C0005', 'C0006', 'C0007']);
    expect(results.cases[0].lines).toHaveLength(4);
  });

  it('writes the table, the results and the raw answers', async () => {
    const ran = await run(makeRepo());
    const table = ran.table();
    expect(table).toContain('| STOPP A1 | PASS | 2 / 2 | 0 | yes | 1 | 0 | 2 of 2: 1 by the model, 1 from the template |');
    expect(table).toContain('| STOPP B2 | FAIL | 1 / 2 | 0 | yes | 0 | 1 | 1 of 1: 1 by the model |');
    expect(table).toContain('- **STOPP B2** on `STOPP-B2/pos-buried.csv`. Mantle did not suspect it.');
    expect(table).toContain('    - `L002: 2026-05-02 | Testazol 10 mg tablet | qty 30`');
    expect(table).toContain('- **STOPP A1** on `STOPP-A1/near-miss.csv`, the near miss written for this criterion.');
    expect(table).toContain('  - Check note: "First draft: The date 3 March 2026 is not in the finding."');
    expect(table).not.toContain('This is a part run');
    expect(fs.readdirSync(path.join(ran.out, 'raw', 'screen'))).toHaveLength(14);
    expect(fs.readdirSync(path.join(ran.out, 'raw', 'check'))).toHaveLength(5);
    expect(fs.readdirSync(path.join(ran.out, 'raw', 'letter'))).toHaveLength(6);
    const raw = JSON.parse(fs.readFileSync(path.join(ran.out, 'raw', 'check', 'STOPP-B2__near-miss.csv__STOPP-B2.json'), 'utf8'));
    expect(raw).toMatchObject({ stage: 'check', status: 'not_confirmed', findingId: 'F0005', answer: { confirmed: false, completed: true } });
  });

  it('prints one progress line per call and a summary', async () => {
    const ran = await run(makeRepo());
    expect(ran.log.filter((l) => l.startsWith('[screen '))).toHaveLength(14);
    expect(ran.log.filter((l) => l.startsWith('[check '))).toHaveLength(5);
    expect(ran.log.filter((l) => l.startsWith('[letter '))).toHaveLength(3);
    expect(ran.log).toContain('[screen 1/14] STOPP-A1/pos-brand.csv | STOPP-A1: suspected, lines L003 L004 (0.5 s)');
    expect(ran.log).toContain('[screen 2/14] STOPP-A1/pos-brand.csv | STOPP-B2: nothing suspected (0.5 s)');
    expect(ran.log).toContain('[screen 14/14] _clean/clean-1.csv | STOPP-B2: COULD NOT BE SCREENED. Tried twice. The local model server did not answer. (0.5 s)');
    expect(ran.log).toContain('[check 5/5] STOPP-B2/near-miss.csv | STOPP-B2: not confirmed (0.5 s)');
    expect(ran.log).toContain('[letter 2/3] STOPP-A1/pos-buried.csv | STOPP-A1: built from the template (0.5 s)');
    expect(ran.log).toContain('Criteria that PASS: 1 of 2. FAIL: 1.');
    expect(ran.log).toContain('  PASS  STOPP-A1: caught 2 of 2, false flags 1, failed calls 0, letters 2 of 2: 1 by the model, 1 from the template.');
    expect(ran.log).toContain('  FAIL  STOPP-B2: caught 1 of 2, false flags 0, failed calls 1, letters 1 of 1: 1 by the model. Missed 1 of 2 planted findings.');
    expect(ran.log).toContain(`Table: ${path.join(ran.out, 'table.md')}`);
    expect(ran.log.join('\n').includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it('says now and then how long the rest of a stage may take', async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 13; i++) files[`_clean/clean-${i}.csv`] = history(`CLEAN-${i}`, plain(1), plain(2));
    const sheet = { signed_by_clinical_reviewer: null, cases: Object.keys(files).map((file) => expectedCase(file, 'clean')) };
    const ran = await run(makeRepo(files, sheet));
    expect(ran.log.filter((l) => l.startsWith('[screen '))).toHaveLength(26);
    const at = ran.log.indexOf('  25 of 26 done. About 1 s left in this stage.');
    expect(at).toBeGreaterThan(0);
    expect(ran.log[at - 1].startsWith('[screen 25/26] ')).toBe(true);
    expect(ran.log.filter((l) => l.includes('left in this stage'))).toHaveLength(1);
    expect(verdicts(ran.results())).toEqual({ 'STOPP-A1': 'NOT_TESTED', 'STOPP-B2': 'NOT_TESTED' });
    expect(ran.code).toBe(0);
  });

  it('gives the letter step an accepted finding with both model answers', async () => {
    const ran = await run(makeRepo());
    const first = ran.fake.findings[0];
    expect(first).toMatchObject({
      id: 'F0001',
      caseId: 'C0001',
      criterionId: 'STOPP-A1',
      state: 'accepted',
      screen: { lineIds: ['L003', 'L004'] },
      check: { confirmed: true, completed: true, lineIds: ['L003', 'L004'] },
      decision: { action: 'accept' },
    });
    expect(ran.fake.findings.map((f) => f.id)).toEqual(['F0001', 'F0002', 'F0004']);
  });

  it('ends with code 0 when every criterion passes', async () => {
    const ran = await run(makeRepo(), [], [A]);
    expect(ran.code).toBe(0);
    expect(verdicts(ran.results())).toEqual({ 'STOPP-A1': 'PASS' });
    expect(ran.fake.calls.filter((c) => c.endsWith(':STOPP-B2'))).toEqual([]);
    // Planted findings for a criterion that is not active are named, not scored.
    expect(ran.results().sheet.warnings).toEqual([
      'STOPP-B2/pos-brand.csv: the sheet expects STOPP-B2, but that criterion is not in the active list. It is not scored.',
      'STOPP-B2/pos-buried.csv: the sheet expects STOPP-B2, but that criterion is not in the active list. It is not scored.',
    ]);
    expect(ran.log).toContain('Things to look at in the answer sheet: 2. They are listed in the table.');
  });
});

describe('a failed call never stops the run and is never a clean result', () => {
  it('records calls that fail or throw at every stage and carries on', async () => {
    const files = {
      'STOPP-A1/throw-screen.csv': history('S-THROW', `${plain(1)} {screen-throw:STOPP-A1}`),
      'STOPP-A1/throw-check.csv': history('C-THROW', `${plain(1)} {screen:STOPP-A1} {check-throw:STOPP-A1}`),
      'STOPP-A1/fail-check.csv': history('C-FAIL', `${plain(1)} {screen:STOPP-A1} {check-fail:STOPP-A1}`),
      'STOPP-A1/throw-letter.csv': history('L-THROW', `${plain(1)} {screen:STOPP-A1} {letter-throw:STOPP-A1}`),
      'STOPP-A1/empty-letter.csv': history('L-EMPTY', `${plain(1)} {screen:STOPP-A1} {letter-empty:STOPP-A1}`),
      'STOPP-A1/stub-letter.csv': history('L-STUB', `${plain(1)} {screen:STOPP-A1} {letter-stub:STOPP-A1}`),
      'STOPP-A1/good.csv': history('GOOD', `${plain(1)} {screen:STOPP-A1} {letter-notes:STOPP-A1}`),
    };
    const sheet = {
      signed_by_clinical_reviewer: null,
      cases: Object.keys(files).map((file) => expectedCase(file, 'positive', [planted('STOPP-A1', ['L001'])])),
    };
    const ran = await run(makeRepo(files, sheet), [], [A]);
    expect(ran.code).toBe(1);
    expect(ran.fake.calls).toHaveLength(7 + 6 + 4);

    const results = ran.results();
    const byFile = Object.fromEntries(results.pairs.map((p) => [p.caseFile.split('/')[1], p]));
    expect(byFile['throw-screen.csv'].screen).toMatchObject({ status: 'failed', error: 'The screen call stopped with an error. boom in the screen step' });
    expect(byFile['throw-check.csv'].check).toMatchObject({ status: 'not_completed', error: 'The check call stopped with an error. boom in the check step' });
    expect(byFile['fail-check.csv'].check).toMatchObject({ status: 'not_completed' });
    expect(byFile['fail-check.csv'].check?.error).toContain('The second check did not finish');
    expect(byFile['throw-letter.csv'].letter).toMatchObject({ status: 'not_produced', error: 'The letter call stopped with an error. boom in the letter step' });
    expect(byFile['empty-letter.csv'].letter).toMatchObject({ status: 'not_produced', error: 'The letter call gave no letter text.' });
    expect(byFile['stub-letter.csv'].letter?.status).toBe('not_produced');
    expect(byFile['good.csv'].letter).toMatchObject({ status: 'model_with_notes', observations: [] });

    const [a] = results.score.criteria;
    expect(a.verdict).toBe('FAIL');
    expect(a).toMatchObject({ planted: 7, caught: 4, notCompletedOnPlanted: 6 });
    expect(a.misses.map((m) => m.why).sort()).toEqual(['check_not_completed', 'check_not_completed', 'could_not_be_screened']);
    expect(a.letters).toEqual({ needed: 4, produced: 1, modelClean: 0, modelWithNotes: 1, template: 0, notProduced: 3, withoutPlanted: 0 });
    expect(a.notCompleted.map((n) => n.stage).sort()).toEqual(['check', 'check', 'letter', 'letter', 'letter', 'screen']);
    expect(ran.log).toContain('[check 2/6] STOPP-A1/fail-check.csv | STOPP-A1: SECOND CHECK NOT COMPLETED. The second check did not finish, so this finding is shown without it. Tried twice. (0.5 s)');
    expect(ran.log).toContain('[letter 1/4] STOPP-A1/throw-letter.csv | STOPP-A1: NO LETTER. The letter call stopped with an error. boom in the letter step (0.5 s)');
    expect(ran.log).toContain('[letter 4/4] STOPP-A1/good.csv | STOPP-A1: written by the model, 1 check note (0.5 s)');
  });

  it('says so once when several calls in a row fail', async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 4; i++) files[`STOPP-A1/down-${i}.csv`] = history(`DOWN-${i}`, `${plain(1)} {screen-fail:STOPP-A1}`);
    const sheet = { signed_by_clinical_reviewer: null, cases: Object.keys(files).map((file) => expectedCase(file, 'clean')) };
    const ran = await run(makeRepo(files, sheet), [], [A]);
    expect(ran.fake.calls).toHaveLength(4);
    expect(ran.log.filter((l) => l.startsWith('Three calls in a row could not be completed.'))).toHaveLength(1);
    const [a] = ran.results().score.criteria;
    expect(a.verdict).toBe('NOT_TESTED');
    expect(a.notCompleted).toHaveLength(4);
    expect(ran.code).toBe(0);
  });

  it('does not screen a history that cannot be read, and never calls it clean', async () => {
    const files = {
      ...FILES,
      'STOPP-A1/pos-brand.csv': history('A1-BRAND', 'BROKEN'),
      'STOPP-B2/notes.txt': 'not a history',
    };
    delete (files as Record<string, string>)['STOPP-A1/pos-buried.csv'];
    const sheet = { ...SHEET, cases: [...SHEET.cases, expectedCase('STOPP-B2/notes.txt', 'clean')] };
    const ran = await run(makeRepo(files, sheet));
    expect(ran.code).toBe(1);
    expect(ran.fake.calls.filter((c) => c.includes(':A1-BRAND:') || c.includes(':A1-BURIED:'))).toEqual([]);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toHaveLength(10);

    const results = ran.results();
    const unread = results.cases.filter((c) => c.cannotAssess !== null).map((c) => [c.file, c.cannotAssess]);
    expect(unread).toEqual([
      ['STOPP-A1/pos-brand.csv', 'The CSV reader reported a problem. No row has a date that can be read.'],
      ['STOPP-A1/pos-buried.csv', 'The file was not found.'],
      ['STOPP-B2/notes.txt', 'Only CSV histories can be scored.'],
    ]);
    const [a] = results.score.criteria;
    expect(a.verdict).toBe('FAIL');
    expect(a).toMatchObject({ planted: 2, caught: 0, notCompletedOnPlanted: 2 });
    expect(a.misses.map((m) => m.why)).toEqual(['history_not_read', 'history_not_read']);
    expect(a.notCompleted.map((n) => n.stage)).toEqual(['import', 'import', 'import']);
    expect(ran.log).toContain('Not screened: STOPP-A1/pos-buried.csv. The file was not found.');
    expect(ran.table()).toContain('- STOPP-A1/pos-buried.csv: the history was not screened. The file was not found.');
    // No raw file is written for a call that was never made.
    expect(fs.existsSync(path.join(ran.out, 'raw', 'screen', 'STOPP-A1__pos-buried.csv__STOPP-A1.json'))).toBe(false);
  });

  it('stops after the current call when asked, writes what it has, and ends with code 2', async () => {
    const ran = await run(makeRepo(), [], [A, B], (fake, stop) => {
      fake.afterCall = () => {
        if (fake.calls.length === 5) stop.requested = true;
      };
    });
    expect(ran.code).toBe(2);
    expect(ran.fake.calls).toHaveLength(5);
    const results = ran.results();
    expect(results.stoppedEarly).toBe('It was stopped before every call was made.');
    expect(results.pairs.filter((p) => p.screen.status === 'not_run')).toHaveLength(9);
    // The finding suspected before the stop has a check that was never run. It is not a catch.
    expect(results.pairs[0].check).toMatchObject({ status: 'not_run' });
    expect(verdicts(results)).toEqual({ 'STOPP-A1': 'FAIL', 'STOPP-B2': 'FAIL' });
    expect(ran.table()).toContain('**This run stopped early.** It was stopped before every call was made. Do not use it for sign-off.');
    expect(ran.log.some((l) => l.startsWith('Stopped early after '))).toBe(true);
  });
});

describe('a forced stop', () => {
  it('writes what there is at once, and leaves the call that was running as not run', async () => {
    const ran = await run(makeRepo(), [], [A, B], (fake, stop) => {
      fake.afterCall = () => {
        // As a second Ctrl+C would: the third call is still running when the results are written.
        if (fake.calls.length === 3) stop.writeNow?.();
      };
    });
    expect(ran.code).toBe(2);
    const results = ran.results();
    expect(results.stoppedEarly).toBe('It was stopped while a call was running. That call and the calls after it were not recorded.');
    expect(results.pairs.map((p) => p.screen.status).slice(0, 4)).toEqual(['suspected', 'clear', 'not_run', 'not_run']);
    expect(results.pairs.filter((p) => p.screen.status === 'not_run')).toHaveLength(12);
    expect(results.score.totals.fail).toBe(2);
    expect(ran.table()).toContain('**This run stopped early.**');
    // The results are written once. What happens after the forced stop does not change them.
    expect(ran.log.filter((l) => l.startsWith('Table: '))).toHaveLength(1);
  });
});

describe('options', () => {
  it('--only runs one criterion on every history', async () => {
    const ran = await run(makeRepo(), ['--only', 'stopp b2']);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toHaveLength(7);
    expect(ran.fake.calls.every((c) => c.endsWith(':STOPP-B2'))).toBe(true);
    const results = ran.results();
    expect(verdicts(results)).toEqual({ 'STOPP-B2': 'FAIL' });
    expect(results.partRun).toBe(true);
    expect(results.options).toEqual({ only: ['STOPP-B2'], cases: [], limit: null, letters: true, sheet: null });
    expect(ran.table()).toContain('Options used: `--only STOPP-B2`.');
    expect(results.activeCriteria).toEqual(['STOPP-A1', 'STOPP-B2']);
    expect(results.score.unscored.map((u) => u.criterionId)).toEqual(['STOPP-A1', 'STOPP-A1']);
    expect(ran.table()).toContain('**This is a part run.**');
    expect(ran.log).toContain('This was a part run. It is not a sign-off run.');
  });

  it('--only refuses a criterion that is not active', async () => {
    const root = makeRepo();
    const ran = await run(root, ['--only', 'STOPP-Z9']);
    expect(ran.code).toBe(2);
    expect(ran.log).toEqual(['Not in the active list: STOPP-Z9. The active criteria are: STOPP-A1, STOPP-B2.']);
    expect(ran.fake.calls).toEqual([]);
    expect(fs.existsSync(ran.out)).toBe(false);
  });

  it('--cases keeps the histories of the folders that match', async () => {
    const one = await run(makeRepo(), ['--cases', 'STOPP-A1'], [A]);
    expect(one.results().cases.map((c) => c.file)).toEqual(['STOPP-A1/pos-brand.csv', 'STOPP-A1/pos-buried.csv', 'STOPP-A1/near-miss.csv']);
    expect(one.results().partRun).toBe(true);
    expect(one.code).toBe(0);
    const part = await run(makeRepo(), ['--cases', 'stopp']);
    expect(part.results().cases).toHaveLength(6);
    const two = await run(makeRepo(), ['--cases', '_clean,STOPP-B2']);
    expect(two.results().cases.map((c) => c.folder)).toEqual(['STOPP-B2', 'STOPP-B2', 'STOPP-B2', '_clean']);
    const none = await run(makeRepo(), ['--cases', 'nothing-like-this']);
    expect(none.code).toBe(2);
    expect(none.log).toEqual(['No history matched. The folders in the answer sheet are: STOPP-A1, STOPP-B2, _clean.']);
  });

  it('--limit keeps the first n histories and the result is not a full pass', async () => {
    const ran = await run(makeRepo(), ['--limit', '1'], [A]);
    expect(ran.fake.calls).toEqual(['screen:A1-BRAND:STOPP-A1', 'check:A1-BRAND:STOPP-A1', 'letter:A1-BRAND:STOPP-A1']);
    const [a] = ran.results().score.criteria;
    expect(a).toMatchObject({ verdict: 'PASS_PART', planted: 1, plantedInSheet: 2, caught: 1 });
    expect(ran.table()).toContain('| STOPP A1 | PASS (part run) | 1 / 1 |');
    expect(ran.code).toBe(0);
  });

  it('--no-letters skips Model 3 and the result is not a full pass', async () => {
    const ran = await run(makeRepo(), ['--no-letters'], [A]);
    expect(ran.fake.calls.filter((c) => c.startsWith('letter:'))).toEqual([]);
    expect(ran.log).toContain('Stage 3 of 3. Letters were skipped (--no-letters).');
    const results = ran.results();
    expect(results.score.lettersRun).toBe(false);
    expect(results.score.criteria[0]).toMatchObject({ verdict: 'PASS_PART', caveats: ['Letters were not run.'] });
    expect(ran.table()).toContain('| STOPP A1 | PASS (part run) | 2 / 2 | 0 | yes | 1 | 0 | not run |');
    expect(ran.code).toBe(0);
  });

  it('--sheet reads another answer sheet', async () => {
    const root = makeRepo();
    const other = { signed_by_clinical_reviewer: { name: 'A. Reviewer', date: '2026-11-19' }, cases: [SHEET.cases[0]] };
    fs.writeFileSync(path.join(root, 'cases', 'other.json'), `${MARK}${JSON.stringify(other)}`, 'utf8');
    const ran = await run(root, ['--sheet', 'cases/other.json'], [A]);
    expect(ran.code).toBe(0);
    const results = ran.results();
    expect(results.sheet).toMatchObject({ path: 'cases/other.json', caseCount: 1, signed_by_clinical_reviewer: { name: 'A. Reviewer', date: '2026-11-19' } });
    expect(results.options.sheet).toBe('cases/other.json');
    expect(results.score.criteria[0].verdict).toBe('PASS');
    expect(ran.log).toContain('Answer sheet: cases/other.json. Signed by A. Reviewer on 2026-11-19.');
    expect(ran.table()).toContain('Signed by A. Reviewer on 2026-11-19.');

    const missing = await run(root, ['--sheet', 'cases/nowhere.json'], [A]);
    expect(missing.code).toBe(2);
    expect(missing.log).toEqual(['The answer sheet was not found: cases/nowhere.json']);

    // A sheet from somewhere else is named by its file name only: no folder of this computer in the results.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-eval-sheet-'));
    tempDirs.push(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'my-sheet.json'), JSON.stringify(other), 'utf8');
    const out = path.join(root, 'out-outside');
    const code = await main(fakePipeline([A]).pipeline, ['--sheet', path.join(elsewhere, 'my-sheet.json'), '--out', out], {
      repoRoot: root,
      cwd: root,
      log: () => {},
    });
    expect(code).toBe(0);
    const saved = fs.readFileSync(path.join(out, 'results.json'), 'utf8');
    expect((JSON.parse(saved) as EvalResults).sheet.path).toBe('my-sheet.json (a file outside the repository)');
    expect(saved.includes(elsewhere)).toBe(false);
    expect(saved.includes(root)).toBe(false);
    expect(fs.readFileSync(path.join(out, 'table.md'), 'utf8').includes(root)).toBe(false);
  });

  it('refuses an answer sheet with a mistake, and reads nothing outside the cases folder', async () => {
    const sheet = { signed_by_clinical_reviewer: null, cases: [{ file: '../outside/secret.csv', kind: 'clean', about: 'x', findings: [] }] };
    const root = makeRepo({}, sheet);
    fs.mkdirSync(path.join(root, 'outside'));
    fs.writeFileSync(path.join(root, 'outside', 'secret.csv'), history('SECRET', plain(1)), 'utf8');
    const ran = await run(root, [], [A]);
    expect(ran.code).toBe(2);
    expect(ran.log).toEqual(['The answer sheet has a mistake. Fix it first.\n  ../outside/secret.csv: it must not use "..".']);
    expect(ran.fake.calls).toEqual([]);
  });

  it('uses eval/results/<date and time> when no folder is given, and never reuses it', async () => {
    const root = makeRepo(FILES, { ...SHEET, cases: [SHEET.cases[0]] });
    const env = { repoRoot: root, cwd: root, log: (): void => {}, now: (): Date => new Date(2026, 10, 18, 14, 5, 10) };
    expect(await main(fakePipeline([A]).pipeline, [], env)).toBe(0);
    expect(await main(fakePipeline([A]).pipeline, [], env)).toBe(0);
    expect(fs.readdirSync(path.join(root, 'eval', 'results')).sort()).toEqual(['20261118-140510', '20261118-140510-2']);
    expect(fs.existsSync(path.join(root, 'eval', 'results', '20261118-140510', 'table.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'eval', 'results', '20261118-140510-2', 'results.json'))).toBe(true);
  });

  it('--check reads the sheet and the histories, calls no model and writes nothing', async () => {
    const good = await run(makeRepo(), ['--check']);
    expect(good.code).toBe(0);
    expect(good.fake.calls).toEqual([]);
    expect(fs.existsSync(good.out)).toBe(false);
    expect(good.log).toEqual([
      'ClinicaLANTERN scorer. Check only. No model is called and nothing is written.',
      'Answer sheet: cases/expected.json. Not signed by the clinical reviewer yet.',
      'Histories: 7 of 7. Criteria: 2 of 2.',
      'Planted findings for each criterion, in this run and in the whole answer sheet:',
      '  STOPP-A1: 2 of 2.',
      '  STOPP-B2: 2 of 2.',
      'A run would make 14 screen calls, then one check for each suspected finding.',
      'Nothing needs a look.',
    ]);

    const files = { ...FILES, 'STOPP-A1/pos-brand.csv': history('A1-BRAND', 'BROKEN') };
    const sheet = { ...SHEET, cases: [...SHEET.cases.slice(0, 3), expectedCase('STOPP-A1/extra.csv', 'positive', [planted('STOPP-A1', ['L009'])])] };
    const noCredit = makeCriterion('STOPP-B2', { source: { ...B.source, credit: '' } });
    const bad = await run(makeRepo(files, sheet), ['--check'], [A, noCredit]);
    expect(bad.code).toBe(1);
    expect(bad.fake.calls).toEqual([]);
    expect(fs.existsSync(bad.out)).toBe(false);
    expect(bad.log.slice(3)).toEqual([
      'Cannot be screened: STOPP-A1/pos-brand.csv. The CSV reader reported a problem. No row has a date that can be read.',
      'Cannot be screened: STOPP-A1/extra.csv. The file was not found.',
      'Planted findings for each criterion, in this run and in the whole answer sheet:',
      '  STOPP-A1: 3 of 3.',
      '  STOPP-B2: 0 of 0. The answer sheet has no planted finding for it. It cannot pass. The criterion file has no credit line.',
      'A run would make 4 screen calls, then one check for each suspected finding.',
      'Things that need a look: 4.',
    ]);

    const lines = await run(makeRepo(FILES, { ...SHEET, cases: [expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L099'])])] }), ['--check'], [A]);
    expect(lines.code).toBe(1);
    expect(lines.log).toContain('Answer sheet: STOPP-A1/pos-brand.csv: the sheet names line L099 for STOPP-A1, but the history has no such line.');
  });

  it('never writes over earlier results', async () => {
    const root = makeRepo(FILES, { ...SHEET, cases: [SHEET.cases[0]] });
    const first = await run(root, [], [A]);
    expect(first.code).toBe(0);
    const before = first.table();
    const second = await run(root, [], [A]);
    expect(second.code).toBe(2);
    expect(second.log).toEqual([`The folder already holds results: ${path.join(root, 'out')}. Give --out a new folder.`]);
    expect(second.fake.calls).toEqual([]);
    expect(first.table()).toBe(before);
  });

  it('shows the help text, and refuses options it does not know', async () => {
    const fake = fakePipeline([A]);
    const log: string[] = [];
    expect(await main(fake.pipeline, ['--help'], { log: (l) => log.push(l) })).toBe(0);
    expect(log).toEqual([USAGE]);
    log.length = 0;
    expect(await main(fake.pipeline, ['--fast'], { log: (l) => log.push(l) })).toBe(2);
    expect(log[0]).toBe('Unknown option: --fast');
    expect(fake.calls).toEqual([]);
  });

  it('refuses a pipeline that lacks a function it needs', async () => {
    expect(missingPipelineParts(fakePipeline([A]).pipeline)).toEqual([]);
    expect(missingPipelineParts({ loadConfig: () => CONFIG })).toEqual(['loadCriteria', 'parseCsv', 'screenCriterion', 'checkFinding', 'draftLetter']);
    expect(missingPipelineParts(null)).toHaveLength(6);
    const log: string[] = [];
    expect(await main({} as Pipeline, [], { log: (l) => log.push(l) })).toBe(2);
    expect(log).toEqual(['The scorer cannot run. The pipeline does not have: loadConfig, loadCriteria, parseCsv, screenCriterion, checkFinding, draftLetter.']);
  });
});

describe('answer sheet checks during a run', () => {
  it('warns when the sheet names a line the history does not have', async () => {
    const sheet = { ...SHEET, cases: [expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L003'], ['L004', 'L044'])])] };
    const ran = await run(makeRepo(FILES, sheet), [], [A]);
    expect(ran.results().sheet.warnings).toEqual(['STOPP-A1/pos-brand.csv: the sheet names line L044 for STOPP-A1, but the history has no such line.']);
    expect(ran.table()).toContain('## Things to look at');
    expect(ran.code).toBe(0);
  });

  it('counts a catch only when the planted lines are cited, by either model', async () => {
    const files = {
      'STOPP-A1/wrong-lines.csv': history('WRONG', `${plain(1)} {screen:STOPP-A1}`, '2026-03-05 | Examplex 200 mg capsule | qty 30'),
      'STOPP-A1/check-cites.csv': history('CHECK', `${plain(1)} {screen:STOPP-A1}`, '2026-03-05 | Examplex 200 mg capsule | qty 30 {check-cite:STOPP-A1}'),
    };
    const sheet = {
      signed_by_clinical_reviewer: null,
      cases: Object.keys(files).map((file) => expectedCase(file, 'positive', [planted('STOPP-A1', ['L002'])])),
    };
    const ran = await run(makeRepo(files, sheet), [], [A]);
    const [a] = ran.results().score.criteria;
    expect(a).toMatchObject({ verdict: 'FAIL', planted: 2, caught: 1 });
    expect(a.misses).toHaveLength(1);
    expect(a.misses[0]).toMatchObject({
      caseFile: 'STOPP-A1/wrong-lines.csv',
      why: 'planted_lines_not_cited',
      missingGroups: [['L002']],
      citedByScreen: ['L001'],
      citedByCheck: ['L001'],
    });
    expect(a.catches[0]).toMatchObject({ caseFile: 'STOPP-A1/check-cites.csv', citedByScreen: ['L001'], citedByCheck: ['L001', 'L002'] });
    // A confirmed finding on the right history with the wrong lines is a miss. It is not a false flag.
    expect(a.falseFlags).toEqual([]);
    expect(ran.fake.calls.filter((c) => c.startsWith('letter:'))).toEqual(['letter:CHECK:STOPP-A1']);
  });

  it('scores the first ten in full when the loader also returns further criteria', async () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: ['EU7-F01'],
    }), 'utf8');
    const further = makeCriterion('EU7-F01');
    const ran = await run(root, [], [A, B, further]);
    expect(ran.code).toBe(1);
    const screens = ran.fake.calls.filter((c) => c.startsWith('screen:'));
    const tenScreens = screens.filter((c) => c.endsWith(':STOPP-A1') || c.endsWith(':STOPP-B2'));
    expect(tenScreens).toHaveLength(14);
    for (const ref of ['A1-BRAND', 'A1-BURIED', 'A1-NEAR', 'B2-BRAND', 'B2-BURIED', 'B2-NEAR', 'CLEAN-1']) {
      expect(tenScreens.filter((c) => c.startsWith(`screen:${ref}:`)).sort()).toEqual([
        `screen:${ref}:STOPP-A1`,
        `screen:${ref}:STOPP-B2`,
      ]);
    }
    // A further criterion with no history of its own is not screened on the ten's histories.
    expect(screens.filter((c) => c.endsWith(':EU7-F01'))).toHaveLength(0);
    expect(ran.results().sheet.warnings).toContain('Histories of further criteria were not run against the ten.');
    expect(ran.results().sheet.path).toBe('cases/expected.json');
    const table = ran.table();
    expect(table).toContain('## THE FIRST TEN: FULL RUN');
    expect(table).toContain('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)');
    expect(table).toContain('Count: 1 of 2 pass the planted-finding test. Signed by the clinical reviewer: 0 of 2.');
    expect(table).toContain('1 of 1 further criteria were scored. 0 were not reached.');
    expect(ran.results().score.criteria.map((s) => [s.criterionId, s.verdict])).toEqual([
      ['STOPP-A1', 'PASS'],
      ['STOPP-B2', 'FAIL'],
      ['EU7-F01', 'NOT_TESTED'],
    ]);
    expect(ran.log).toContain('The first ten are written. FURTHER CRITERIA: NOT RUN YET.');
  });

  it('leaves the table of the first ten when it is stopped before the further criteria', async () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: ['EU7-F01'],
    }), 'utf8');
    const ran = await run(root, [], [A, B, makeCriterion('EU7-F01')], (_fake, stop) => {
      stop.beforeFurther = (): void => {
        stop.requested = true;
      };
    });
    expect(ran.code).toBe(2);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toHaveLength(14);
    expect(ran.fake.calls.filter((c) => c.endsWith(':EU7-F01'))).toEqual([]);
    const table = ran.table();
    expect(table).toContain('## THE FIRST TEN: FULL RUN');
    expect(table).toContain('## FURTHER CRITERIA: NOT RUN YET');
    expect(table).toContain('| STOPP A1 | PASS |');
    expect(table).toContain('| STOPP B2 | FAIL |');
    expect(table).not.toContain('EU7-F01');
    expect(ran.results().stoppedEarly).toContain('stopped');
  });

  it('scores a further history against its own criterion and not against the ten', async () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'cases', 'EU7-F01'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cases', 'EU7-F01', 'pos.csv'), history('EU', `${plain(1)} {screen:EU7-F01}`), 'utf8');
    fs.writeFileSync(path.join(root, 'cases', 'expected.further.json'), JSON.stringify({
      signed_by_clinical_reviewer: null,
      cases: [expectedCase('EU7-F01/pos.csv', 'positive', [planted('EU7-F01', ['L001'])])],
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: ['EU7-F01'],
    }), 'utf8');
    const ran = await run(root, [], [A, B, makeCriterion('EU7-F01')]);
    const screens = ran.fake.calls.filter((c) => c.startsWith('screen:'));
    expect(screens.filter((c) => c.endsWith(':STOPP-A1') || c.endsWith(':STOPP-B2'))).toHaveLength(14);
    expect(screens.filter((c) => c.startsWith('screen:EU:'))).toEqual(['screen:EU:EU7-F01']);
    const euAt = ran.fake.calls.indexOf('screen:EU:EU7-F01');
    expect(ran.fake.calls.slice(0, euAt).some((c) => c.startsWith('check:'))).toBe(true);
    expect(ran.fake.calls.slice(euAt).some((c) => c.endsWith(':STOPP-A1') || c.endsWith(':STOPP-B2'))).toBe(false);
    expect(ran.results().sheet.path).toBe('cases/expected.json and cases/expected.further.json');
    expect(ran.results().sheet.warnings).toContain('1 history of further criteria was not run against the ten.');
    expect(ran.results().score.criteria.find((s) => s.criterionId === 'EU7-F01')).toMatchObject({ verdict: 'PASS', caught: 1, planted: 1 });
    expect(ran.table()).toContain('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)');
  });

  it('screens a planted finding that sits in the other list, and leaves a _demo history out', async () => {
    const files = {
      'EU7-F01/pos.csv': history('EU', `${plain(1)} {screen:EU7-F01}`, `${plain(2)} {screen:STOPP-A1}`),
      'STOPP-A1/pos-brand.csv': history('A1', `${plain(3)} {screen:STOPP-A1}`, `${plain(4)} {screen:EU7-F01}`),
      '_demo/tour.csv': history('DEMO', `${plain(5)} {screen:STOPP-A1}`),
    };
    const sheet = {
      signed_by_clinical_reviewer: null,
      cases: [
        expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L001']), planted('EU7-F01', ['L002'])]),
        expectedCase('_demo/tour.csv', 'positive', [planted('STOPP-A1', ['L001'])]),
      ],
    };
    const root = makeRepo(files, sheet);
    fs.writeFileSync(path.join(root, 'cases', 'expected.further.json'), JSON.stringify({
      signed_by_clinical_reviewer: null,
      cases: [expectedCase('EU7-F01/pos.csv', 'positive', [planted('EU7-F01', ['L001']), planted('STOPP-A1', ['L002'])])],
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: ['EU7-F01'],
    }), 'utf8');
    const ran = await run(root, [], [A, B, makeCriterion('EU7-F01')]);
    expect(ran.fake.calls).toContain('screen:EU:STOPP-A1');
    expect(ran.fake.calls).toContain('screen:A1:EU7-F01');
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:EU:')).sort()).toEqual(['screen:EU:EU7-F01', 'screen:EU:STOPP-A1']);
    expect(ran.fake.calls).not.toContain('screen:EU:STOPP-B2');
    expect(ran.fake.calls.filter((c) => c.includes(':DEMO:'))).toEqual([]);
    const euTen = ran.fake.calls.indexOf('screen:EU:STOPP-A1');
    const euOwn = ran.fake.calls.indexOf('screen:EU:EU7-F01');
    const brandFurther = ran.fake.calls.indexOf('screen:A1:EU7-F01');
    expect(euOwn).toBeGreaterThan(euTen);
    expect(brandFurther).toBeGreaterThan(euOwn);
    const table = ran.table();
    const furtherAt = table.indexOf('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)');
    expect(table.indexOf('## THE FIRST TEN: FULL RUN')).toBeGreaterThanOrEqual(0);
    expect(furtherAt).toBeGreaterThan(table.indexOf('## THE FIRST TEN: FULL RUN'));
    expect(table.slice(0, furtherAt)).not.toContain('EU7-F01');
    expect(table.slice(furtherAt)).toContain('EU7-F01');
  });

  it('writes the table again after every 20 further criteria', async () => {
    const further = Array.from({ length: 21 }, (_, i) => makeCriterion(`EU7-F${String(i + 1).padStart(2, '0')}`));
    const root = makeRepo();
    const extra = further.map((criterion, i) => {
      const file = `${criterion.id}/pos.csv`;
      fs.mkdirSync(path.join(root, 'cases', criterion.id), { recursive: true });
      fs.writeFileSync(path.join(root, 'cases', file), history(`F${i + 1}`, plain(1)), 'utf8');
      return expectedCase(file, 'near_miss');
    });
    fs.writeFileSync(path.join(root, 'cases', 'expected.further.json'), JSON.stringify({
      signed_by_clinical_reviewer: null,
      cases: extra,
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: further.map((criterion) => criterion.id),
    }), 'utf8');
    const midway: string[] = [];
    const ran = await run(root, ['--no-letters'], [A, B, ...further], undefined, (line, readTable) => {
      if (line.startsWith('Written again.')) midway.push(readTable());
    });
    expect(ran.log.filter((l) => l.startsWith('Written again.'))).toEqual(['Written again. 20 of 21 further criteria are scored.']);
    expect(midway).toHaveLength(1);
    const partial = midway[0];
    const furtherAt = partial.indexOf('## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)');
    const tenAt = partial.indexOf('## THE FIRST TEN: FULL RUN');
    expect(tenAt).toBeGreaterThanOrEqual(0);
    expect(furtherAt).toBeGreaterThan(tenAt);
    expect(partial.slice(0, furtherAt)).not.toContain('EU7-F01');
    expect(partial).toContain('20 of 21 further criteria were scored. 1 were not reached.');
    expect(partial).toContain('Count: 1 of 2 pass the planted-finding test. Signed by the clinical reviewer: 0 of 2.');
    expect(partial).not.toContain('of 20 pass');
    expect(ran.table()).toContain('21 of 21 further criteria were scored. 0 were not reached.');
    const screens = ran.fake.calls.filter((c) => c.startsWith('screen:'));
    expect(screens.findIndex((c) => c.endsWith(':EU7-F21'))).toBeGreaterThan(screens.findIndex((c) => c.endsWith(':EU7-F20')));
  });
});

describe('quick mode and the further answer sheet', () => {
  it('leaves a history in _demo out of a quick run and says how many', async () => {
    const files = { ...FILES, '_demo/tour.csv': history('DEMO', plain(1)) };
    const sheet = { ...SHEET, cases: [...SHEET.cases, expectedCase('_demo/tour.csv', 'near_miss')] };
    const ran = await run(makeRepo(files, sheet), ['--quick']);
    expect(ran.fake.calls.filter((c) => c.includes(':DEMO:'))).toEqual([]);
    expect(ran.results().sheet.warnings).toContain(
      '1 history was left out of this run, because no criterion in the run is planned for it: _demo/tour.csv.',
    );
    expect(ran.table()).toContain('1 history was left out of this run');
  });

  it('treats a nested folder as the criterion named in its path', async () => {
    const files = {
      '_fresh/STOPP-A1/pos.csv': history('FRESH', plain(1)),
      '_clean/clean-1.csv': history('CLEAN-1', plain(1)),
    };
    const sheet = {
      signed_by_clinical_reviewer: null,
      cases: [expectedCase('_fresh/STOPP-A1/pos.csv', 'near_miss'), expectedCase('_clean/clean-1.csv', 'clean')],
    };
    const ran = await run(makeRepo(files, sheet), ['--quick', '--no-sample'], [A, B]);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:FRESH:'))).toEqual(['screen:FRESH:STOPP-A1']);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:CLEAN-1:')).sort()).toEqual(['screen:CLEAN-1:STOPP-A1', 'screen:CLEAN-1:STOPP-B2']);
    expect(folderOf('a\\b\\c.csv')).toBe('a/b');
  });

  it('lets --only name a further criterion', async () => {
    const files = { 'EU7-F01/pos.csv': history('EU', `${plain(1)} {screen:EU7-F01}`) };
    const sheet = { signed_by_clinical_reviewer: null, cases: [expectedCase('EU7-F01/pos.csv', 'positive', [planted('EU7-F01', ['L001'])])] };
    const root = makeRepo(files, sheet);
    fs.mkdirSync(path.join(root, 'criteria'), { recursive: true });
    fs.writeFileSync(path.join(root, 'criteria', 'active.json'), JSON.stringify({
      active: ['STOPP-A1', 'STOPP-B2'],
      reserves: [],
      further: ['EU7-F01'],
    }), 'utf8');
    const ran = await run(root, ['--quick', '--only', 'EU7-F01', '--no-sample'], [A, B, makeCriterion('EU7-F01')]);
    expect(ran.code).toBe(0);
    expect(ran.fake.calls.filter((c) => c.startsWith('screen:'))).toEqual(['screen:EU:EU7-F01']);
  });

  it('reads cases/expected.further.json and keeps the ten\'s row when a file is in both', async () => {
    const root = makeRepo();
    const missing = await run(root, ['--check']);
    expect(missing.code).toBe(0);
    expect(missing.log.some((line) => line.includes('expected.further.json'))).toBe(false);

    fs.writeFileSync(path.join(root, 'cases', 'expected.further.json'), '{', 'utf8');
    const broken = await run(root, ['--check']);
    expect(broken.code).toBe(2);
    expect(broken.log[0]).toContain('cases/expected.further.json');

    fs.writeFileSync(path.join(root, 'cases', 'expected.further.json'), JSON.stringify({
      signed_by_clinical_reviewer: null,
      cases: [
        expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L001'])]),
        expectedCase('EU7-F01/pos.csv', 'near_miss'),
      ],
    }), 'utf8');
    fs.mkdirSync(path.join(root, 'cases', 'EU7-F01'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cases', 'EU7-F01', 'pos.csv'), history('EU', plain(1)), 'utf8');
    const merged = await run(root, ['--check']);
    expect(merged.log).toContain('Answer sheet: cases/expected.json and cases/expected.further.json. Not signed by the clinical reviewer yet.');
    expect(merged.log).toContain('Answer sheet: STOPP-A1/pos-brand.csv: it is in both answer sheets. The row in cases/expected.json is kept.');
    expect(merged.log).toContain('  STOPP-A1: 2 of 2.');
  });

  it('gives each of the ten the same caught-of-planted in a quick run as in a full run', async () => {
    const full = await run(makeRepo());
    const quick = await run(makeRepo(), ['--quick']);
    const take = (ran: Ran): Record<string, { verdict: string; caught: number; planted: number }> =>
      Object.fromEntries(ran.results().score.criteria.map((s) => [s.criterionId, { verdict: s.verdict, caught: s.caught, planted: s.planted }]));
    expect(take(quick)).toEqual(take(full));
    expect(take(full)).toEqual({
      'STOPP-A1': { verdict: 'PASS', caught: 2, planted: 2 },
      'STOPP-B2': { verdict: 'FAIL', caught: 1, planted: 2 },
    });
  });
});

describe('reading the options', () => {
  it('reads every option', () => {
    const parsed = parseArgs(['--only', 'STOPP-A1,STOPP-B2', '--cases', '_clean', '--out', 'x/y', '--limit', '5', '--no-letters', '--sheet', 'cases/other.json']);
    expect(parsed.errors).toEqual([]);
    expect(parsed.help).toBe(false);
    expect(parsed.options).toEqual({ only: ['STOPP-A1', 'STOPP-B2'], cases: ['_clean'], limit: 5, letters: false, sheet: 'cases/other.json', out: 'x/y', check: false });
    expect(parseArgs(['--check']).options.check).toBe(true);
  });

  it('has sensible defaults', () => {
    expect(parseArgs([]).options).toEqual({ only: [], cases: [], limit: null, letters: true, sheet: null, out: null, check: false });
  });

  it('reads --name=value and repeated options', () => {
    const parsed = parseArgs(['--only=STOPP-A1', '--only', 'STOPP-B2', '--limit=3']);
    expect(parsed.errors).toEqual([]);
    expect(parsed.options.only).toEqual(['STOPP-A1', 'STOPP-B2']);
    expect(parsed.options.limit).toBe(3);
  });

  it('reports what is wrong', () => {
    expect(parseArgs(['--only']).errors).toEqual(['Option --only needs a criterion ID, for example --only STOPP-C10.']);
    expect(parseArgs(['--only', '--no-letters']).errors).toHaveLength(1);
    expect(parseArgs(['--limit', 'many']).errors).toEqual(['Option --limit needs a whole number, 1 or more.']);
    expect(parseArgs(['--limit', '0']).errors).toHaveLength(1);
    expect(parseArgs(['--limit', '2.5']).errors).toHaveLength(1);
    expect(parseArgs(['--out']).errors).toEqual(['Option --out needs a folder.']);
    expect(parseArgs(['--sheet']).errors).toEqual(['Option --sheet needs the path of an answer sheet.']);
    expect(parseArgs(['--cases', ',']).errors).toHaveLength(1);
    expect(parseArgs(['--no-letters=yes']).errors).toEqual(['Option --no-letters takes no value.']);
    expect(parseArgs(['extra']).errors).toEqual(['Unknown option: extra']);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

describe('choosing criteria and histories', () => {
  it('finds a criterion by its ID or its label', () => {
    expect(selectCriteria([A, B], [])).toEqual({ selected: [A, B], unknown: [] });
    expect(selectCriteria([A, B], ['stopp-b2']).selected).toEqual([B]);
    expect(selectCriteria([A, B], ['STOPP B2', 'STOPP_A1']).selected).toEqual([A, B]);   // kept in the active order
    expect(selectCriteria([A, B], ['STOPP-B', 'X']).unknown).toEqual(['STOPP-B', 'X']);
  });

  it('knows the folder of a history', () => {
    expect(folderOf('STOPP-A1/pos-brand.csv')).toBe('STOPP-A1');
    expect(folderOf('a\\b\\c.csv')).toBe('a/b');
    expect(folderOf('loose.csv')).toBe('');
  });

  it('picks a folder by its full name, or every folder that holds the text', () => {
    const cases = [
      expectedCase('STOPP-C1/pos.csv', 'positive'),
      expectedCase('STOPP-C10/pos.csv', 'positive'),
      expectedCase('START-A2/pos.csv', 'positive'),
      expectedCase('_clean/c.csv', 'clean'),
    ];
    const files = (filters: string[], limit: number | null = null): string[] => selectCases(cases, filters, limit).map((c) => c.file);
    expect(files([])).toHaveLength(4);
    expect(files(['STOPP-C1'])).toEqual(['STOPP-C1/pos.csv']);                       // a full folder name: that folder only
    expect(files(['stopp'])).toEqual(['STOPP-C1/pos.csv', 'STOPP-C10/pos.csv']);    // part of a name
    expect(files(['_clean', 'START'])).toEqual(['START-A2/pos.csv', '_clean/c.csv']);
    expect(files([], 2)).toEqual(['STOPP-C1/pos.csv', 'STOPP-C10/pos.csv']);
    expect(files(['st'], 1)).toEqual(['STOPP-C1/pos.csv']);
    expect(files(['nope'])).toEqual([]);
  });
});

describe('reading one history', () => {
  it('reads the file through the pipeline reader and drops a byte order mark', () => {
    const root = makeRepo({ 'STOPP-A1/bom.csv': `${MARK}${history('BOM', plain(1), plain(2))}` });
    const read = readCase(fakePipeline([A]).pipeline, path.join(root, 'cases'), expectedCase('STOPP-A1/bom.csv', 'clean'), 4);
    expect(read).toMatchObject({ caseId: 'C0005', folder: 'STOPP-A1', cannotAssess: null, problems: [], patient: { label: 'Fictional patient BOM' } });
    expect(read.lines.map((l) => l.id)).toEqual(['L001', 'L002']);
  });

  it('gives a reason when the history cannot be used', () => {
    const root = makeRepo({ 'STOPP-A1/empty.csv': 'patient,EMPTY\n', 'STOPP-A1/odd.csv': 'no header\n' });
    const casesDir = path.join(root, 'cases');
    const pipeline = fakePipeline([A]).pipeline;
    expect(readCase(pipeline, casesDir, expectedCase('STOPP-A1/empty.csv', 'clean'), 0).cannotAssess).toBe('The CSV reader reported a problem. The file has no supply rows.');
    expect(readCase(pipeline, casesDir, expectedCase('STOPP-A1/odd.csv', 'clean'), 0).cannotAssess).toBe('The CSV reader reported a problem. The file has no "dispense_date" column.');
    expect(readCase(pipeline, casesDir, expectedCase('STOPP-A1/gone.csv', 'clean'), 0).cannotAssess).toBe('The file was not found.');
    expect(readCase(pipeline, casesDir, expectedCase('cases/STOPP-A1/empty.csv', 'clean'), 0).cannotAssess).toBe(
      'The file was not found. Write the path from inside the cases folder, without "cases/" at the start.',
    );
    expect(readCase(pipeline, casesDir, expectedCase('../cases-other/x.csv', 'clean'), 0).cannotAssess).toBe('The file is not inside the cases folder.');
    const throwing = { ...pipeline, parseCsv: () => { throw new Error('bad reader'); } };
    expect(readCase(throwing, casesDir, expectedCase('STOPP-A1/empty.csv', 'clean'), 0).cannotAssess).toBe('The CSV reader stopped with an error. bad reader');
    const odd = { ...pipeline, parseCsv: () => ({ lines: [{ id: 1 }] }) } as unknown as Pipeline;
    expect(readCase(odd, casesDir, expectedCase('STOPP-A1/empty.csv', 'clean'), 0).cannotAssess).toBe('The CSV reader gave an answer the scorer cannot use.');
  });
});
