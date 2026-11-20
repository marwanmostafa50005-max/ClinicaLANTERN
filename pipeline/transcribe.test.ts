import { describe, expect, it } from 'vitest';
import { normalizeConfig } from './config.ts';
import type { LanternConfig } from '../shared/types.ts';
import type { ChatFn, ChatRequest, ChatResult, ChatTimings } from './ollama.ts';
import {
  TRANSCRIBE_NUM_PREDICT, TRANSCRIBE_SCHEMA, TRANSCRIBE_SYSTEM, TRANSCRIBE_TIMEOUT_MS,
  cleanBase64, transcribePageImage
} from './transcribe.ts';

const TIMINGS: ChatTimings = {
  wallSeconds: 1, loadSeconds: 0, promptTokens: 1, promptSeconds: 0, outputTokens: 1, outputSeconds: 0, attempts: 1
};

function standIn(answer: ChatResult<unknown>): { chat: ChatFn; seen: () => ChatRequest | undefined; calls: () => number } {
  let seen: ChatRequest | undefined;
  let calls = 0;
  const chat: ChatFn = async <T>(_cfg: LanternConfig, req: ChatRequest): Promise<ChatResult<T>> => {
    calls += 1;
    seen = req;
    return answer as ChatResult<T>;
  };
  return { chat, seen: () => seen, calls: () => calls };
}

describe('cleanBase64', () => {
  it('drops a data-url prefix and every space', () => {
    expect(cleanBase64('data:image/png;base64,QU JD\n')).toBe('QUJD');
    expect(cleanBase64('DATA:IMAGE/JPEG;BASE64,abc')).toBe('abc');
    expect(cleanBase64('  abc  ')).toBe('abc');
    expect(cleanBase64('not-a-prefix')).toBe('not-a-prefix');
  });

  it('leaves a prefix that names a charset, and a prefix that is not at the start', () => {
    expect(cleanBase64('data:image/png;charset=utf-8;base64,QUJD')).toBe('data:image/png;charset=utf-8;base64,QUJD');
    expect(cleanBase64('data:image/png;base64')).toBe('data:image/png;base64');
    expect(cleanBase64('abc data:image/png;base64,QU JD')).toBe('abcdata:image/png;base64,QUJD');
    expect(cleanBase64('QU\tJD\r\n')).toBe('QUJD');
  });
});

