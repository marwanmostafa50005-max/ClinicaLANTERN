// The server joined to the real model jobs (screen, double-check, letter), with a stand-in for the
// model itself. One record that carries a condition and no result goes from import to a letter for
// a possible finding (docs/SPEC.md section 6a). No model is called.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criterion, LanternConfig } from '../shared/types.ts';
import { checkFinding, toCheckForm } from '../pipeline/check.ts';
import { draftLetter, LETTER_SCHEMA } from '../pipeline/letter.ts';
import type { ChatFn, ChatRequest, ChatResult } from '../pipeline/ollama.ts';
import { screenCriterion, screenHistory, SCREEN_FACTS_SCHEMA, SCREEN_SCHEMA } from '../pipeline/screen.ts';
import { factsCriterion, testConfig, testCriterion, userText } from '../pipeline/testkit.ts';
import { Engine } from './engine.ts';
import { PageImages } from './images.ts';
import { StateStore } from './store.ts';
import { HELD_FOR_MODELS } from './view.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const EGFR = 'eGFR (estimated kidney function), the most recent result';
const HEADER = 'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value';
const SUPPLY = (date: string): string => `F-022,72,M,,${date},,Lanoxin PG,62.5 microgram,tablet,200,1,Take TWO tablets daily,Dr A. Example,,`;

// No line about the eGFR: the medicines match and the fact is missing.
const NO_FACT_CSV = [HEADER, 'F-022,72,M,condition,2025-12-09,,,,,,,,,Atrial fibrillation,', SUPPLY('2025-12-10'), SUPPLY('2026-03-18'), SUPPLY('2026-06-24')].join('\r\n');
// The same supplies with an eGFR of 24: the fact is on the record and meets the criterion.
const WITH_FACT_CSV = [HEADER, SUPPLY('2025-12-10'), SUPPLY('2026-03-18'), 'F-022,72,M,result,2026-05-12,,,,,,,,,eGFR,24 mL/min/1.73 m2', SUPPLY('2026-06-24')].join('\r\n');

/**
 * A stand-in for the three models. It answers by what the request is: the screen of the criterion
 * with facts, the screen of the plain criterion, the double-check, or the letter.
 */
