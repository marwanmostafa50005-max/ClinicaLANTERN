// docs/SPEC.md section 6a: the screen of a criterion that needs a fact a dispensing history does not hold.
// No model is called: the tests pass a stand-in.
import { describe, expect, it } from 'vitest';
import type { HistoryLine } from '../shared/types.ts';
import {
  CONTRADICTION_NOTE, NO_FACT_LINE_NOTE, readMissingFacts, readScreenAnswer, screenCriterion, screenMessages, screenSchemaFor,
  SCREEN_FACTS_SCHEMA, SCREEN_PART_SCHEMA, SCREEN_SCHEMA
} from './screen.ts';
import { checkAgainstSchema, type ChatRequest } from './ollama.ts';
import {
  factsCriterion, factsLines, fakeChat, manyLines, noFactLines, testConfig, testCriterion, testLines, testPatient, userText
} from './testkit.ts';

const AT = '2026-11-18T00:00:00.000Z';
const EGFR = 'eGFR (estimated kidney function), the most recent result';

/** The numbered lines of a prompt. */
function shownLines(req: ChatRequest): HistoryLine[] {
  return userText(req).split('\n')
    .map(l => /^(L\d{3,}) \| (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ id: m[1], text: m[2] }));
}

describe('the screen of a criterion that needs facts', () => {
  it('asks for the missing facts in its answer form: always there, before the yes or no', () => {
    expect(screenSchemaFor(factsCriterion)).toBe(SCREEN_FACTS_SCHEMA);
    expect(screenSchemaFor(testCriterion)).toBe(SCREEN_SCHEMA);
    expect(Object.keys(SCREEN_FACTS_SCHEMA.properties ?? {})).toEqual(['reason', 'medicines', 'line_ids', 'missing_facts', 'suspected']);
    expect(SCREEN_FACTS_SCHEMA.required).toEqual(['reason', 'medicines', 'line_ids', 'missing_facts', 'suspected']);
    expect(Object.keys(SCREEN_FACTS_SCHEMA.properties ?? {}).sort().pop()).toBe('suspected');   // last in alphabetical order too
    // The list may be empty, and it may not be left out.
    expect(checkAgainstSchema({ reason: 'x', medicines: [], line_ids: [], missing_facts: [], suspected: false }, SCREEN_FACTS_SCHEMA)).toBeNull();
    expect(checkAgainstSchema({ reason: 'x', medicines: [], line_ids: [], suspected: false }, SCREEN_FACTS_SCHEMA)).toBe('answer is missing "missing_facts"');
    // The form of a criterion without facts is the form it always had.
    expect(Object.keys(SCREEN_SCHEMA.properties ?? {})).toEqual(['reason', 'medicines', 'line_ids', 'suspected']);
  });

  it('lists the facts and explains the three cases in plain words', () => {
    const text = screenMessages(testPatient, factsLines, factsCriterion)[1].content;
    expect(text).toContain(
      'DISPENSING HISTORY WITH RECORDED FACTS (one supply or one fact per line, each line starts with its ID; ' +
      'a fact line says CONDITION, RESULT or OBSERVATION after its date)');
    expect(text).toContain('L004 | 2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2');
    expect(text).toContain(`FACTS THIS CRITERION NEEDS\nFact 1 (RESULT line): ${EGFR}. Meets the criterion when: below 30 mL/min/1.73 m2.`);
    const task = text.split('TASK')[1];
    expect(task).toContain('1. A finding. The medicines meet the rule, and a fact line of the record meets the criterion.');
    expect(task).toContain('2. A possible finding. The medicines meet the rule, but the record holds no line about a fact that the finding needs.');
    expect(task).toContain('3. No finding. The medicines do not meet the rule, or a fact line of the record shows that the fact does not meet the criterion.');
    expect(task).toContain('A supply line is never a fact line.');
    expect(task.indexOf('reason (')).toBeLessThan(task.indexOf('missing_facts ('));
    expect(task.indexOf('missing_facts (')).toBeLessThan(task.indexOf('suspected (true or false)'));
    expect(text).not.toContain('\u2014');                    // no em dash
    // The order is still: history first, then the criterion, then the task.
    expect(text.indexOf('DISPENSING HISTORY')).toBeLessThan(text.indexOf('CRITERION Test criterion'));
    expect(text.indexOf('FACTS THIS CRITERION NEEDS')).toBeLessThan(text.indexOf('RULE'));
    expect(text.indexOf('RULE')).toBeLessThan(text.indexOf('TASK'));
  });

  it('opens the same way for every criterion of one record, with or without facts', () => {
    // The reading of the record is reused from one criterion to the next (docs/SPEC.md section 3).
    const a = screenMessages(testPatient, factsLines, factsCriterion)[1].content;
    const b = screenMessages(testPatient, factsLines, testCriterion)[1].content;
    const shared = a.slice(0, a.indexOf('CRITERION'));
    expect(b.startsWith(shared)).toBe(true);
    expect(shared).toContain('L006 | 2026-06-16 | Lipitor');
  });

  it('case 1: the medicines match and the record holds the fact: a finding that cites the fact line', async () => {
    const fake = fakeChat([{
      reason: 'Lanoxin is supplied for more than 90 days and the eGFR is 24.', medicines: ['digoxin'],
      line_ids: ['L002', 'L003', 'L004', 'L005'], missing_facts: [], suspected: true
    }]);
    const outcome = await screenCriterion(testConfig, testPatient, factsLines, factsCriterion, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].schema).toBe(SCREEN_FACTS_SCHEMA);
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L002', 'L003', 'L004', 'L005'], missingFacts: [], linesVerified: true } });
    if (outcome.ok) expect(outcome.result.reason).toBe('Lanoxin is supplied for more than 90 days and the eGFR is 24.');
  });

  it('case 2: the medicines match and the record holds no line about the fact: a possible finding that names it', async () => {
    const fake = fakeChat([{
      reason: 'Lanoxin is supplied for more than 90 days. There is no eGFR line.', medicines: ['digoxin'],
      line_ids: ['L002', 'L003', 'L004'], missing_facts: ['eGFR'], suspected: true
    }]);
    const outcome = await screenCriterion(testConfig, testPatient, noFactLines, factsCriterion, { chat: fake.chat });
    // The name is written the way the criterion writes it, so the bell and the letter use the signed wording.
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L002', 'L003', 'L004'], missingFacts: [EGFR] } });
  });

  it('case 3: the record holds the fact and it does not meet the criterion: no finding, and no missing fact', async () => {
    const fake = fakeChat([{ reason: 'The eGFR is 41, which is not below 30.', medicines: ['digoxin'], line_ids: [], missing_facts: [], suspected: false }]);
    const outcome = await screenCriterion(testConfig, testPatient, factsLines, factsCriterion, { chat: fake.chat });
    expect(outcome).toMatchObject({ ok: true, suspected: false, result: { lineIds: [], missingFacts: [] } });
    // A "no" names no missing fact, whatever the model wrote in the list.
    const stray = readScreenAnswer({ reason: 'No digoxin.', medicines: [], line_ids: [], missing_facts: ['eGFR'], suspected: false }, factsLines, 'm', AT, 1, factsCriterion);
    expect(stray).toMatchObject({ suspected: false, result: { missingFacts: [] } });
  });

  it('shows a finding that names no fact line and no missing fact as a possible finding, and says so', () => {
    // The model says "finding" and gives the supply lines only. A fact is never taken as recorded without its line.
    const read = readScreenAnswer(
      { reason: 'Digoxin is supplied long term.', medicines: ['digoxin'], line_ids: ['L002', 'L003'], missing_facts: [], suspected: true },
      noFactLines, 'lantern-screen', AT, 1, factsCriterion);
    expect(read.suspected).toBe(true);
    expect(read.result.missingFacts).toEqual([EGFR]);
    expect(read.result.reason).toBe(`Digoxin is supplied long term. ${NO_FACT_LINE_NOTE}`);
    // With a fact line among its lines the finding stands as the model gave it.
    const withLine = readScreenAnswer(
      { reason: 'Digoxin with an eGFR of 24.', medicines: ['digoxin'], line_ids: ['L002', 'L004'], missing_facts: [], suspected: true },
      factsLines, 'lantern-screen', AT, 1, factsCriterion);
    expect(withLine.result.missingFacts).toEqual([]);
    expect(withLine.result.reason).toBe('Digoxin with an eGFR of 24.');
    // A suspected finding with no usable line at all is never dropped: it goes on as a possible finding.
    const noLines = readScreenAnswer(
      { reason: 'Suspected.', medicines: [], line_ids: ['L900'], missing_facts: [], suspected: true }, factsLines, 'm', AT, 1, factsCriterion);
    expect(noLines).toMatchObject({ suspected: true, result: { lineIds: [], linesVerified: false, missingFacts: [EGFR] } });
  });

  it('keeps a "no" that names lines as a suspected finding, as before, and applies the same rule to it', () => {
    const read = readScreenAnswer(
      { reason: 'The eGFR is 24.', medicines: ['digoxin'], line_ids: ['L002', 'L004'], missing_facts: [], suspected: false },
      factsLines, 'm', AT, 1, factsCriterion);
    expect(read.suspected).toBe(true);
    expect(read.result.reason).toBe(`The eGFR is 24. ${CONTRADICTION_NOTE}`);
    expect(read.result.missingFacts).toEqual([]);            // it named the fact line
  });

  it('never reads missing facts for a criterion that needs none', async () => {
    // Even if a model wrote the field, a criterion without needs_facts never gives a possible finding.
    const read = readScreenAnswer(
      { reason: 'Both supplied.', medicines: [], line_ids: ['L002', 'L003'], missing_facts: ['kidney function'], suspected: true },
      testLines, 'm', AT, 1, testCriterion);
    expect(read.result.missingFacts).toEqual([]);
    const fake = fakeChat([{ reason: 'Both supplied.', medicines: [], line_ids: ['L002', 'L003'], suspected: true }]);
    const outcome = await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: fake.chat });
    expect(fake.calls[0].schema).toBe(SCREEN_SCHEMA);
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { missingFacts: [] } });
  });

  it('reports a failed call as "could not be screened", never as a finding and never as clear', async () => {
    const outcome = await screenCriterion(testConfig, testPatient, factsLines, factsCriterion, { chat: fakeChat([{ fail: 'Tried twice.' }]).chat });
    expect(outcome).toEqual({ ok: false, error: 'Tried twice.' });
  });
});

