// Unit tests for the scoring rules, with hand-made inputs. No model is used.

import { describe, expect, it } from 'vitest';
import type { PairRecord } from './types.ts';
import {
  caseSheetWarnings,
  checkCallFrom,
  checkSheet,
  criterionText,
  groupsNotCited,
  judgePlanted,
  letterCallFrom,
  letterHasCriterionText,
  letterObservations,
  linesCited,
  oneLine,
  plantedNotShown,
  scoreCriterion,
  scoreRun,
  screenCallFrom,
  unsafeCasePath,
} from './score.ts';
import {
  SCENARIO_CASES,
  SCENARIO_PAIRS,
  checkConfirmed,
  checkNotCompleted,
  checkNotConfirmed,
  checkResult,
  expectedCase,
  letterBody,
  letterByModel,
  letterDraft,
  letterNotProduced,
  makeCriterion,
  pair,
  planted,
  screenClear,
  screenFailed,
  screenResult,
  screenSuspected,
} from './testkit.ts';

const A = makeCriterion('STOPP-A1');
const B = makeCriterion('STOPP-B2');

function finder(pairs: PairRecord[], criterionId: string): (caseFile: string) => PairRecord | undefined {
  return (caseFile) => pairs.find((p) => p.caseFile === caseFile && p.criterionId === criterionId);
}

describe('lines that must be cited', () => {
  it('is met when each group has at least one cited line', () => {
    expect(groupsNotCited([['L003'], ['L007', 'L008']], ['L003', 'L008'])).toEqual([]);
  });

  it('names the group that has no cited line', () => {
    expect(groupsNotCited([['L003'], ['L007', 'L008']], ['L003'])).toEqual([['L007', 'L008']]);
  });

  it('does not care about case or spaces in a line ID', () => {
    expect(groupsNotCited([['L003']], [' l003 '])).toEqual([]);
  });

  it('can never meet an empty group', () => {
    expect(groupsNotCited([[]], ['L001', 'L002'])).toEqual([[]]);
  });

  it('joins the lines of Model 1 and Model 2', () => {
    const p = pair('A/pos.csv', A.id, screenSuspected(['L003']), checkConfirmed(['L007', 'L003']));
    expect(linesCited(p)).toEqual({ byScreen: ['L003'], byCheck: ['L007', 'L003'], all: ['L003', 'L007'] });
    expect(linesCited(undefined).all).toEqual([]);
  });

  it('gives Model 2 no lines when its check was not completed', () => {
    // The pipeline copies the first step's lines into a check that failed twice.
    const failed = pair('A/pos.csv', A.id, screenSuspected(['L003']), { ...checkNotCompleted(), result: checkResult(false, ['L003'], false) });
    expect(linesCited(failed)).toEqual({ byScreen: ['L003'], byCheck: [], all: ['L003'] });
  });
});

describe('judging one planted finding', () => {
  const expected = planted(A.id, ['L003'], ['L007', 'L008']);

  it('is a catch when Model 2 confirms and the planted lines are cited', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenSuspected(['L003', 'L007']), checkConfirmed(['L003'])));
    expect(outcome.caught).toBe(true);
    expect(outcome.why).toBeUndefined();
    expect(outcome.missingGroups).toEqual([]);
  });

  it('is a catch when a planted line is cited by Model 2 only', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenSuspected(['L003']), checkConfirmed(['L008'])));
    expect(outcome.caught).toBe(true);
  });

  it('is a miss when Model 1 does not suspect it', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenClear()));
    expect(outcome.caught).toBe(false);
    expect(outcome.why).toBe('not_suspected');
    expect(outcome.detail).toBe('Model 1 did not suspect it.');
  });

  it('is disputed, not a miss, when Model 2 turns it back', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenSuspected(['L003', 'L007']), checkNotConfirmed()));
    expect(outcome.caught).toBe(false);
    expect(outcome.disputed).toBe(true);
    expect(outcome.why).toBe('not_confirmed');
    expect(outcome.missingGroups).toEqual([]);   // Model 1 did cite the planted lines
  });

  it('is a miss when it is confirmed but a planted group is not cited', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenSuspected(['L003']), checkConfirmed(['L003', 'L011'])));
    expect(outcome.caught).toBe(false);
    expect(outcome.why).toBe('planted_lines_not_cited');
    expect(outcome.missingGroups).toEqual([['L007', 'L008']]);
    expect(outcome.citedByScreen).toEqual(['L003']);
    expect(outcome.citedByCheck).toEqual(['L003', 'L011']);
  });

  it('is a miss when the screen call failed, and it says why', () => {
    const outcome = judgePlanted(expected, pair('A/pos.csv', A.id, screenFailed('Tried twice. HTTP 500.')));
    expect(outcome.caught).toBe(false);
    expect(outcome.why).toBe('could_not_be_screened');
    expect(outcome.detail).toContain('Tried twice. HTTP 500.');
  });

  it('is a miss when the second check was not completed, even if the record says confirmed', () => {
    const p = pair('A/pos.csv', A.id, screenSuspected(['L003', 'L007']), checkNotCompleted());
    expect(p.check?.result?.confirmed).toBe(true);
    const outcome = judgePlanted(expected, p);
    expect(outcome.caught).toBe(false);
    expect(outcome.why).toBe('check_not_completed');
  });

  it('is a miss when the history could not be read or the run stopped', () => {
    const notRead = pair('A/pos.csv', A.id, { status: 'not_read', seconds: 0, error: 'The file was not found.' });
    expect(judgePlanted(expected, notRead).why).toBe('history_not_read');
    const notRun = pair('A/pos.csv', A.id, { status: 'not_run', seconds: 0 });
    expect(judgePlanted(expected, notRun).why).toBe('not_run');
    expect(judgePlanted(expected, undefined).why).toBe('not_run');
    const checkNotRun = pair('A/pos.csv', A.id, screenSuspected(['L003', 'L007']), { status: 'not_run', seconds: 0 });
    expect(judgePlanted(expected, checkNotRun).why).toBe('not_run');
  });

  it('is a catch with no must_cite groups once Model 2 confirms', () => {
    const outcome = judgePlanted(planted(A.id), pair('A/pos.csv', A.id, screenSuspected([]), checkConfirmed([])));
    expect(outcome.caught).toBe(true);
  });
});