describe('reading one page image', () => {
  it('gives the call its own time limit', async () => {
    expect(TRANSCRIBE_TIMEOUT_MS).toBe(290_000);
    const { chat, seen } = standIn({ ok: true, value: { rows: [] }, timings: TIMINGS });
    const outcome = await transcribePageImage(normalizeConfig({}), 'QUJD', { chat });
    expect(outcome).toEqual({ ok: true, rows: [] });
    expect(seen()?.timeoutMs).toBe(TRANSCRIBE_TIMEOUT_MS);
    expect(seen()?.model).toBe('lantern-screen');
  });

  it('refuses an empty image and does not call the model', async () => {
    const { chat, calls } = standIn({ ok: true, value: { rows: [] }, timings: TIMINGS });
    const cfg = normalizeConfig({});
    for (const image of ['', '   ', 'data:image/png;base64,', 'data:image/png;base64,\n ']) {
      expect(await transcribePageImage(cfg, image, { chat })).toEqual({ ok: false, error: 'The page image is empty.' });
    }
    expect(await transcribePageImage(cfg, null as unknown as string, { chat })).toEqual({
      ok: false, error: 'The page image is empty.'
    });
    expect(calls()).toBe(0);
  });

  it('writes a date that can be read as year-month-day, keeps one that cannot, and drops an empty row', async () => {
    const cfg = normalizeConfig({});
    cfg.think.screen = true;
    const signal = new AbortController().signal;
    const { chat, seen } = standIn({
      ok: true,
      value: {
        rows: [
          {
            date: '21/08/2026', medicine: 'Celebrex (celecoxib)', strength: '200 mg', form: 'capsule',
            qty: '30', repeats: '2', directions: 'Take ONE capsule daily', prescriber: 'Dr G. Sample'
          },
          {
            date: '31/02/2026', medicine: 'Xarelto', strength: '20 mg', form: 'tablet',
            qty: '28', repeats: '5', directions: 'Take one', prescriber: 'Dr F. Example'
          },
          { date: '', medicine: '', strength: '', form: '', qty: '', repeats: '', directions: '', prescriber: '' }
        ]
      },
      timings: TIMINGS
    });
    const outcome = await transcribePageImage(cfg, 'data:image/png;base64,QU JD', { chat, signal });
    expect(outcome).toEqual({
      ok: true,
      rows: [
        '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily | Dr G. Sample',
        '31/02/2026 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take one | Dr F. Example'
      ]
    });
    const req = seen();
    expect(req?.model).toBe('lantern-screen');
    expect(req?.think).toBe(true);
    expect(req?.schema).toBe(TRANSCRIBE_SCHEMA);
    expect(req?.numPredict).toBe(TRANSCRIBE_NUM_PREDICT);
    expect(req?.timeoutMs).toBe(TRANSCRIBE_TIMEOUT_MS);
    expect(req?.signal).toBe(signal);
    expect(req?.messages[0]).toEqual({ role: 'system', content: TRANSCRIBE_SYSTEM });
    expect(req?.messages[1]?.images).toEqual(['QUJD']);
    expect(req?.messages[1]?.content).toContain('date, medicine');
  });

  it('a call that fails is a failed read, never a page with no rows', async () => {
    const { chat } = standIn({ ok: false, error: 'The local model server did not answer.', timings: TIMINGS });
    expect(await transcribePageImage(normalizeConfig({}), 'QUJD', { chat })).toEqual({
      ok: false, error: 'The local model server did not answer.'
    });
  });

  it('a call that throws is a failed read, with the reason', async () => {
    const thrown: ChatFn = async () => { throw new Error('the picture was cut off'); };
    expect(await transcribePageImage(normalizeConfig({}), 'QUJD', { chat: thrown })).toEqual({
      ok: false, error: 'The page could not be read: the picture was cut off'
    });
    const notAnError: ChatFn = async () => { throw 'stopped'; };
    expect(await transcribePageImage(normalizeConfig({}), 'QUJD', { chat: notAnError })).toEqual({
      ok: false, error: 'The page could not be read: stopped'
    });
  });

  it('keeps a row that is only a date, and leaves thinking off', async () => {
    const { chat, seen } = standIn({
      ok: true,
      value: {
        rows: [
          { date: '21/08/2026', medicine: '   ', strength: '', form: '', qty: '', repeats: '', directions: '', prescriber: '' }
        ]
      },
      timings: TIMINGS
    });
    const outcome = await transcribePageImage(normalizeConfig({}), 'data:image/gif;base64,QQ==', { chat });
    expect(outcome).toEqual({ ok: true, rows: ['2026-08-21'] });
    expect(seen()?.think).toBe(false);
    expect(seen()?.numPredict).toBe(TRANSCRIBE_NUM_PREDICT);
    expect(seen()?.messages[1]?.images).toEqual(['QQ==']);
  });

  it('an answer with no rows list is a failed read', async () => {
    const { chat } = standIn({ ok: true, value: {}, timings: TIMINGS });
    const outcome = await transcribePageImage(normalizeConfig({}), 'QUJD', { chat });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/^The page could not be read: /);
  });

  it('a cell that is not text fails the page, and a pipe in a name does not split the line', async () => {
    const bad = standIn({
      ok: true,
      value: {
        rows: [{ date: 20260821, medicine: 'Xarelto', strength: '', form: '', qty: '', repeats: '', directions: '', prescriber: '' }]
      },
      timings: TIMINGS
    });
    const failed = await transcribePageImage(normalizeConfig({}), 'QUJD', { chat: bad.chat });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/^The page could not be read: /);

    const { chat } = standIn({
      ok: true,
      value: {
        rows: [{
          date: '2026-08-21', medicine: 'Celebrex | celecoxib', strength: '200 mg', form: '',
          qty: '', repeats: '', directions: '', prescriber: ''
        }]
      },
      timings: TIMINGS
    });
    expect(await transcribePageImage(normalizeConfig({}), 'QUJD', { chat })).toEqual({
      ok: true,
      rows: ['2026-08-21 | Celebrex / celecoxib 200 mg']
    });
  });

  it('strips a data url with no type, and keeps a strength when the name is blank', async () => {
    expect(cleanBase64('data:;base64,QU JD')).toBe('QUJD');
    expect(cleanBase64('data:text/plain;base64,abc')).toBe('abc');
    const { chat, seen } = standIn({
      ok: true,
      value: {
        rows: [
          { date: '21/08/2026', medicine: '   ', strength: '20 mg', form: '', qty: '', repeats: '', directions: '', prescriber: '' }
        ]
      },
      timings: TIMINGS
    });
    expect(await transcribePageImage(normalizeConfig({}), 'data:;base64,QQ==', { chat })).toEqual({
      ok: true,
      rows: ['2026-08-21 | 20 mg']
    });
    expect(seen()?.messages[1]?.images).toEqual(['QQ==']);
  });
});

describe('reading the patient header of a scanned page', () => {
  it('carries a printed date of birth without asking the model to calculate age', async () => {
    const { chat, seen } = standIn({
      ok: true,
      value: {
        patient: { date_of_birth: '15 August 1952', age: '80', sex: 'Female' },
        rows: [{
          date: '21/08/2026', medicine: 'Celebrex', strength: '200 mg', form: 'capsule',
          qty: '30', repeats: '2', directions: 'Take ONE', prescriber: 'Dr B. Example'
        }]
      },
      timings: TIMINGS
    });
    const outcome = await transcribePageImage(normalizeConfig({}), 'QUJD', { chat });
    expect(outcome).toEqual({
      ok: true,
      rows: ['2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE | Dr B. Example'],
      patient: { dateOfBirth: '1952-08-15', age: 80, sex: 'F' }
    });
    expect(seen()?.messages[1]?.content).toContain('date_of_birth');
    expect(seen()?.messages[1]?.content).toContain('Do not calculate');
  });

  it('keeps an age-only scanned header as a recorded age', async () => {
    const { chat } = standIn({
      ok: true,
      value: {
        patient: { date_of_birth: '', age: '72', sex: 'Male' },
        rows: [{ date: '21/08/2026', medicine: 'Xarelto', strength: '', form: '', qty: '', repeats: '', directions: '', prescriber: '' }]
      },
      timings: TIMINGS
    });
    expect(await transcribePageImage(normalizeConfig({}), 'QUJD', { chat })).toEqual({
      ok: true,
      rows: ['2026-08-21 | Xarelto'],
      patient: { age: 72, sex: 'M' }
    });
  });
});