describe('the missing facts a model names', () => {
  const several = {
    ...factsCriterion,
    needs_facts: [
      { kind: 'result' as const, what: 'Serum potassium', meets: 'below 3.0 mmol/L' },
      { kind: 'result' as const, what: 'Serum sodium', meets: 'below 130 mmol/L' },
      { kind: 'condition' as const, what: 'Gout', meets: 'a history of gout is recorded' },
      { kind: 'observation' as const, what: 'Clinic blood pressure', meets: '140 mmHg or more systolic' },
      { kind: 'observation' as const, what: 'Ambulatory blood pressure monitoring (ABPM) daytime average', meets: '135/85 mmHg or more' }
    ]
  };

  it('are written as the criterion writes them when a name fits exactly one fact', () => {
    expect(readMissingFacts(['eGFR'], factsCriterion)).toEqual([EGFR]);
    expect(readMissingFacts(['the eGFR result', 'kidney function'], factsCriterion)).toEqual([EGFR]);
    expect(readMissingFacts(['potassium', 'gout history', 'Serum sodium.'], several)).toEqual(['Serum potassium', 'Gout', 'Serum sodium']);
    expect(readMissingFacts(['ABPM daytime average'], several)).toEqual(['Ambulatory blood pressure monitoring (ABPM) daytime average']);
  });

  it('are kept as the model wrote them when a name fits no fact, or more than one', () => {
    expect(readMissingFacts(['blood pressure'], several)).toEqual(['blood pressure']);             // fits two facts
    expect(readMissingFacts(['liver function'], several)).toEqual(['liver function']);             // fits none: kept, never dropped
    expect(readMissingFacts(['Serum potassium, sodium and gout'], several)).toEqual(['Serum potassium, sodium and gout']);
  });

  it('are tidied: no empty name, no name twice, not more than eight, no name without end', () => {
    expect(readMissingFacts(['', '  ', 'eGFR', 'EGFR result'], factsCriterion)).toEqual([EGFR]);
    expect(readMissingFacts('eGFR', factsCriterion)).toEqual([]);
    expect(readMissingFacts(undefined, factsCriterion)).toEqual([]);
    expect(readMissingFacts(Array.from({ length: 20 }, (_, i) => `fact number ${i}`), several)).toHaveLength(8);
    expect(readMissingFacts(['x'.repeat(500)], several)[0]).toHaveLength(200);
  });
});