describe('turning pipeline answers into call records', () => {
  it('reads a screen answer', () => {
    expect(screenCallFrom({ ok: true, suspected: true, result: screenResult(['L001']) }, 5.2).status).toBe('suspected');
    expect(screenCallFrom({ ok: true, suspected: false, result: screenResult([]) }, 5.2).status).toBe('clear');
  });

  it('never turns a failed or unreadable screen answer into a clean result', () => {
    const failed = screenCallFrom({ ok: false, error: 'Tried twice. The model sent an empty answer.' }, 21);
    expect(failed).toEqual({ status: 'failed', seconds: 21, error: 'Tried twice. The model sent an empty answer.' });
    expect(screenCallFrom(undefined, 1).status).toBe('failed');
    expect(screenCallFrom({ ok: true, result: screenResult([]) }, 1).status).toBe('failed');       // no "suspected"
    expect(screenCallFrom({ ok: true, suspected: false }, 1).status).toBe('failed');                // no result
    expect(screenCallFrom('clear', 1).status).toBe('failed');
  });

  it('reads a check answer', () => {
    expect(checkCallFrom(checkResult(true, ['L001']), 9).status).toBe('confirmed');
    expect(checkCallFrom(checkResult(false, []), 9).status).toBe('not_confirmed');
  });

  it('never counts a check that failed twice as confirmed', () => {
    const call = checkCallFrom(checkResult(true, [], false), 30);
    expect(call.status).toBe('not_completed');
    expect(call.result?.confirmed).toBe(true);
    expect(call.error).toContain('Tried twice. The local model server did not answer.');
    expect(checkCallFrom(null, 1).status).toBe('not_completed');
    expect(checkCallFrom({ completed: true }, 1).status).toBe('not_completed');
    expect(checkCallFrom({ confirmed: true }, 1)).toMatchObject({ status: 'not_completed', error: 'The check call failed twice.' });
  });

  it('sorts letters into model, model with notes, template and none', () => {
    const body = letterBody(A);
    expect(letterCallFrom(letterDraft('model', [], body), 2, A).status).toBe('model_clean');
    const redrafted = ['First draft: The date 3 March 2026 is not in the finding.', 'The letter was drafted again. The second draft passed the checks.'];
    expect(letterCallFrom(letterDraft('model', redrafted, body), 2, A).status).toBe('model_with_notes');
    expect(letterCallFrom(letterDraft('template', ['Both drafts failed the checks.'], body), 6, A).status).toBe('template');
    expect(letterCallFrom(letterDraft('model', [], '   '), 2, A).status).toBe('not_produced');
    expect(letterCallFrom(undefined, 2, A).status).toBe('not_produced');
    expect(letterCallFrom({ ...letterDraft('model', [], body), origin: 'other' }, 2, A).status).toBe('not_produced');
  });

  it('does not count a text without the criterion text as a letter', () => {
    const stub = letterDraft(
      'template',
      ['The letter could not be built.'],
      'Fictional patient. No real person.\n\nThe letter could not be built. Please write it by hand.',
    );
    const call = letterCallFrom(stub, 1, A);
    expect(call.status).toBe('not_produced');
    expect(call.error).toContain('does not include the criterion text');
    expect(call.draft).toBe(stub);
    expect(letterHasCriterionText(stub.body, A)).toBe(false);
    // Line breaks inside the criterion text do not matter.
    expect(letterHasCriterionText('Dear Doctor,\nStatement text\nfor   STOPP-A1.\nYours sincerely,', A)).toBe(true);
  });

  it('notes what a letter leaves out, without making it a result', () => {
    expect(letterObservations(letterDraft('model', [], letterBody(A)), A)).toEqual([]);
    const thin = letterDraft('model', [], `Dear Doctor, please review. ${A.statement}`);
    expect(letterObservations(thin, A)).toEqual([
      'The letter does not say the patient is fictional.',
      'The letter does not include the credit line word for word.',
    ]);
    expect(letterCallFrom(thin, 2, A)).toMatchObject({ status: 'model_clean', observations: letterObservations(thin, A) });

    const first = '2026-08-21 | Examplex 200 mg capsule | qty 30';
    const second = '2026-09-01 | Samplol 5 mg tablet | qty 30';
    const third = '2026-10-01 | Samplol 5 mg tablet | qty 30';
    const groups = [
      { ids: ['L003'], texts: [first] },
      { ids: ['L007', 'L008'], texts: [second, third] },
    ];
    // Whether the letter shows the planted lines is no longer a note: it is part of the pass rule.
    const ids = (body: string): string[][] => plantedNotShown(letterDraft('model', [], body), groups).map((g) => g.ids);
    expect(ids(letterBody(A, [first, third]))).toEqual([]);
    expect(ids(letterBody(A, [first]))).toEqual([['L007', 'L008']]);
    expect(ids(letterBody(A))).toEqual([['L003'], ['L007', 'L008']]);
    expect(letterCallFrom(letterDraft('model', [], letterBody(A, [first])), 2, A, groups)).toMatchObject({
      status: 'model_clean',
      plantedNotShown: [['L007', 'L008']],
    });
  });

  it('cuts long text to one line', () => {
    expect(oneLine('  a\n\n b  ')).toBe('a b');
    expect(oneLine('x'.repeat(500), 50)).toHaveLength(50);
    expect(oneLine(undefined)).toBe('');
  });
});

