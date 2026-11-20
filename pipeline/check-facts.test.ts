// docs/SPEC.md section 6a: the double-check of a criterion that needs a fact a dispensing history does not hold.
// No model is called: the tests pass a stand-in.
import { describe, expect, it } from 'vitest';
import type { ScreenResult } from '../shared/types.ts';
import { checkFinding, checkMessages, CHECK_SCHEMA, CHECK_SYSTEM, toCheckForm, type CheckAnswer } from './check.ts';
import { factsCriterion, factsLines, fakeChat, manyLines, noFactLines, testConfig, testCriterion, testLines, testPatient, userText } from './testkit.ts';

const EGFR = 'eGFR (estimated kidney function), the most recent result';

function first(lineIds: string[], missingFacts: string[] = [], reason = 'Digoxin is supplied long term.'): ScreenResult {
  return { lineIds, medicines: ['digoxin'], reason, linesVerified: lineIds.length > 0, missingFacts, model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 5 };
}

const answer = (a: CheckAnswer) => toCheckForm(a);

describe('the check prompt of a criterion that needs facts', () => {
  it('gives the record, the criterion with its facts, and what the first step says is missing', () => {
    const text = checkMessages(testPatient, noFactLines, factsCriterion, first(['L002', 'L003', 'L004'], [EGFR]))[1].content;
    expect(text).toContain('DISPENSING HISTORY WITH RECORDED FACTS');
    expect(text).toContain(`FACTS THIS CRITERION NEEDS\nFact 1 (RESULT line): ${EGFR}. Meets the criterion when: below 30 mL/min/1.73 m2.`);
    expect(text).toContain(`"suspected_lines":["L002","L003","L004"]`);
    expect(text).toContain(`"missing_facts":["${EGFR}"]`);
    expect(text.indexOf('FACTS THIS CRITERION NEEDS')).toBeLessThan(text.indexOf('SUSPECTED FINDING FROM THE FIRST STEP'));
  });

  it('explains the three cases in plain words: confirm with the fact line, confirm a possible finding, turn back', () => {
    const text = checkMessages(testPatient, factsLines, factsCriterion, first(['L002', 'L004']))[1].content;
    const task = text.split('SUSPECTED FINDING FROM THE FIRST STEP')[1];
    expect(task).toContain('"missing_facts":[]');                // the first step reported a finding with its fact line
    expect(task).toContain('1. The medicines meet the rule, and a fact line of the record meets the criterion. Confirm. Give the supply lines and the fact line.');
    expect(task).toContain('2. The medicines meet the rule, and the record holds no line about a fact that the finding needs. This is a possible finding. Confirm it.');
    expect(task).toContain('Do not turn it back because the fact is not on the record.');
    expect(task).toContain('3. The record holds a line about the fact, and that line shows that the fact does not meet the criterion. Do not confirm.');
    expect(task).toContain('Look for a line about each fact yourself.');
    expect(task.indexOf('step1_what_matches (')).toBeLessThan(task.indexOf('step4_confirmed (true or false)'));
    expect(text).not.toContain('\u2014');
  });

  it('uses the same four fields and the same system role for every criterion', async () => {
    const fake = fakeChat([answer({ confirmed: true, line_ids: ['L002', 'L004'], what_matches: 'Digoxin and an eGFR of 24.', what_cannot_be_seen: 'A digoxin level.' })]);
    await checkFinding(testConfig, testPatient, factsLines, factsCriterion, first(['L002', 'L004']), { chat: fake.chat });
    expect(fake.calls[0].schema).toBe(CHECK_SCHEMA);
    expect(fake.calls[0].messages[0].content).toBe(CHECK_SYSTEM);
  });

  it('leaves the prompt of a criterion without facts as it was: no word about facts', () => {
    const text = checkMessages(testPatient, testLines, testCriterion, { ...first(['L002', 'L003']), missingFacts: ['something'] })[1].content;
    expect(text).not.toContain('missing_facts');
    expect(text).not.toContain('FACTS');
    expect(text).toContain('step1_what_matches (one or two short sentences naming the medicines and their dates, or saying what is missing)');
  });

  it('still names the missing fact when the first step gave no line that exists, and asks for the whole history', () => {
    const text = checkMessages(testPatient, noFactLines, factsCriterion, first(['L900'], [EGFR]))[1].content;
    expect(text).toContain('"suspected_lines":[]');
    expect(text).toContain(`"missing_facts":["${EGFR}"]`);
    expect(text).toContain('The first step gave no line IDs that can be used here. Look through the whole history.');
    expect(text.indexOf('FACTS THIS CRITERION NEEDS')).toBeLessThan(text.indexOf('SUSPECTED FINDING FROM THE FIRST STEP'));
  });
});

