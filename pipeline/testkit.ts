// Helpers for the unit tests of the three jobs. No model is called: the tests pass a stand-in.
import type { Criterion, HistoryLine, LanternConfig, PatientHeader } from '../shared/types.ts';
import { normalizeConfig } from './config.ts';
import { lineId } from './csv.ts';
import type { ChatFn, ChatRequest, ChatResult } from './ollama.ts';

export const testConfig: LanternConfig = normalizeConfig({});

export const testPatient: PatientHeader = { label: 'Fictional patient F-001', age: 72, sex: 'F' };

export const testCriterion: Criterion = {
  id: 'DEMO-NSAID-ANTICOAG',
  label: 'Demo criterion (NSAID with an anticoagulant)',
  family: 'Demo',
  title: 'Test stand-in: an NSAID supplied with an oral anticoagulant',
  statement: 'A non-steroidal anti-inflammatory drug (NSAID) supplied to a person who is also being supplied an oral anticoagulant (risk of major bleeding).',
  statement_origin: 'entrant',
  source: {
    document: 'Test wording written for this prototype',
    citation: 'Written by the entrant to test the engine.',
    licence: 'The entrant\'s own wording.',
    licence_status: 'proposed',
    credit: 'Test wording written by the entrant for this prototype. It is not a published criterion.'
  },
  plain_summary: 'An anti-inflammatory pain medicine and a blood thinner supplied together can raise the risk of serious bleeding.',
  medicine_groups: [
    {
      key: 'A', name: 'Oral NSAIDs',
      ingredients: ['ibuprofen', 'celecoxib'],
      brands: { ibuprofen: ['Nurofen', 'Brufen'], celecoxib: ['Celebrex'] }
    },
    {
      key: 'B', name: 'Oral anticoagulants',
      ingredients: ['warfarin', 'rivaroxaban'],
      brands: { warfarin: ['Coumadin', 'Marevan'], rivaroxaban: ['Xarelto'] }
    }
  ],
  rule_for_models: 'Suspect a finding when at least one Group A medicine AND at least one Group B medicine both appear in the history with supply dates that overlap or fall within 60 days of each other.',
  cannot_be_seen: 'Why the anticoagulant was started, kidney function, and any pain medicines bought without a prescription.',
  ask_the_gp: 'Whether the NSAID is still needed while the anticoagulant continues, and the patient\'s risk of bleeding',
  urgency: 'routine',
  draft: true,
  signed_by_clinical_reviewer: null
};

/** A short history with the finding in it: Xarelto every month, Celebrex in August and September. */
export const testLines: HistoryLine[] = [
  '2026-08-06 | Lipitor (atorvastatin) 40 mg tablet | qty 30 | repeats 4 | Take ONE tablet at night | Dr F. Example',
  '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example',
  '2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample',
  '2026-09-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example',
  '2026-09-20 | Celebrex 200 mg capsule | qty 30 | repeats 1 | Take ONE capsule daily with food | Dr G. Sample',
  '2026-10-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example'
].map((text, i) => ({ id: lineId(i + 1), text }));

/**
 * A criterion that needs a fact a dispensing history does not hold (docs/SPEC.md section 6a):
 * long-term digoxin with a low eGFR. Test wording, not a published criterion.
 */
export const factsCriterion: Criterion = {
  id: 'TEST-DIGOXIN-EGFR',
  label: 'Test criterion (digoxin with low kidney function)',
  family: 'Test',
  title: 'Test stand-in: long-term digoxin with low kidney function',
  statement: 'Digoxin at a long-term dose of 125 micrograms a day or more when the eGFR is below 30 mL/min/1.73 m2 (risk of digoxin toxicity).',
  statement_origin: 'entrant',
  source: {
    document: 'Test wording written for this prototype',
    citation: 'Written by the entrant to test the engine.',
    licence: 'The entrant\'s own wording.',
    licence_status: 'proposed',
    credit: 'Test wording written by the entrant for this prototype. It is not a published criterion.'
  },
  plain_summary: 'Digoxin can build up in the body when the kidneys work poorly.',
  medicine_groups: [
    { key: 'A', name: 'Digoxin', ingredients: ['digoxin'], brands: { digoxin: ['Lanoxin', 'Lanoxin PG', 'Sigmaxin'] } }
  ],
  needs_facts: [
    { kind: 'result', what: 'eGFR (estimated kidney function), the most recent result', meets: 'below 30 mL/min/1.73 m2' }
  ],
  rule_for_models: 'Suspect a finding when digoxin (Group A) is supplied for more than 90 days AND the most recent eGFR on the record is below 30 mL/min/1.73 m2; cite the digoxin supply lines and the eGFR line. If the record holds no eGFR line, report a possible finding and say that the eGFR is the missing fact. If the most recent eGFR is 30 or above, there is no finding.',
  cannot_be_seen: 'The latest kidney test if none is on the record, and any digoxin blood level.',
  ask_the_gp: 'A review of the digoxin dose against the current eGFR',
  urgency: 'routine',
  draft: true,
  signed_by_clinical_reviewer: null
};

