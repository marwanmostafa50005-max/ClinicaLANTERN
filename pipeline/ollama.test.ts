import { describe, expect, it } from 'vitest';
import { normalizeConfig } from './config.ts';
import { chat, checkAgainstSchema, DEFAULT_TIMEOUT_MS, failedBecauseServerIsDown, type ChatRequest, type JsonSchema } from './ollama.ts';

const cfg = normalizeConfig({});

const schema: JsonSchema = {
  type: 'object',
  properties: { suspected: { type: 'boolean' }, line_ids: { type: 'array', items: { type: 'string' } } },
  required: ['suspected', 'line_ids']
};

const request: ChatRequest = {
  model: 'lantern-screen',
  think: false,
  schema,
  messages: [{ role: 'user', content: 'hello' }],
  numPredict: 100
};

function reply(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model: 'lantern-screen', done_reason: 'stop', message: { role: 'assistant', content },
    load_duration: 2_000_000_000, prompt_eval_count: 120, prompt_eval_duration: 500_000_000,
    eval_count: 30, eval_duration: 1_500_000_000, ...extra
  }), { status: 200 });
}

/** A stand-in for fetch that gives the listed answers in turn. */
function fakeFetch(answers: (Response | Error)[]): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[]; urls: string[] } {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, bodies, urls };
}

const noWait = { sleep: async () => undefined };

describe('checkAgainstSchema', () => {
  it('accepts a value that fits', () => {
    expect(checkAgainstSchema({ suspected: true, line_ids: ['L001'] }, schema)).toBeNull();
  });

  it('says what is wrong in one sentence', () => {
    expect(checkAgainstSchema({ suspected: true }, schema)).toBe('answer is missing "line_ids"');
    expect(checkAgainstSchema({ suspected: 'yes', line_ids: [] }, schema)).toBe('answer.suspected should be true or false');
    expect(checkAgainstSchema({ suspected: true, line_ids: ['L001', 4] }, schema)).toBe('answer.line_ids[1] should be text');
    expect(checkAgainstSchema(['x'], schema)).toBe('answer should be an object');
    expect(checkAgainstSchema(null, schema)).toBe('answer should be an object');
  });

  it('names a text, a number, a whole number, a list, and a type it does not know', () => {
    expect(checkAgainstSchema('L001', { type: 'string' })).toBeNull();
    expect(checkAgainstSchema(1, { type: 'string' }, 'line')).toBe('line should be text');
    expect(checkAgainstSchema(true, { type: 'boolean' })).toBeNull();
    expect(checkAgainstSchema(1.5, { type: 'number' })).toBeNull();
    expect(checkAgainstSchema(Number.NaN, { type: 'number' })).toBe('answer should be a number');
    expect(checkAgainstSchema(Number.POSITIVE_INFINITY, { type: 'number' })).toBe('answer should be a number');
    expect(checkAgainstSchema(2, { type: 'integer' })).toBeNull();
    expect(checkAgainstSchema(1.5, { type: 'integer' })).toBe('answer should be a whole number');
    expect(checkAgainstSchema('1', { type: 'integer' })).toBe('answer should be a whole number');
    expect(checkAgainstSchema([], { type: 'array' })).toBeNull();
    expect(checkAgainstSchema(['a'], { type: 'array' })).toBeNull();
    expect(checkAgainstSchema('no', { type: 'array' })).toBe('answer should be a list');
    expect(checkAgainstSchema({ extra: 1 }, { type: 'object' })).toBeNull();
    expect(checkAgainstSchema({ n: 'x' }, { type: 'object', properties: { n: { type: 'number' } } })).toBe('answer.n should be a number');
    expect(checkAgainstSchema({ kept: true }, { type: 'object', properties: { n: { type: 'number' } } })).toBeNull();
    expect(checkAgainstSchema(1, { type: 'null' } as unknown as JsonSchema)).toBe('answer has a type this check does not know');
  });
});