describe('a long history and a criterion that needs facts', () => {
  const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };       // parts: L001-L010, L008-L017, L015-L024
  const LANOXIN = '2026-03-10 | Lanoxin 250 microgram tablet | qty 100 | repeats 1 | Take ONE tablet daily | Dr A. Example';
  const withLines = (extra: Record<string, string>): HistoryLine[] => manyLines(24).map(l => (extra[l.id] ? { ...l, text: extra[l.id] } : l));
  const listing = (ids: string[]) => ({ listed_line_ids: ids, reason: 'Listed.', medicines: [], line_ids: [], suspected: false });

  it('asks each part to list the fact lines with the medicine lines, and decides when they are read together', async () => {
    const lines = withLines({ L002: LANOXIN, L012: LANOXIN, L022: '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2' });
    const fake = fakeChat([
      listing(['L002']), listing(['L012']), listing(['L022']),
      { reason: 'Digoxin long term and an eGFR of 24.', medicines: ['digoxin'], line_ids: ['L002', 'L012', 'L022'], missing_facts: [], suspected: true }
    ]);
    const outcome = await screenCriterion(cfg, testPatient, lines, factsCriterion, { chat: fake.chat });
    expect(fake.calls).toHaveLength(4);
    // A part cannot tell that a fact is missing: its form does not ask for missing facts.
    for (const call of fake.calls.slice(0, 3)) expect(call.schema).toBe(SCREEN_PART_SCHEMA);
    const partTask = userText(fake.calls[0]).split('TASK')[1];
    expect(partTask).toContain('and every fact line of THIS part that is about a fact this criterion needs');
    expect(partTask).toContain('do not report a finding only because a fact is not in this part');
    // The lines read together: the medicine lines and the fact line, with the form that asks for missing facts.
    expect(fake.calls[3].schema).toBe(SCREEN_FACTS_SCHEMA);
    expect(userText(fake.calls[3])).toContain(
      'This history is long: 24 lines. Only the 3 lines that hold a medicine listed for this criterion, or a fact this criterion needs, are shown here.');
    expect(shownLines(fake.calls[3]).map(l => l.id)).toEqual(['L002', 'L012', 'L022']);
    expect(outcome).toMatchObject({
      ok: true, suspected: true,
      result: { lineIds: ['L002', 'L012', 'L022'], listedLineIds: ['L002', 'L012', 'L022'], missingFacts: [] }
    });
  });

  it('gives a possible finding when no part holds a line about the fact', async () => {
    const lines = withLines({ L002: LANOXIN, L012: LANOXIN });
    const fake = fakeChat([
      listing(['L002']), listing(['L012']), listing([]),
      { reason: 'Digoxin long term. No eGFR line.', medicines: ['digoxin'], line_ids: ['L002', 'L012'], missing_facts: ['eGFR'], suspected: true }
    ]);
    const outcome = await screenCriterion(cfg, testPatient, lines, factsCriterion, { chat: fake.chat });
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L002', 'L012'], missingFacts: [EGFR] } });
  });

  it('is not called clear only because no line was listed: Model 1 is asked once more and told so', async () => {
    // A criterion about a medicine that should be there may be a finding with no medicine line at all.
    const clearAgain = fakeChat([
      listing([]), listing([]), listing([]),
      { reason: 'No digoxin is supplied.', medicines: [], line_ids: [], missing_facts: [], suspected: false }
    ]);
    const clear = await screenCriterion(cfg, testPatient, manyLines(24), factsCriterion, { chat: clearAgain.chat });
    expect(clearAgain.calls).toHaveLength(4);
    expect(userText(clearAgain.calls[3])).toContain(
      'No line of it holds a medicine listed for this criterion or a fact this criterion needs, so no line is shown here.');
    expect(clear).toMatchObject({ ok: true, suspected: false, result: { reason: 'No digoxin is supplied.', missingFacts: [] } });
    if (clear.ok) expect(clear.result.listedLineIds).toBeUndefined();

    const possible = fakeChat([
      listing([]), listing([]), listing([]),
      { reason: 'Nothing is recorded.', medicines: [], line_ids: [], missing_facts: ['eGFR'], suspected: true }
    ]);
    const found = await screenCriterion(cfg, testPatient, manyLines(24), factsCriterion, { chat: possible.chat });
    expect(found).toMatchObject({ ok: true, suspected: true, result: { lineIds: [], linesVerified: false, missingFacts: [EGFR] } });

    // A criterion without facts is clear without another call, as before.
    const plain = fakeChat([listing([]), listing([]), listing([])]);
    expect(await screenCriterion(cfg, testPatient, manyLines(24), testCriterion, { chat: plain.chat })).toMatchObject({ ok: true, suspected: false });
    expect(plain.calls).toHaveLength(3);
  });

  it('is "could not be screened" when a part could not be read and nothing was listed', async () => {
    const fake = fakeChat([listing([]), { fail: 'Tried twice.' }, listing([])]);
    const outcome = await screenCriterion(cfg, testPatient, manyLines(24), factsCriterion, { chat: fake.chat });
    expect(outcome.ok).toBe(false);
    expect(fake.calls).toHaveLength(3);
  });
});
