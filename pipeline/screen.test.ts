import { describe, expect, it } from 'vitest';
import type { HistoryLine, LanternConfig } from '../shared/types.ts';
import {
  CONTRADICTION_NOTE, contradictionNote, joinParts, noFactLineNote, readScreenAnswer, screenCriterion, screenCutNote, screenHistory, screenMessages, screenPartMessages,
  screenParts, SCREEN_PART_SCHEMA, SCREEN_SCHEMA, type PartOutcome, type ScreenStep
} from './screen.ts';
import { checkAgainstSchema, type ChatFn, type ChatRequest, type ChatResult } from './ollama.ts';
import { lineId } from './csv.ts';
import { fakeChat, manyLines, testConfig, testCriterion, testLines, testPatient, userText } from './testkit.ts';

const AT = '2026-11-18T00:00:00.000Z';

function part(suspected: boolean, lineIds: string[], reason: string, medicines: string[] = [], listed: string[] = lineIds): PartOutcome {
  return {
    ok: true, suspected, listed,
    result: { lineIds, medicines, reason, linesVerified: lineIds.length > 0, missingFacts: [], model: 'lantern-screen', at: AT, seconds: 1 }
  };
}

const clear = { reason: 'Nothing here.', medicines: [], line_ids: [], suspected: false };
const clearPart = { listed_line_ids: [], ...clear };

// ---------- a stand-in model that reads perfectly what it is shown ----------

const XARELTO = '2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example';
const CELEBREX = '2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample';

/** A history of metformin supplies with one Xarelto line and one Celebrex line at the given places. */
function historyWithPair(total: number, xareltoAt: number, celebrexAt: number): HistoryLine[] {
  return Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    let text = `2026-08-${String((i % 28) + 1).padStart(2, '0')} | Diabex XR (metformin) 1000 mg tablet | qty 60 | repeats 4 | Take ONE tablet twice a day | Dr F. Example`;
    if (n === xareltoAt) text = XARELTO;
    if (n === celebrexAt) text = CELEBREX;
    return { id: lineId(n), text };
  });
}

/** The numbered history lines of a prompt. The criterion block also names the brands, so only "L001 | text" lines are read. */
function shownLines(req: ChatRequest): HistoryLine[] {
  return userText(req).split('\n')
    .map(l => /^(L\d{3,}) \| (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ id: m[1], text: m[2] }));
}

/**
 * Suspects the demo finding exactly when the lines in its prompt hold both an NSAID brand and an
 * anticoagulant brand. In a part of a long history it also lists every line with a listed medicine.
 */
function perfectReader(): { chat: ChatFn; calls: { first: string; last: string; lines: number; part: boolean; suspected: boolean }[] } {
  const calls: { first: string; last: string; lines: number; part: boolean; suspected: boolean }[] = [];
  const chat: ChatFn = async <T>(_cfg: LanternConfig, req: ChatRequest): Promise<ChatResult<T>> => {
    const shown = shownLines(req);
    const nsaid = shown.filter(l => /Celebrex|Nurofen|Brufen/i.test(l.text));
    const anticoagulant = shown.filter(l => /Xarelto|Coumadin|Marevan/i.test(l.text));
    const suspected = nsaid.length > 0 && anticoagulant.length > 0;
    const isPart = 'listed_line_ids' in (req.schema.properties ?? {});
    calls.push({ first: shown[0]?.id ?? '', last: shown[shown.length - 1]?.id ?? '', lines: shown.length, part: isPart, suspected });
    const answer: Record<string, unknown> = {
      reason: suspected ? 'An NSAID and an anticoagulant are both supplied.' : 'Only one of the two groups is in these lines.',
      medicines: suspected ? ['celecoxib', 'rivaroxaban'] : [],
      line_ids: suspected ? [...nsaid, ...anticoagulant].map(l => l.id) : [],
      suspected
    };
    if (isPart) answer.listed_line_ids = [...nsaid, ...anticoagulant].map(l => l.id);
    // A prompt size like the real one: about 2.6 characters for each token.
    const promptTokens = Math.round(req.messages.reduce((n, m) => n + m.content.length, 0) / 2.6);
    return {
      ok: true, value: answer as T,
      timings: { wallSeconds: 1, loadSeconds: 0, promptTokens, promptSeconds: 0.1, outputTokens: 20, outputSeconds: 0.5, attempts: 1 }
    };
  };
  return { chat, calls };
}