describe('criterion text attached', () => {
  it('is attached when the file has a statement and a credit line', () => {
    expect(criterionText(A)).toEqual({ attached: true, problems: [] });
  });

  it('is not attached when the statement or the credit line is empty', () => {
    const noCredit = makeCriterion('X-1', { source: { ...A.source, credit: '  ' } });
    expect(criterionText(noCredit)).toEqual({ attached: false, problems: ['The criterion file has no credit line.'] });
    const noStatement = makeCriterion('X-2', { statement: '' });
    expect(criterionText(noStatement).attached).toBe(false);
    expect(criterionText(noStatement).problems).toEqual(['The criterion file has no statement text.']);
  });
});

describe('scoring a run', () => {
  const score = scoreRun({ criteria: [A, B], cases: SCENARIO_CASES, pairs: SCENARIO_PAIRS, lettersRun: true });
  const [a, b] = score.criteria;

  it('passes a criterion when every planted finding is caught, the text is attached and each has a letter', () => {
    expect(a.verdict).toBe('PASS');
    expect(a.reasons).toEqual([]);
    expect(a.caveats).toEqual([]);
    expect(a.planted).toBe(2);
    expect(a.caught).toBe(2);
    expect(a.misses).toEqual([]);
    expect(a.textAttached).toBe(true);
  });

  it('counts a template letter as a letter, on its own', () => {
    expect(a.letters).toEqual({ needed: 2, produced: 2, modelClean: 1, modelWithNotes: 0, template: 1, notProduced: 0, withoutPlanted: 0 });
    const template = a.letterLines.find((l) => l.result === 'template');
    expect(template?.caseFile).toBe('STOPP-A1/pos-buried.csv');
    expect(template?.checkNotes).toEqual(['The date 2026-01-01 is not in the finding.']);
  });

  it('counts and lists a false flag but never fails for it', () => {
    expect(a.falseFlags).toHaveLength(1);
    expect(a.falseFlags[0]).toMatchObject({
      criterionId: 'STOPP-A1',
      caseFile: 'STOPP-A1/near-miss.csv',
      caseKind: 'near_miss',
      ownFolder: true,
      citedByScreen: ['L004', 'L009'],
      citedByCheck: ['L004'],
      screenReason: 'Both medicines appear.',
    });
    expect(a.verdict).toBe('PASS');
  });

  it('counts a suspected finding that Model 2 turned back, and does not call it a false flag', () => {
    expect(a.turnedBack).toBe(1);
    expect(a.falseFlags.map((f) => f.caseFile)).not.toContain('_clean/clean-1.csv');
  });

  it('fails a criterion for a miss and lists the miss with its lines', () => {
    expect(b.verdict).toBe('FAIL');
    expect(b.planted).toBe(2);
    expect(b.caught).toBe(1);
    expect(b.misses).toHaveLength(1);
    expect(b.misses[0]).toMatchObject({
      criterionId: 'STOPP-B2',
      caseFile: 'STOPP-B2/pos-buried.csv',
      why: 'not_suspected',
      mustCite: [['L011']],
      missingGroups: [['L011']],
    });
    expect(b.reasons).toEqual(['Missed 1 of 2 planted findings.']);
  });

  it('counts a failed call on a history with nothing planted, without failing for it alone', () => {
    expect(b.notCompleted).toHaveLength(1);
    expect(b.notCompleted[0]).toMatchObject({ caseFile: '_clean/clean-1.csv', stage: 'screen', planted: false });
    expect(b.notCompleted[0].detail).toContain('error 500');
    expect(b.notCompletedOnPlanted).toBe(0);
    expect(b.falseFlags).toEqual([]);
  });

  it('adds up the calls and the seconds', () => {
    expect(a.calls).toEqual({ screen: 6, check: 4, letter: 2 });
    expect(a.secondsByStage).toEqual({ screen: 39, check: 44, letter: 8 });
    expect(a.seconds).toBe(91);
    expect(b.calls).toEqual({ screen: 6, check: 1, letter: 1 });
    expect(b.seconds).toBe(57);
  });

  it('gives the totals', () => {
    expect(score.totals).toMatchObject({
      criteria: 2,
      pass: 1,
      passPart: 0,
      fail: 1,
      notTested: 0,
      planted: 4,
      caught: 3,
      falseFlags: 1,
      turnedBack: 1,
      notCompleted: 1,
      seconds: 148,
    });
    expect(score.totals.letters).toEqual({ needed: 3, produced: 3, modelClean: 2, modelWithNotes: 0, template: 1, notProduced: 0, withoutPlanted: 0 });
    expect(score.unscored).toEqual([]);
  });
});

