// Unit tests for the scoring of criteria that need a fact (docs/SPEC.md section 6a): histories
// named pos-fact and pos-nofact, possible findings, the plain reason of a FAIL, the class of a
// criterion and the lists a script reads. Hand-made inputs. No model is used.

import { describe, expect, it } from 'vitest';
import type { PairRecord } from './types.ts';
import {
  classLabel,
  criterionClass,
  factsNeeded,
  factsText,
  checkSheet,
  historyKind,
  isPossible,
  judgePlanted,
  letterCallFrom,
  letterObservations,
  missFailure,
  missingFactsOf,
  passingLists,
  scoreCriterion,
  scoreRun,
} from './score.ts';
import { notPassingLabel, percentText, renderTable } from './report.ts';
import {
  checkConfirmed,
  checkNotCompleted,
  checkNotConfirmed,
  expectedCase,
  letterBody,
  letterByModel,
  letterDraft,
  letterNotProduced,
  makeCriterion,
  makeFactCriterion,
  makeResults,
  pair,
  planted,
  screenClear,
  screenFailed,
  screenPossible,
  screenResult,
  screenSuspected,
} from './testkit.ts';

const SUP = makeCriterion('SUP-1');
const FACT = makeFactCriterion('FACT-2', 'eGFR');

function finder(pairs: PairRecord[], criterionId: string): (caseFile: string) => PairRecord | undefined {
  return (caseFile) => pairs.find((p) => p.caseFile === caseFile && p.criterionId === criterionId);
}

// The three histories of a criterion that needs a fact.
const withFact = expectedCase('FACT-2/pos-fact.csv', 'positive', [planted('FACT-2', ['L004', 'L008'], ['L001'])], 'The record holds an eGFR of 28.');
const noFact = expectedCase('FACT-2/pos-nofact.csv', 'positive', [planted('FACT-2', ['L003', 'L007'])], 'possible finding: the record holds no eGFR line.');
const nearMiss = expectedCase('FACT-2/near-miss.csv', 'near_miss', [], 'The record holds an eGFR of 72.');
const CASES = [withFact, noFact, nearMiss];
const FACT_LINES = { 'FACT-2/pos-fact.csv': ['L001'], 'FACT-2/near-miss.csv': ['L001'] };

describe('the class of a criterion', () => {
  it('is "needs a fact" when the criterion file lists a fact, and "supplies only" when it does not', () => {
    expect(criterionClass(SUP)).toBe('supplies_only');
    expect(criterionClass(FACT)).toBe('needs_a_fact');
    expect(factsNeeded(FACT)).toEqual([{ kind: 'condition', what: 'eGFR', meets: 'eGFR is recorded as a condition' }]);
    expect(factsNeeded(SUP)).toEqual([]);
    expect(criterionClass(makeCriterion('X-1', { needs_facts: [] }))).toBe('supplies_only');
    expect(classLabel('needs_a_fact')).toBe('needs a fact');
    expect(classLabel('supplies_only')).toBe('supplies only');
  });

  it('knows what a history is for by its name', () => {
    expect(historyKind('FACT-2/pos-fact.csv')).toBe('with_fact');
    expect(historyKind('FACT-2\\pos-nofact.csv')).toBe('no_fact');
    expect(historyKind('FACT-2/POS-NOFACT.CSV')).toBe('no_fact');
    expect(historyKind('FACT-2/near-miss.csv')).toBe('other');
    expect(historyKind('SUP-1/pos-brand.csv')).toBe('other');
  });
});

