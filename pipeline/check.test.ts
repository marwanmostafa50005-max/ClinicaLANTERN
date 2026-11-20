import { describe, expect, it } from 'vitest';
import type { ScreenResult } from '../shared/types.ts';
import {
  checkCutNote, checkFinding, checkMessages, CHECK_SCHEMA, CHECK_SYSTEM, checkUnclearNote, fromCheckForm, mergeCheckParts, readCheckAnswer, toCheckForm,
  WHAT_MATCHES_MAX, type CheckAnswer
} from './check.ts';
import { checkAgainstSchema } from './ollama.ts';
import { fakeChat, manyLines, testConfig, testCriterion, testLines, testPatient, userText, type FakeChat } from './testkit.ts';

function isAnswer(value: unknown): value is CheckAnswer {
  return typeof value === 'object' && value !== null && 'confirmed' in value && 'what_matches' in value;
}

/**
 * A stand-in for the second model. The answers are written here by their plain names and handed
 * over the way the model writes them: under the numbered names of the answer form.
 */
function fakeCheck(answers: unknown[]): FakeChat {
  return fakeChat(answers.map(a => {
    if (isAnswer(a)) return toCheckForm(a);
    if (typeof a === 'object' && a !== null && 'answer' in a && isAnswer((a as { answer: unknown }).answer)) {
      return { ...a, answer: toCheckForm((a as { answer: CheckAnswer }).answer) };
    }
    return a;
  }));
}

const screen: ScreenResult = {
  lineIds: ['L002', 'L003', 'L004', 'L005'],
  medicines: ['celecoxib', 'rivaroxaban'],
  reason: 'Celebrex was supplied while Xarelto is supplied every month.',
  linesVerified: true,
  missingFacts: [],
  model: 'lantern-screen',
  at: '2026-11-18T00:00:00.000Z',
  seconds: 5
};

describe('the check prompt', () => {
  it('is lopsided: it tells the model to confirm unless the finding is clearly wrong', () => {
    expect(CHECK_SYSTEM).toContain('Confirm the finding unless the cited lines clearly do not contain the listed medicines or the rule is clearly not met');
    expect(CHECK_SYSTEM).toContain('if you are unsure, confirm it');
  });

  it('gives the full history, the same criterion block and the suspected finding', () => {
    const text = checkMessages(testPatient, testLines, testCriterion, screen)[1].content;
    expect(text.indexOf('DISPENSING HISTORY')).toBeLessThan(text.indexOf('CRITERION Demo criterion'));
    expect(text.indexOf('CRITERION Demo criterion')).toBeLessThan(text.indexOf('SUSPECTED FINDING FROM THE FIRST STEP'));
    expect(text).toContain('L001 | 2026-08-06 | Lipitor');
    expect(text).toContain('"suspected_lines":["L002","L003","L004","L005"]');
    expect(text).toContain('Group B (Oral anticoagulants)');
  });

  it('tells the model to look everywhere when the first step gave no usable line', () => {
    const text = checkMessages(testPatient, testLines, testCriterion, { ...screen, lineIds: [], linesVerified: false })[1].content;
    expect(text).toContain('"suspected_lines":[]');
    expect(text).toContain('Look through the whole history.');
  });
});

