// pipeline/testkit.ts builds the histories and the stand-in model the other tests use.
// These tests pin that stand-in. No model is called, and no server is started.
import { describe, expect, it } from 'vitest';
import { normalizeConfig } from './config.ts';
import type { ChatRequest } from './ollama.ts';
import {
  factsCriterion,
  factsLines,
  fakeChat,
  manyLines,
  noFactLines,
  testConfig,
  testCriterion,
  testLines,
  testPatient,
  userText
} from './testkit.ts';

function request(content: string, earlier = ''): ChatRequest {
  const messages: ChatRequest['messages'] = earlier === ''
    ? [{ role: 'user', content }]
    : [
        { role: 'user', content: earlier },
        { role: 'assistant', content: 'noted' },
        { role: 'user', content }
      ];
  return {
    model: 'stand-in',
    think: false,
    schema: { type: 'object' },
    messages,
    numPredict: 20
  };
}

describe('testkit', () => {
  it('builds the short demo history with Celebrex inside the Xarelto months', () => {
    expect(testConfig).toEqual(normalizeConfig({}));
    expect(testPatient).toEqual({ label: 'Fictional patient F-001', age: 72, sex: 'F' });
    expect(testCriterion.id).toBe('DEMO-NSAID-ANTICOAG');
    expect(testCriterion.draft).toBe(true);
    expect(testCriterion.medicine_groups.map(group => group.key)).toEqual(['A', 'B']);
    expect(testCriterion.medicine_groups[0]?.ingredients).toEqual(['ibuprofen', 'celecoxib']);
    expect(testCriterion.medicine_groups[1]?.ingredients).toEqual(['warfarin', 'rivaroxaban']);
    expect(testLines.map(line => line.id)).toEqual(['L001', 'L002', 'L003', 'L004', 'L005', 'L006']);
    expect(testLines.filter(line => line.text.includes('Celebrex')).map(line => line.id)).toEqual(['L003', 'L005']);
    expect(testLines.filter(line => line.text.includes('Xarelto')).map(line => line.id)).toEqual(['L002', 'L004', 'L006']);
  });

  it('builds the digoxin record with the eGFR, and the same record without it', () => {
    expect(factsCriterion.id).toBe('TEST-DIGOXIN-EGFR');
    expect(factsCriterion.needs_facts).toEqual([
      { kind: 'result', what: 'eGFR (estimated kidney function), the most recent result', meets: 'below 30 mL/min/1.73 m2' }
    ]);
    expect(factsLines.map(line => line.id)).toEqual(['L001', 'L002', 'L003', 'L004', 'L005', 'L006']);
    expect(factsLines.find(line => line.text.includes('eGFR'))?.id).toBe('L004');
    expect(factsLines.filter(line => line.text.includes('Lanoxin')).map(line => line.id)).toEqual(['L002', 'L003', 'L005']);
    expect(noFactLines.map(line => line.id)).toEqual(['L001', 'L002', 'L003', 'L004', 'L005']);
    expect(noFactLines.some(line => line.text.includes('eGFR'))).toBe(false);
    expect(noFactLines.filter(line => line.text.includes('Lanoxin')).map(line => line.id)).toEqual(['L002', 'L003', 'L004']);
  });

  it('numbers a long history and wraps the day after the 28th', () => {
    const lines = manyLines(30);
    expect(lines).toHaveLength(30);
    expect(lines[0]?.id).toBe('L001');
    expect(lines[0]?.text.startsWith('2026-01-01 |')).toBe(true);
    expect(lines[27]?.id).toBe('L028');
    expect(lines[27]?.text.startsWith('2026-01-28 |')).toBe(true);
    expect(lines[28]?.id).toBe('L029');
    expect(lines[28]?.text.startsWith('2026-01-01 |')).toBe(true);
    expect(lines[29]?.text.startsWith('2026-01-02 |')).toBe(true);
  });

  it('answers calls in order, including a failure and a given prompt size', async () => {
    const standIn = fakeChat([
      { suspected: true },
      { fail: 'the model did not answer' },
      { answer: { suspected: false }, promptTokens: 40 },
      (req: ChatRequest) => ({ echoed: req.model })
    ]);
    const first = await standIn.chat(testConfig, request('first'));
    const failed = await standIn.chat(testConfig, request('second'));
    const sized = await standIn.chat(testConfig, request('third'));
    const echoed = await standIn.chat(testConfig, request('fourth'));
    expect(first).toMatchObject({ ok: true, value: { suspected: true }, timings: { attempts: 1, promptTokens: 100 } });
    expect(failed).toMatchObject({ ok: false, error: 'the model did not answer', timings: { attempts: 2 } });
    expect(sized).toMatchObject({ ok: true, value: { suspected: false }, timings: { promptTokens: 40, attempts: 1 } });
    expect(echoed).toMatchObject({ ok: true, value: { echoed: 'stand-in' } });
    expect(standIn.calls).toHaveLength(4);
    await expect(standIn.chat(testConfig, request('fifth'))).rejects.toThrow('The test did not expect another model call.');
  });

  it('reads the last message the user wrote', () => {
    expect(userText(request('the later one', 'the earlier one'))).toBe('the later one');
    const onlyTheModel = request('unused');
    onlyTheModel.messages = [{ role: 'assistant', content: 'only the model' }];
    expect(userText(onlyTheModel)).toBe('');
  });

  it('lets a function return a sized answer, and a failure wins when both marks are present', async () => {
    const standIn = fakeChat([
      (req: ChatRequest) => ({ answer: { model: req.model }, promptTokens: 0 }),
      { fail: 'stopped', answer: { suspected: true }, promptTokens: 9 }
    ]);
    const sized = await standIn.chat(testConfig, request('sized'));
    const failed = await standIn.chat(testConfig, request('both'));
    expect(sized).toMatchObject({ ok: true, value: { model: 'stand-in' }, timings: { promptTokens: 0, attempts: 1 } });
    expect(failed).toMatchObject({ ok: false, error: 'stopped', timings: { attempts: 2 } });
    const after = request('kept');
    after.messages.push({ role: 'assistant', content: 'later' });
    expect(userText(after)).toBe('kept');
  });

  it('builds no lines when asked for none, and a stand-in can answer null or turn a function into a failure', async () => {
    expect(manyLines(0)).toEqual([]);
    const one = manyLines(1);
    expect(one).toHaveLength(1);
    expect(one[0]?.id).toBe('L001');
    expect(one[0]?.text.startsWith('2026-01-01 |')).toBe(true);

    const standIn = fakeChat([
      null,
      { fail: 0 },
      () => ({ fail: 'from the function' }),
      { answer: { suspected: true } }
    ]);
    const empty = await standIn.chat(testConfig, request('null'));
    const zero = await standIn.chat(testConfig, request('zero'));
    const fromFn = await standIn.chat(testConfig, request('function'));
    const wrapped = await standIn.chat(testConfig, request('wrapped'));
    expect(empty).toMatchObject({ ok: true, value: null, timings: { attempts: 1, promptTokens: 100 } });
    expect(zero).toMatchObject({ ok: false, error: '0', timings: { attempts: 2 } });
    expect(fromFn).toMatchObject({ ok: false, error: 'from the function', timings: { attempts: 2 } });
    expect(wrapped).toMatchObject({ ok: true, value: { answer: { suspected: true } }, timings: { attempts: 1, promptTokens: 100 } });
    expect(standIn.calls).toHaveLength(4);

    const noMessages = request('unused');
    noMessages.messages = [];
    expect(userText(noMessages)).toBe('');
  });

  it('uses a plain word from a function as the answer, and names both digoxin brands', async () => {
    expect(factsCriterion.medicine_groups[0]?.brands).toEqual({
      digoxin: ['Lanoxin', 'Lanoxin PG', 'Sigmaxin']
    });
    expect(testCriterion.urgency).toBe('routine');
    expect(testCriterion.signed_by_clinical_reviewer).toBeNull();
    const standIn = fakeChat([() => 'plain']);
    const result = await standIn.chat(testConfig, request('word'));
    expect(result).toMatchObject({ ok: true, value: 'plain', timings: { attempts: 1, promptTokens: 100 } });
    expect(standIn.calls).toHaveLength(1);
  });

  it('keeps an object that is not a failure and not a sized answer, and a function may return null', async () => {
    const standIn = fakeChat([
      { promptTokens: 12 },
      () => null
    ]);
    const markOnly = await standIn.chat(testConfig, request('mark'));
    const fromNull = await standIn.chat(testConfig, request('null from a function'));
    expect(markOnly).toMatchObject({ ok: true, value: { promptTokens: 12 }, timings: { promptTokens: 100, attempts: 1 } });
    expect(fromNull).toMatchObject({ ok: true, value: null, timings: { attempts: 1, promptTokens: 100 } });
    expect(standIn.calls).toHaveLength(2);
  });

  it('wraps the day a second time, and a number or a blank word is the answer itself', async () => {
    const lines = manyLines(57);
    expect(lines).toHaveLength(57);
    expect(lines[55]?.id).toBe('L056');
    expect(lines[55]?.text.startsWith('2026-01-28 |')).toBe(true);
    expect(lines[56]?.id).toBe('L057');
    expect(lines[56]?.text.startsWith('2026-01-01 |')).toBe(true);

    const standIn = fakeChat([
      0,
      false,
      '',
      { fail: undefined },
      () => { throw new Error('the stand-in stopped'); }
    ]);
    const zero = await standIn.chat(testConfig, request('zero'));
    const no = await standIn.chat(testConfig, request('no'));
    const blank = await standIn.chat(testConfig, request('blank'));
    const missing = await standIn.chat(testConfig, request('missing fail'));
    await expect(standIn.chat(testConfig, request('throws'))).rejects.toThrow('the stand-in stopped');
    expect(zero).toMatchObject({ ok: true, value: 0, timings: { attempts: 1, promptTokens: 100 } });
    expect(no).toMatchObject({ ok: true, value: false });
    expect(blank).toMatchObject({ ok: true, value: '' });
    expect(missing).toMatchObject({ ok: false, error: 'undefined', timings: { attempts: 2 } });
    expect(standIn.calls).toHaveLength(5);

    const blankLast = request('the earlier one');
    blankLast.messages.push({ role: 'assistant', content: 'noted' });
    blankLast.messages.push({ role: 'user', content: '' });
    blankLast.messages.push({ role: 'system', content: 'not the user' });
    expect(userText(blankLast)).toBe('');
  });

  it('copies the answer list, and a failure mark of null is the word null', async () => {
    const answers: unknown[] = ['one'];
    const copied = fakeChat(answers);
    answers.push({ fail: null }, ['kept']);
    const first = await copied.chat(testConfig, request('copied'));
    expect(first).toMatchObject({ ok: true, value: 'one' });
    await expect(copied.chat(testConfig, request('no more'))).rejects.toThrow('The test did not expect another model call.');
    expect(copied.calls).toHaveLength(2);

    const later = fakeChat([{ fail: null }, ['kept']]);
    const failed = await later.chat(testConfig, request('null fail'));
    const list = await later.chat(testConfig, request('list'));
    expect(failed).toMatchObject({ ok: false, error: 'null', timings: { attempts: 2 } });
    expect(list).toMatchObject({ ok: true, value: ['kept'], timings: { attempts: 1, promptTokens: 100 } });
  });
});