const FACTS_RECORD = [
  '2025-12-02 | CONDITION | Atrial fibrillation',
  '2025-12-08 | Lanoxin 250 microgram tablet | qty 100 | repeats 2 | Take ONE tablet daily | Dr A. Example',
  '2026-03-10 | Lanoxin 250 microgram tablet | qty 100 | repeats 1 | Take ONE tablet daily | Dr A. Example',
  '2026-05-12 | RESULT | eGFR 24 mL/min/1.73 m2',
  '2026-06-16 | Lanoxin 250 microgram tablet | qty 100 | repeats 0 | Take ONE tablet daily | Dr A. Example',
  '2026-06-16 | Lipitor (atorvastatin) 40 mg tablet | qty 30 | repeats 4 | Take ONE tablet at night | Dr A. Example'
];

/** A short record with the finding and its fact: digoxin for six months (L002, L003, L005) and an eGFR of 24 (L004). */
export const factsLines: HistoryLine[] = FACTS_RECORD.map((text, i) => ({ id: lineId(i + 1), text }));

/** The same record with no line about the eGFR: digoxin on L002, L003 and L004. The medicines match and the fact is missing. */
export const noFactLines: HistoryLine[] = FACTS_RECORD.filter(text => !text.includes('eGFR')).map((text, i) => ({ id: lineId(i + 1), text }));

export function manyLines(n: number): HistoryLine[] {
  return Array.from({ length: n }, (_, i) => ({
    id: lineId(i + 1),
    text: `2026-01-${String((i % 28) + 1).padStart(2, '0')} | Diabex XR (metformin) 1000 mg tablet | qty 60 | repeats 4 | Take ONE tablet twice a day | Dr F. Example`
  }));
}

export interface FakeChat {
  chat: ChatFn;
  calls: ChatRequest[];
}

/**
 * A stand-in for the model. Each entry answers one call: a value is a good answer,
 * { fail: "..." } is a call that failed twice, and { answer, promptTokens } is a good answer
 * with a given prompt size. A function gets the request and returns any of these.
 */
export function fakeChat(answers: unknown[]): FakeChat {
  const calls: ChatRequest[] = [];
  const queue = [...answers];
  const chat: ChatFn = async <T>(_cfg: LanternConfig, req: ChatRequest): Promise<ChatResult<T>> => {
    calls.push(req);
    if (queue.length === 0) throw new Error('The test did not expect another model call.');
    let next = queue.shift();
    if (typeof next === 'function') next = (next as (r: ChatRequest) => unknown)(req);
    const timings = { wallSeconds: 1.5, loadSeconds: 0, promptTokens: 100, promptSeconds: 0.5, outputTokens: 20, outputSeconds: 1, attempts: 1 };
    if (typeof next === 'object' && next !== null && 'fail' in next) {
      return { ok: false, error: String((next as { fail: unknown }).fail), timings: { ...timings, attempts: 2 } };
    }
    if (typeof next === 'object' && next !== null && 'answer' in next && 'promptTokens' in next) {
      const sized = next as { answer: unknown; promptTokens: number };
      return { ok: true, value: sized.answer as T, timings: { ...timings, promptTokens: sized.promptTokens } };
    }
    return { ok: true, value: next as T, timings };
  };
  return { chat, calls };
}

/** The text of the last user message of a request. */
export function userText(req: ChatRequest): string {
  const users = req.messages.filter(m => m.role === 'user');
  return users[users.length - 1]?.content ?? '';
}