describe('the screen prompt', () => {
  it('puts the history first and the criterion last, so the reading of the history can be reused', () => {
    const [system, user] = screenMessages(testPatient, testLines, testCriterion);
    expect(system.role).toBe('system');
    const text = user.content;
    const history = text.indexOf('DISPENSING HISTORY');
    const criterion = text.indexOf('CRITERION Demo criterion');
    const medicines = text.indexOf('MEDICINES THAT COUNT');
    const rule = text.indexOf('RULE');
    const task = text.indexOf('TASK');
    expect(text.startsWith('PATIENT (fictional)\nFictional patient F-001, female, 72 years')).toBe(true);
    expect(history).toBeGreaterThan(0);
    expect(criterion).toBeGreaterThan(history);
    expect(medicines).toBeGreaterThan(criterion);
    expect(rule).toBeGreaterThan(medicines);
    expect(task).toBeGreaterThan(rule);
    expect(text).toContain('L003 | 2026-08-21 | Celebrex 200 mg capsule');
    expect(text).toContain('Group A (Oral NSAIDs): ibuprofen (Nurofen, Brufen), celecoxib (Celebrex)');
    expect(text).toContain('Group B (Oral anticoagulants): warfarin (Coumadin, Marevan), rivaroxaban (Xarelto)');
  });

  it('holds the age from the date of birth and does not give the date of birth to the model', () => {
    const patient = {
      label: 'Fictional patient F-100', age: 72, sex: 'F',
      dateOfBirth: '1954-03-15', ageFrom: 'date_of_birth' as const
    };
    const [, user] = screenMessages(patient, testLines, testCriterion);
    expect(user.content).toContain('72 years');
    expect(user.content).not.toContain('1954-03-15');
    expect(user.content).not.toContain('date of birth');
  });

  it('opens the same way for every criterion of one case', () => {
    const other = { ...testCriterion, label: 'Another criterion', statement: 'Something else.' };
    const a = screenMessages(testPatient, testLines, testCriterion)[1].content;
    const b = screenMessages(testPatient, testLines, other)[1].content;
    const shared = a.slice(0, a.indexOf('CRITERION'));
    expect(b.startsWith(shared)).toBe(true);
    expect(shared).toContain('L006 | 2026-10-08 | Xarelto');
  });

  it('asks for the explanation first and the yes or no last', () => {
    // The order of the answer form is the order the model writes in: what it saw, then its decision.
    expect(Object.keys(SCREEN_SCHEMA.properties ?? {})).toEqual(['reason', 'medicines', 'line_ids', 'suspected']);
    expect(Object.keys(SCREEN_PART_SCHEMA.properties ?? {})).toEqual(['listed_line_ids', 'reason', 'medicines', 'line_ids', 'suspected']);
    const task = screenMessages(testPatient, testLines, testCriterion)[1].content.split('TASK')[1];
    expect(task.indexOf('reason (')).toBeLessThan(task.indexOf('suspected (true or false)'));
    // The second model writes its fields in alphabetical order (measured 18 November). If the first
    // model ever did the same, the yes or no would still come last.
    expect(Object.keys(SCREEN_SCHEMA.properties ?? {}).sort().pop()).toBe('suspected');
    expect(Object.keys(SCREEN_PART_SCHEMA.properties ?? {}).sort().pop()).toBe('suspected');
  });

  it('asks, in a part of a long history, for every line that holds a listed medicine', () => {
    const lines = manyLines(24);
    const text = screenPartMessages(testPatient, lines.slice(7, 17), testCriterion, 1, 3)[1].content;
    expect(text).toContain('This is part 2 of 3 of a long history: lines L008 to L017.');
    expect(text).toContain('First list every line of THIS part that holds a medicine named under MEDICINES THAT COUNT, from any group, whether or not the rule is met in this part.');
    expect(text).toContain('listed_line_ids');
    // A criterion with no fixed list is asked in words that fit it.
    const open = screenPartMessages(testPatient, lines.slice(0, 10), { ...testCriterion, medicine_groups: [] }, 0, 3)[1].content;
    expect(open).toContain('that holds a medicine that matters for this criterion');
  });
});