describe('checkFinding', () => {
  it('returns the confirmed finding with only lines that exist', async () => {
    const fake = fakeCheck([{
      confirmed: true, line_ids: ['L003', 'L002', 'L099'],
      what_matches: 'Celebrex (celecoxib) on 2026-08-21 and Xarelto (rivaroxaban) on 2026-08-08.',
      what_cannot_be_seen: 'Whether the medicines were taken.'
    }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ model: 'lantern-check', think: false, numPredict: 1200 });
    expect(result).toMatchObject({
      confirmed: true, completed: true, lineIds: ['L002', 'L003'], model: 'lantern-check',
      whatMatches: 'Celebrex (celecoxib) on 2026-08-21 and Xarelto (rivaroxaban) on 2026-08-08.',
      whatCannotBeSeen: 'Whether the medicines were taken.'
    });
  });

  it('passes a rejection through as not confirmed, completed', async () => {
    const fake = fakeCheck([{ confirmed: false, line_ids: [], what_matches: 'No Group A medicine is in the history.', what_cannot_be_seen: '' }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: false, completed: true, lineIds: [] });
    expect(result.whatCannotBeSeen).toBe(testCriterion.cannot_be_seen);
  });

  it('leaves the finding visible when the call fails twice: completed is false', async () => {
    const fake = fakeCheck([{ fail: 'Tried twice. The local model server answered with error 500.' }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(result.completed).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.lineIds).toEqual(['L002', 'L003', 'L004', 'L005']);       // the lines from the first step stay on show
    expect(result.whatMatches).toBe('The second check did not finish, so this finding is shown without it. Tried twice. The local model server answered with error 500.');
    expect(result.whatCannotBeSeen).toBe(testCriterion.cannot_be_seen);
  });

  it('never throws, even when the model stand-in throws', async () => {
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, {
      chat: async () => { throw new Error('boom'); }
    });
    expect(result.completed).toBe(false);
    expect(result.whatMatches).toContain('boom');
  });

  it('keeps the lines of the first step when the model confirms without a usable line', async () => {
    const fake = fakeCheck([{ confirmed: true, line_ids: ['L500'], what_matches: 'Both are supplied.', what_cannot_be_seen: 'Kidney function.' }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L002', 'L003', 'L004', 'L005'] });
  });

  it('does not count a check whose prompt did not fit in the reading window of the model', async () => {
    const answer = { confirmed: false, line_ids: [], what_matches: 'Nothing matches.', what_cannot_be_seen: '' };
    const fake = fakeCheck([{ answer, promptTokens: testConfig.numCtx }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: false, completed: false });        // still shown to the pharmacist
    expect(result.whatMatches).toContain('too long for the model');
  });

  it('uses more room for the answer when thinking is on', async () => {
    const fake = fakeCheck([{ confirmed: true, line_ids: ['L002'], what_matches: 'x', what_cannot_be_seen: 'y' }]);
    await checkFinding({ ...testConfig, think: { ...testConfig.think, check: true } }, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(fake.calls[0]).toMatchObject({ think: true, numPredict: 4000 });
  });

  it('checks the listed lines of a long history together, never one part at a time', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const lines = manyLines(24);                    // parts: L001-L010, L008-L017, L015-L024
    // The first model listed L002 and L022 and cited them: they sit in part 1 and part 3.
    const long: ScreenResult = { ...screen, lineIds: ['L002', 'L022'], listedLineIds: ['L002', 'L012', 'L022'] };
    const fake = fakeCheck([{ what_matches: 'Both are supplied.', line_ids: ['L002', 'L022', 'L005'], what_cannot_be_seen: 'Kidney function.', confirmed: true }]);
    const result = await checkFinding(cfg, testPatient, lines, testCriterion, long, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    const text = userText(fake.calls[0]);
    expect(text).toContain('This history is long: 24 lines. Only the 3 lines that hold a medicine listed for this criterion are shown here.');
    expect(text).toContain('L002 |');
    expect(text).toContain('L012 |');
    expect(text).toContain('L022 |');
    expect(text).not.toContain('L003 |');
    expect(text).not.toContain('This is part');
    expect(text).toContain('"suspected_lines":["L002","L022"]');
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L002', 'L022'] });     // L005 was not shown, so it is dropped
  });

  it('reads the cited lines together even when the first model listed nothing else', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const spread: ScreenResult = { ...screen, lineIds: ['L002', 'L022'] };       // part 1 and part 3
    const fake = fakeCheck([{ what_matches: 'Both groups here.', line_ids: ['L022'], what_cannot_be_seen: 'Kidney function.', confirmed: true }]);
    const result = await checkFinding(cfg, testPatient, manyLines(24), testCriterion, spread, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L022'], whatMatches: 'Both groups here.' });
  });

  it('is not completed when the lines that matter are too many to check together', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const lines = manyLines(24);
    const long: ScreenResult = { ...screen, lineIds: ['L002'], listedLineIds: lines.slice(0, 11).map(l => l.id) };
    const fake = fakeCheck([]);
    const result = await checkFinding(cfg, testPatient, lines, testCriterion, long, { chat: fake.chat });
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ confirmed: false, completed: false });        // still shown to the pharmacist
    expect(result.whatMatches).toContain('too many to check together');
  });

  it('goes through the parts of a long history only when the first step named no line at all', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const lines = manyLines(24);
    const none: ScreenResult = { ...screen, lineIds: [], linesVerified: false };
    const reject = { what_matches: 'Only one group here.', line_ids: [], what_cannot_be_seen: '', confirmed: false };
    const confirm = { what_matches: 'Both groups here.', line_ids: ['L022'], what_cannot_be_seen: 'Kidney function.', confirmed: true };

    const yes = fakeCheck([reject, reject, confirm]);
    expect(await checkFinding(cfg, testPatient, lines, testCriterion, none, { chat: yes.chat }))
      .toMatchObject({ confirmed: true, completed: true, lineIds: ['L022'], whatMatches: 'Both groups here.' });
    expect(userText(yes.calls[2])).toContain('This is part 3 of 3 of a long history: lines L015 to L024.');

    const unknown = await checkFinding(cfg, testPatient, lines, testCriterion, none, { chat: fakeCheck([reject, { fail: 'Tried twice.' }, reject]).chat });
    expect(unknown).toMatchObject({ confirmed: false, completed: false });

    const no = await checkFinding(cfg, testPatient, lines, testCriterion, none, { chat: fakeCheck([reject, reject, reject]).chat });
    expect(no).toMatchObject({ confirmed: false, completed: true });
    expect(no.unclear).toBeUndefined();
  });
});