function standIn(letterFails = false, screenFails = false, checkFails = false, checkTurnsBack = false, checkUnclear = false, letterThrows = false, letterServerDown = false, letterChecksFail = false, letterRedrafts = false, letterSecondEmpty = false, screenServerDown = false, checkServerDown = false, checkThrows = false): { chat: ChatFn; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const chat: ChatFn = async <T>(_cfg: LanternConfig, req: ChatRequest): Promise<ChatResult<T>> => {
    requests.push(req);
    if ((screenFails || screenServerDown) && (req.schema === SCREEN_SCHEMA || req.schema === SCREEN_FACTS_SCHEMA)) {
      // An empty answer is a failed screen. The server being down leaves the step waiting. Neither is a clear result.
      return {
        ok: false,
        error: screenServerDown ? 'The local model server did not answer.' : 'The model sent an empty answer.',
        timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
      };
    }
    const text = userText(req);
    const shown = (text.match(/^L\d{3,} \| .*$/gm) ?? []).map(line => ({ id: line.slice(0, 4), text: line.slice(7) }));
    const digoxin = shown.filter(l => l.text.includes('Lanoxin')).map(l => l.id);
    const egfr = shown.filter(l => l.text.includes('| RESULT | eGFR')).map(l => l.id);
    let value: unknown;
    if (req.schema === SCREEN_FACTS_SCHEMA) {
      value = egfr.length > 0
        ? { reason: 'Digoxin long term and an eGFR of 24.', medicines: ['digoxin'], line_ids: [...digoxin, ...egfr], missing_facts: [], suspected: true }
        : { reason: 'Digoxin long term. There is no eGFR line.', medicines: ['digoxin'], line_ids: digoxin, missing_facts: ['eGFR'], suspected: true };
    } else if (req.schema === SCREEN_SCHEMA) {
      value = { reason: 'No NSAID and no anticoagulant.', medicines: [], line_ids: [], suspected: false };
    } else if ('step4_confirmed' in (req.schema.properties ?? {})) {
      if (checkThrows) {
        // A throw is not "the server is down". The finding is shown, and the check is not completed.
        throw new Error('the check call broke');
      }
      if (checkServerDown) {
        // The server did not answer. The finding stays with the first model. It is not dismissed.
        return {
          ok: false,
          error: 'The local model server did not answer.',
          timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
        };
      }
      if (checkFails) {
        // An empty answer is a failed check. It is not "the server is down", so the finding is not left waiting.
        return {
          ok: false,
          error: 'The model sent an empty answer.',
          timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
        };
      }
      value = checkUnclear
        ? toCheckForm({ confirmed: false, line_ids: digoxin, what_matches: 'These supply lines were named.', what_cannot_be_seen: 'A digoxin level.' })
        : checkTurnsBack
          ? toCheckForm({ confirmed: false, line_ids: [], what_matches: 'The supplies do not meet the criterion.', what_cannot_be_seen: 'A digoxin level.' })
          : toCheckForm({ confirmed: true, line_ids: [...digoxin, ...egfr], what_matches: 'Digoxin is supplied long term.', what_cannot_be_seen: 'A digoxin level.' });
    } else if (req.schema === LETTER_SCHEMA && letterServerDown) {
      // The server did not answer. The letter stays waiting. It is not built from the template.
      return {
        ok: false,
        error: 'The local model server did not answer.',
        timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
      };
    } else if (req.schema === LETTER_SCHEMA && letterThrows) {
      // A throw is not "the server is down". The letter job builds the template and does not stay waiting.
      throw new Error('the letter call broke');
    } else if (req.schema === LETTER_SCHEMA && letterRedrafts) {
      // The first draft tells the doctor what to do. The second draft passes.
      const letterCalls = requests.filter(r => r.schema === LETTER_SCHEMA).length;
      value = letterCalls === 1
        ? {
          subject: 'Possible finding: digoxin and kidney function',
          finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
          evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026.',
          request_paragraph: 'The dose should be reduced. Could you please confirm the most recent eGFR?'
        }
        : {
          subject: 'Possible finding: digoxin and kidney function',
          finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
          evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026.',
          request_paragraph: 'Could you please confirm the most recent eGFR, and review the digoxin dose if it is below 30 mL/min/1.73 m2? I am happy to help with any information from our records.'
        };
    } else if (req.schema === LETTER_SCHEMA && letterSecondEmpty) {
      // The first draft fails its checks. The second answer is empty, so the template is used.
      const letterCalls = requests.filter(r => r.schema === LETTER_SCHEMA).length;
      if (letterCalls > 1) {
        return {
          ok: false,
          error: 'The model sent an empty answer.',
          timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
        };
      }
      value = {
        subject: 'Possible finding: digoxin and kidney function',
        finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
        evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026.',
        request_paragraph: 'The dose should be reduced. Could you please confirm the most recent eGFR?'
      };
    } else if (req.schema === LETTER_SCHEMA && letterChecksFail) {
      // Both drafts tell the doctor what to do. The checks fail and the template is used.
      value = {
        subject: 'Possible finding: digoxin and kidney function',
        finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
        evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026.',
        request_paragraph: 'The dose should be reduced. Could you please confirm the most recent eGFR?'
      };
    } else if (req.schema === LETTER_SCHEMA && letterFails) {
      // An empty answer is a failed call. It is not "the server is down", so the letter is still written.
      return {
        ok: false,
        error: 'The model sent an empty answer.',
        timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 0, outputSeconds: 0, attempts: 1 }
      };
    } else if (text.includes('"possible_finding"')) {
      value = {
        subject: 'Possible finding: digoxin and kidney function',
        finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term. The record we hold does not show an eGFR result.',
        evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026.',
        request_paragraph: 'Could you please confirm the most recent eGFR, and review the digoxin dose if it is below 30 mL/min/1.73 m2? I am happy to help with any information from our records.'
      };
    } else {
      value = {
        subject: 'Review request: digoxin and kidney function',
        finding_paragraph: 'I am writing about a possible medicines issue for this patient. Digoxin has been supplied long term and the eGFR on our record is below 30 mL/min/1.73 m2.',
        evidence_paragraph: 'Lanoxin PG 62.5 microgram was supplied on 10 December 2025, 18 March 2026 and 24 June 2026. An eGFR of 24 mL/min/1.73 m2 was recorded on 12 May 2026.',
        request_paragraph: 'Could you please review the digoxin dose against the current eGFR? I am happy to help with any information from our records.'
      };
    }
    return { ok: true, value: value as T, timings: { wallSeconds: 1, loadSeconds: 0, promptTokens: 400, promptSeconds: 0.1, outputTokens: 40, outputSeconds: 0.5, attempts: 1 } };
  };
  return { chat, requests };
}

