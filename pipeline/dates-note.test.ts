// The note "DATES": for a criterion that needs facts and counts months back from the end of the
// record, the dates are worked out for the models, so that they compare dates and do not have to
// subtract months. (Measured on 18 November: the first model found a result of 2025-06-04 and a
// latest date of 2026-09-19, and still wrote that the result lay "within 15 months".)
// No model is called.
import { describe, expect, it } from 'vitest';
import type { Criterion, HistoryLine, ScreenResult } from '../shared/types.ts';
import { checkFinding, checkMessages, toCheckForm } from './check.ts';
import { lineId } from './csv.ts';
import { monthsBefore } from './dates.ts';
import { datesNote, latestDate, monthsCountedBack, screenCriterion, screenMessages } from './screen.ts';
import { factsCriterion, factsLines, fakeChat, manyLines, testConfig, testCriterion, testLines, testPatient, userText } from './testkit.ts';

// A criterion like PINCER 3 of the drafted waves: a blood test that should have been done.
const TEST_DUE: Criterion = {
  ...factsCriterion,
  id: 'TEST-CHECK-DUE',
  label: 'Test criterion (kidney check due)',
  needs_facts: [{ kind: 'result', what: 'Kidney function', meets: 'No such result recorded in the 15 months before the latest date in the record' }],
  rule_for_models: 'Suspect a finding when a Group A medicine was first supplied at least 15 months before the latest date in the record, ' +
    'and it was supplied at least once in the last six months, AND the record holds no kidney function result in the last 15 months. ' +
    'If the record has no line about the test at all, report a possible finding.'
};

const RECORD: HistoryLine[] = [
  '2025-06-04 | RESULT | eGFR 58 mL/min/1.73 m2',
  '2025-06-10 | Lanoxin 250 microgram tablet | qty 100',
  'no date | CONDITION | Atrial fibrillation',
  '2026-09-19 | Lanoxin 250 microgram tablet | qty 100',
  '2026-08-18 | Lanoxin 250 microgram tablet | qty 100'
].map((text, i) => ({ id: lineId(i + 1), text }));

describe('counting months back', () => {
  it('gives the date a number of months before a date', () => {
    expect(monthsBefore('2026-09-19', 15)).toBe('2025-06-19');
    expect(monthsBefore('2026-09-19', 6)).toBe('2026-03-19');
    expect(monthsBefore('2026-01-15', 1)).toBe('2025-12-15');
    expect(monthsBefore('2026-01-15', 12)).toBe('2025-01-15');
    expect(monthsBefore('2026-09-19', 0)).toBe('2026-09-19');
  });

  it('moves the day back to the end of a shorter month', () => {
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBefore('2024-03-31', 1)).toBe('2024-02-29');      // a leap year
    expect(monthsBefore('2026-08-31', 2)).toBe('2026-06-30');
    expect(monthsBefore('2026-05-31', 6)).toBe('2025-11-30');
  });

  it('gives nothing for a date it cannot read', () => {
    expect(monthsBefore('19/09/2026', 6)).toBeNull();
    expect(monthsBefore('2026-02-30', 6)).toBeNull();
    expect(monthsBefore('2026-09-19', -1)).toBeNull();
    expect(monthsBefore('2026-09-19', 1.5)).toBeNull();
  });

  it('finds the latest date written at the start of a line', () => {
    expect(latestDate(RECORD)).toBe('2026-09-19');
    expect(latestDate([{ id: 'L001', text: 'no date | CONDITION | Gout' }, { id: 'L002', text: 'Example Pharmacy: 2026-01-01' }])).toBeNull();
    expect(latestDate([])).toBeNull();
    // A line entered at the counter is not an event of the history, even when it carries a later date.
    const withCounter = [
      ...RECORD,
      { id: 'L099', text: '2026-11-19 | CONDITION | Peptic ulcer disease. Confirmed by the pharmacist at the counter on 19 November 2026.' }
    ];
    expect(latestDate(withCounter)).toBe('2026-09-19');
  });
});

describe('the months a criterion counts back from the end of the record', () => {
  const withRule = (rule_for_models: string, meets = 'present on the record'): Criterion =>
    ({ ...factsCriterion, rule_for_models, needs_facts: [{ kind: 'condition', what: 'A condition', meets }] });

  it('are read from the words of the rule and of the facts', () => {
    expect(monthsCountedBack(TEST_DUE)).toEqual([6, 15]);
    expect(monthsCountedBack(withRule('no supply of any Group A medicine in the last six months of the record'))).toEqual([6]);
    expect(monthsCountedBack(withRule('no test in the previous three months, and none in the past 12 months'))).toEqual([3, 12]);
    expect(monthsCountedBack(withRule('older than the interval (12 months if aged 65 to 74, 6 months if aged 75 or over, counted back from the end of the record)'))).toEqual([6, 12]);
    expect(monthsCountedBack(withRule('a Group A medicine is supplied', 'No result recorded in the last 15 months'))).toEqual([15]);
  });

  it('leave out a length of treatment, which is not counted from the end', () => {
    expect(monthsCountedBack(withRule('a Group A medicine is supplied for more than 3 months, with supplies within 60 days of each other'))).toEqual([]);
    expect(monthsCountedBack(factsCriterion)).toEqual([]);          // "for more than 90 days"
  });

  it('are never read for a criterion that needs no facts', () => {
    const plain = { ...testCriterion, rule_for_models: 'no supply of a Group A medicine in the last six months of the record' };
    expect(monthsCountedBack(plain)).toEqual([]);
    expect(datesNote(RECORD, plain)).toBe('');
  });

  it('reads the other wordings, keeps each count once, and leaves out a count that is not from one to sixty', () => {
    expect(monthsCountedBack(withRule('no supply in the preceding one month'))).toEqual([1]);
    expect(monthsCountedBack(withRule('a result 15 months prior to the end, or 2 months before the last supply'))).toEqual([2, 15]);
    expect(monthsCountedBack(withRule('nothing in the last 0 months, and nothing in the last 61 months'))).toEqual([]);
    expect(monthsCountedBack(withRule('4 months of treatment, counted back from the latest date'))).toEqual([4]);
    expect(monthsCountedBack(withRule('the window is eighteen months, counted back from the last date'))).toEqual([18]);
    expect(monthsCountedBack(withRule('in the last six months and again in the past 6 months'))).toEqual([6]);
    const one = withRule('no supply in the last one month');
    expect(datesNote(RECORD, one)).toBe(
      'DATES\n' +
      'The latest date in this record is 2026-09-19. 1 month before it is 2026-08-19. ' +
      'Compare dates with these. A date earlier than one of them is more than that many months before the latest date. ' +
      'A date on or after it is within that many months.');
  });
});