describe('reading the screen answer', () => {
  it('drops line IDs that do not exist', () => {
    const read = readScreenAnswer(
      { suspected: true, line_ids: ['L002', 'L003', 'L044', 'L3'], medicines: ['celecoxib', 'Celecoxib', 'rivaroxaban'], reason: ' Both are supplied. ' },
      testLines, 'lantern-screen', AT, 2.5
    );
    expect(read.suspected).toBe(true);
    expect(read.result.lineIds).toEqual(['L002', 'L003']);
    expect(read.result.linesVerified).toBe(true);
    expect(read.result.medicines).toEqual(['celecoxib', 'rivaroxaban']);
    expect(read.result.reason).toBe('Both are supplied.');
    expect(read.result.seconds).toBe(2.5);
  });

  it('never drops a suspected finding: with no valid line left it goes on, marked lines not verified', () => {
    const read = readScreenAnswer(
      { suspected: true, line_ids: ['L900', 'L901'], medicines: ['celecoxib'], reason: 'Suspected.' },
      testLines, 'lantern-screen', AT, 1
    );
    expect(read.suspected).toBe(true);
    expect(read.result.lineIds).toEqual([]);
    expect(read.result.linesVerified).toBe(false);
  });

  it('does not take a "no" that names the proving lines as a plain no: it goes on to the second check and says so', () => {
    const read = readScreenAnswer(
      { suspected: false, line_ids: ['L002', 'L003', 'L004', 'L005'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Celebrex and Xarelto within 60 days.' },
      testLines, 'lantern-screen', AT, 1
    );
    expect(read.suspected).toBe(true);
    expect(read.result.lineIds).toEqual(['L002', 'L003', 'L004', 'L005']);
    expect(read.result.reason).toBe(`Celebrex and Xarelto within 60 days. ${CONTRADICTION_NOTE}`);
    // A plain no, with no line named, stays a no. So does a no that names only lines that do not exist.
    expect(readScreenAnswer({ suspected: false, line_ids: [], medicines: [], reason: 'No NSAID.' }, testLines, 'm', AT, 1).suspected).toBe(false);
    expect(readScreenAnswer({ suspected: false, line_ids: ['L900'], medicines: [], reason: 'No NSAID.' }, testLines, 'm', AT, 1).suspected).toBe(false);
  });

  it('keeps a long reason to a sensible length and says that more was written', () => {
    const long = 'The patient is supplied Xarelto. '.repeat(40);
    const read = readScreenAnswer({ suspected: true, line_ids: ['L002'], medicines: [], reason: long }, testLines, 'm', AT, 1);
    expect(read.result.reason.length).toBeLessThan(700);
    expect(read.result.reason.endsWith(screenCutNote())).toBe(true);
  });

  it('has a schema that the proof answer fits', () => {
    expect(checkAgainstSchema(
      { suspected: true, line_ids: ['L004'], medicines: ['rivaroxaban', 'celecoxib'], reason: 'x' }, SCREEN_SCHEMA
    )).toBeNull();
    expect(checkAgainstSchema({ suspected: true, line_ids: ['L004'], medicines: [] }, SCREEN_SCHEMA)).toBe('answer is missing "reason"');
  });
});

describe('the end of a long history: the listed lines are read together', () => {
  const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
  const lines = manyLines(24);

  it('is suspected when the lines read together meet the rule, though no part alone did', async () => {
    const fake = fakeChat([{ reason: 'Xarelto and Celebrex both supplied.', medicines: ['rivaroxaban', 'celecoxib'], line_ids: ['L002', 'L022'], suspected: true }]);
    const outcome = await joinParts(cfg, testPatient, lines, testCriterion, [
      part(false, [], 'Only Xarelto here.', [], ['L002']),
      part(false, [], 'Nothing here.', [], []),
      part(false, [], 'Only Celebrex here.', [], ['L022'])
    ], { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    const text = userText(fake.calls[0]);
    expect(text).toContain('This history is long: 24 lines. Only the 2 lines that hold a medicine listed for this criterion are shown here.');
    expect(shownLines(fake.calls[0]).map(l => l.id)).toEqual(['L002', 'L022']);
    expect(outcome).toMatchObject({
      ok: true, suspected: true,
      result: { lineIds: ['L002', 'L022'], listedLineIds: ['L002', 'L022'], linesVerified: true, reason: 'Xarelto and Celebrex both supplied.' }
    });
  });

  it('is clear without another call when no part listed a line, and every part was read', async () => {
    const fake = fakeChat([]);
    const outcome = await joinParts(cfg, testPatient, lines, testCriterion, [part(false, [], 'Nothing.'), part(false, [], 'Nothing.')], { chat: fake.chat });
    expect(fake.calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: true, suspected: false });
    if (outcome.ok) expect(outcome.result.reason).toBe(`${cfg.modelNames.screen} found no line with a medicine listed for this criterion in any of the 2 parts of this long history.`);
  });

  it('is clear only when the lines read together are clear too', async () => {
    const fake = fakeChat([{ reason: 'Only an anticoagulant is supplied.', medicines: ['rivaroxaban'], line_ids: [], suspected: false }]);
    const outcome = await joinParts(cfg, testPatient, lines, testCriterion, [part(false, [], 'x', [], ['L002']), part(false, [], 'y', [], ['L012'])], { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: true, suspected: false, result: { lineIds: [], listedLineIds: ['L002', 'L012'], reason: 'Only an anticoagulant is supplied.' } });
  });

  it('is "could not be screened" when a part failed and nothing is suspected', async () => {
    const none = await joinParts(cfg, testPatient, lines, testCriterion,
      [part(false, [], 'Nothing.'), { ok: false, error: 'Tried twice. The model sent an empty answer.' }], { chat: fakeChat([]).chat });
    expect(none).toEqual({ ok: false, error: 'Part 2 of 2 of this long history could not be screened. Tried twice. The model sent an empty answer.' });
    // Lines were listed in the part that was read, and read together they are clear. A part is still missing: never clear.
    const some = await joinParts(cfg, testPatient, lines, testCriterion,
      [part(false, [], 'x', [], ['L002']), { ok: false, error: 'boom' }], { chat: fakeChat([clear]).chat });
    expect(some.ok).toBe(false);
  });

  it('stays suspected when one part failed and another is suspected, and says so', async () => {
    const outcome = await joinParts(cfg, testPatient, lines, testCriterion,
      [{ ok: false, error: 'boom' }, part(true, ['L012', 'L014'], 'Celebrex with Xarelto.', ['celecoxib'])],
      { chat: fakeChat([{ reason: 'Both supplied.', medicines: ['rivaroxaban'], line_ids: ['L012', 'L014'], suspected: true }]).chat });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.suspected).toBe(true);
    expect(outcome.result.reason).toBe('Both supplied. Part 1 of 2 of this long history could not be read by the first model.');
    expect(outcome.result.medicines).toEqual(['rivaroxaban', 'celecoxib']);
  });

  it('keeps a finding that one part suspected, whatever the joined reading says, even when that reading fails', async () => {
    const parts = [part(true, ['L004', 'L003'], 'Found in part 1.', ['celecoxib']), part(false, [], 'Nothing.', [], ['L015'])];
    const disagrees = await joinParts(cfg, testPatient, lines, testCriterion, parts, { chat: fakeChat([clear]).chat });
    expect(disagrees).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L003', 'L004'], listedLineIds: ['L003', 'L004', 'L015'] } });
    if (disagrees.ok) expect(disagrees.result.reason).toBe(`Found in part 1. Read together, the listed lines did not meet the rule for ${cfg.modelNames.screen}.`);
    const fails = await joinParts(cfg, testPatient, lines, testCriterion, parts, { chat: fakeChat([{ fail: 'Tried twice.' }]).chat });
    expect(fails).toMatchObject({ ok: true, suspected: true });
    if (fails.ok) expect(fails.result.reason).toContain('The listed lines of this long history could not be read together. Tried twice.');
  });

  it('is "could not be screened" when the listed lines cannot be read together', async () => {
    const failed = await joinParts(cfg, testPatient, lines, testCriterion, [part(false, [], 'x', [], ['L002']), part(false, [], 'y', [], ['L012'])],
      { chat: fakeChat([{ fail: 'Tried twice. The local model server did not answer.' }]).chat });
    expect(failed).toEqual({ ok: false, error: 'The listed lines of this long history could not be read together. Tried twice. The local model server did not answer.' });
    // More listed lines than fit in one call: no call is made and the criterion is not called clear.
    const fake = fakeChat([]);
    const many = lines.slice(0, 11).map(l => l.id);
    const tooMany = await joinParts(cfg, testPatient, lines, testCriterion, [part(false, [], 'x', [], many), part(false, [], 'y', [], [])], { chat: fake.chat });
    expect(fake.calls).toHaveLength(0);
    expect(tooMany).toEqual({ ok: false, error: '11 lines of this long history hold a listed medicine. That is too many to read together in one go.' });
  });
});

describe('screenCriterion', () => {
  it('makes one call for a history that fits and applies the line-ID guard', async () => {
    const fake = fakeChat([{ suspected: true, line_ids: ['L002', 'L003', 'L777'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both supplied.' }]);
    const outcome = await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ model: 'lantern-screen', think: false, numPredict: 1200 });
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L002', 'L003'], linesVerified: true, model: 'lantern-screen' } });
    if (outcome.ok) expect(outcome.result.listedLineIds).toBeUndefined();
  });

  it('reports a failed call as "could not be screened", never as no finding', async () => {
    const fake = fakeChat([{ fail: 'Tried twice. The local model server did not answer.' }]);
    const outcome = await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: fake.chat });
    expect(outcome).toEqual({ ok: false, error: 'Tried twice. The local model server did not answer.' });
  });

  it('refuses a history with no lines', async () => {
    const outcome = await screenCriterion(testConfig, testPatient, [], testCriterion, { chat: fakeChat([]).chat });
    expect(outcome.ok).toBe(false);
  });

  it('screens a long history in overlapping parts, then reads the listed lines together', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const lines = manyLines(24);                    // parts: L001-L010, L008-L017, L015-L024
    const fake = fakeChat([
      clearPart,
      { listed_line_ids: ['L009', 'L016', 'L001'], reason: 'Found in the middle.', medicines: ['celecoxib'], line_ids: ['L016', 'L009', 'L001'], suspected: true },
      clearPart,
      { reason: 'Celebrex with Xarelto.', medicines: ['celecoxib', 'rivaroxaban'], line_ids: ['L009', 'L016'], suspected: true }
    ]);
    const outcome = await screenCriterion(cfg, testPatient, lines, testCriterion, { chat: fake.chat });
    expect(fake.calls).toHaveLength(4);
    expect(userText(fake.calls[0])).toContain('This is part 1 of 3 of a long history: lines L001 to L010.');
    expect(userText(fake.calls[1])).toContain('This is part 2 of 3 of a long history: lines L008 to L017.');
    expect(userText(fake.calls[1])).not.toContain('L007 |');
    expect(userText(fake.calls[2])).toContain('L024 |');
    expect(fake.calls[0]).toMatchObject({ numPredict: 2000 });
    expect(shownLines(fake.calls[3]).map(l => l.id)).toEqual(['L009', 'L016']);     // L001 is not in part 2, so the guard dropped it there
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.suspected).toBe(true);
    expect(outcome.result.lineIds).toEqual(['L009', 'L016']);
    expect(outcome.result.reason).toBe('Celebrex with Xarelto.');
  });

  it('does not trust an answer when the prompt did not fit in the reading window of the model', async () => {
    const answer = { suspected: false, line_ids: [], medicines: [], reason: 'Nothing here.' };
    const tooBig = fakeChat([{ answer, promptTokens: testConfig.numCtx - 1000 }]);
    const outcome = await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: tooBig.chat });
    expect(outcome).toEqual({ ok: false, error: 'This part of the history is too long for the model to read in one go.' });

    const fits = fakeChat([{ answer, promptTokens: testConfig.numCtx - 1200 - 64 }]);
    expect(await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: fits.chat })).toMatchObject({ ok: true, suspected: false });
  });

  it('does not trust an answer when Ollama read only part of a large prompt', async () => {
    const answer = { suspected: false, line_ids: [], medicines: [], reason: 'Nothing here.' };
    const lines = manyLines(150);                              // one part of about 21,000 characters
    const cut = fakeChat([{ answer, promptTokens: 4000 }]);    // far fewer tokens than that much text needs
    expect(await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: cut.chat }))
      .toEqual({ ok: false, error: 'This part of the history is too long for the model to read in one go.' });
    const whole = fakeChat([{ answer, promptTokens: 8200 }]);
    expect(await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: whole.chat })).toMatchObject({ ok: true, suspected: false });
  });

  it('splits a history of very long lines by size, not only by line count', async () => {
    const wide = manyLines(40).map(l => ({ ...l, text: l.text + ' | ' + 'x'.repeat(900) }));   // about 1,000 characters a line
    const answers = Array.from({ length: 12 }, () => clearPart);
    const fake = fakeChat(answers);
    const outcome = await screenCriterion({ ...testConfig, numCtx: 8192 }, testPatient, wide, testCriterion, { chat: fake.chat });
    expect(outcome.ok).toBe(true);
    expect(fake.calls.length).toBeGreaterThan(1);              // 40 lines is under 150, but they do not fit in one call
    for (const call of fake.calls) expect(userText(call).length).toBeLessThan((8192 - 1200) * 2.9);
  });

  it('does not call a long history clear when one of its parts could not be read', async () => {
    const cfg = { ...testConfig, maxLinesPerCall: 10, overlapLines: 3 };
    const fake = fakeChat([clearPart, { fail: 'Tried twice. The model sent an empty answer.' }, clearPart]);
    const outcome = await screenCriterion(cfg, testPatient, manyLines(24), testCriterion, { chat: fake.chat });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('Part 2 of 3 of this long history could not be screened.');
  });

  it('passes the stop signal to every model call', async () => {
    const stop = new AbortController();
    const fake = fakeChat([clear]);
    await screenCriterion(testConfig, testPatient, testLines, testCriterion, { chat: fake.chat, signal: stop.signal });
    expect(fake.calls[0].signal).toBe(stop.signal);
  });
});