describe('chat', () => {
  it('sends the options from the proof and returns the answer with timings', async () => {
    const fake = fakeFetch([reply('{"suspected": true, "line_ids": ["L001"]}')]);
    const result = await chat<{ suspected: boolean; line_ids: string[] }>(cfg, request, { ...noWait, fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ suspected: true, line_ids: ['L001'] });
    expect(result.timings).toMatchObject({ attempts: 1, loadSeconds: 2, promptTokens: 120, promptSeconds: 0.5, outputTokens: 30, outputSeconds: 1.5 });
    expect(fake.urls).toEqual(['http://127.0.0.1:27435/api/chat']);
    expect(fake.bodies[0]).toMatchObject({
      model: 'lantern-screen', stream: false, think: false, keep_alive: '20m', format: schema,
      options: { temperature: 0, seed: 42, top_k: 1, num_ctx: 16384, num_predict: 100 }
    });
  });

  it('tries once more after a failure, 2 seconds later', async () => {
    const waits: number[] = [];
    const fake = fakeFetch([
      new Response('{"error":"CUDA error"}', { status: 500 }),
      reply('{"suspected": false, "line_ids": []}')
    ]);
    const result = await chat(cfg, request, { fetchImpl: fake.fetchImpl, sleep: async ms => { waits.push(ms); } });
    expect(result.ok).toBe(true);
    expect(result.timings.attempts).toBe(2);
    expect(waits).toEqual([2000]);
    expect(fake.bodies).toHaveLength(2);
  });

  it('never throws: a call that fails twice comes back as ok false with both reasons', async () => {
    const fake = fakeFetch([new Error('connect ECONNREFUSED'), new Response('{"error":"CUDA error"}', { status: 500 })]);
    const result = await chat(cfg, request, { ...noWait, fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Tried twice. First: The local model server did not answer. Second: The local model server answered with error 500: CUDA error.');
    expect(result.timings.attempts).toBe(2);
    expect(fake.bodies).toHaveLength(2);
  });

  it('does not try a third time', async () => {
    const fake = fakeFetch([new Error('down'), new Error('down'), reply('{"suspected": false, "line_ids": []}')]);
    const result = await chat(cfg, request, { ...noWait, fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(false);
    expect(fake.bodies).toHaveLength(2);
  });

  it('gives every attempt a time limit, and a call that takes too long is a failed attempt', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(240_000);
    let calls = 0;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('no time limit'));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
        });
      });
    }) as typeof fetch;
    const result = await chat(cfg, { ...request, timeoutMs: 40 }, { ...noWait, fetchImpl });
    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Tried twice. The model took too long to answer.');
    expect(result.timings.attempts).toBe(2);
  });

  it('refuses an answer that was cut off', async () => {
    const cut = (): Response => reply('{"suspected": true, "line_ids": ["L0', { done_reason: 'length' });
    const result = await chat(cfg, request, { ...noWait, fetchImpl: fakeFetch([cut(), cut()]).fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('did not finish its answer');
  });

  it('refuses an empty answer, an answer that is not JSON and an answer of the wrong shape', async () => {
    for (const content of ['', '   ', 'Sure! Here is the answer.', '{"suspected": "maybe", "line_ids": []}', '{"line_ids": []}']) {
      const result = await chat(cfg, request, { ...noWait, fetchImpl: fakeFetch([reply(content), reply(content)]).fetchImpl });
      expect(result.ok).toBe(false);
    }
  });

  it('passes page images through', async () => {
    const fake = fakeFetch([reply('{"suspected": false, "line_ids": []}')]);
    await chat(cfg, { ...request, messages: [{ role: 'user', content: 'read this', images: ['QUJD'] }] }, { ...noWait, fetchImpl: fake.fetchImpl });
    expect(fake.bodies[0].messages).toEqual([{ role: 'user', content: 'read this', images: ['QUJD'] }]);
  });

  it('sends the limit on a text field to the model server, which keeps the text to it', async () => {
    const limited: JsonSchema = { type: 'object', properties: { what_matches: { type: 'string', maxLength: 700 } }, required: ['what_matches'] };
    const fake = fakeFetch([reply('{"what_matches": "Both are supplied."}')]);
    const result = await chat(cfg, { ...request, schema: limited }, { ...noWait, fetchImpl: fake.fetchImpl });
    expect(result.ok).toBe(true);
    expect(fake.bodies[0].format).toEqual(limited);
  });

  it('stops at once when it is told to, and does not try a stopped call again', async () => {
    const stop = new AbortController();
    let calls = 0;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }) as typeof fetch;
    const running = chat(cfg, { ...request, signal: stop.signal }, { ...noWait, fetchImpl });
    await new Promise(resolve => setTimeout(resolve, 10));
    stop.abort();
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: 'The call was stopped.' });
    expect(calls).toBe(1);
    // A call that is asked for after the stop is not made at all.
    const later = await chat(cfg, { ...request, signal: stop.signal }, { ...noWait, fetchImpl });
    expect(later).toMatchObject({ ok: false, error: 'The call was stopped.' });
    expect(calls).toBe(1);
  });

  it('runs one call at a time', async () => {
    let running = 0;
    let most = 0;
    const fetchImpl = (async () => {
      running++;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve, 15));
      running--;
      return reply('{"suspected": false, "line_ids": []}');
    }) as typeof fetch;
    await Promise.all([1, 2, 3].map(() => chat(cfg, request, { ...noWait, fetchImpl })));
    expect(most).toBe(1);
  });
});

describe('failedBecauseServerIsDown', () => {
  it('is true only when the server could not be reached', () => {
    expect(failedBecauseServerIsDown('Tried twice. The local model server did not answer.')).toBe(true);
    expect(failedBecauseServerIsDown('The local model server did not answer.')).toBe(true);
    expect(failedBecauseServerIsDown(
      'The second check did not finish, so this finding is shown without it. Tried twice. The local model server did not answer.'
    )).toBe(true);
    expect(failedBecauseServerIsDown(
      'The letter model did not answer. Tried twice. The local model server did not answer.'
    )).toBe(true);
    expect(failedBecauseServerIsDown('Tried twice. The model took too long to answer.')).toBe(false);
    expect(failedBecauseServerIsDown('Tried twice. The local model server answered with error 500: CUDA error.')).toBe(false);
    expect(failedBecauseServerIsDown(
      'Tried twice. First: The local model server did not answer. Second: The local model server answered with error 500: CUDA error.'
    )).toBe(false);
    expect(failedBecauseServerIsDown('The model sent an empty answer.')).toBe(false);
    expect(failedBecauseServerIsDown('The model answer was not in the form that was asked for.')).toBe(false);
  });

  it('is false when that sentence sits beside another fault, and true when both tries say it', () => {
    const down = 'The local model server did not answer.';
    expect(failedBecauseServerIsDown(`${down} The answer could not be read.`)).toBe(false);
    expect(failedBecauseServerIsDown(`${down} The model sent an empty answer.`)).toBe(false);
    expect(failedBecauseServerIsDown(`${down} The answer was not in the form that was asked for.`)).toBe(false);
    expect(failedBecauseServerIsDown(`${down} The model did not finish its answer.`)).toBe(false);
    expect(failedBecauseServerIsDown(`First: ${down} Second: ${down}`)).toBe(true);
    expect(failedBecauseServerIsDown(`First: ${down} Second: the call was stopped.`)).toBe(false);
  });
});
