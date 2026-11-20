import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criterion, HealthResponse, StateResponse } from '../shared/types.ts';
import { testConfig, testCriterion } from '../pipeline/testkit.ts';
import { MAX_BODY_BYTES, getHealth, handleApi, isLocalHostHeader, isLocalOrigin, readJsonBody, sendJson } from './api.ts';
import { ApiError, Engine, type PipelineFns } from './engine.ts';
import { PageImages } from './images.ts';
import { resolveInside, serveStatic } from './static.ts';
import { StateStore } from './store.ts';

const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const CSV = [
  'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber',
  'F-001,72,F,2026-08-08,,Xarelto,20 mg,tablet,28,5,Take ONE tablet daily with food,Dr F. Example',
  'F-001,72,F,2026-08-21,,Celebrex,200 mg,capsule,30,2,Take ONE capsule daily with food,Dr G. Sample'
].join('\r\n');

const pipeline: PipelineFns = {
  screenCriterion: async () => ({
    ok: true, suspected: true,
    result: { lineIds: ['L001', 'L002'], medicines: ['celecoxib', 'rivaroxaban'], reason: 'Both are supplied.', linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1 }
  }),
  checkFinding: async () => ({
    confirmed: true, lineIds: ['L001', 'L002'], whatMatches: 'Celebrex and Xarelto.', whatCannotBeSeen: 'Kidney function.',
    completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 2
  }),
  draftLetter: async () => ({
    subject: 'Review request', body: 'Fictional patient. No real person.\n\nThe letter text.', origin: 'model', checkNotes: [],
    model: 'lantern-letter', at: '2026-11-18T00:01:00.000Z', seconds: 2
  }),
  transcribePageImage: async () => ({ ok: true, rows: ['2026-08-08 | Xarelto 20 mg tablet'] })
};

interface Running {
  base: string;
  port: number;
  engine: Engine;
  dir: string;
}

async function startServer(options?: { warmup?: boolean; warmModel?: PipelineFns['warmModel'] }): Promise<Running> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-api-'));
  made.push(dir);
  const store = new StateStore(path.join(dir, 'data'));
  store.load();
  const criteria: Criterion[] = [testCriterion];
  const engine = new Engine({
    cfg: testConfig,
    store,
    pipeline: options?.warmModel ? { ...pipeline, warmModel: options.warmModel } : pipeline,
    images: new PageImages(path.join(dir, 'data', 'images')),
    loadCriteria: async () => criteria,
    warmup: options?.warmup === true
  });
  await engine.start();
  const dist = path.join(dir, 'dist');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) void handleApi(engine, req, res, pathname);
    else serveStatic(dist, req, res, pathname);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, engine, dir };
}