describe('a possible finding', () => {
  it('is a suspected finding whose first model named a fact the record does not show', () => {
    const possible = pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']));
    expect(isPossible(possible)).toBe(true);
    expect(missingFactsOf(possible.screen.result)).toEqual(['eGFR']);
    expect(isPossible(pair(noFact.file, 'FACT-2', screenSuspected(['L003']), checkConfirmed(['L003'])))).toBe(false);
    expect(isPossible(pair(noFact.file, 'FACT-2', screenClear()))).toBe(false);
    expect(isPossible(undefined)).toBe(false);
    // The list is tidied the way the app tidies it: no empty entry, no repeat, no full stop at the end.
    expect(missingFactsOf(screenResult(['L001'], 'x', [' eGFR. ', '', 'egfr', 'Heart failure']))).toEqual(['eGFR', 'Heart failure']);
    expect(missingFactsOf(undefined)).toEqual([]);
    expect(factsText(['eGFR', 'Heart failure.', 'Blood pressure'])).toBe('eGFR, Heart failure and Blood pressure');
  });

  it('counts as caught when it is confirmed, and the outcome says it was a possible one', () => {
    const outcome = judgePlanted(noFact.findings[0], pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003'])));
    expect(outcome).toMatchObject({ caught: true, possible: true, missingFacts: ['eGFR'] });
    expect(outcome.detail).toBe('Caught. Model 2 confirmed it and the planted lines were cited. It was reported as a possible finding. The record does not show: eGFR.');
    // A plain finding has no such mark.
    const plain = judgePlanted(noFact.findings[0], pair(noFact.file, 'FACT-2', screenSuspected(['L003']), checkConfirmed(['L003'])));
    expect(plain.caught).toBe(true);
    expect(plain.possible).toBeUndefined();
  });
});

describe('scoring histories named pos-fact and pos-nofact', () => {
  it('counts both as planted findings', () => {
    const pairs = [
      pair(withFact.file, 'FACT-2', screenSuspected(['L001', 'L004']), checkConfirmed(['L001', 'L004']), letterByModel()),
      pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']), letterByModel()),
      pair(nearMiss.file, 'FACT-2', screenClear()),
    ];
    const s = scoreCriterion(FACT, CASES, finder(pairs, 'FACT-2'), true);
    expect(s).toMatchObject({ verdict: 'PASS', planted: 2, caught: 2, class: 'needs_a_fact', possibleCaught: 1, failures: [], whyFailed: '' });
    expect(s.factHistories).toEqual({ withFactPlanted: 1, withFactCaught: 1, withFactPossible: 0, noFactPlanted: 1, noFactCaught: 1, noFactPossible: 1 });
    expect(s.catches.map((c) => [c.caseFile, c.possible, c.missingFacts])).toEqual([
      ['FACT-2/pos-fact.csv', false, []],
      ['FACT-2/pos-nofact.csv', true, ['eGFR']],
    ]);
  });

  it('counts a pos-nofact finding as caught when it is confirmed, possible or not, and records how many were possible', () => {
    const second = expectedCase('FACT-2/pos-nofact-2.csv', 'positive', [planted('FACT-2', ['L002'])]);
    const pairs = [
      // Reported as a possible finding: the record does not show the fact.
      pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']), letterByModel()),
      // Reported as a plain finding, with no missing fact named. It is still caught.
      pair(second.file, 'FACT-2', screenSuspected(['L002']), checkConfirmed(['L002']), letterByModel()),
    ];
    const s = scoreCriterion(FACT, [noFact, second], finder(pairs, 'FACT-2'), true);
    expect(s).toMatchObject({ verdict: 'PASS', planted: 2, caught: 2, possibleCaught: 1 });
    expect(s.factHistories).toMatchObject({ noFactPlanted: 2, noFactCaught: 2, noFactPossible: 1 });
  });

  it('does not count a pos-nofact finding that Model 2 turned back, or that Model 1 never suspected', () => {
    const turnedBack = scoreCriterion(FACT, [noFact], finder([pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkNotConfirmed())], 'FACT-2'), true);
    expect(turnedBack).toMatchObject({ verdict: 'PASS', caught: 0, disputed: 1 });
    expect(turnedBack.factHistories).toMatchObject({ noFactPlanted: 1, noFactCaught: 0, noFactPossible: 0 });
    expect(turnedBack.failures).toEqual([]);
    expect(turnedBack.disputes).toEqual([{
      criterionId: 'FACT-2', caseFile: 'FACT-2/pos-nofact.csv',
      detail: 'Disputed. Model 1 suspected it and Model 2 turned it back. It is shown to the pharmacist. It is not a failure.',
      citedByScreen: ['L003'], citedByCheck: [],
    }]);
    const notSuspected = scoreCriterion(FACT, [noFact], finder([pair(noFact.file, 'FACT-2', screenClear())], 'FACT-2'), true);
    expect(notSuspected.failures).toEqual([{ caseFile: 'FACT-2/pos-nofact.csv', step: 'not_suspected', text: 'pos-nofact.csv: not suspected by Model 1.' }]);
  });

  it('needs the fact line cited on a pos-fact history, and says so when it is not', () => {
    const pairs = [pair(withFact.file, 'FACT-2', screenSuspected(['L004', 'L008']), checkConfirmed(['L004']), letterByModel())];
    const s = scoreCriterion(FACT, [withFact], finder(pairs, 'FACT-2'), true, undefined, { factLines: (file) => FACT_LINES[file as keyof typeof FACT_LINES] ?? [] });
    expect(s).toMatchObject({ verdict: 'FAIL', caught: 0 });
    expect(s.misses[0]).toMatchObject({ why: 'planted_lines_not_cited', missingGroups: [['L001']] });
    expect(s.failures).toEqual([{ caseFile: 'FACT-2/pos-fact.csv', step: 'lines_not_cited', text: 'pos-fact.csv: it reached the bell, but the fact line L001 was not cited.' }]);
    expect(s.factHistories).toMatchObject({ withFactPlanted: 1, withFactCaught: 0 });
    // Without the list of fact lines the reason still names the line.
    const bare = scoreCriterion(FACT, [withFact], finder(pairs, 'FACT-2'), true);
    expect(bare.failures[0].text).toBe('pos-fact.csv: it reached the bell, but the planted line L001 was not cited.');
  });

  it('notes a pos-fact finding that was reported as possible all the same', () => {
    const pairs = [pair(withFact.file, 'FACT-2', screenPossible(['L001', 'L004'], ['Heart failure']), checkConfirmed(['L001', 'L004']), letterByModel())];
    const s = scoreCriterion(FACT, [withFact], finder(pairs, 'FACT-2'), true);
    expect(s).toMatchObject({ verdict: 'PASS', caught: 1, possibleCaught: 1 });
    expect(s.factHistories).toMatchObject({ withFactPlanted: 1, withFactCaught: 1, withFactPossible: 1 });
  });

  it('counts a near miss that is confirmed as a false flag, never as a failure', () => {
    const pairs = [
      pair(withFact.file, 'FACT-2', screenSuspected(['L001', 'L004']), checkConfirmed(['L001', 'L004']), letterByModel()),
      pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']), letterByModel()),
      pair(nearMiss.file, 'FACT-2', screenPossible(['L005'], ['eGFR']), checkConfirmed(['L005'])),
    ];
    const s = scoreCriterion(FACT, CASES, finder(pairs, 'FACT-2'), true);
    expect(s.verdict).toBe('PASS');
    expect(s.falseFlags).toHaveLength(1);
    expect(s.falseFlags[0]).toMatchObject({ caseFile: 'FACT-2/near-miss.csv', caseKind: 'near_miss', ownFolder: true, possible: true });
    expect(s.failures).toEqual([]);
  });

  it('warns when a history named pos-fact or pos-nofact lists no finding', () => {
    const checked = checkSheet({
      cases: [
        { file: 'FACT-2/pos-nofact.csv', kind: 'near_miss', about: 'x', findings: [] },
        { file: 'FACT-2/pos-fact.csv', kind: 'positive', about: 'x', findings: [{ criterion: 'FACT-2', must_cite: [['L001']] }] },
      ],
    });
    expect(checked.warnings).toEqual(['FACT-2/pos-nofact.csv: its name says a finding is planted, but it is marked near_miss and lists no finding. Nothing is scored as planted for it.']);
  });
});