describe('the double-check of a criterion that needs facts', () => {
  it('confirms a finding with its fact line', async () => {
    const fake = fakeChat([answer({
      confirmed: true, line_ids: ['L002', 'L003', 'L004', 'L005'],
      what_matches: 'Lanoxin from 2025-12-08 to 2026-06-16 and an eGFR of 24 mL/min/1.73 m2 on L004.', what_cannot_be_seen: 'A digoxin level.'
    })]);
    const result = await checkFinding(testConfig, testPatient, factsLines, factsCriterion, first(['L002', 'L003', 'L005']), { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L002', 'L003', 'L004', 'L005'] });
  });

  it('confirms a possible finding as possible: the record holds no line about the fact', async () => {
    const fake = fakeChat([answer({
      confirmed: true, line_ids: ['L002', 'L003', 'L004'],
      what_matches: 'Lanoxin is supplied for more than 90 days. The record contains no RESULT line for eGFR.', what_cannot_be_seen: 'The kidney function.'
    })]);
    const screen = first(['L002', 'L003', 'L004'], [EGFR]);
    const result = await checkFinding(testConfig, testPatient, noFactLines, factsCriterion, screen, { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L002', 'L003', 'L004'] });
    // The second check does not change what the first model named: the finding stays a possible finding.
    expect(screen.missingFacts).toEqual([EGFR]);
  });

  it('turns a finding back when the record holds the fact and it does not meet the criterion', async () => {
    const fake = fakeChat([answer({ confirmed: false, line_ids: [], what_matches: 'The eGFR on L004 is 41, which is not below 30.', what_cannot_be_seen: '' })]);
    const result = await checkFinding(testConfig, testPatient, factsLines, factsCriterion, first(['L002', 'L004']), { chat: fake.chat });
    expect(result).toMatchObject({ confirmed: false, completed: true, lineIds: [] });
    expect(result.unclear).toBeUndefined();
  });

  it('keeps every guard: a failed call leaves the finding in view, and a "no" with lines is marked unclear', async () => {
    const screen = first(['L002', 'L003', 'L004'], [EGFR]);
    const failed = await checkFinding(testConfig, testPatient, noFactLines, factsCriterion, screen, { chat: fakeChat([{ fail: 'Tried twice.' }]).chat });
    expect(failed).toMatchObject({ confirmed: false, completed: false, lineIds: ['L002', 'L003', 'L004'] });
    const unclear = await checkFinding(testConfig, testPatient, noFactLines, factsCriterion, screen, {
      chat: fakeChat([answer({ confirmed: false, line_ids: ['L002', 'L900'], what_matches: 'Digoxin is supplied.', what_cannot_be_seen: '' })]).chat
    });
    expect(unclear).toMatchObject({ confirmed: false, completed: true, unclear: true, lineIds: ['L002'] });
  });

  it('checks the listed lines of a long history together, the fact lines among them', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const lines = manyLines(24).map(l => (l.id === 'L022' ? { ...l, text: '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2' } : l));
    const long: ScreenResult = { ...first(['L002', 'L022']), listedLineIds: ['L002', 'L012', 'L022'] };
    const fake = fakeChat([answer({ confirmed: true, line_ids: ['L002', 'L022'], what_matches: 'Both are there.', what_cannot_be_seen: 'A digoxin level.' })]);
    const result = await checkFinding(cfg, testPatient, lines, factsCriterion, long, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    const text = userText(fake.calls[0]);
    expect(text).toContain('This history is long: 24 lines. Only the 3 lines that hold a medicine listed for this criterion, or a fact this criterion needs, are shown here.');
    expect(text).toContain('L022 | 2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2');
    expect(result).toMatchObject({ confirmed: true, completed: true, lineIds: ['L002', 'L022'] });
  });

  it('a call that throws still shows the finding, and an empty history is not treated as no finding', async () => {
    const screen = first(['L002', 'L003', 'L004'], [EGFR]);
    const thrown = await checkFinding(testConfig, testPatient, noFactLines, factsCriterion, screen, {
      chat: async () => { throw new Error('stand-in broke'); }
    });
    expect(thrown).toMatchObject({ confirmed: false, completed: false, lineIds: ['L002', 'L003', 'L004'] });
    expect(thrown.whatMatches).toBe('The second check did not finish, so this finding is shown without it. The check step failed: stand-in broke');
    expect(thrown.whatCannotBeSeen).toBe(factsCriterion.cannot_be_seen);
    expect(screen.missingFacts).toEqual([EGFR]);

    let called = false;
    const empty = await checkFinding(testConfig, testPatient, [], factsCriterion, first(['L002'], [EGFR]), {
      chat: async () => { called = true; throw new Error('should not be called'); }
    });
    expect(called).toBe(false);
    expect(empty).toMatchObject({ confirmed: false, completed: false, lineIds: [] });
    expect(empty.whatMatches).toContain('The history has no lines.');
    expect(empty.whatCannotBeSeen).toBe(factsCriterion.cannot_be_seen);
  });
});