async function call(base: string, method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** A request with hand-written headers and an address sent exactly as typed: fetch tidies both. */
function raw(port: number, method: string, route: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function rawGet(port: number, route: string, host: string): Promise<{ status: number; body: string }> {
  return raw(port, 'GET', route, { host });
}

describe('the API over HTTP', () => {
  it('runs one history from import to a closed letter', async () => {
    const s = await startServer();

    const criteria = await call(s.base, 'GET', '/api/criteria');
    expect(criteria.status).toBe(200);
    expect(criteria.json.map((c: Criterion) => c.id)).toEqual(['DEMO-NSAID-ANTICOAG']);

    const imported = await call(s.base, 'POST', '/api/cases', { fileName: 'positive.csv', source: 'csv', csvText: CSV });
    expect(imported).toEqual({ status: 200, json: { caseId: 'C0001' } });
    await s.engine.whenIdle();

    let state = (await call(s.base, 'GET', '/api/state')).json as StateResponse;
    expect(state.state.findings[0]).toMatchObject({ id: 'F0001', state: 'confirmed' });
    expect(state.counts.bellBadge).toBe(1);
    expect(state.now).toEqual({ stage: null, text: 'Idle' });
    expect(state.recorded).toBe(false);
    expect(typeof state.serverTime).toBe('string');

    expect((await call(s.base, 'POST', '/api/findings/F0001/seen', {})).status).toBe(200);
    const bypassNoReason = await call(s.base, 'POST', '/api/findings/F0001/decision', { action: 'bypass' });
    expect(bypassNoReason.status).toBe(400);
    expect(bypassNoReason.json.error).toBe('Please give a short reason for bypassing this finding.');

    const accepted = await call(s.base, 'POST', '/api/findings/F0001/decision', { action: 'accept' });
    expect(accepted.status).toBe(200);
    expect(accepted.json.finding.state).toBe('accepted');
    await s.engine.whenIdle();

    expect((await call(s.base, 'POST', '/api/letters/T0001/seen', {})).status).toBe(200);
    const edited = await call(s.base, 'PUT', '/api/letters/T0001', { subject: 'Review request, edited', body: 'Fictional patient. No real person.\n\nEdited.', expectedRevision: 0 });
    expect(edited.json.letter).toMatchObject({ editedByPharmacist: true, subject: 'Review request, edited' });
    expect((await call(s.base, 'POST', '/api/letters/T0001/agree', {})).json.letter.patientAgreed).toBeTruthy();
    const refused = await call(s.base, 'POST', '/api/letters/T0001/sent', { by: 'print' });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain('has not been previewed');
    const preview = await call(s.base, 'POST', '/api/letters/T0001/preview', {});
    expect(preview.status).toBe(200);
    expect(preview.json.text).toContain('Fictional patient. No real person.');
    expect(preview.json.emailDraft.coverNote).toBe(false);
    expect((await call(s.base, 'POST', '/api/letters/T0001/sent', { by: 'print', previewToken: preview.json.previewToken })).json.letter.status).toBe('sent');
    expect((await call(s.base, 'POST', '/api/letters/T0001/reply', { outcome: 'will_review', note: 'Will see the patient.' })).json.letter.status).toBe('reply_recorded');
    expect((await call(s.base, 'POST', '/api/letters/T0001/close', {})).json.letter.status).toBe('closed');

    state = (await call(s.base, 'GET', '/api/state')).json as StateResponse;
    expect(state.counts).toMatchObject({ historiesScreened: 1, findingsConfirmed: 1, accepted: 1, lettersSent: 1, repliesRecorded: 1, closed: 1, bellBadge: 0, letterBadge: 0 });

    const reset = await call(s.base, 'POST', '/api/reset', {});
    expect(reset.status).toBe(200);
    expect(reset.json.backup).toMatch(/^state-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    state = (await call(s.base, 'GET', '/api/state')).json as StateResponse;
    expect(state.state.cases).toEqual([]);
    expect(state.state.activity.map(a => a.kind)).toEqual(['reset']);
  });

  it('moves the demo clock, keeps it in its own file, and a reset puts the real date back', async () => {
    const s = await startServer();
    expect((await call(s.base, 'GET', '/api/demo-clock')).status).toBe(405);
    const bad = await call(s.base, 'POST', '/api/demo-clock', { days: 1.5 });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('whole number');

    const moved = await call(s.base, 'POST', '/api/demo-clock', { days: 8 });
    expect(moved.status).toBe(200);
    expect(moved.json.days).toBe(8);
    let state = (await call(s.base, 'GET', '/api/state')).json as StateResponse;
    expect(state.now.text).toBe('Idle Demo clock: 8 days ahead.');
    const posted = Date.parse(moved.json.serverTime);
    const seen = Date.parse(state.serverTime);
    expect(Math.abs(seen - posted)).toBeLessThan(5000);
    expect(seen - Date.now()).toBeGreaterThan(7.9 * 24 * 60 * 60 * 1000);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'demo-clock.json'), 'utf8')) as { days: number };
    expect(saved.days).toBe(8);

    const reset = await call(s.base, 'POST', '/api/reset', {});
    expect(reset.status).toBe(200);
    state = (await call(s.base, 'GET', '/api/state')).json as StateResponse;
    expect(state.now.text).toBe('Idle');
    expect(state.state.activity.map(a => a.text)).toEqual([
      'The demo clock is back to the real date.',
      expect.stringContaining('A clean demo was started.')
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(s.dir, 'data', 'demo-clock.json'), 'utf8'))).toEqual({ days: 0 });
  });

  it('answers mistakes with a plain message and the right code', async () => {
    const s = await startServer();
    expect(await call(s.base, 'GET', '/api/nothing')).toEqual({ status: 404, json: { error: 'There is no such call.' } });
    expect((await call(s.base, 'GET', '/api/cases')).status).toBe(405);
    expect((await call(s.base, 'POST', '/api/findings/F0404/decision', { action: 'accept' })).status).toBe(404);
    expect((await call(s.base, 'POST', '/api/letters/T0404/close', {})).json).toEqual({ error: 'This letter was not found.' });
    expect((await call(s.base, 'POST', '/api/cases', { fileName: 'x.csv', source: 'csv' })).json).toEqual({ error: 'The CSV text is missing.' });

    const notJson = await fetch(s.base + '/api/cases', { method: 'POST', body: 'this is not json' });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'The request could not be read. It must be JSON.' });

    // An empty body is read as {}: the page sends one for calls that need no details.
    const empty = await fetch(s.base + '/api/findings/F0404/seen', { method: 'POST' });
    expect(empty.status).toBe(404);
  });

  it('takes a body of a few megabytes and refuses one over 40 MB', async () => {
    const s = await startServer();
    const big = await call(s.base, 'POST', '/api/cases', { fileName: 'scan.pdf', source: 'pdf-image', pageImages: ['A'.repeat(3 * 1024 * 1024)] });
    expect(big).toEqual({ status: 200, json: { caseId: 'C0001' } });
    await s.engine.whenIdle();

    const tooBig = await fetch(s.base + '/api/cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: 'huge.pdf', source: 'pdf-image', pageImages: ['A'.repeat(41 * 1024 * 1024)] })
    }).then(async res => ({ status: res.status, json: await res.json() as unknown }), () => ({ status: 413, json: { error: 'connection closed' } }));
    expect(tooBig.status).toBe(413);
    expect(s.engine.state.cases).toHaveLength(1);
  });

  it('answers only pages and names of this computer', async () => {
    const s = await startServer();
    expect((await rawGet(s.port, '/api/state', 'evil.example.com')).status).toBe(403);
    expect((await rawGet(s.port, '/api/state', `localhost:${s.port}`)).status).toBe(200);
    expect((await rawGet(s.port, '/api/state', '127.0.0.1:5173')).status).toBe(200);
    const host = `127.0.0.1:${s.port}`;
    const fromElsewhere = await raw(s.port, 'POST', '/api/reset', { host, origin: 'https://evil.example.com', 'content-type': 'text/plain' }, '{}');
    expect(fromElsewhere.status).toBe(403);
    expect(JSON.parse(fromElsewhere.body)).toEqual({ error: 'This server only answers pages opened from this computer.' });
    const fromThePage = await raw(s.port, 'GET', '/api/state', { host, origin: 'http://127.0.0.1:5173' });
    expect(fromThePage.status).toBe(200);
    expect(s.engine.state.activity.some(a => a.kind === 'reset')).toBe(false);     // the reset from elsewhere did nothing

    expect(isLocalHostHeader('127.0.0.1:8787')).toBe(true);
    expect(isLocalHostHeader('localhost')).toBe(true);
    expect(isLocalHostHeader('[::1]:8787')).toBe(true);
    expect(isLocalHostHeader('127.0.0.1.evil.example.com')).toBe(false);
    expect(isLocalHostHeader(undefined)).toBe(false);
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1.evil.example.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});