// The defect the reviewers proved on 18 November: a finding that needs two lines was seen only when
// both lines sat in the same part, and "no part suspected" was recorded as clear.
describe('a long history whose two proving lines fall in different parts', () => {
  it('is suspected when the pair is 290 lines apart (a history printed medicine by medicine)', async () => {
    const lines = historyWithPair(400, 10, 300);
    const parts = screenParts(testConfig, lines);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.some(p => p.some(l => l.id === 'L010') && p.some(l => l.id === 'L300'))).toBe(false);   // no part holds both lines
    const reader = perfectReader();
    const outcome = await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: reader.chat });
    expect(reader.calls.filter(c => c.part).every(c => !c.suspected)).toBe(true);       // no part alone can see the finding
    const joined = reader.calls[reader.calls.length - 1];
    expect(joined).toMatchObject({ part: false, lines: 2, suspected: true });           // the listed lines, read together
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L010', 'L300'], listedLineIds: ['L010', 'L300'] } });
  });

  it('is suspected when the pair is only 31 lines apart, either side of a part boundary', async () => {
    const lines = historyWithPair(200, 120, 151);
    const reader = perfectReader();
    const outcome = await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: reader.chat });
    expect(outcome).toMatchObject({ ok: true, suspected: true, result: { lineIds: ['L120', 'L151'] } });
  });

  it('is suspected when the two medicines are on line 20 and line 380 of a 400-line history', async () => {
    const lines = historyWithPair(400, 20, 380);
    const parts = screenParts(testConfig, lines);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.some(p => p.some(l => l.id === 'L020') && p.some(l => l.id === 'L380'))).toBe(false);
    const reader = perfectReader();
    const outcome = await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: reader.chat });
    expect(reader.calls.filter(c => c.part).every(c => !c.suspected)).toBe(true);
    expect(outcome).toMatchObject({
      ok: true, suspected: true,
      result: { lineIds: ['L020', 'L380'], listedLineIds: ['L020', 'L380'] }
    });
  });

  it('is still clear when the history holds only one of the two medicines', async () => {
    const lines = historyWithPair(400, 10, 0);                     // Xarelto, no Celebrex
    const reader = perfectReader();
    const outcome = await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: reader.chat });
    expect(outcome).toMatchObject({ ok: true, suspected: false, result: { lineIds: [], listedLineIds: ['L010'] } });
  });
});

