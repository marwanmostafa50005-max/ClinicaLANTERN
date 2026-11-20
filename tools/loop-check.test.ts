import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyState } from '../server/store.ts';
import { computeCounts } from '../server/view.ts';
import type { AppState, CaseRecord, Finding, Letter, StateResponse } from '../shared/types.ts';
import { main, readOptions, repoRoot, reportLines } from './loop-check.ts';

function letter(over: Partial<Letter> & Pick<Letter, 'id' | 'status'>): Letter {
  return {
    findingId: 'F0001', caseId: 'C0001', subject: 'Review', body: 'Text',
    editedByPharmacist: false, seenByPharmacist: true, ...over
  };
}

describe('loop-check', () => {
  it('reads the server and how many histories', () => {
    expect(readOptions([])).toEqual({ server: 'http://127.0.0.1:8788', histories: 2 });
    expect(readOptions(['--server', 'http://127.0.0.1:8788/', '--histories', '1'])).toEqual({
      server: 'http://127.0.0.1:8788', histories: 1
    });
    expect(readOptions(['--histories', '2'])).toEqual({ server: 'http://127.0.0.1:8788', histories: 2 });
    expect(() => readOptions(['--histories', '3'])).toThrow(/1 or 2/);
    expect(() => readOptions(['--server'])).toThrow(/after --server/);
    expect(() => readOptions(['--wat'])).toThrow(/Unknown option --wat/);
    expect(() => readOptions(['extra'])).toThrow(/Unexpected argument extra/);
    expect(repoRoot()).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  });

  it('drops only one trailing slash, and the later number of histories wins', () => {
    expect(readOptions(['--server', 'http://127.0.0.1:9//'])).toEqual({
      server: 'http://127.0.0.1:9/', histories: 2
    });
    expect(() => readOptions(['--histories'])).toThrow(/1 or 2/);
    expect(readOptions(['--histories', '1', '--histories', '2'])).toEqual({
      server: 'http://127.0.0.1:8788', histories: 2
    });
  });

  it('prints a closed letter, an overdue letter, and the counts', () => {
    const state = emptyState();
    state.letters.push(
      letter({
        id: 'T0001', status: 'closed', sentAt: '2026-11-18T01:00:00.000Z', dueAt: '2026-11-25T01:00:00.000Z',
        reply: { at: '2026-11-18T02:00:00.000Z', outcome: 'will_review', note: 'Seen next week.' },
        closedAt: '2026-11-18T03:00:00.000Z'
      }),
      letter({
        id: 'T0002', findingId: 'F0002', caseId: 'C0002', status: 'sent',
        sentAt: '2026-11-18T01:00:00.000Z', dueAt: '2026-11-25T01:00:00.000Z'
      })
    );
    const when = new Date('2026-11-26T01:00:00.000Z');
    const response: StateResponse = {
      state,
      counts: computeCounts(state, when),
      now: { stage: null, text: 'Idle Demo clock: 8 days ahead.' },
      serverTime: when.toISOString(),
      recorded: false
    };
    expect(reportLines(response, ['T0001', 'T0002'])).toEqual([
      'T0001 closed',
      'T0002 sent overdue',
      'letters sent 2, replies recorded 1, closed 1, overdue 1',
      'Idle Demo clock: 8 days ahead.'
    ]);
  });

  it('names a missing letter, and a sent letter that is not yet due', () => {
    const state = emptyState();
    state.letters.push(letter({
      id: 'T0001', status: 'sent', sentAt: '2026-11-18T01:00:00.000Z', dueAt: '2026-12-01T00:00:00.000Z'
    }));
    const when = new Date('2026-11-20T00:00:00.000Z');
    const response: StateResponse = {
      state,
      counts: computeCounts(state, when),
      now: { stage: null, text: 'Idle' },
      serverTime: when.toISOString(),
      recorded: false
    };
    expect(reportLines(response, ['T0001', 'T0099'])).toEqual([
      'T0001 sent',
      'T0099 missing',
      'letters sent 1, replies recorded 0, closed 0, overdue 0',
      'Idle'
    ]);
  });

  it('keeps the later server address, and prints a letter that is still being drafted', () => {
    expect(readOptions(['--server', 'http://127.0.0.1:9', '--server', 'http://127.0.0.1:10'])).toEqual({
      server: 'http://127.0.0.1:10', histories: 2
    });
    expect(() => readOptions(['--server', ''])).toThrow(/after --server/);
    expect(() => readOptions(['--histories', '01'])).toThrow(/1 or 2/);
    expect(() => readOptions(['--Histories', '1'])).toThrow(/Unknown option --Histories/);

    const state = emptyState();
    state.letters.push(letter({ id: 'T0001', status: 'drafting' }));
    const when = new Date('2026-11-20T00:00:00.000Z');
    const response: StateResponse = {
      state,
      counts: computeCounts(state, when),
      now: { stage: null, text: 'Drafting the letter.' },
      serverTime: when.toISOString(),
      recorded: false
    };
    expect(reportLines(response, [])).toEqual([
      'letters sent 0, replies recorded 0, closed 0, overdue 0',
      'Drafting the letter.'
    ]);
    expect(reportLines(response, ['T0001'])[0]).toBe('T0001 drafting');
  });
});

