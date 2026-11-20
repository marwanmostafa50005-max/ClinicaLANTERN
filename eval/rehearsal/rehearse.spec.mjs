import { describe, expect, it, onTestFinished, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { answerBodyFor, runRehearsal } from './rehearse.mjs';

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearse-test-'));
  const history = path.join(dir, 'history.csv');
  const answers = path.join(dir, 'answers.json');
  fs.writeFileSync(history, 'patient,F-TEST\n');
  fs.writeFileSync(answers, JSON.stringify([
    { key: 'condition\nknown fact', answer: 'Yes' },
    { key: 'result\ntyped fact', answer: { value: '42', unit: 'mg/L', date: '2026-11-18' } }
  ]));
  return { dir, history, answers, out: path.join(dir, 'out') };
}

function question(id, key, words = key, options = [{ words: 'Yes', effect: 'meets' }, { words: 'Not known', effect: 'unknown' }]) {
  return { id, key, what: words, question: words, kind: 'condition', criterionIds: ['C1'], status: 'open', options, needsValue: false };
}

function state(questions, findings = [], letters = []) {
  return {
    state: { cases: [{ id: 'CASE1', questions, lines: [{ id: 'L001', text: '2026-11-18 | Example supply' }] }], findings, letters, jobs: [] },
    counts: {}, now: { stage: null, text: 'Idle' }, serverTime: '2026-11-21T00:00:00.000Z'
  };
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

describe('rehearsal answer bodies', () => {
  it('uses exact file choices and typed values, with an unknown-option fallback', () => {
    const q = question('Q1', 'condition\nknown fact');
    expect(answerBodyFor(q, { answer: 'Yes' })).toEqual({ option: 'Yes' });
    expect(answerBodyFor(q, undefined)).toEqual({ option: 'Not known' });
    expect(answerBodyFor(q, { answer: { value: '42', unit: 'mg/L', date: '2026-11-18' } })).toEqual({ value: '42', unit: 'mg/L', date: '2026-11-18' });
    expect(answerBodyFor(question('Q2', 'other', 'Other', [{ words: 'Prior response is unknown', effect: 'unknown' }]), undefined)).toEqual({ option: 'Prior response is unknown' });
  });
});

describe('rehearsal runner', () => {
  it('imports, answers listed and unlisted questions, records API errors verbatim and writes reports', async () => {
    const w = workspace();
    const questions = [question('Q1', 'condition\nknown fact'), question('Q2', 'condition\nunlisted')];
    const bodies = [];
    let answerAttempts = 0;
    let mutations = 0;
    let maxMutations = 0;
    let eventLoopStalled = false;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const pathname = new URL(url).pathname;
      if (pathname === '/api/health') return response({ ollama: 'up', models: { screen: true, check: true, letter: true } });
      if (pathname === '/api/state') {
        if (!eventLoopStalled) {
          eventLoopStalled = true;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125);
        }
        return response(state(questions));
      }
      if (method !== 'GET') {
        mutations++;
        maxMutations = Math.max(maxMutations, mutations);
        await new Promise(resolve => setTimeout(resolve, 3));
        mutations--;
      }
      if (pathname === '/api/cases') {
        const body = JSON.parse(init.body);
        expect(body.csvText).toBe('patient,F-TEST\n');
        return response({ caseId: 'CASE1' });
      }
      if (pathname.endsWith('/answer')) {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (pathname.includes('/Q1/') && answerAttempts++ === 0) return response({ error: 'The criterion is being screened at this moment.' }, 409);
        const q = questions.find(item => item.id === pathname.split('/').at(-2));
        q.status = body.option === 'Not known' ? 'not_known' : 'answered';
        q.answer = { words: body.option ?? body.value };
        return response({ ok: true, question: q });
      }
      throw new Error(`${method} ${pathname}`);
    };
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const running = runRehearsal({ base: 'http://127.0.0.1:9999', history: w.history, answers: w.answers, out: w.out, minutes: 0.002, pollMs: 2, fetchImpl });
    await vi.runAllTimersAsync();
    const result = await running;
    expect(bodies).toContainEqual({ option: 'Yes' });
    expect(bodies).toContainEqual({ option: 'Not known' });
    expect(maxMutations).toBe(1);
    expect(result.summary.questions.answered).toBe(2);
    expect(result.summary.questions.unlisted.map(q => q.key)).toEqual(['condition\nunlisted']);
    expect(result.summary.errors.map(error => error.error)).toContain('The criterion is being screened at this moment.');
    expect(JSON.parse(fs.readFileSync(path.join(w.out, 'summary.json'), 'utf8')).timeline.some(event => event.type === 'question_answered')).toBe(true);
    expect(fs.readFileSync(path.join(w.out, 'summary.md'), 'utf8')).toContain('The criterion is being screened at this moment.');
    fs.rmSync(w.dir, { recursive: true, force: true });
  });

  it('accepts the first confirmed finding and completes agreement, preview and paper-sent calls', async () => {
    const w = workspace();
    const finding = { id: 'F1', caseId: 'CASE1', criterionId: 'CRIT1', state: 'confirmed', possible: false, screen: { lineIds: ['L001'] } };
    const letters = [];
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const pathname = new URL(url).pathname;
      if (method !== 'GET') calls.push({ method, pathname, body: JSON.parse(init.body ?? '{}') });
      if (pathname === '/api/health') return response({ ollama: 'up', models: { screen: true, check: true, letter: true } });
      if (pathname === '/api/state') return response(state([], [finding], letters));
      if (pathname === '/api/cases') return response({ caseId: 'CASE1' });
      if (pathname === '/api/findings/F1/decision') {
        letters.push({ id: 'T1', caseId: 'CASE1', findingId: 'F1', status: 'ready', draft: { body: 'Fictional letter.' } });
        return response({ ok: true });
      }
      if (pathname === '/api/letters/T1/agree') return response({ ok: true });
      if (pathname === '/api/letters/T1/preview') return response({ ok: true, previewToken: 'token-1', text: 'Fictional letter.' });
      if (pathname === '/api/letters/T1/sent') {
        letters[0].status = 'sent';
        return response({ ok: true });
      }
      throw new Error(`${method} ${pathname}`);
    };
    const result = await runRehearsal({ base: 'http://127.0.0.1:9999', history: w.history, answers: w.answers, out: w.out, minutes: 0.002, pollMs: 2, acceptFirst: true, fetchImpl });
    expect(calls.map(call => call.pathname)).toEqual(expect.arrayContaining(['/api/findings/F1/decision', '/api/letters/T1/agree', '/api/letters/T1/preview', '/api/letters/T1/sent']));
    expect(calls.find(call => call.pathname.endsWith('/sent')).body).toEqual({ by: 'print', previewToken: 'token-1' });
    expect(result.summary.firstFinding.criterion).toBe('CRIT1');
    expect(result.summary.minutesToFirstFinding).toEqual(expect.any(Number));
    expect(result.summary.minutesToLetter).toEqual(expect.any(Number));
    expect(result.summary.letters[0].status).toBe('sent');
    fs.rmSync(w.dir, { recursive: true, force: true });
  });
});
