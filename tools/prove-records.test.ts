// tools/prove-records.mjs runs histories on the real models. These tests do not.
// They name what a history is expected to show, and how that result is judged.
// No model is called.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface Expectation {
  want: string;
  words: string;
}

interface JudgeRow {
  error?: string;
  suspected: boolean;
  possible: boolean;
  check: { completed: boolean; confirmed: boolean; unclear?: boolean } | null;
  cited: string[];
  criterionId: string;
  entry: { kind?: string; about?: string; file?: string; findings?: { criterion: string; must_cite?: string[][] }[] };
  expect: Expectation;
}

interface Proof {
  expectationOf: (entry: JudgeRow['entry']) => Expectation;
  groupsNotCited: (entry: JudgeRow['entry'], criterionId: string, cited: string[]) => string[][];
  judge: (row: JudgeRow) => { ok: boolean; why: string };
  checkWords: (row: Pick<JudgeRow, 'suspected' | 'check'>) => string;
  cell: (text: unknown) => string;
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'prove-records.mjs');
const proof = await import(new URL('./prove-records.mjs', import.meta.url).href) as Proof;
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function row(over: Partial<JudgeRow> = {}): JudgeRow {
  return {
    suspected: false,
    possible: false,
    check: null,
    cited: [],
    criterionId: 'STOPP-E1',
    entry: { findings: [{ criterion: 'STOPP-E1', must_cite: [['L001', 'L002']] }] },
    expect: { want: 'none', words: 'no finding' },
    ...over
  };
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.on('data', chunk => { out += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe('prove-records', () => {
  it('reads what the answer part expects', () => {
    expect(proof.expectationOf({ kind: 'near_miss' })).toEqual({ want: 'none', words: 'no finding' });
    expect(proof.expectationOf({ kind: 'clean' })).toEqual({ want: 'none', words: 'no finding' });
    expect(proof.expectationOf({ about: 'Possible finding: the eGFR is not on the record' }).want).toBe('possible');
    expect(proof.expectationOf({ file: 'stopp-e1-nofact.csv' }).want).toBe('possible');
    expect(proof.expectationOf({ kind: 'positive', about: 'The finding is planted.' })).toEqual({
      want: 'finding',
      words: 'a confirmed finding with the planted lines'
    });
  });

  it('keeps a planted group only when none of its lines were cited', () => {
    const entry = {
      findings: [
        { criterion: 'STOPP-E1', must_cite: [['l001', 'L002'], ['L009']] },
        { criterion: 'OTHER', must_cite: [['L003']] }
      ]
    };
    expect(proof.groupsNotCited(entry, 'STOPP-E1', ['L001'])).toEqual([['L009']]);
    expect(proof.groupsNotCited(entry, 'STOPP-E1', ['l001'])).toEqual([['l001', 'L002'], ['L009']]);
  });

  it('judges a clear history, a turned-back suspicion, and a false flag', () => {
    expect(proof.judge(row())).toEqual({ ok: true, why: 'Model 1 suspected nothing.' });
    expect(proof.judge(row({
      suspected: true,
      check: { completed: true, confirmed: false, unclear: false }
    }))).toEqual({ ok: true, why: 'Model 1 suspected it and Model 2 turned it back.' });
    expect(proof.judge(row({
      suspected: true,
      check: { completed: true, confirmed: true }
    }))).toEqual({ ok: false, why: 'A false flag: it was confirmed.' });
    expect(proof.judge(row({
      suspected: true,
      check: { completed: true, confirmed: false, unclear: true }
    }))).toEqual({ ok: false, why: 'A false flag: it reached the bell without a plain yes.' });
    expect(proof.judge(row({ error: 'The history could not be read.' }))).toEqual({
      ok: false,
      why: 'The history could not be read.'
    });
  });

  it('judges a confirmed finding and a possible finding by the planted lines', () => {
    const confirmed = row({
      suspected: true,
      possible: false,
      check: { completed: true, confirmed: true },
      cited: ['L001'],
      expect: { want: 'finding', words: 'a confirmed finding with the planted lines' }
    });
    expect(proof.judge(confirmed)).toEqual({ ok: true, why: 'Confirmed, with the planted lines.' });
    expect(proof.judge({ ...confirmed, cited: [] }).ok).toBe(false);
    expect(proof.judge({ ...confirmed, possible: true })).toEqual({
      ok: false,
      why: 'Confirmed with the planted lines, but marked as a possible finding though the record holds the fact.'
    });
    expect(proof.judge({ ...confirmed, suspected: false })).toEqual({ ok: false, why: 'Missed: Model 1 suspected nothing.' });

    const possible = row({
      suspected: true,
      possible: true,
      check: { completed: true, confirmed: false, unclear: true },
      cited: ['L001'],
      expect: { want: 'possible', words: 'a possible finding at the bell' }
    });
    expect(proof.judge(possible)).toEqual({
      ok: true,
      why: 'At the bell as a possible finding, without a plain yes from Model 2.'
    });
    expect(proof.judge({ ...possible, check: { completed: true, confirmed: true } })).toEqual({
      ok: true,
      why: 'Confirmed as a possible finding.'
    });
    expect(proof.judge({ ...possible, possible: false }).why).toContain('It was not marked as a possible finding.');
  });

  it('names the double-check in a few words, and flattens a table cell', () => {
    expect(proof.checkWords(row())).toBe('-');
    expect(proof.checkWords(row({ suspected: true, check: null }))).toBe('not run');
    expect(proof.checkWords(row({ suspected: true, check: { completed: false, confirmed: false } }))).toBe('not completed');
    expect(proof.checkWords(row({ suspected: true, check: { completed: true, confirmed: true } }))).toBe('yes');
    expect(proof.checkWords(row({ suspected: true, check: { completed: true, confirmed: false, unclear: true } }))).toBe('unclear');
    expect(proof.checkWords(row({ suspected: true, check: { completed: true, confirmed: false, unclear: false } }))).toBe('no');
    expect(proof.cell('  a | b \n c  ')).toBe('a / b c');
  });

  it('turns a possible finding back, names planted lines that were not cited, and a second check that never ran', () => {
    expect(proof.expectationOf({ about: '  possible finding of a low eGFR' }).want).toBe('possible');
    expect(proof.groupsNotCited({}, 'STOPP-E1', ['L001'])).toEqual([]);

    expect(proof.judge(row({ suspected: true, check: null }))).toEqual({
      ok: true,
      why: 'Model 1 suspected it and Model 2 turned it back.'
    });
    expect(proof.judge(row({
      suspected: true,
      check: { completed: false, confirmed: false }
    }))).toEqual({ ok: false, why: 'A false flag: it reached the bell without a plain yes.' });

    const possible = row({
      suspected: true,
      possible: true,
      check: { completed: true, confirmed: false, unclear: false },
      cited: ['L001'],
      expect: { want: 'possible', words: 'a possible finding at the bell' }
    });
    expect(proof.judge(possible)).toEqual({
      ok: false,
      why: 'Model 2 turned the possible finding back.'
    });
    expect(proof.judge({
      ...possible,
      check: { completed: true, confirmed: false, unclear: true },
      cited: []
    }).why).toBe('Planted lines not cited: L001/L002.');

    expect(proof.judge(row({
      suspected: true,
      check: { completed: true, confirmed: false },
      cited: [],
      expect: { want: 'finding', words: 'a confirmed finding with the planted lines' }
    }))).toEqual({
      ok: false,
      why: 'Not confirmed by Model 2. Planted lines not cited: L001/L002.'
    });
  });

  it('does not call a model when the file is imported', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/prove-records.mjs'"], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const timer = setTimeout(() => child.kill(), 8000);
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    clearTimeout(timer);
    expect(code).toBe(0);
    expect(out).not.toContain('Stage 1');
    expect(out).not.toContain('Model 1');
  });

  it('lists nothing and calls no model when the wave folder is empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-prove-records-'));
    made.push(dir);
    const result = await run(['--list', '--waves', dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('');
  });

  it('keeps a near miss as no finding even when the file name says nofact, and an empty planted group stays missing', () => {
    expect(proof.expectationOf({ kind: 'near_miss', file: 'x-nofact.csv' })).toEqual({ want: 'none', words: 'no finding' });
    expect(proof.expectationOf({ file: 'X-NOFACT.csv' }).want).toBe('possible');
    expect(proof.expectationOf({}).want).toBe('finding');
    expect(proof.groupsNotCited(
      { findings: [{ criterion: 'STOPP-E1', must_cite: [[]] }] },
      'STOPP-E1',
      ['L001']
    )).toEqual([[]]);
    expect(proof.checkWords(row({ suspected: false, check: { completed: true, confirmed: true } }))).toBe('-');
    expect(proof.judge(row({
      error: 'The history could not be read.',
      suspected: true,
      check: { completed: true, confirmed: true }
    }))).toEqual({ ok: false, why: 'The history could not be read.' });
    expect(proof.cell(null)).toBe('null');
    expect(proof.cell('   ')).toBe('');
    expect(proof.cell(12)).toBe('12');
  });

  it('matches a planted line that is a number, and names every missed group', () => {
    const numbered = {
      findings: [{ criterion: 'STOPP-E1', must_cite: [[12, 'l002'], [9]] }]
    } as JudgeRow['entry'];
    expect(proof.groupsNotCited(numbered, 'STOPP-E1', ['12'])).toEqual([[9]]);
    expect(proof.groupsNotCited(
      { findings: [{ criterion: 'STOPP-E1' }] },
      'STOPP-E1',
      ['L001']
    )).toEqual([]);

    expect(proof.judge(row({
      suspected: true,
      check: { completed: true, confirmed: true },
      cited: [],
      expect: { want: 'finding', words: 'a confirmed finding with the planted lines' },
      entry: { findings: [{ criterion: 'STOPP-E1', must_cite: [['L001', 'L002'], ['L009']] }] }
    }))).toEqual({
      ok: false,
      why: 'Planted lines not cited: L001/L002; L009.'
    });
  });
});