describe('the note "DATES"', () => {
  it('gives the latest date and the date each count of months before it', () => {
    expect(datesNote(RECORD, TEST_DUE)).toBe(
      'DATES\n' +
      'The latest date in this record is 2026-09-19. 6 months before it is 2026-03-19. 15 months before it is 2025-06-19. ' +
      'Compare dates with these. A date earlier than one of them is more than that many months before the latest date. ' +
      'A date on or after it is within that many months.');
  });

  it('is empty when the criterion counts no months back, or the record shows no date', () => {
    expect(datesNote(factsLines, factsCriterion)).toBe('');
    expect(datesNote([{ id: 'L001', text: 'no date | CONDITION | Gout' }], TEST_DUE)).toBe('');
    expect(datesNote([], TEST_DUE)).toBe('');
  });

  it('stands in the screen prompt between the rule and the task, only for such a criterion', () => {
    const text = screenMessages(testPatient, RECORD, TEST_DUE)[1].content;
    expect(text).toContain('\n\nDATES\nThe latest date in this record is 2026-09-19. 6 months before it is 2026-03-19. 15 months before it is 2025-06-19.');
    expect(text.indexOf('RULE\n')).toBeLessThan(text.indexOf('DATES\n'));
    expect(text.indexOf('DATES\n')).toBeLessThan(text.indexOf('TASK\n'));
    // A criterion that needs facts and counts no months back has no such note, and neither has a criterion without facts.
    expect(screenMessages(testPatient, factsLines, factsCriterion)[1].content).not.toContain('DATES\n');
    expect(screenMessages(testPatient, testLines, testCriterion)[1].content).not.toContain('DATES\n');
    expect(screenMessages(testPatient, testLines, { ...testCriterion, rule_for_models: 'no NSAID in the last six months of the record' })[1].content)
      .not.toContain('DATES\n');
  });

  it('stands in the double-check prompt too, before the suspected finding', () => {
    const first: ScreenResult = { lineIds: ['L001', 'L002'], medicines: ['digoxin'], reason: 'x', linesVerified: true, missingFacts: [], model: 'm', at: '', seconds: 1 };
    const text = checkMessages(testPatient, RECORD, TEST_DUE, first)[1].content;
    expect(text).toContain('DATES\nThe latest date in this record is 2026-09-19.');
    expect(text.indexOf('DATES\n')).toBeLessThan(text.indexOf('SUSPECTED FINDING FROM THE FIRST STEP'));
    expect(checkMessages(testPatient, testLines, testCriterion, first)[1].content).not.toContain('DATES\n');
  });

  it('counts from the latest date of the whole record when only the listed lines of a long history are read together', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };       // parts: L001-L010, L008-L017, L015-L024
    // manyLines are dated in January 2026. One listed line is from 2025, and the last line of the record is from December 2026.
    const lines = manyLines(24).map(l => {
      if (l.id === 'L002') return { ...l, text: '2025-06-04 | RESULT | eGFR 58 mL/min/1.73 m2' };
      if (l.id === 'L012') return { ...l, text: '2025-06-10 | Lanoxin 250 microgram tablet | qty 100' };
      if (l.id === 'L024') return { ...l, text: '2026-12-01 | Lipitor (atorvastatin) 40 mg tablet | qty 30' };
      return l;
    });
    const listing = (ids: string[]) => ({ listed_line_ids: ids, reason: 'Listed.', medicines: [], line_ids: [], suspected: false });
    const fake = fakeChat([
      listing(['L002']), listing(['L012']), listing([]),
      { reason: 'The result is older than 15 months.', medicines: ['digoxin'], line_ids: ['L002', 'L012'], missing_facts: [], suspected: true }
    ]);
    const outcome = await screenCriterion(cfg, testPatient, lines, TEST_DUE, { chat: fake.chat });
    // The listed lines end in June 2025. The record ends on 2026-12-01, and that is the date the months are counted from.
    expect(userText(fake.calls[3])).toContain('The latest date in this record is 2026-12-01. 6 months before it is 2026-06-01. 15 months before it is 2025-09-01.');
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L002', 'L012'] } });

    const check = fakeChat([toCheckForm({ confirmed: true, line_ids: ['L002', 'L012'], what_matches: 'Old result.', what_cannot_be_seen: 'x' })]);
    if (outcome.ok) await checkFinding(cfg, testPatient, lines, TEST_DUE, outcome.result, { chat: check.chat });
    expect(userText(check.calls[0])).toContain('The latest date in this record is 2026-12-01.');
  });
});