describe('the plain reason of a FAIL', () => {
  const pos = expectedCase('SUP-1/pos-brand.csv', 'positive', [planted('SUP-1', ['L003'])]);
  const buried = expectedCase('SUP-1/pos-buried.csv', 'positive', [planted('SUP-1', ['L010'])]);
  const elsewhere = expectedCase('OTHER-9/pos-both.csv', 'positive', [planted('SUP-1', ['L002'])]);
  const reasonsFor = (pairs: PairRecord[], cases = [pos], lettersRun = true): string[] =>
    scoreCriterion(SUP, cases, finder(pairs, 'SUP-1'), lettersRun).failures.map((f) => `${f.step}: ${f.text}`);

  it('names the history and the step: not suspected by Model 1', () => {
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenClear())])).toEqual(['not_suspected: pos-brand.csv: not suspected by Model 1.']);
  });

  it('a finding Model 2 turned back is disputed, and it is not a reason for FAIL', () => {
    const s = scoreCriterion(SUP, [pos], finder([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkNotConfirmed())], 'SUP-1'), true);
    expect(s).toMatchObject({ verdict: 'PASS', caught: 0, disputed: 1, failures: [] });
    expect(s.caveats).toEqual([]);
  });

  it('call could not be completed, with the model that did not answer', () => {
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenFailed())])).toEqual(['call_not_completed: pos-brand.csv: call could not be completed (Model 1, screen).']);
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkNotCompleted())])).toEqual([
      'call_not_completed: pos-brand.csv: call could not be completed (Model 2, double-check).',
    ]);
    const body = letterBody(SUP, ['2026-08-21 | Examplex 200 mg capsule | qty 30']);
    const noAnswer = letterCallFrom({ ...letterDraft('template', ['The letter model did not answer.'], body), templateReason: 'no_answer' }, 5, SUP);
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), noAnswer)])).toEqual([
      'call_not_completed: pos-brand.csv: call could not be completed (Model 3, letter). The letter was built from the template.',
    ]);
  });

  it('letter missing', () => {
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterNotProduced())])).toEqual(['letter_missing: pos-brand.csv: letter missing.']);
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), { status: 'not_run', seconds: 0 })])).toEqual([
      'letter_missing: pos-brand.csv: letter missing. The run stopped before Model 3 wrote it.',
    ]);
    // With --no-letters a missing letter is not a failure, so there is no reason.
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']))], [pos], false)).toEqual([]);
  });

  it('the other ways a planted finding is lost each have their own words', () => {
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L001']), checkConfirmed(['L001']))])).toEqual([
      'lines_not_cited: pos-brand.csv: it reached the bell, but the planted line L003 was not cited.',
    ]);
    expect(reasonsFor([pair(pos.file, 'SUP-1', { status: 'not_read', seconds: 0, error: 'The file was not found.' })])).toEqual(['history_not_read: pos-brand.csv: the history could not be read.']);
    expect(reasonsFor([pair(pos.file, 'SUP-1', { status: 'not_run', seconds: 0 })])).toEqual([
      'not_run: pos-brand.csv: not run. The run stopped first, or the criterion was not screened on this history.',
    ]);
    const groups = [{ ids: ['L003'], texts: ['2026-08-21 | Examplex 200 mg capsule | qty 30'] }];
    const wrongLetter = letterCallFrom(letterDraft('model', [], letterBody(SUP, ['2026-01-06 | Samplol 5 mg tablet | qty 30'])), 2, SUP, groups);
    expect(reasonsFor([pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), wrongLetter)])).toEqual([
      'letter_without_lines: pos-brand.csv: the letter does not show the planted lines (L003).',
    ]);
    const several = missFailure('pos-fact.csv', 'FACT-2/pos-fact.csv', {
      caught: false,
      why: 'planted_lines_not_cited',
      detail: '',
      missingGroups: [['L001', 'L002'], ['L004', 'L008', 'L012', 'L016', 'L020', 'L024', 'L028']],
      citedByScreen: [],
      citedByCheck: [],
    }, new Set(['L001', 'L002']));
    expect(several.text).toBe('pos-fact.csv: it reached the bell, but none of the fact lines L001, L002 was cited, and none of the planted lines L004, L008, L012, L016, L020, L024 and 1 more was cited.');
  });

  it('gives one reason for each history that failed, and uses the path for a history in another folder', () => {
    const pairs = [
      pair(pos.file, 'SUP-1', screenClear()),
      pair(buried.file, 'SUP-1', screenSuspected(['L010']), checkNotConfirmed()),
      pair(elsewhere.file, 'SUP-1', screenFailed()),
    ];
    const s = scoreCriterion(SUP, [pos, buried, elsewhere], finder(pairs, 'SUP-1'), true);
    expect(s.failures.map((f) => f.text)).toEqual([
      'pos-brand.csv: not suspected by Model 1.',
      'OTHER-9/pos-both.csv: call could not be completed (Model 1, screen).',
    ]);
    expect(s.disputed).toBe(1);
    expect(s.whyFailed).toBe('pos-brand.csv: not suspected by Model 1. OTHER-9/pos-both.csv: call could not be completed (Model 1, screen).');
    // The miss is named. The finding Model 2 turned back is not in the reason.
    expect(s.reasons).toEqual(['Missed 2 of 3 planted findings.', '1 call could not be completed on a history with a planted finding. A failed call is never a clean result.']);
  });

  it('says so when the criterion file itself is the reason', () => {
    const bare = makeCriterion('SUP-1', { source: { ...SUP.source, credit: '' } });
    const caught = pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel());
    const s = scoreCriterion(bare, [pos], finder([caught], 'SUP-1'), true);
    expect(s.failures).toEqual([{ caseFile: null, step: 'criterion_text', text: 'The criterion file has no credit line.' }]);
  });

  it('has no reason for a criterion that did not fail', () => {
    const caught = pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel());
    expect(scoreCriterion(SUP, [pos], finder([caught], 'SUP-1'), true)).toMatchObject({ verdict: 'PASS', failures: [], whyFailed: '' });
  });
});