describe('the answer form of the second check', () => {
  it('asks for the explanation first and the yes or no last', () => {
    const names = Object.keys(CHECK_SCHEMA.properties ?? {});
    expect(names).toEqual(['step1_what_matches', 'step2_line_ids', 'step3_what_cannot_be_seen', 'step4_confirmed']);
    expect(CHECK_SCHEMA.required).toEqual(names);
    const task = checkMessages(testPatient, testLines, testCriterion, screen)[1].content.split('SUSPECTED FINDING FROM THE FIRST STEP')[1];
    expect(task.indexOf('step1_what_matches (')).toBeLessThan(task.indexOf('step4_confirmed (true or false)'));
  });

  it('keeps that order when the model writes the fields in alphabetical order, as the second model does', () => {
    // Measured on 18 November: lantern-check wrote "confirmed" first whatever order the form gave.
    // The yes or no must be the last name of the form in alphabetical order too.
    const names = Object.keys(CHECK_SCHEMA.properties ?? {});
    expect([...names].sort()).toEqual(names);
    expect([...names].sort().pop()).toBe('step4_confirmed');
  });

  it('accepts an answer in the numbered form', () => {
    const form = toCheckForm({ confirmed: true, line_ids: ['L002'], what_matches: 'x', what_cannot_be_seen: 'y' });
    expect(checkAgainstSchema(form, CHECK_SCHEMA)).toBeNull();
    expect(checkAgainstSchema({ confirmed: true, line_ids: [], what_matches: 'x', what_cannot_be_seen: 'y' }, CHECK_SCHEMA)).toBe('answer is missing "step1_what_matches"');
  });

  it('limits how much the model may write under "what matches"', () => {
    expect(CHECK_SCHEMA.properties?.step1_what_matches.maxLength).toBe(WHAT_MATCHES_MAX);
    expect(WHAT_MATCHES_MAX).toBeLessThanOrEqual(800);
  });

  it('does not take a "no" that names the proving lines as a plain no: it is marked unclear and still shown', async () => {
    // What the reviewers saw: "confirmed: false" with the two proving lines and "so the rule is met".
    const fake = fakeCheck([{
      what_matches: 'Celebrex on 2026-08-21 (L003) and Xarelto on 2026-08-08 (L002) are within 60 days, so the rule is met.',
      line_ids: ['L002', 'L003'], what_cannot_be_seen: 'Whether the medicines were taken.', confirmed: false
    }]);
    const result = await checkFinding(testConfig, testPatient, testLines, testCriterion, screen, { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: false, completed: true, unclear: true, lineIds: ['L002', 'L003'] });
  });

  it('takes a plain "no" as a no', () => {
    const plain = readCheckAnswer({ confirmed: false, line_ids: [], what_matches: 'No NSAID.', what_cannot_be_seen: '' }, testLines, screen);
    expect(plain).toMatchObject({ confirmed: false, unclear: false, lineIds: [] });
    // Lines that do not exist prove nothing.
    const made = readCheckAnswer({ confirmed: false, line_ids: ['L900'], what_matches: 'No NSAID.', what_cannot_be_seen: '' }, testLines, screen);
    expect(made).toMatchObject({ confirmed: false, unclear: false, lineIds: [] });
  });

  it('cuts a long working-out back to whole sentences and says that more was written', () => {
    const long = 'L001 was supplied on 8 January. ' + 'Let me check the other lines again. '.repeat(40);
    const read = readCheckAnswer({ confirmed: true, line_ids: ['L002'], what_matches: long, what_cannot_be_seen: 'x' }, testLines, screen);
    expect(read.whatMatches.length).toBeLessThan(WHAT_MATCHES_MAX + 60);
    expect(read.whatMatches.endsWith(checkCutNote())).toBe(true);
    expect(read.whatMatches).toContain(`again. ${checkCutNote().slice(0, 12)}`);
  });

  it('joins the parts of a long check, and reads a numbered answer back', () => {
    const part = (over: {
      completed?: boolean; confirmed?: boolean; unclear?: boolean; lineIds?: string[];
      whatMatches?: string; whatCannotBeSeen?: string; error?: string;
    }) => ({ completed: true, confirmed: false, unclear: false, lineIds: [] as string[], whatMatches: '', whatCannotBeSeen: '', ...over });

    const only = part({ confirmed: true, lineIds: ['L003'], whatMatches: 'Both.' });
    expect(mergeCheckParts([only])).toBe(only);

    const won = mergeCheckParts([
      part({ unclear: true, lineIds: ['L010'], whatMatches: 'The lines are there.' }),
      part({ confirmed: true, lineIds: ['L010', 'nope', 'L002'], whatMatches: 'Both groups.' }),
      part({ completed: false, error: 'Tried twice.' })
    ]);
    expect(won).toMatchObject({
      completed: true, confirmed: true, unclear: false,
      lineIds: ['nope', 'L002', 'L010'], whatMatches: 'Both groups.', error: 'Tried twice.'
    });

    const unclear = mergeCheckParts([
      part({ unclear: true, lineIds: ['L003', 'L002'], whatMatches: 'The lines are there.' }),
      part({ whatMatches: 'Only one group.' }),
      part({ unclear: true, lineIds: ['L003'], whatMatches: 'the lines are there.' })
    ]);
    expect(unclear).toMatchObject({
      completed: true, confirmed: false, unclear: true,
      lineIds: ['L002', 'L003'], whatMatches: 'The lines are there.'
    });

    const failed = mergeCheckParts([
      part({ whatMatches: 'No.' }),
      part({ completed: false, error: 'The local model server did not answer.' })
    ]);
    expect(failed).toMatchObject({ completed: false, confirmed: false, unclear: false, whatMatches: 'No.' });
    expect(failed.error).toBe('The local model server did not answer.');

    const answer = { confirmed: true, line_ids: ['L002'], what_matches: 'x', what_cannot_be_seen: 'y' };
    expect(fromCheckForm(toCheckForm(answer))).toEqual(answer);
  });

  it('names who wrote an unclear no, and uses Lumen when no name is given', () => {
    expect(checkUnclearNote('Mantle')).toBe(
      'The second check is unclear: Mantle answered "not confirmed" but named lines as proof. The finding is shown so that it is not missed.');
    expect(checkUnclearNote('   ')).toBe(checkUnclearNote());
    expect(checkUnclearNote()).toContain('Lumen');
  });

  it('names who wrote more than fits, and uses Lumen when no name is given', () => {
    expect(checkCutNote('Ogee')).toBe('(Ogee wrote more. The rest was left out.)');
    expect(checkCutNote('   ')).toBe(checkCutNote());
    expect(checkCutNote()).toBe('(Lumen wrote more. The rest was left out.)');
  });
});