interface Hit { method: string; path: string; body: unknown }

function walkServer(mode: 'walk' | 'cannot' | 'no-id' | 'interrupted' | 'no-bell' | 'not-ready' | 'status-only' | 'named-error'): Promise<{ base: string; hits: Hit[]; close: () => Promise<void> }> {
  const hits: Hit[] = [];
  const state: AppState = emptyState();
  let n = 0;
  let serverTime = '2026-11-18T01:00:00.000Z';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body: unknown = raw ? JSON.parse(raw) as unknown : {};
      hits.push({ method: req.method ?? '', path: url.pathname, body });
      const send = (data: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.method === 'POST' && url.pathname === '/api/cases') {
        if (mode === 'no-id') { send({}); return; }
        if (mode === 'status-only') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (mode === 'named-error') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'no date' }));
          return;
        }
        n += 1;
        const id = `C000${n}`;
        const findingId = `F000${n}`;
        const letterId = `T000${n}`;
        state.cases.push({
          id, fileName: 'positive.csv', importedAt: serverTime, source: 'csv',
          patient: { label: 'Fictional patient' }, lines: [], transcriptionConfirmed: true, parts: 1,
          cannotAssess: mode === 'cannot' ? 'no date' : undefined,
          screening: { status: mode === 'interrupted' ? 'interrupted' : 'done', criteria: [{ criterionId: 'DEMO', status: 'suspected' }] }
        } as CaseRecord);
        state.findings.push({
          id: findingId, caseId: id, criterionId: 'DEMO', state: 'confirmed', possible: false,
          seenByPharmacist: false,
          screen: {
            lineIds: ['L001'], medicines: [], reason: 'stand-in', linesVerified: true, missingFacts: [],
            model: 'stand-in', at: serverTime, seconds: 1
          },
          check: {
            confirmed: mode !== 'no-bell', lineIds: ['L001'], whatMatches: 'stand-in', whatCannotBeSeen: 'stand-in',
            completed: true, model: 'stand-in', at: serverTime, seconds: 1
          }
        } as Finding);
        state.letters.push(letter({ id: letterId, findingId, caseId: id, status: mode === 'not-ready' ? 'sent' : 'ready' }));
        send({ caseId: id });
        return;
      }
      const preview = url.pathname.match(/^\/api\/letters\/(T\d+)\/preview$/);
      if (req.method === 'POST' && preview) {
        const item = state.letters.find(entry => entry.id === preview[1]);
        if (item) item.previewHash = 'preview-token';
        send({ previewToken: 'preview-token' });
        return;
      }
      const sent = url.pathname.match(/^\/api\/letters\/(T\d+)\/sent$/);
      if (req.method === 'POST' && sent) {
        const item = state.letters.find(entry => entry.id === sent[1]);
        if (item) {
          item.status = 'sent';
          item.sentAt = '2026-11-18T01:00:00.000Z';
          item.dueAt = '2026-11-19T01:00:00.000Z';
          item.sentBy = 'print';
        }
        send({});
        return;
      }
      const reply = url.pathname.match(/^\/api\/letters\/(T\d+)\/reply$/);
      if (req.method === 'POST' && reply) {
        const item = state.letters.find(entry => entry.id === reply[1]);
        const note = typeof body === 'object' && body !== null && 'note' in body ? String(body.note) : '';
        if (item) {
          item.status = 'reply_recorded';
          item.reply = { at: serverTime, outcome: 'will_review', note };
        }
        send({});
        return;
      }
      const close = url.pathname.match(/^\/api\/letters\/(T\d+)\/close$/);
      if (req.method === 'POST' && close) {
        const item = state.letters.find(entry => entry.id === close[1]);
        if (item) { item.status = 'closed'; item.closedAt = serverTime; }
        send({});
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/demo-clock') {
        const days = typeof body === 'object' && body !== null && 'days' in body ? Number(body.days) : 0;
        serverTime = new Date(Date.parse('2026-11-18T01:00:00.000Z') + days * 86400000).toISOString();
        send({ serverTime });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const when = new Date(serverTime);
        send({
          state, counts: computeCounts(state, when), now: { stage: null, text: 'Idle' }, serverTime, recorded: false
        });
        return;
      }
      send({});
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        hits,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