describe('screenHistory: several criteria on one history', () => {
  const other = { ...testCriterion, id: 'OTHER', label: 'Another criterion' };

  it('reads each part of a long history once for all criteria: the parts are the outer loop', async () => {
    const lines = historyWithPair(400, 10, 300);
    const reader = perfectReader();
    const steps: ScreenStep[] = [];
    const results: [number, boolean][] = [];
    const outcomes = await screenHistory(testConfig, testPatient, lines, [testCriterion, other], { chat: reader.chat }, {
      onStep: step => steps.push(step),
      onResult: (index, outcome) => results.push([index, outcome.ok && outcome.suspected])
    });
    const parts = screenParts(testConfig, lines).length;
    const partCalls = reader.calls.filter(c => c.part);
    expect(partCalls).toHaveLength(parts * 2);
    // Two calls in a row read the same part: the second one can reuse the reading of the first.
    for (let i = 0; i < partCalls.length; i += 2) expect(partCalls[i + 1].first).toBe(partCalls[i].first);
    expect(steps[0]).toEqual({ part: 1, parts, criterion: 1, criteria: 2 });
    expect(steps[1]).toEqual({ part: 1, parts, criterion: 2, criteria: 2 });
    expect(steps[steps.length - 1]).toEqual({ part: 0, parts, criterion: 2, criteria: 2 });
    expect(results).toEqual([[0, true], [1, true]]);
    expect(outcomes.map(o => o.ok && o.suspected)).toEqual([true, true]);
    // The same answer as one criterion at a time.
    const alone = await screenCriterion(testConfig, testPatient, lines, testCriterion, { chat: perfectReader().chat });
    expect(outcomes[0]).toMatchObject({ ok: true, suspected: true, result: { lineIds: alone.ok ? alone.result.lineIds : [] } });
  });

  it('screens a history that fits one criterion after another', async () => {
    const fake = fakeChat([clear, { reason: 'Both.', medicines: [], line_ids: ['L002', 'L003'], suspected: true }]);
    const steps: ScreenStep[] = [];
    const outcomes = await screenHistory(testConfig, testPatient, testLines, [testCriterion, other], { chat: fake.chat }, { onStep: s => steps.push(s) });
    expect(fake.calls).toHaveLength(2);
    expect(steps).toEqual([{ part: 1, parts: 1, criterion: 1, criteria: 2 }, { part: 1, parts: 1, criterion: 2, criteria: 2 }]);
    expect(outcomes.map(o => o.ok && o.suspected)).toEqual([false, true]);
  });
});

describe('the notes added when a screen answer does not agree with itself', () => {
  it('names the model that was asked, and Mantle when no name is given', () => {
    expect(contradictionNote()).toBe(CONTRADICTION_NOTE);
    expect(contradictionNote('Lumen')).toBe('Lumen answered "not suspected" but named these lines. To be safe the finding was passed on to the second check.');
    expect(contradictionNote('  ')).toBe(CONTRADICTION_NOTE);
    expect(noFactLineNote()).toMatch(/^Mantle named no line/);
    expect(noFactLineNote('Ogee')).toBe('Ogee named no line that holds a fact this criterion needs, and no missing fact. To be safe the finding is shown as a possible finding.');
    expect(noFactLineNote('')).toMatch(/^Mantle named no line/);
  });
});