describe('the calls added after the review of 18 November', () => {
  it('serves the page pictures of a scan until its rows are confirmed, so the check works after a page reload', async () => {
    const { base, port, engine } = await startServer();
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);      // starts like a PNG file
    const imported = await call(base, 'POST', '/api/cases', { fileName: 'scan.pdf', source: 'pdf-image', pageImages: [picture.toString('base64')] });
    const id = imported.json.caseId as string;
    await engine.whenIdle();

    const res = await fetch(`${base}/api/cases/${id}/pages/1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(picture)).toBe(true);
    expect((await call(base, 'GET', `/api/cases/${id}/pages/2`)).status).toBe(404);
    expect((await call(base, 'GET', `/api/cases/${id}/pages/x`)).status).toBe(404);
    expect((await call(base, 'GET', '/api/cases/C0404/pages/1')).status).toBe(404);
    expect((await call(base, 'POST', `/api/cases/${id}/pages/1`, {})).status).toBe(405);
    expect((await rawGet(port, `/api/cases/${id}/pages/1`, 'attacker.example')).status).toBe(403);    // only this computer

    const state = (await call(base, 'GET', '/api/state')).json as StateResponse;
    expect(state.state.cases[0].pages).toBe(1);
    expect(JSON.stringify(state)).not.toContain(picture.toString('base64'));                          // the picture is not in the state

    expect((await call(base, 'POST', `/api/cases/${id}/confirm-transcription`, {})).status).toBe(200);
    expect((await call(base, 'GET', `/api/cases/${id}/pages/1`)).status).toBe(404);                   // removed once confirmed
  });

  it('screens again what could not be screened, and refuses when there is nothing to do', async () => {
    const { base, engine } = await startServer();
    const real = pipeline.screenCriterion;
    pipeline.screenCriterion = async () => ({ ok: false, error: 'Tried twice. The model took too long to answer.' });
    try {
      const { json } = await call(base, 'POST', '/api/cases', { fileName: 'positive.csv', source: 'csv', csvText: CSV });
      await engine.whenIdle();
      let state = (await call(base, 'GET', '/api/state')).json as StateResponse;
      expect(state.counts.historiesScreened).toBe(0);
      expect(state.state.cases[0].screening.criteria[0].status).toBe('failed');

      pipeline.screenCriterion = real;
      const again = await call(base, 'POST', `/api/cases/${json.caseId}/screen-again`, {});
      expect(again.status).toBe(200);
      await engine.whenIdle();
      state = (await call(base, 'GET', '/api/state')).json as StateResponse;
      expect(state.counts.historiesScreened).toBe(1);
      expect(state.state.cases).toHaveLength(1);
      const nothing = await call(base, 'POST', `/api/cases/${json.caseId}/screen-again`, {});
      expect(nothing.status).toBe(409);
      expect(nothing.json.error).toContain('nothing to screen again');
      expect((await call(base, 'POST', '/api/cases/C0404/screen-again', {})).status).toBe(404);
    } finally {
      pipeline.screenCriterion = real;
    }
  });

  it('discards a scan the pharmacist will not confirm', async () => {
    const { base, engine } = await startServer();
    const { json } = await call(base, 'POST', '/api/cases', { fileName: 'blurred.pdf', source: 'pdf-image', pageImages: ['AAAA'] });
    await engine.whenIdle();
    const gone = await call(base, 'POST', `/api/cases/${json.caseId}/discard`, {});
    expect(gone.status).toBe(200);
    expect(gone.json.case.cannotAssess).toContain('The pharmacist discarded this scan.');
    expect((await call(base, 'POST', `/api/cases/${json.caseId}/confirm-transcription`, {})).status).toBe(409);
  });
});

describe('the question calls over HTTP', () => {
  it('answers, takes an answer back, opens the question again, and refuses the other ways', async () => {
    const s = await startServer();
    const imported = await call(s.base, 'POST', '/api/cases', { fileName: 'positive.csv', source: 'csv', csvText: CSV });
    await s.engine.whenIdle();
    const history = s.engine.state.cases[0];
    expect(history?.id).toBe(imported.json.caseId);
    if (!history) return;
    history.questions = [{
      id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure', meets: 'recorded',
      criterionIds: [], findingIds: [], source: 'patient', status: 'open', needsValue: false,
      options: [
        { words: 'Yes', effect: 'meets' },
        { words: 'No', effect: 'does_not_meet' },
        { words: 'Not known', effect: 'unknown' }
      ]
    }];
    const route = `/api/cases/${history.id}/questions/Q0001`;

    expect(await call(s.base, 'POST', `/api/cases/${history.id}/questions/Q9999/answer`, { option: 'Yes' }))
      .toEqual({ status: 404, json: { error: 'This question was not found.' } });
    expect(await call(s.base, 'POST', `${route}/shrug`, {}))
      .toEqual({ status: 404, json: { error: 'There is no such call.' } });
    expect(await call(s.base, 'PUT', `${route}/answer`, { option: 'Yes' }))
      .toEqual({ status: 405, json: { error: 'This call does not take that method.' } });
    expect(await call(s.base, 'GET', `${route}/answer`))
      .toEqual({ status: 405, json: { error: 'This call does not take that method.' } });
    expect(await call(s.base, 'GET', '/api/cases'))
      .toEqual({ status: 405, json: { error: 'This call does not take that method.' } });

    const yes = await call(s.base, 'POST', `${route}/answer`, { option: 'Yes' });
    expect(yes.status).toBe(200);
    expect(yes.json.question.status).toBe('answered');
    expect(yes.json.question.answer.words).toBe('Yes');
    await s.engine.whenIdle();
    expect(s.engine.state.cases[0].lines.some(line => line.text.includes('Heart failure') && line.text.includes('pharmacist at the counter'))).toBe(true);

    const again = await call(s.base, 'POST', `${route}/answer`, { option: 'No' });
    expect(again.status).toBe(409);
    expect(again.json.error).toContain('already has an answer');

    const back = await call(s.base, 'POST', `${route}/take-back`, {});
    expect(back.status).toBe(200);
    expect(back.json.question.status).toBe('open');

    const known = await call(s.base, 'POST', `${route}/answer`, { option: 'Not known' });
    expect(known.status).toBe(200);
    expect(known.json.question.status).toBe('not_known');
    const closed = await call(s.base, 'POST', `${route}/answer`, { option: 'Yes' });
    expect(closed.status).toBe(409);
    expect(closed.json.error).toContain('Open it again');

    const opened = await call(s.base, 'POST', `${route}/reopen`, {});
    expect(opened.status).toBe(200);
    expect(opened.json.question.status).toBe('open');

    expect(await call(s.base, 'GET', `/api/cases/${history.id}/questions/leave`))
      .toEqual({ status: 405, json: { error: 'This call does not take that method.' } });
    expect((await call(s.base, 'PUT', `/api/cases/${history.id}/questions/leave`, {})).status).toBe(405);
    const left = await call(s.base, 'POST', `/api/cases/${history.id}/questions/leave`, {});
    expect(left.status).toBe(200);
    expect(left.json.questions.map((q: { what: string }) => q.what)).toEqual(['Heart failure']);
    expect(s.engine.state.cases[0].questions?.[0].leftUnanswered).toBe(true);
    const shown = await call(s.base, 'POST', `/api/cases/${history.id}/questions/leave`, { show: true });
    expect(shown.status).toBe(200);
    expect(shown.json.questions).toHaveLength(1);
    expect(s.engine.state.cases[0].questions?.[0].leftUnanswered).toBeUndefined();
    expect(await call(s.base, 'POST', '/api/cases/C9999/questions/leave', {}))
      .toEqual({ status: 404, json: { error: 'This history was not found.' } });

    const host = await raw(s.port, 'GET', '/api/state', { host: 'evil.example.com' });
    expect(host.status).toBe(403);
    expect(JSON.parse(host.body)).toEqual({ error: 'This server only answers on this computer.' });
  });

  it('answers HEAD for a page picture and names a picture that is not there', async () => {
    const s = await startServer();
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
    const imported = await call(s.base, 'POST', '/api/cases', {
      fileName: 'scan.pdf', source: 'pdf-image', pageImages: [picture.toString('base64')]
    });
    await s.engine.whenIdle();
    const id = imported.json.caseId as string;
    const head = await fetch(`${s.base}/api/cases/${id}/pages/1`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(head.headers.get('content-length')).toBe(String(picture.length));
    expect(head.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(await call(s.base, 'GET', `/api/cases/${id}/pages/2`))
      .toEqual({ status: 404, json: { error: 'This page picture is not on this computer any more.' } });
    expect(await call(s.base, 'GET', `/api/cases/${id}/pages/1a`))
      .toEqual({ status: 404, json: { error: 'This page picture is not on this computer any more.' } });
    expect(await call(s.base, 'GET', `/api/cases/${id}/pages/1/extra`))
      .toEqual({ status: 404, json: { error: 'There is no such call.' } });
  });
});

describe('health', () => {
  const answer = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200 });

  it('says which of the three models are there', async () => {
    const fetchImpl = (async (url: string | URL | Request) => String(url).endsWith('/api/version')
      ? answer({ version: '0.40.15' })
      : answer({ models: [{ name: 'lantern-screen:latest' }, { name: 'lantern-letter:latest' }, { name: 'other:7b' }] })) as typeof fetch;
    const health: HealthResponse = await getHealth(testConfig, fetchImpl);
    expect(health).toEqual({
      ollama: 'up', version: '0.40.15',
      models: { screen: true, check: false, letter: true },
      names: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
      displayNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' },
      modelsBehind: { screen: 'Gemma 4 31B', check: 'Qwen 3.8 27B', letter: 'Gemma 4 26B' }
    });
  });

  it('says down when Ollama does not answer', async () => {
    const fetchImpl = (async () => { throw new Error('connect ECONNREFUSED'); }) as typeof fetch;
    expect(await getHealth(testConfig, fetchImpl)).toEqual({
      ollama: 'down',
      models: { screen: false, check: false, letter: false },
      names: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
      displayNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' },
      modelsBehind: { screen: 'Gemma 4 31B', check: 'Qwen 3.8 27B', letter: 'Gemma 4 26B' }
    });
  });

  it('adds the models note on health only while the warm-up has failed', async () => {
    const failed = await startServer({
      warmup: true,
      warmModel: async () => ({ ok: false, error: 'The local model server did not answer.' })
    });
    const quiet = await startServer();
    await failed.engine.whenIdle();
    await quiet.engine.whenIdle();
    const down = await call(failed.base, 'GET', '/api/health');
    expect(down.status).toBe(200);
    expect(down.json.modelsNote).toBe('The local models are not running.');
    const clear = await call(quiet.base, 'GET', '/api/health');
    expect(clear.status).toBe(200);
    expect(clear.json.modelsNote).toBeUndefined();
  }, 20000);
});

describe('serving the built page', () => {
  it('says so when the page has not been built', async () => {
    const s = await startServer();
    const res = await fetch(s.base + '/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('The page has not been built yet.');
    expect((await fetch(s.base + '/assets/app.js')).status).toBe(404);
  });

  it('serves files inside dist and nothing outside it', async () => {
    const s = await startServer();
    const dist = path.join(s.dir, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ClinicaLANTERN</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("page")');
    fs.writeFileSync(path.join(s.dir, 'secret.txt'), 'outside dist');

    const index = await fetch(s.base + '/');
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toContain('<title>ClinicaLANTERN</title>');
    const script = await fetch(s.base + '/assets/app.js');
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).toBe('console.log("page")');
    expect((await fetch(s.base + '/assets/missing.js')).status).toBe(404);
    expect(await (await fetch(s.base + '/some/page')).text()).toContain('<title>ClinicaLANTERN</title>');   // the one page

    for (const attempt of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/assets/..%2f..%2fsecret.txt', '/c:%5cwindows%5cwin.ini']) {
      const res = await rawGet(s.port, attempt, `127.0.0.1:${s.port}`);
      expect(res.body, attempt).not.toContain('outside dist');
      expect([403, 404, 200], attempt).toContain(res.status);
      if (res.status === 200) expect(res.body, attempt).toContain('<title>ClinicaLANTERN</title>');
    }
    expect((await rawGet(s.port, '/../secret.txt', `127.0.0.1:${s.port}`)).body).not.toContain('outside dist');
    expect((await fetch(s.base + '/', { method: 'POST' })).status).toBe(405);
  });

  it('keeps every path inside the folder', () => {
    const root = path.resolve('some', 'dist');
    expect(resolveInside(root, '/')).toBe(root);
    expect(resolveInside(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveInside(root, '/a/../b.js')).toBe(path.join(root, 'b.js'));
    expect(resolveInside(root, '/../secret.txt')).toBeNull();
    expect(resolveInside(root, '/..%2f..%2fsecret.txt')).toBeNull();
    expect(resolveInside(root, '/assets/..%2f..%2fsecret.txt')).toBeNull();
    expect(resolveInside(root, '/..%5csecret.txt')).toBeNull();
    expect(resolveInside(root, '/c:/windows/win.ini')).toBeNull();
    expect(resolveInside(root, '/file%00.txt')).toBeNull();
    expect(resolveInside(root, '/%zz')).toBeNull();
  });
});

describe('reading a body and writing a JSON reply', () => {
  function bodyRequest(opts: {
    body?: string;
    chunks?: Buffer[];
    headers?: Record<string, string>;
    mode?: 'end' | 'error' | 'hold';
  }): IncomingMessage & { resumed: boolean } {
    const ee = new EventEmitter();
    const req = ee as IncomingMessage & { resumed: boolean };
    req.headers = opts.headers ?? {};
    req.resumed = false;
    req.resume = () => {
      req.resumed = true;
      return req;
    };
    queueMicrotask(() => {
      if (opts.mode === 'hold') return;
      if (opts.mode === 'error') {
        ee.emit('error', new Error('reset'));
        return;
      }
      const chunks = opts.chunks ?? (opts.body ? [Buffer.from(opts.body)] : []);
      for (const chunk of chunks) ee.emit('data', chunk);
      ee.emit('end');
    });
    return req;
  }

  function jsonReply(): ServerResponse & { statusCode: number; headers: Record<string, string | number>; body: string } {
    return {
      statusCode: 0,
      headers: {},
      body: '',
      writeHead(status: number, headers: Record<string, string | number>) {
        this.statusCode = status;
        this.headers = headers;
      },
      end(text: string) {
        this.body = text;
      }
    } as ServerResponse & { statusCode: number; headers: Record<string, string | number>; body: string };
  }

  it('reads an empty body as {}, strips a byte-order mark, and refuses what is not JSON', async () => {
    expect(await readJsonBody(bodyRequest({}))).toEqual({});
    expect(await readJsonBody(bodyRequest({ body: ' \n\t ' }))).toEqual({});
    expect(await readJsonBody(bodyRequest({ body: '\uFEFF{"ok":true}' }))).toEqual({ ok: true });
    expect(await readJsonBody(bodyRequest({ body: '12' }))).toBe(12);
    await expect(readJsonBody(bodyRequest({ body: '{' }))).rejects.toEqual(new ApiError(400, 'The request could not be read. It must be JSON.'));
  });

  it('stops a body the declared length already says is over the limit, and one that grows past it', async () => {
    const declared = bodyRequest({
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      body: '{}',
      mode: 'hold'
    });
    await expect(readJsonBody(declared)).rejects.toEqual(new ApiError(413, 'The file is too large. The limit is 40 MB.'));
    expect(declared.resumed).toBe(true);

    const growing = bodyRequest({ chunks: [Buffer.from('{"a":'), Buffer.from('"bcdef"}')], mode: 'end' });
    await expect(readJsonBody(growing, 8)).rejects.toEqual(new ApiError(413, 'The file is too large. The limit is 40 MB.'));
  });

  it('says the request was cut off when the body fails before it ends', async () => {
    await expect(readJsonBody(bodyRequest({ mode: 'error' }))).rejects.toEqual(new ApiError(400, 'The request was cut off.'));
  });

  it('writes the status, the length in bytes, and any extra header', () => {
    const res = jsonReply();
    sendJson(res, 201, { note: 'é' }, { 'x-extra': 'yes', 'cache-control': 'max-age=0' });
    const text = JSON.stringify({ note: 'é' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toBe(text);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['content-length']).toBe(Buffer.byteLength(text));
    expect(res.headers['content-length']).toBeGreaterThan(text.length);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-extra']).toBe('yes');
    expect(res.headers['cache-control']).toBe('max-age=0');
  });
});

describe('which computer the call comes from, and whether the model server is up', () => {
  it('accepts this computer in any case, and refuses a bare IPv6 name and an empty host', () => {
    expect(isLocalHostHeader('  LOCALHOST:8787  ')).toBe(true);
    expect(isLocalHostHeader('[::1]')).toBe(true);
    expect(isLocalHostHeader('[127.0.0.1]')).toBe(true);
    expect(isLocalHostHeader('')).toBe(false);
    expect(isLocalHostHeader('::1')).toBe(false);
    expect(isLocalHostHeader(':')).toBe(false);
    expect(isLocalOrigin('https://127.0.0.1/health')).toBe(true);
    expect(isLocalOrigin('http://[::1]:8787')).toBe(true);
    expect(isLocalOrigin('http://LOCALHOST')).toBe(true);
    expect(isLocalOrigin('ftp://127.0.0.1')).toBe(false);
    expect(isLocalOrigin('')).toBe(false);
  });

  it('says down when the version call is refused, and does not ask which models are there', async () => {
    let tags = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/tags')) tags += 1;
      return new Response('no', { status: 500 });
    }) as typeof fetch;
    const health = await getHealth(testConfig, fetchImpl);
    expect(health.ollama).toBe('down');
    expect(health.version).toBeUndefined();
    expect(health.models).toEqual({ screen: false, check: false, letter: false });
    expect(tags).toBe(0);
  });

  it('is up with no models when the model list is refused, and omits a version that is not text', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/version')) return new Response(JSON.stringify({ version: 12 }), { status: 200 });
      return new Response('no', { status: 503 });
    }) as typeof fetch;
    const health = await getHealth(testConfig, fetchImpl);
    expect(health.ollama).toBe('up');
    expect(health.version).toBeUndefined();
    expect(health.models).toEqual({ screen: false, check: false, letter: false });
  });

  it('reads a model from its model field, and says down when the list cannot be read', async () => {
    const listed = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.1.0' }), { status: 200 });
      return new Response(JSON.stringify({ models: [{ model: 'Lantern-Check' }, { name: 'lantern-letter:latest' }] }), { status: 200 });
    }) as typeof fetch;
    const health = await getHealth(testConfig, listed);
    expect(health.version).toBe('0.1.0');
    expect(health.models).toEqual({ screen: false, check: true, letter: true });

    const brokenJson = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/version')) return new Response('not-json', { status: 200 });
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }) as typeof fetch;
    expect((await getHealth(testConfig, brokenJson)).ollama).toBe('down');

    const notAList = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/version')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ models: { name: 'lantern-screen' } }), { status: 200 });
    }) as typeof fetch;
    expect((await getHealth(testConfig, notAList)).ollama).toBe('down');
  });
});