describe('the pass rule, one case at a time', () => {
  const pos = expectedCase('STOPP-A1/pos.csv', 'positive', [planted(A.id, ['L003'])]);
  const near = expectedCase('STOPP-A1/near.csv', 'near_miss');
  const clean = expectedCase('_clean/c.csv', 'clean');
  const caught = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel());

  it('never fails for false flags, however many', () => {
    const pairs = [
      caught,
      pair(near.file, A.id, screenSuspected(['L001']), checkConfirmed(['L001'])),
      pair(clean.file, A.id, screenSuspected(['L002']), checkConfirmed(['L002'])),
    ];
    const s = scoreCriterion(A, [pos, near, clean], finder(pairs, A.id), true);
    expect(s.falseFlags).toHaveLength(2);
    expect(s.verdict).toBe('PASS');
  });

  it('counts a confirmed finding for a criterion not expected on a positive history as a false flag', () => {
    const otherPos = expectedCase('STOPP-B2/pos.csv', 'positive', [planted(B.id, ['L002'])]);
    const pairs = [caught, pair(otherPos.file, A.id, screenSuspected(['L005']), checkConfirmed(['L005']))];
    const s = scoreCriterion(A, [pos, otherPos], finder(pairs, A.id), true);
    expect(s.falseFlags).toHaveLength(1);
    expect(s.falseFlags[0]).toMatchObject({ caseFile: 'STOPP-B2/pos.csv', caseKind: 'positive', ownFolder: false });
    expect(s.planted).toBe(1);
    expect(s.verdict).toBe('PASS');
  });

  it('fails when a call could not be completed on a history with a planted finding', () => {
    const pairs = [pair(pos.file, A.id, screenFailed())];
    const s = scoreCriterion(A, [pos], finder(pairs, A.id), true);
    expect(s.verdict).toBe('FAIL');
    expect(s.caught).toBe(0);
    expect(s.notCompletedOnPlanted).toBe(1);
    expect(s.misses[0].why).toBe('could_not_be_screened');
    expect(s.reasons.join(' ')).toContain('A failed call is never a clean result.');
  });

  it('fails when the second check was not completed on a planted finding', () => {
    const pairs = [pair(pos.file, A.id, screenSuspected(['L003']), checkNotCompleted())];
    const s = scoreCriterion(A, [pos], finder(pairs, A.id), true);
    expect(s.verdict).toBe('FAIL');
    expect(s.caught).toBe(0);
    expect(s.notCompleted[0]).toMatchObject({ stage: 'check', planted: true });
    expect(s.letters.needed).toBe(0);
  });

  it('does not call an uncompleted check a false flag, and does not call it clean', () => {
    const pairs = [caught, pair(clean.file, A.id, screenSuspected(['L002']), checkNotCompleted())];
    const s = scoreCriterion(A, [pos, clean], finder(pairs, A.id), true);
    expect(s.falseFlags).toEqual([]);
    expect(s.turnedBack).toBe(0);
    expect(s.notCompleted).toHaveLength(1);
    expect(s.notCompleted[0]).toMatchObject({ caseFile: '_clean/c.csv', stage: 'check', planted: false });
    expect(s.notCompleted[0].detail).toContain('still be shown under the bell');
    expect(s.verdict).toBe('PASS');
  });

  it('fails when the criterion text or the credit line is missing', () => {
    const bare = makeCriterion(A.id, { source: { ...A.source, credit: '' } });
    const s = scoreCriterion(bare, [pos], finder([caught], A.id), true);
    expect(s.caught).toBe(1);
    expect(s.textAttached).toBe(false);
    expect(s.verdict).toBe('FAIL');
    expect(s.reasons).toEqual(['The criterion file has no credit line.']);
  });

  it('fails when a caught finding has no letter', () => {
    const noLetter = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), letterNotProduced());
    const s = scoreCriterion(A, [pos], finder([noLetter], A.id), true);
    expect(s.caught).toBe(1);
    expect(s.letters).toMatchObject({ needed: 1, produced: 0, notProduced: 1 });
    expect(s.verdict).toBe('FAIL');
    expect(s.reasons.join(' ')).toContain('No letter was produced for 1 caught finding.');
    expect(s.notCompleted[0]).toMatchObject({ stage: 'letter', planted: true });

    const missing = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']));
    expect(scoreCriterion(A, [pos], finder([missing], A.id), true).verdict).toBe('FAIL');
  });

  it('counts a model letter with check notes on its own, as a letter', () => {
    const noted = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel(['The dose is not in the finding.']));
    const s = scoreCriterion(A, [pos], finder([noted], A.id), true);
    expect(s.letters).toEqual({ needed: 1, produced: 1, modelClean: 0, modelWithNotes: 1, template: 0, notProduced: 0, withoutPlanted: 0 });
    expect(s.verdict).toBe('PASS');
  });

  // The review of 18 November, part G: Model 1 cites the planted lines, Model 2 confirms but cites
  // two other lines, and the letter prints only those. It was scored PASS.
  it('fails when the letter shows none of the planted lines', () => {
    const plantedText = '2026-08-21 | Examplex 200 mg capsule | qty 30';
    const otherText = '2026-01-06 | Samplol 5 mg tablet | qty 30';
    const groups = [{ ids: ['L003'], texts: [plantedText] }];
    const wrongLetter = letterCallFrom(letterDraft('model', [], letterBody(A, [otherText])), 2, A, groups);
    const p = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L001', 'L002']), wrongLetter);
    const s = scoreCriterion(A, [pos], finder([p], A.id), true);
    expect(s.caught).toBe(1);                                   // the app does show L003: it keeps the lines of Model 1
    expect(s.letters).toMatchObject({ produced: 1, withoutPlanted: 1 });
    expect(s.verdict).toBe('FAIL');
    expect(s.reasons).toEqual(['1 letter does not show the planted lines. A letter that does not show the finding is not a proper letter.']);
    expect(s.letterLines[0].detail).toContain('The letter does not show planted line L003.');

    const rightLetter = letterCallFrom(letterDraft('model', [], letterBody(A, [otherText, plantedText])), 2, A, groups);
    const ok = scoreCriterion(A, [pos], finder([pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L001', 'L002']), rightLetter)], A.id), true);
    expect(ok.verdict).toBe('PASS');
    expect(ok.letters.withoutPlanted).toBe(0);
  });

  // The review of 18 November, part H: Model 3 failed twice, the template letter was counted as
  // produced, the table said "Calls that could not be completed: 0" and the criterion was scored PASS.
  it('does not pass, and counts a failed call, when the letter is the template because Model 3 did not answer', () => {
    const body = letterBody(A, ['2026-08-21 | Examplex 200 mg capsule | qty 30']);
    const noAnswer = letterCallFrom({ ...letterDraft('template', ['The letter model did not answer.'], body), templateReason: 'no_answer' }, 5, A);
    expect(noAnswer).toMatchObject({ status: 'template', modelDidNotAnswer: true });
    const s = scoreCriterion(A, [pos], finder([pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), noAnswer)], A.id), true);
    expect(s.letters).toMatchObject({ produced: 1, template: 1 });        // the template letter is still there for the pharmacist
    expect(s.notCompleted).toEqual([
      { criterionId: A.id, caseFile: pos.file, stage: 'letter', planted: true, detail: 'Model 3 did not answer, so the letter was built from the template.' },
    ]);
    expect(s.verdict).toBe('FAIL');
    expect(s.reasons.join(' ')).toContain('1 call could not be completed on a history with a planted finding.');
    expect(s.letterLines[0].detail).toBe('Built from the template because Model 3 did not answer. No draft was written or checked.');

    // A template letter because the drafts failed their checks is a different thing: the model answered.
    const failedChecks = letterCallFrom({ ...letterDraft('template', ['Both drafts failed the checks.'], body), templateReason: 'checks_failed' }, 5, A);
    expect(failedChecks.modelDidNotAnswer).toBeUndefined();
    const t = scoreCriterion(A, [pos], finder([pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']), failedChecks)], A.id), true);
    expect(t.verdict).toBe('PASS');
    expect(t.notCompleted).toEqual([]);
  });

  it('counts a finding with an unclear second check as reaching the bell, and says so', () => {
    const unclear = checkCallFrom({ ...checkResult(false, ['L003']), unclear: true }, 9);
    expect(unclear.status).toBe('unclear');
    const p = pair(pos.file, A.id, screenSuspected(['L003']), unclear, letterByModel());
    expect(linesCited(p)).toEqual({ byScreen: ['L003'], byCheck: ['L003'], all: ['L003'] });
    const outcome = judgePlanted(pos.findings[0], p);
    expect(outcome).toMatchObject({ caught: true, unclear: true });
    expect(outcome.detail).toContain('marked "second check unclear"');
    const s = scoreCriterion(A, [pos], finder([p], A.id), true);
    expect(s.catches[0].unclear).toBe(true);
    // Where nothing was planted, an unclear finding under the bell is a false flag, counted like any other.
    const flag = scoreCriterion(A, [near], finder([pair(near.file, A.id, screenSuspected(['L003']), unclear)], A.id), true);
    expect(flag.falseFlags).toHaveLength(1);
    expect(flag.falseFlags[0].unclear).toBe(true);
  });

  it('judges the planted lines against the lines the app shows: those of Model 2 and those of Model 1, in history order', () => {
    const p = pair(pos.file, A.id, screenSuspected(['L036', 'L040']), checkConfirmed(['L001', 'L002']));
    expect(linesCited(p).all).toEqual(['L001', 'L002', 'L036', 'L040']);
  });

  it('does not call it a full pass when letters were not run', () => {
    const noLetter = pair(pos.file, A.id, screenSuspected(['L003']), checkConfirmed(['L003']));
    const s = scoreCriterion(A, [pos], finder([noLetter], A.id), false);
    expect(s.verdict).toBe('PASS_PART');
    expect(s.caveats).toEqual(['Letters were not run.']);
    expect(s.letters).toMatchObject({ needed: 1, produced: 0, notProduced: 0 });
    expect(s.notCompleted).toEqual([]);
  });

  it('does not call it a full pass when part of the planted findings were left out of the run', () => {
    const s = scoreCriterion(A, [pos], finder([caught], A.id), true, 2);
    expect(s.verdict).toBe('PASS_PART');
    expect(s.plantedInSheet).toBe(2);
    expect(s.caveats).toEqual(['Only 1 of the 2 planted findings in the answer sheet were in this run.']);
  });

  it('says NOT TESTED when nothing was planted for the criterion in the run', () => {
    const pairs = [pair(clean.file, A.id, screenClear())];
    const s = scoreCriterion(A, [clean], finder(pairs, A.id), true);
    expect(s.verdict).toBe('NOT_TESTED');
    expect(s.planted).toBe(0);
    expect(s.caveats).toEqual(['No planted finding for this criterion was in this run.']);
  });

  it('treats a history that could not be read as a miss and as not completed', () => {
    const pairs = [pair(pos.file, A.id, { status: 'not_read', seconds: 0, error: 'The file was not found.' })];
    const s = scoreCriterion(A, [pos], finder(pairs, A.id), true);
    expect(s.verdict).toBe('FAIL');
    expect(s.misses[0].why).toBe('history_not_read');
    expect(s.notCompleted[0]).toMatchObject({ stage: 'import', planted: true });
    expect(s.calls.screen).toBe(0);
  });

  it('treats a criterion that was never run on a history as not completed', () => {
    const s = scoreCriterion(A, [pos, clean], finder([caught], A.id), true);
    expect(s.notCompleted).toHaveLength(1);
    expect(s.notCompleted[0]).toMatchObject({ caseFile: '_clean/c.csv', stage: 'screen', planted: false });
    expect(s.verdict).toBe('PASS');
  });

  it('lists planted findings whose criterion was not in the run', () => {
    const score = scoreRun({ criteria: [B], cases: [pos], pairs: [pair(pos.file, B.id, screenClear())], lettersRun: true });
    expect(score.unscored).toEqual([{ caseFile: 'STOPP-A1/pos.csv', criterionId: 'STOPP-A1' }]);
    expect(score.criteria[0].verdict).toBe('NOT_TESTED');
  });

  it('counts the planted findings of the whole sheet when the run is a part of it', () => {
    const second = expectedCase('STOPP-A1/pos-2.csv', 'positive', [planted(A.id, ['L001'])]);
    const score = scoreRun({ criteria: [A], cases: [pos], pairs: [caught], lettersRun: true, sheetCases: [pos, second, clean] });
    expect(score.criteria[0].plantedInSheet).toBe(2);
    expect(score.criteria[0].verdict).toBe('PASS_PART');
    expect(score.totals).toMatchObject({ pass: 0, passPart: 1, fail: 0 });
  });
});

describe('the answer sheet', () => {
  const good = {
    signed_by_clinical_reviewer: null,
    cases: [
      { file: 'STOPP-A1\\pos-brand.csv', kind: 'positive', about: 'Planted by brand.', findings: [{ criterion: 'STOPP-A1', must_cite: [['L003'], ['L007', 'L008']] }] },
      { file: './STOPP-A1/near-miss.csv', kind: 'near_miss', about: 'Not a finding.', findings: [] },
      { file: ' _clean/clean-1.csv ', kind: 'clean', about: 'Nothing.', findings: [] },
    ],
  };

  it('accepts a well-formed sheet and writes paths with forward slashes', () => {
    const checked = checkSheet(good);
    expect(checked.fatal).toEqual([]);
    expect(checked.warnings).toEqual([]);
    expect(checked.sheet?.cases.map((c) => c.file)).toEqual(['STOPP-A1/pos-brand.csv', 'STOPP-A1/near-miss.csv', '_clean/clean-1.csv']);
    expect(checked.sheet?.signed_by_clinical_reviewer).toBeNull();
  });

  it('reads the sign-off', () => {
    const checked = checkSheet({ ...good, signed_by_clinical_reviewer: { name: 'A. Reviewer', date: '2026-11-19' } });
    expect(checked.sheet?.signed_by_clinical_reviewer).toEqual({ name: 'A. Reviewer', date: '2026-11-19' });
    const odd = checkSheet({ ...good, signed_by_clinical_reviewer: 'yes' });
    expect(odd.sheet?.signed_by_clinical_reviewer).toBeNull();
    expect(odd.warnings).toHaveLength(1);
  });

  it('refuses a sheet it cannot read', () => {
    expect(checkSheet(null).sheet).toBeNull();
    expect(checkSheet({}).fatal).toEqual(['The answer sheet has no "cases" list.']);
    expect(checkSheet({ cases: [] }).fatal).toEqual(['The answer sheet lists no histories.']);
    const bad = checkSheet({
      cases: [
        { kind: 'positive', findings: [] },
        { file: 'a/b.csv', kind: 'maybe', findings: [] },
        { file: 'a/c.csv', kind: 'positive' },
        { file: 'a/d.csv', kind: 'positive', findings: [{ must_cite: [] }] },
        { file: 'a/e.csv', kind: 'positive', findings: [{ criterion: 'X', must_cite: ['L001'] }] },
        { file: 'a/f.csv', kind: 'clean', findings: [] },
        { file: 'A/F.csv', kind: 'clean', findings: [] },
      ],
    });
    expect(bad.sheet).toBeNull();
    expect(bad.fatal).toEqual([
      'Entry 1 has no "file".',
      'a/b.csv: "kind" must be positive, near_miss or clean.',
      'a/c.csv: "findings" must be a list.',
      'a/d.csv: finding 1 has no "criterion".',
      'a/e.csv: finding 1 needs "must_cite" as a list of lists of line IDs.',
      'A/F.csv: it is listed twice.',
    ]);
  });

  it('refuses a path that leaves the cases folder', () => {
    expect(unsafeCasePath('STOPP-A1/pos.csv')).toBeNull();
    expect(unsafeCasePath('../other/pos.csv')).not.toBeNull();
    expect(unsafeCasePath('a/../../pos.csv')).not.toBeNull();
    expect(unsafeCasePath('/etc/pos.csv')).not.toBeNull();
    expect(unsafeCasePath('C:\\Users\\x\\pos.csv')).not.toBeNull();
    expect(unsafeCasePath('a//pos.csv')).not.toBeNull();
    const checked = checkSheet({ cases: [{ file: '..\\..\\elsewhere\\pos.csv', kind: 'clean', findings: [] }] });
    expect(checked.sheet).toBeNull();
    expect(checked.fatal).toEqual(['../../elsewhere/pos.csv: it must not use "..".']);
  });

  it('warns about entries that look wrong but can be run', () => {
    const checked = checkSheet({
      cases: [
        { file: 'a/pos.csv', kind: 'positive', about: 'x', findings: [] },
        { file: 'a/near.csv', kind: 'near_miss', about: 'x', findings: [{ criterion: 'X-1', must_cite: [['L001']] }] },
        { file: 'a/empty-group.csv', kind: 'positive', about: 'x', findings: [{ criterion: 'X-1', must_cite: [[]] }] },
        { file: 'a/no-lines.csv', kind: 'positive', findings: [{ criterion: 'X-1', must_cite: [] }] },
      ],
    });
    expect(checked.sheet?.cases).toHaveLength(4);
    expect(checked.warnings).toEqual([
      'a/pos.csv: it is marked positive but lists no finding.',
      'a/near.csv: it is marked near_miss but lists a finding. The finding is scored as planted.',
      'a/empty-group.csv: X-1 has an empty group in "must_cite". It can never be caught.',
      'a/no-lines.csv: X-1 names no line that must be cited. Any confirmed finding will count as caught.',
      'a/no-lines.csv: it has no "about" sentence.',
    ]);
  });

  it('checks the sheet against the lines of a history and the active criteria', () => {
    const c = expectedCase('a/pos.csv', 'positive', [planted('X-1', ['L001'], ['L002', 'L099']), planted('OLD-9', ['L001'])]);
    expect(caseSheetWarnings(c, ['L001', 'L002'], ['X-1'])).toEqual([
      'a/pos.csv: the sheet names line L099 for X-1, but the history has no such line.',
      'a/pos.csv: the sheet expects OLD-9, but that criterion is not in the active list. It is not scored.',
    ]);
    // A history that could not be read: no line check.
    expect(caseSheetWarnings(c, null, ['X-1', 'OLD-9'])).toEqual([]);
  });
});

describe('a disputed planted finding is not a failure', () => {
  const criterion = makeCriterion('STOPP-C10');
  const caughtCase = expectedCase('STOPP-C10/pos-brand.csv', 'positive', [planted('STOPP-C10', ['L001'])]);
  const disputedCase = expectedCase('STOPP-C10/pos-buried.csv', 'positive', [planted('STOPP-C10', ['L002'])]);
  const missedCase = expectedCase('STOPP-C10/pos-other.csv', 'positive', [planted('STOPP-C10', ['L003'])]);

  it('is caught when Model 2 confirms it', () => {
    const s = scoreCriterion(criterion, [caughtCase], finder([
      pair(caughtCase.file, 'STOPP-C10', screenSuspected(['L001']), checkConfirmed(['L001']), letterByModel()),
    ], 'STOPP-C10'), true);
    expect(s).toMatchObject({ verdict: 'PASS', caught: 1, disputed: 0 });
  });

  it('is disputed when Model 1 suspects it and Model 2 turns it back', () => {
    const s = scoreCriterion(criterion, [disputedCase], finder([
      pair(disputedCase.file, 'STOPP-C10', screenSuspected(['L002']), checkNotConfirmed()),
    ], 'STOPP-C10'), true);
    expect(s).toMatchObject({ verdict: 'PASS', caught: 0, disputed: 1, failures: [], caveats: [] });
    expect(s.letters.needed).toBe(0);
  });

  it('is a miss, and a failure, when Model 1 does not suspect it', () => {
    const s = scoreCriterion(criterion, [missedCase], finder([
      pair(missedCase.file, 'STOPP-C10', screenClear()),
    ], 'STOPP-C10'), true);
    expect(s.verdict).toBe('FAIL');
    expect(s.failures.map((f) => f.text)).toEqual(['pos-other.csv: not suspected by Model 1.']);
  });

  it('passes when one planted finding is caught and one is disputed', () => {
    const s = scoreCriterion(criterion, [caughtCase, disputedCase], finder([
      pair(caughtCase.file, 'STOPP-C10', screenSuspected(['L001']), checkConfirmed(['L001']), letterByModel()),
      pair(disputedCase.file, 'STOPP-C10', screenSuspected(['L002']), checkNotConfirmed()),
    ], 'STOPP-C10'), true);
    expect(s).toMatchObject({ verdict: 'PASS', caught: 1, disputed: 1, failures: [], caveats: [] });
  });

  it('fails for the miss only when one planted finding is disputed and one is missed', () => {
    const s = scoreCriterion(criterion, [disputedCase, missedCase], finder([
      pair(disputedCase.file, 'STOPP-C10', screenSuspected(['L002']), checkNotConfirmed()),
      pair(missedCase.file, 'STOPP-C10', screenClear()),
    ], 'STOPP-C10'), true);
    expect(s.verdict).toBe('FAIL');
    expect(s.disputed).toBe(1);
    expect(s.failures.map((f) => f.text)).toEqual(['pos-other.csv: not suspected by Model 1.']);
    expect(s.whyFailed).toBe('pos-other.csv: not suspected by Model 1.');
  });
});