async function walked(histories: 1 | 2): Promise<{ lines: string[]; hits: Hit[] }> {
  const stand = await walkServer('walk');
  const lines: string[] = [];
  const real = console.log;
  console.log = ((line?: unknown) => { lines.push(String(line ?? '')); }) as typeof console.log;
  try {
    await main(['--server', stand.base, '--histories', String(histories)], repoRoot());
  } finally {
    console.log = real;
    await stand.close();
  }
  return { lines, hits: stand.hits };
}

describe('the letter loop against a stand-in server', () => {
  it('previews one letter before it is marked sent, then shows it overdue', async () => {
    const { lines, hits } = await walked(1);
    expect(hits.map(hit => `${hit.method} ${hit.path}`)).toEqual([
      'POST /api/cases',
      'GET /api/state',
      'POST /api/findings/F0001/decision',
      'GET /api/state',
      'POST /api/letters/T0001/preview',
      'POST /api/letters/T0001/sent',
      'POST /api/demo-clock',
      'GET /api/state'
    ]);
    expect(hits.find(hit => hit.path.endsWith('/sent'))?.body).toEqual({ by: 'print', previewToken: 'preview-token' });
    expect(hits.find(hit => hit.path === '/api/demo-clock')?.body).toEqual({ days: 8 });
    expect(lines).toContain('Case C0001.');
    expect(lines).toContain('T0001 marked as sent.');
    expect(lines).toContain('T0001 sent overdue');
    expect(lines).toContain('letters sent 1, replies recorded 0, closed 0, overdue 1');
  });

  it('records a reply and closes the first letter when two histories are walked', async () => {
    const { lines, hits } = await walked(2);
    const paths = hits.map(hit => `${hit.method} ${hit.path}`);
    const sentSecond = paths.indexOf('POST /api/letters/T0002/sent');
    const reply = paths.indexOf('POST /api/letters/T0001/reply');
    const close = paths.indexOf('POST /api/letters/T0001/close');
    expect(sentSecond).toBeGreaterThan(paths.indexOf('POST /api/letters/T0001/preview'));
    expect(reply).toBeGreaterThan(sentSecond);
    expect(close).toBeGreaterThan(reply);
    expect(lines).toContain('T0001 closed');
    expect(lines).toContain('T0002 sent overdue');
    expect(lines).toContain('letters sent 2, replies recorded 1, closed 1, overdue 1');
  });

  it('stops when the history cannot be assessed, and does not mark a letter sent', async () => {
    const stand = await walkServer('cannot');
    const real = console.log;
    console.log = (() => undefined) as typeof console.log;
    try {
      await expect(main(['--server', stand.base, '--histories', '1'], repoRoot())).rejects.toThrow(/Cannot assess: no date/);
    } finally {
      console.log = real;
      await stand.close();
    }
    expect(stand.hits.some(hit => hit.path.endsWith('/sent'))).toBe(false);
    expect(stand.hits.some(hit => hit.path.includes('/decision'))).toBe(false);
  });

  it('stops when the server returns no case id', async () => {
    const stand = await walkServer('no-id');
    const real = console.log;
    console.log = (() => undefined) as typeof console.log;
    try {
      await expect(main(['--server', stand.base, '--histories', '1'], repoRoot())).rejects.toThrow(/did not return a case id/);
    } finally {
      console.log = real;
      await stand.close();
    }
  });

  it('stops when screening was interrupted, no finding reached the bell, or the letter is not ready', async () => {
    const quiet = async (mode: 'interrupted' | 'no-bell' | 'not-ready' | 'status-only' | 'named-error', pattern: RegExp): Promise<Hit[]> => {
      const stand = await walkServer(mode);
      const real = console.log;
      console.log = (() => undefined) as typeof console.log;
      try {
        await expect(main(['--server', stand.base, '--histories', '1'], repoRoot())).rejects.toThrow(pattern);
      } finally {
        console.log = real;
        await stand.close();
      }
      return stand.hits;
    };

    const interrupted = await quiet('interrupted', /C0001: screening stopped before it was done/);
    expect(interrupted.some(hit => hit.path.includes('/decision'))).toBe(false);

    const noBell = await quiet('no-bell', /C0001: no finding reached the bell/);
    expect(noBell.some(hit => hit.path.includes('/decision'))).toBe(false);

    const notReady = await quiet('not-ready', /C0001: the letter did not become ready/);
    expect(notReady.some(hit => hit.path.includes('/decision'))).toBe(true);
    expect(notReady.some(hit => hit.path.endsWith('/sent'))).toBe(false);

    const statusOnly = await quiet('status-only', /The server answered 500/);
    expect(statusOnly.map(hit => hit.path)).toEqual(['/api/cases']);

    const named = await quiet('named-error', /^no date$/);
    expect(named.map(hit => hit.path)).toEqual(['/api/cases']);
  });
});