function start(criteria: Criterion[], letterFails = false, screenFails = false, checkFails = false, checkTurnsBack = false, checkUnclear = false, letterThrows = false, letterServerDown = false, letterChecksFail = false, letterRedrafts = false, letterSecondEmpty = false, screenServerDown = false, checkServerDown = false, checkThrows = false): { engine: Engine; requests: ChatRequest[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-records-pipeline-'));
  made.push(dir);
  const store = new StateStore(dir);
  store.load();
  const model = standIn(letterFails, screenFails, checkFails, checkTurnsBack, checkUnclear, letterThrows, letterServerDown, letterChecksFail, letterRedrafts, letterSecondEmpty, screenServerDown, checkServerDown, checkThrows);
  const when = new Date(2026, 10, 18, 9, 30);
  const deps = (signal?: AbortSignal) => ({ chat: model.chat, signal, now: () => when });
  // Joined the way server/index.ts joins them, with the stand-in in place of the model.
  const engine = new Engine({
    cfg: testConfig, store, images: new PageImages(path.join(dir, 'images')),
    loadCriteria: async () => criteria,
    pipeline: {
      screenCriterion: (c, patient, lines, criterion, signal) => screenCriterion(c, patient, lines, criterion, deps(signal)),
      screenHistory: (c, patient, lines, list, hooks, signal) => screenHistory(c, patient, lines, list, deps(signal), hooks),
      checkFinding: (c, patient, lines, criterion, screen, signal) => checkFinding(c, patient, lines, criterion, screen, deps(signal)),
      draftLetter: (c, patient, lines, criterion, finding, signal) => draftLetter(c, patient, lines, criterion, finding, deps(signal)),
      transcribePageImage: async () => ({ ok: true, rows: [] })
    },
    now: () => when,
    // A held letter must not probe the real model server, and must not be started again during the test.
    ...((letterServerDown || screenServerDown || checkServerDown) ? { modelsUp: async () => false, holdDelayMs: 60_000 } : {})
  });
  return { engine, requests: model.requests };
}

describe('one record through the server and the real model jobs', () => {
  const PLAIN: Criterion = { ...testCriterion, id: 'PLAIN' };
  const FACTS: Criterion = { ...factsCriterion, id: 'FACTS' };

  it('a record with no line about the fact: a possible finding at the bell, and a letter that asks the doctor to confirm', async () => {
    const { engine, requests } = start([PLAIN, FACTS]);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();

    const c = engine.state.cases[0];
    expect(c.lines.map(l => l.text.split(' | ')[1])).toEqual(['CONDITION', 'Lanoxin PG 62.5 microgram tablet', 'Lanoxin PG 62.5 microgram tablet', 'Lanoxin PG 62.5 microgram tablet']);
    expect(c.screening.criteria.map(run => [run.criterionId, run.status])).toEqual([['PLAIN', 'clear'], ['FACTS', 'suspected']]);
    // Lanoxin is on a supply line, so the criterion that lists it is screened first and keeps the form with missing_facts. Its check reaches the bell before the plain criterion is screened.
    expect(requests[0].schema).toBe(SCREEN_FACTS_SCHEMA);
    expect(userText(requests[1])).toContain(`"missing_facts":["${EGFR}"]`);
    expect(requests[2].schema).toBe(SCREEN_SCHEMA);

    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(f.screen.missingFacts).toEqual([EGFR]);
    expect(f.screen.lineIds).toEqual(['L002', 'L003', 'L004']);
    expect(engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 1, bellBadge: 1 });

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'model', checkNotes: [] });
    expect(letter.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(letter.body).toContain('Could you please confirm the most recent eGFR');
    expect(letter.body).toContain('Dispensing lines from our records');
    expect(letter.body).toContain('Fictional patient. No real person.');
    expect(letter.body).not.toContain('CONDITION | Atrial fibrillation');           // a fact line that was not cited is not printed
  });

  it('a record that holds the fact: a finding that cites the fact line, and a letter that prints it', async () => {
    const { engine } = start([PLAIN, FACTS]);
    await engine.start();
    await engine.importCase({ fileName: 'pos-fact.csv', source: 'csv', csvText: WITH_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: false });
    expect(f.screen.missingFacts).toEqual([]);
    expect(f.screen.lineIds).toEqual(['L001', 'L002', 'L003', 'L004']);
    expect(engine.state.activity.some(a => a.text.includes('possible finding'))).toBe(false);

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    const letter = engine.state.letters[0];
    expect(letter.draft).toMatchObject({ origin: 'model', checkNotes: [] });
    expect(letter.body).toContain('Lines from our records');
    expect(letter.body).toContain('2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2');
    expect(letter.body).not.toContain('The record we hold does not show');
  });

  it('a letter the model answers with nothing is still written, and still says the fact is missing', async () => {
    const { engine, requests } = start([PLAIN, FACTS], true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toEqual([]);

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(1);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'no_answer' });
    expect(letter.draft?.checkNotes[0]).toContain('The letter model did not answer.');
    expect(letter.draft?.checkNotes[0]).toContain('The model sent an empty answer.');
    expect(letter.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(letter.body).toContain(`Could you please confirm whether this applies to the patient: ${EGFR}?`);
    expect(letter.body).not.toContain('Could you please confirm the most recent eGFR');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(engine.state.jobs.some(j => j.stage === 'letter' && j.status === 'queued')).toBe(false);
  });

  it('a letter the model answers with nothing still prints the fact line when the record holds it', async () => {
    const { engine, requests } = start([PLAIN, FACTS], true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-fact.csv', source: 'csv', csvText: WITH_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: false });
    expect(f.screen.lineIds).toContain('L003');

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(1);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'no_answer' });
    expect(letter.body).toContain('2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2');
    expect(letter.body).toContain('Lines from our records');
    expect(letter.body).not.toContain('The record we hold does not show');
    expect(letter.body).toContain('Could you please review this when you next see the patient?');
    expect(letter.body).toContain('What I am asking you to review: A review of the digoxin dose against the current eGFR.');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
  });

  it('a screen the model answers with nothing is not a clear result, and there is no finding', async () => {
    const { engine } = start([PLAIN, FACTS], false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const c = engine.state.cases[0];
    expect(c.screening.status).toBe('done');
    expect(c.screening.criteria.map(run => [run.criterionId, run.status])).toEqual([['PLAIN', 'failed'], ['FACTS', 'failed']]);
    expect(c.screening.criteria.every(run => run.error?.includes('Could not be screened.') && run.error.includes('empty answer'))).toBe(true);
    expect(engine.state.findings).toEqual([]);
    expect(engine.stateResponse().counts.historiesScreened).toBe(0);
    expect(engine.state.activity.some(a => a.text.includes('nothing suspected'))).toBe(false);
    expect(engine.state.activity.some(a => a.text.includes('This is not a clear result.'))).toBe(true);
    expect(engine.state.jobs.some(j => j.stage === 'screen' && (j.status === 'queued' || j.status === 'running'))).toBe(false);
  });

  it('a second check the model answers with nothing still shows the finding', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(f.check).toMatchObject({ completed: false, confirmed: false });
    expect(f.check?.whatMatches).toContain('The second check did not finish');
    expect(f.check?.whatMatches).toContain('empty answer');
    expect(engine.stateResponse().counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 0, bellBadge: 1 });
    expect(engine.state.activity.some(a => a.text.includes('turned it back'))).toBe(false);
    expect(engine.state.activity.some(a => a.text.includes('second check not completed'))).toBe(true);
    expect(requests.some(r => 'step4_confirmed' in (r.schema.properties ?? {}))).toBe(true);
    expect(engine.state.letters).toEqual([]);
    expect(engine.state.jobs.some(j => j.stage === 'check' && (j.status === 'queued' || j.status === 'running'))).toBe(false);
  });

  it('a second check that says no turns the finding back and does not count it as confirmed', async () => {
    const { engine } = start([PLAIN, FACTS], false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'not_confirmed', possible: true });
    expect(f.check).toMatchObject({ completed: true, confirmed: false, lineIds: [] });
    expect(f.check?.unclear).toBeUndefined();
    expect(engine.stateResponse().counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 0, bellBadge: 0 });
    expect(engine.state.activity.some(a => a.text.includes('turned it back'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('second check not completed'))).toBe(false);
    expect(engine.state.letters).toEqual([]);
  });

  it('a second check that says no but names lines is unclear, and the finding is still shown', async () => {
    const { engine } = start([PLAIN, FACTS], false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(f.check?.completed).toBe(true);
    expect(f.check?.confirmed).toBe(false);
    expect(f.check?.unclear).toBe(true);
    expect(f.check?.lineIds.length).toBeGreaterThan(0);
    expect(engine.stateResponse().counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 0, bellBadge: 1 });
    expect(engine.state.activity.some(a => a.text.includes('second check unclear'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('turned it back'))).toBe(false);
    expect(engine.state.letters).toEqual([]);
  });

  it('a letter step that throws is still written from the template, and marked as an error', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(1);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'error' });
    expect(letter.draft?.checkNotes[0]).toContain('The letter step failed:');
    expect(letter.draft?.checkNotes[0]).toContain('the letter call broke');
    expect(letter.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(letter.body).toContain(`Could you please confirm whether this applies to the patient: ${EGFR}?`);
    expect(letter.body).not.toContain('Could you please confirm the most recent eGFR');
    expect(letter.body).not.toContain('Please write it by hand');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body).not.toContain('Drafted by a local AI model');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('The draft could not be made'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not answer'))).toBe(false);
    expect(engine.state.jobs.find(j => j.stage === 'letter')?.status).toBe('done');
  });

  it('a letter the model server does not answer stays waiting, and is not built from the template', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });

    engine.decide(f.id, { action: 'accept' });
    const began = Date.now();
    while (!engine.state.jobs.some(j => j.stage === 'letter' && j.detail === HELD_FOR_MODELS)) {
      if (Date.now() - began > 4000) throw new Error('timed out waiting for the letter to be held');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(1);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('drafting');
    expect(letter.draft).toBeUndefined();
    expect(letter.body).toBe('');
    expect(engine.state.jobs.find(j => j.stage === 'letter')).toMatchObject({ status: 'queued', detail: HELD_FOR_MODELS });
    expect(engine.state.activity.some(a => a.text.includes('not built from the template'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('is ready'))).toBe(false);
  });

  it('a letter whose drafts fail their checks is built from the template', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(2);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'checks_failed' });
    expect(letter.draft?.checkNotes.some(n => n.includes('should'))).toBe(true);
    expect(letter.draft?.checkNotes.some(n => n.includes('Both drafts failed the checks.'))).toBe(true);
    expect(letter.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(letter.body).toContain(`Could you please confirm whether this applies to the patient: ${EGFR}?`);
    expect(letter.body).not.toContain('The dose should be reduced');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body).not.toContain('Drafted by a local AI model');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not pass its checks'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not answer'))).toBe(false);
    expect(engine.state.jobs.find(j => j.stage === 'letter')?.status).toBe('done');
  });

  it('a first letter draft that fails is replaced by a second draft that passes', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(2);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'model' });
    expect(letter.draft?.templateReason).toBeUndefined();
    expect(letter.draft?.checkNotes.some(n => n.includes('should'))).toBe(true);
    expect(letter.draft?.checkNotes.some(n => n.includes('The second draft passed the checks.'))).toBe(true);
    expect(letter.body).toContain('Could you please confirm the most recent eGFR');
    expect(letter.body).toContain('Drafted by a local AI model');
    expect(letter.body).not.toContain('The dose should be reduced');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('The first draft failed a check. The second draft passed.'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not pass its checks'))).toBe(false);
    expect(engine.state.jobs.find(j => j.stage === 'letter')?.status).toBe('done');
  });

  it('a second letter draft the model answers with nothing is built from the template', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });

    engine.decide(f.id, { action: 'accept' });
    await engine.whenIdle();
    expect(requests.filter(r => r.schema === LETTER_SCHEMA)).toHaveLength(2);
    const letter = engine.state.letters[0];
    expect(letter.status).toBe('ready');
    expect(letter.draft).toMatchObject({ origin: 'template', templateReason: 'checks_failed' });
    expect(letter.draft?.checkNotes.some(n => n.includes('should'))).toBe(true);
    expect(letter.draft?.checkNotes.some(n => n.includes('The second draft could not be written.'))).toBe(true);
    expect(letter.draft?.checkNotes.some(n => n.includes('The model sent an empty answer.'))).toBe(true);
    expect(letter.body).toContain(`The record we hold does not show: ${EGFR}.`);
    expect(letter.body).not.toContain('The dose should be reduced');
    expect(letter.body).not.toContain('Built from the standard letter template');
    expect(letter.body).not.toContain('Drafted by a local AI model');
    expect(letter.body.trimEnd().endsWith('Marwan Morsy\nPharmacy Manager\nPHA0002761764')).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not pass its checks'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('did not answer'))).toBe(false);
    expect(engine.state.jobs.find(j => j.stage === 'letter')?.status).toBe('done');
  });

  it('a screen the model server does not answer is not a clear result, and the step stays waiting', async () => {
    const { engine } = start([PLAIN, FACTS], false, false, false, false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    const began = Date.now();
    while (!engine.state.jobs.some(j => j.stage === 'screen' && j.detail === HELD_FOR_MODELS)) {
      if (Date.now() - began > 4000) throw new Error('timed out waiting for the screen to be held');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const runs = engine.state.cases[0].screening.criteria;
    expect(runs.map(run => run.status)).toEqual(['waiting', 'waiting']);
    expect(engine.state.cases[0].screening.status).toBe('waiting');
    expect(engine.state.findings).toEqual([]);
    expect(engine.state.letters).toEqual([]);
    expect(engine.stateResponse().counts).toMatchObject({ historiesScreened: 0, findingsConfirmed: 0, bellBadge: 0 });
    expect(engine.state.jobs.find(j => j.stage === 'screen')).toMatchObject({ status: 'queued', detail: HELD_FOR_MODELS });
    expect(engine.state.activity.some(a => a.text.includes('This is not a clear result.'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('nothing suspected'))).toBe(false);
  });

  it('a second check the model server does not answer stays waiting, and the finding is not dismissed', async () => {
    const { engine, requests } = start([PLAIN, FACTS], false, false, false, false, false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    const began = Date.now();
    while (!engine.state.jobs.some(j => j.stage === 'check' && j.detail === HELD_FOR_MODELS)) {
      if (Date.now() - began > 4000) throw new Error('timed out waiting for the second check to be held');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'suspected', possible: true });
    expect(f.check).toBeUndefined();
    expect(requests.some(r => 'step4_confirmed' in (r.schema.properties ?? {}))).toBe(true);
    expect(engine.stateResponse().counts).toMatchObject({ findingsConfirmed: 0, bellBadge: 0 });
    expect(engine.state.jobs.find(j => j.stage === 'check')).toMatchObject({ status: 'queued', detail: HELD_FOR_MODELS });
    expect(engine.state.activity.some(a => a.text.includes('not dismissed'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('turned it back'))).toBe(false);
    expect(engine.state.activity.some(a => a.text.includes('second check not completed'))).toBe(false);
    expect(engine.state.letters).toEqual([]);
  });

  it('a second check that throws still shows the finding, and the check is not completed', async () => {
    const { engine } = start([PLAIN, FACTS], false, false, false, false, false, false, false, false, false, false, false, false, true);
    await engine.start();
    await engine.importCase({ fileName: 'pos-nofact.csv', source: 'csv', csvText: NO_FACT_CSV });
    await engine.whenIdle();
    const f = engine.state.findings[0];
    expect(f).toMatchObject({ criterionId: 'FACTS', state: 'confirmed', possible: true });
    expect(f.check?.completed).toBe(false);
    expect(f.check?.confirmed).toBe(false);
    expect(f.check?.whatMatches).toContain('The second check did not finish');
    expect(f.check?.whatMatches).toContain('The check step failed:');
    expect(f.check?.whatMatches).toContain('the check call broke');
    expect(engine.stateResponse().counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 0, bellBadge: 1 });
    expect(engine.state.activity.some(a => a.text.includes('second check not completed'))).toBe(true);
    expect(engine.state.activity.some(a => a.text.includes('turned it back'))).toBe(false);
    expect(engine.state.letters).toEqual([]);
    expect(engine.state.jobs.find(j => j.stage === 'check')?.status).toBe('done');
  });
});