describe('own criterion only', () => {
  const posA = expectedCase('SUP-1/pos-brand.csv', 'positive', [planted('SUP-1', ['L003'])]);
  const nearA = expectedCase('SUP-1/near-miss.csv', 'near_miss');
  const clean = expectedCase('_clean/clean-1.csv', 'clean');
  const pairs: PairRecord[] = [
    { ...pair(posA.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel()), role: 'own' },
    { ...pair(nearA.file, 'SUP-1', screenClear()), role: 'own' },
    { ...pair(withFact.file, 'FACT-2', screenSuspected(['L001', 'L004']), checkConfirmed(['L001', 'L004']), letterByModel()), role: 'own' },
    { ...pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']), letterByModel()), role: 'own' },
    { ...pair(nearMiss.file, 'FACT-2', screenClear()), role: 'own' },
    { ...pair(clean.file, 'SUP-1', screenClear()), role: 'clean' },
    // The false-flag sample: SUP-1 on two histories written for FACT-2, FACT-2 on one written for SUP-1.
    { ...pair(withFact.file, 'SUP-1', screenSuspected(['L002']), checkConfirmed(['L002'])), role: 'sample' },
    { ...pair(noFact.file, 'SUP-1', screenSuspected(['L002']), checkNotConfirmed()), role: 'sample' },
    { ...pair(posA.file, 'FACT-2', screenFailed()), role: 'sample' },
  ];
  const cases = [posA, nearA, ...CASES, clean];
  const score = scoreRun({ criteria: [SUP, FACT], cases, pairs, lettersRun: true, ownCriterionOnly: true, factLines: FACT_LINES });
  const [sup, fact] = score.criteria;

  it('does not mark a criterion down for the histories it was never screened on', () => {
    expect(score.ownCriterionOnly).toBe(true);
    expect(sup.verdict).toBe('PASS');
    expect(fact.verdict).toBe('PASS');
    // Only the call that really failed is listed. In a full run every unscreened history would be.
    expect(sup.notCompleted).toEqual([]);
    expect(fact.notCompleted).toEqual([
      { criterionId: 'FACT-2', caseFile: 'SUP-1/pos-brand.csv', stage: 'screen', planted: false, detail: 'Model 1 could not screen it. Error: Tried twice. The local model server did not answer.', role: 'sample' },
    ]);
    const full = scoreRun({ criteria: [SUP, FACT], cases, pairs, lettersRun: true });
    expect(full.criteria[1].notCompleted.length).toBeGreaterThan(1);
  });

  it('counts what the false-flag sample found, on its own', () => {
    expect(sup.sample).toEqual({ screenings: 2, answered: 2, falseFlags: 1, turnedBack: 1, notCompleted: 0 });
    expect(fact.sample).toEqual({ screenings: 1, answered: 0, falseFlags: 0, turnedBack: 0, notCompleted: 1 });
    expect(score.totals.sample).toEqual({ screenings: 3, answered: 2, falseFlags: 1, turnedBack: 1, notCompleted: 1 });
    expect(sup.falseFlags.map((f) => [f.caseFile, f.role])).toEqual([['FACT-2/pos-fact.csv', 'sample']]);
    expect(score.totals.falseFlagsByRole).toEqual({ own: 0, clean: 0, sample: 1, full: 0 });
    expect(score.totals).toMatchObject({ needsAFact: 1, suppliesOnly: 1, possibleCaught: 1, falseFlags: 1 });
    expect(percentText(1, 2)).toBe('50.0%');
    expect(percentText(3, 1132)).toBe('0.3%');
    expect(percentText(0, 0)).toBe('no rate');
    expect(percentText(0, 3210)).toBe('0.0%');
    expect(percentText(1, 3210)).toBe('less than 0.1%');      // never "0.0%" when something was found
  });

  it('still counts a planted finding that has no record at all as missed', () => {
    const lonely = scoreRun({ criteria: [SUP], cases: [posA], pairs: [], lettersRun: true, ownCriterionOnly: true });
    expect(lonely.criteria[0]).toMatchObject({ verdict: 'FAIL', planted: 1, caught: 0 });
    expect(lonely.criteria[0].failures[0].step).toBe('not_run');
  });
});

describe('the lists a script reads', () => {
  const pos = expectedCase('SUP-1/pos-brand.csv', 'positive', [planted('SUP-1', ['L003'])]);
  const caught = pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel());
  const missedFact = pair(noFact.file, 'FACT-2', screenClear());

  it('puts the criteria that PASS under passing, and every other one under not_passing with its reason', () => {
    const score = scoreRun({ criteria: [SUP, FACT], cases: [pos, noFact], pairs: [caught, pair(noFact.file, 'SUP-1', screenClear()), pair(pos.file, 'FACT-2', screenClear()), missedFact], lettersRun: true });
    expect(passingLists(score)).toEqual({
      passing: ['SUP-1'],
      not_passing: [
        { id: 'FACT-2', result: 'FAIL', reason: 'pos-nofact.csv: not suspected by Model 1.', reasons: ['pos-nofact.csv: not suspected by Model 1.'], class: 'needs_a_fact', wave: null },
      ],
    });
  });

  it('never lists a part run, or a criterion that was not tested, as passing', () => {
    const noLetters = scoreRun({ criteria: [SUP, FACT], cases: [pos], pairs: [pair(pos.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003'])), pair(pos.file, 'FACT-2', screenClear())], lettersRun: false });
    const lists = passingLists(noLetters);
    expect(lists.passing).toEqual([]);
    expect(lists.not_passing).toEqual([
      { id: 'SUP-1', result: 'PASS_PART', reason: 'Nothing failed, but the run did not cover everything. Letters were not run.', reasons: ['Nothing failed, but the run did not cover everything. Letters were not run.'], class: 'supplies_only', wave: null },
      { id: 'FACT-2', result: 'NOT_TESTED', reason: 'No planted finding for this criterion was in this run.', reasons: ['No planted finding for this criterion was in this run.'], class: 'needs_a_fact', wave: null },
    ]);
  });

  it('adds the criteria that were not scored, and the wave folder each criterion came from', () => {
    const score = scoreRun({ criteria: [SUP], cases: [pos], pairs: [caught], lettersRun: true, ownCriterionOnly: true });
    const lists = passingLists(
      score,
      [
        { id: 'GONE-3', result: 'NOT_DRAFTED', reason: 'not drafted', wave: 'W901' },
        { id: 'BAD-5', result: 'FILES_NOT_USABLE', reason: 'files not usable: criterion.json: it is not JSON', wave: 'W902' },
      ],
      (id) => (id === 'SUP-1' ? 'W901' : null),
    );
    expect(lists.passing).toEqual(['SUP-1']);
    expect(lists.not_passing).toEqual([
      { id: 'GONE-3', result: 'NOT_DRAFTED', reason: 'not drafted', reasons: ['not drafted'], class: null, wave: 'W901' },
      { id: 'BAD-5', result: 'FILES_NOT_USABLE', reason: 'files not usable: criterion.json: it is not JSON', reasons: ['files not usable: criterion.json: it is not JSON'], class: null, wave: 'W902' },
    ]);
    expect(notPassingLabel('NOT_DRAFTED')).toBe('NOT DRAFTED');
    expect(notPassingLabel('FILES_NOT_USABLE')).toBe('FILES NOT USABLE');
    expect(notPassingLabel('PASS_PART')).toBe('PASS (part run)');
    expect(notPassingLabel('NOT_TESTED')).toBe('NOT TESTED');
  });
});

describe('the table', () => {
  const pos = expectedCase('SUP-1/pos-brand.csv', 'positive', [planted('SUP-1', ['L003'])]);
  const results = makeResults({
    criteria: [SUP, FACT],
    cases: [pos, ...CASES],
    pairs: [
      pair(pos.file, 'SUP-1', screenClear()),
      pair(withFact.file, 'FACT-2', screenSuspected(['L001', 'L004']), checkConfirmed(['L001', 'L004']), letterByModel()),
      pair(noFact.file, 'FACT-2', screenPossible(['L003'], ['eGFR']), checkConfirmed(['L003']), letterByModel()),
      pair(nearMiss.file, 'FACT-2', screenPossible(['L005'], ['eGFR']), checkConfirmed(['L005'])),
    ],
    ownCriterionOnly: true,
    factLines: FACT_LINES,
    over: { mode: 'quick' },
  });
  const table = renderTable(results);

  it('gives each criterion its class and, for a FAIL, the plain reason', () => {
    expect(table).toContain('| Criterion | Result | Caught / planted | Disputed | Criterion text | False flags | Failed calls | Letters | Seconds | ID | Class | Why it failed |');
    expect(table).toContain('| SUP 1 | FAIL | 0 / 1 | 0 | yes | 0 | 0 | none needed | 5.0 | SUP-1 | supplies only | pos-brand.csv: not suspected by Mantle. |');
    expect(table).toContain('| FACT 2 | PASS | 2 / 2 | 0 | yes | 1 | 0 | 2 of 2: 2 by the model | 46.0 | FACT-2 | needs a fact |  |');
    const why = table.slice(table.indexOf('## Why each FAIL'), table.indexOf('## Misses'));
    expect(why).toContain('- **SUP 1**: Missed 1 of 1 planted finding.');
    expect(why).toContain('  - pos-brand.csv: not suspected by Mantle.');
    expect(table).toContain('- Class: "supplies only" when the criterion is decided from the supplies alone. "needs a fact" when it also needs a condition, a result or a measurement.');
    expect(table).toContain('- Why it failed: for a FAIL, which history failed and at which step. Not suspected by Mantle. Call could not be completed. Letter missing. A finding Lumen turned back is disputed, and it is not in this column.');
  });

  it('records how many pos-nofact findings were reported as possible', () => {
    expect(table).toContain('- Histories with no line about the fact (`pos-nofact`): caught 1 of 1. Reported as a possible finding: 1. Reported as a plain finding: 0. Both count as caught.');
    expect(table).toContain('- Histories that hold the fact (`pos-fact`): caught 1 of 1.');
    const section = table.slice(table.indexOf('## Possible findings'), table.indexOf('## False flags'));
    expect(section).toContain('It counts as caught.');
    expect(section).toContain('- **FACT 2** on `FACT-2/pos-nofact.csv`. The record does not show: eGFR.');
    expect(section).not.toContain('pos-fact.csv');
    // A near miss that was confirmed is a false flag, and the table says it was a possible one.
    expect(table).toContain('- **FACT 2** on `FACT-2/near-miss.csv`, the near miss written for this criterion. It was reported as a possible finding.');
    expect(table).toContain('- A near miss that is confirmed is a false flag. It is counted and it is never a failure.');
  });

  it('lists a pos-nofact finding that was reported as a plain finding', () => {
    const plain = makeResults({
      criteria: [FACT],
      cases: [noFact],
      pairs: [pair(noFact.file, 'FACT-2', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel())],
    });
    const text = renderTable(plain);
    expect(text).toContain('- Histories with no line about the fact (`pos-nofact`): caught 1 of 1. Reported as a possible finding: 0. Reported as a plain finding: 1. Both count as caught.');
    expect(text).toContain('No caught finding was reported as a possible finding.');
    expect(text).toContain('Caught on a history with no line about the fact, and reported as a plain finding, not a possible one. It still counts as caught:');
    expect(text).toContain('- **FACT 2** on `FACT-2/pos-nofact.csv`.');
  });

  it('keeps the table of a run without such criteria as it was', () => {
    const pos2 = expectedCase('SUP-1/pos.csv', 'positive', [planted('SUP-1', ['L003'])]);
    const plain = renderTable(makeResults({ criteria: [SUP], cases: [pos2], pairs: [pair(pos2.file, 'SUP-1', screenSuspected(['L003']), checkConfirmed(['L003']), letterByModel())] }));
    expect(plain).not.toContain('## Possible findings');
    expect(plain).not.toContain('pos-nofact');
    expect(plain).not.toContain('quick run');
    expect(plain).not.toContain('## Sampled false-flag estimate');
    expect(plain).not.toContain('## Not drafted');
  });

  it('uses no long dash', () => {
    expect(table.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(table.includes(String.fromCharCode(0x2013))).toBe(false);
  });
});

describe('the letter of a possible finding', () => {
  it('is noted when it does not ask the doctor to confirm the fact, without changing the result', () => {
    const silent = letterDraft('model', [], letterBody(FACT));
    expect(letterObservations(silent, FACT, true)).toEqual(['The letter is for a possible finding, but it does not ask the doctor to confirm the fact.']);
    expect(letterObservations(silent, FACT, false)).toEqual([]);
    const asks = letterDraft('model', [], `Could you please confirm whether this applies to the patient?\n${letterBody(FACT)}`);
    expect(letterObservations(asks, FACT, true)).toEqual([]);
    expect(letterCallFrom(silent, 2, FACT, [], true)).toMatchObject({ status: 'model_clean', observations: ['The letter is for a possible finding, but it does not ask the doctor to confirm the fact.'] });
  });
});
