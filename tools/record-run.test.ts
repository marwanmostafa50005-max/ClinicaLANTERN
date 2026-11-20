// tools/record-run.mjs writes one recording from a running server. These tests use a stand-in
// server on a free port. No model is called, and the app servers on 8787 and 8788 are not started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'record-run.mjs');
const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status?: number;
  body: unknown;
}

function listen(routes: Record<string, Reply>): Promise<number> {
  const server = http.createServer((req, res) => {
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const reply = routes[route];
    if (!reply) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not here' }));
      return;
    }
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

function run(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    child.stderr.on('data', chunk => { err += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, out, err }));
  });
}

function idleState(): unknown {
  return {
    recorded: false,
    serverTime: '2026-11-18T09:14:00.000Z',
    state: {
      jobs: [{ status: 'done' }],
      cases: [{ patient: { label: 'Fictional patient P-01' } }],
      findings: [{ id: 'F0001' }],
      letters: [],
      activity: [{ at: '2026-11-18T09:00:00.000Z' }]
    }
  };
}

describe('record-run', () => {
  it('writes the recording of an idle run and keeps the state it was given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'nested', 'run.json');
    const port = await listen({
      '/api/state': { body: idleState() },
      '/api/criteria': { body: [{ id: 'STOPP-C10' }] },
      '/api/health': { body: { version: '0.5.0', names: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' } } }
    });
    const result = await run([
      '--base', `http://127.0.0.1:${port}/`,
      '--how', 'a scripted check',
      '--by', 'Entered by the test.',
      '--out', outFile
    ]);
    expect(result.code).toBe(0);
    expect(result.err).not.toContain('The recording was not written');
    expect(result.out).toContain('1 histories, 1 findings, 0 letters, 1 steps in the activity log.');
    expect(result.out).toContain('Next: npm run build:replay');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as {
      note: string; how: string; recordedAt: string; models: { screen: string }; criteria: { id: string }[];
      state: { cases: { patient: { label: string } }[] };
    };
    expect(written.how).toBe('a scripted check');
    expect(written.recordedAt).toBe('2026-11-18T09:14:00.000Z');
    expect(written.models.screen).toBe('Mantle');
    expect(written.criteria).toEqual([{ id: 'STOPP-C10' }]);
    expect(written.state.cases[0].patient.label).toBe('Fictional patient P-01');
    expect(written.note).toContain('18 November 2026');
    expect(written.note).toContain('Ollama 0.5.0');
    expect(written.note).toContain('Entered by the test.');
    expect(written.note).toContain('Fictional patient. No real person.');
  });

  it('writes nothing when the server is still working, has no history, or the label is not fictional', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const working = idleState() as { state: { jobs: { status: string }[] } };
    working.state.jobs = [{ status: 'running' }];
    const empty = idleState() as { state: { cases: unknown[] } };
    empty.state.cases = [];
    const named = idleState() as { state: { cases: { patient: { label: string } }[] } };
    named.state.cases = [{ patient: { label: 'Patient A' } }];
    const cases = [
      { body: working, words: 'The server is still working' },
      { body: empty, words: 'There is nothing to record' },
      { body: named, words: 'does not say "fictional"' }
    ];
    for (const one of cases) {
      const outFile = path.join(dir, `${cases.indexOf(one)}.json`);
      const port = await listen({
        '/api/state': { body: one.body },
        '/api/criteria': { body: [] },
        '/api/health': { body: { version: '0.5.0', names: {} } }
      });
      const result = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
      expect(result.code).toBe(1);
      expect(result.err).toContain('The recording was not written');
      expect(result.err).toContain(one.words);
      expect(fs.existsSync(outFile)).toBe(false);
    }
  });

  it('writes nothing when the server is itself playing a recording', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const body = idleState() as { recorded: boolean };
    body.recorded = true;
    const port = await listen({
      '/api/state': { body },
      '/api/criteria': { body: [] },
      '/api/health': { body: {} }
    });
    const result = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('This server plays a recording itself');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('writes nothing when the server does not answer, and names the address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const port = await listen({});
    const held = servers.pop();
    await new Promise<void>(resolve => held?.close(() => resolve()));
    const result = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('The recording was not written');
    expect(result.err).toContain(`Is the server running at http://127.0.0.1:${port}?`);
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('writes nothing when a call answers with an error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const port = await listen({
      '/api/state': { body: idleState() },
      '/api/criteria': { status: 500, body: { error: 'no' } },
      '/api/health': { body: {} }
    });
    const result = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('GET /criteria answered 500');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('uses the earliest day, drops a time that cannot be read, and keeps the fallback words when the version is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const body = idleState() as { state: { activity: { at: string }[] } };
    body.state.activity = [
      { at: 'not-a-date' },
      { at: '2026-11-18T09:00:00.000Z' },
      { at: '2026-11-17T12:00:00.000Z' }
    ];
    const port = await listen({
      '/api/state': { body },
      '/api/criteria': { body: [] },
      '/api/health': { body: { names: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' } } }
    });
    const result = await run([
      '--base', `http://127.0.0.1:${port}///`,
      '--how',
      '--out', outFile
    ]);
    expect(result.code).toBe(0);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { note: string; how: string };
    expect(written.how).toBe('npm run smoke');
    expect(written.note).toContain('17 November 2026');
    expect(written.note).not.toContain('18 November 2026');
    expect(written.note).toContain('through Ollama.');
    expect(written.note).toContain('the join test script');
    expect(written.note).not.toContain('Ollama undefined');
  });

  it('writes nothing for a queued job or when one history is not fictional', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const queued = idleState() as { state: { jobs: { status: string }[] } };
    queued.state.jobs = [{ status: 'queued' }, { status: 'done' }];
    const mixed = idleState() as { state: { cases: { patient: { label: string } }[] } };
    mixed.state.cases = [
      { patient: { label: 'Fictional patient P-01' } },
      { patient: { label: 'Patient B' } }
    ];
    const cases = [
      { body: queued, words: 'The server is still working' },
      { body: mixed, words: 'does not say "fictional"' }
    ];
    for (const one of cases) {
      const outFile = path.join(dir, `${cases.indexOf(one)}.json`);
      const port = await listen({
        '/api/state': { body: one.body },
        '/api/criteria': { body: [] },
        '/api/health': { body: { version: '0.5.0', names: {} } }
      });
      const result = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
      expect(result.code).toBe(1);
      expect(result.err).toContain(one.words);
      expect(fs.existsSync(outFile)).toBe(false);
    }
  });

  it('records a failed job, keeps the default words when the next word is an option, and names no real day when no time can be read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const body = idleState() as {
      state: { jobs: { status: string }[]; findings: unknown[]; activity: { at: string }[] };
    };
    body.state.jobs = [{ status: 'failed' }];
    body.state.findings = [];
    body.state.activity = [{ at: 'not-a-date' }];
    const port = await listen({
      '/api/state': { body },
      '/api/criteria': { body: [] },
      '/api/health': { body: { version: '9', names: { screen: 'Mantle' } } }
    });
    const result = await run([
      '--base', `http://127.0.0.1:${port}`,
      '--by', '--how',
      '--out', outFile
    ]);
    expect(result.code).toBe(0);
    expect(result.err).not.toContain('The recording was not written');
    expect(result.out).toContain('1 histories, 0 findings, 0 letters, 1 steps in the activity log.');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { note: string; how: string };
    expect(written.how).toBe('npm run smoke');
    expect(written.note).toContain('The steps of the pharmacist were made by the join test script, not by a person.');
    expect(written.note).toContain('Ollama 9');
    expect(written.note).toContain('Invalid Date');
    expect(written.note).not.toContain('November');
  });

  it('records a job status in the wrong case, keeps the first words, and counts one letter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const body = {
      recorded: 0,
      state: {
        jobs: [{ status: 'Running' }, { status: 'Queued' }],
        cases: [{ patient: { label: 'FICTIONAL patient P-02' } }],
        findings: [{ id: 'F0001' }, { id: 'F0002' }],
        letters: [{ id: 'L0001' }],
        activity: [{ at: '2026-11-18T09:00:00.000Z' }]
      }
    };
    const port = await listen({
      '/api/state': { body },
      '/api/criteria': { body: [{ id: 'STOPP-C10' }] },
      '/api/health': { body: { version: 0, names: { screen: 'Mantle' } } }
    });
    const result = await run([
      '--base', `http://127.0.0.1:${port}/`,
      '--how', 'first words',
      '--how', 'second words',
      '--by', '',
      '--out', outFile
    ]);
    expect(result.code).toBe(0);
    expect(result.err).not.toContain('The recording was not written');
    expect(result.out).toContain('1 histories, 2 findings, 1 letters, 1 steps in the activity log.');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as {
      note: string; how: string; recordedAt?: string; models: { screen: string };
    };
    expect(written.how).toBe('first words');
    expect(written.recordedAt).toBeUndefined();
    expect(written.models.screen).toBe('Mantle');
    expect(written.note).toContain('18 November 2026');
    expect(written.note).toContain('Ollama 0');
    expect(written.note).toContain('The steps of the pharmacist were made by the join test script, not by a person.');
  });

  it('records a job that is not exactly queued, and keeps a path on the server address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const body = idleState() as {
      state: { jobs: { status: string }[]; cases: { patient: { label: string } }[] };
    };
    body.state.jobs = [{ status: 'queued ' }];
    body.state.cases.push({ patient: { label: 'a fictional second history' } });
    const port = await listen({
      '/api/state': { body },
      '/api/criteria': { body: [] },
      '/api/health': { body: { version: '9', names: { screen: 'Mantle' } } }
    });
    const ok = await run(['--base', `http://127.0.0.1:${port}`, '--out', outFile]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain('2 histories, 1 findings, 0 letters, 1 steps in the activity log.');
    expect(fs.existsSync(outFile)).toBe(true);

    const missed = path.join(dir, 'miss.json');
    const healthPort = await listen({
      '/api/state': { body: idleState() },
      '/api/criteria': { body: [] },
      '/api/health': { status: 404, body: { error: 'no' } }
    });
    const health = await run(['--base', `http://127.0.0.1:${healthPort}`, '--out', missed]);
    expect(health.code).toBe(1);
    expect(health.err).toContain('GET /health answered 404');
    expect(fs.existsSync(missed)).toBe(false);

    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    servers.push(server);
    const extraPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    const extra = path.join(dir, 'extra.json');
    const routed = await run(['--base', `http://127.0.0.1:${extraPort}/extra/`, '--out', extra]);
    expect(routed.code).toBe(1);
    expect(seen).toContain('/extra/api/state');
    expect(seen.every(p => p.startsWith('/extra/api/'))).toBe(true);
    expect(routed.err).toContain('GET /state answered 404');
    expect(routed.err).not.toContain('Is the server running');
    expect(fs.existsSync(extra)).toBe(false);
  });
});

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { resolve({}); }
    });
  });
}

function openServer(onRequest: (method: string, route: string, body: unknown) => { status?: number; body: unknown }): Promise<number> {
  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const body = await readBody(req);
    const reply = onRequest(req.method ?? 'GET', route, body);
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function writeSteps(dir: string, steps: unknown): string {
  const file = path.join(dir, 'steps.json');
  fs.writeFileSync(file, JSON.stringify(steps));
  return file;
}

describe('record-run from a steps file', () => {
  it('records each pharmacist step, marks every frame recorded, and ignores a change of the time alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'date,medicine\n2026-01-02,paracetamol\n');
    const outFile = path.join(dir, 'run.json');
    let tick = 0;
    const data = { jobs: [] as unknown[], cases: [] as unknown[], findings: [] as unknown[], letters: [] as unknown[], activity: [] as unknown[], demoDays: 0 };
    const calls: { method: string; route: string; body: unknown }[] = [];
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ method, route, body });
      if (route === '/api/reset' && method === 'POST') {
        data.cases = [];
        data.findings = [];
        data.letters = [];
        data.demoDays = 0;
        return { body: { ok: true } };
      }
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10' }] };
      if (route === '/api/cases' && method === 'POST') {
        data.cases.push({ id: 'C0001', patient: { label: 'Fictional patient P-01' }, source: 'csv' });
        data.findings.push({ id: 'F0001', state: 'confirmed', caseId: 'C0001' });
        return { body: { caseId: 'C0001' } };
      }
      const decision = route.match(/^\/api\/findings\/([^/]+)\/decision$/);
      if (decision && method === 'POST') {
        const found = data.findings.find(item => (item as { id: string }).id === decision[1]) as { state: string; decision?: unknown };
        found.decision = body;
        found.state = 'accepted';
        data.letters.push({ id: 'L0001', status: 'ready', findingId: decision[1] });
        return { body: { ok: true } };
      }
      const letter = route.match(/^\/api\/letters\/([^/]+)\/([^/]+)$/);
      if (letter && method === 'POST') {
        const row = data.letters.find(item => (item as { id: string }).id === letter[1]) as Record<string, unknown>;
        if (letter[2] === 'agree') row.patientAgreed = { at: 't' };
        if (letter[2] === 'preview') { row.previewedAt = 't'; row.previewHash = 'preview-token'; }
        if (letter[2] === 'sent') row.status = 'sent';
        if (letter[2] === 'reply') { row.status = 'reply_recorded'; row.reply = body; }
        if (letter[2] === 'close') row.status = 'closed';
        return { body: { ok: true } };
      }
      if (route === '/api/demo-clock' && method === 'POST') {
        data.demoDays = (body as { days: number }).days;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        tick += 1;
        return {
          body: {
            recorded: false,
            serverTime: new Date(Date.UTC(2026, 10, 19, 0, 0, tick)).toISOString(),
            now: { stage: null, text: 'Idle' },
            counts: {},
            state: structuredClone(data)
          }
        };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const steps = writeSteps(dir, {
      title: 'Demo history to the bell',
      about: 'The fictional history is screened and the script accepts the finding.',
      madeHow: 'A stand-in server answered. No model was called.',
      steps: [
        { step: 'import', file: csv },
        // A limit is the longest a wait may take, not how long it takes: the wait ends as soon as the
        // stand-in server shows the bell. Two seconds was too little when the whole test set ran on a
        // loaded machine (20 November 2026: the merge engine refused two commits for this one reason).
        { step: 'wait-bell', limitMs: 60000 },
        { step: 'accept' },
        { step: 'wait-letter', limitMs: 60000 },
        { step: 'tick' },
        { step: 'preview' },
        { step: 'sent' },
        { step: 'reply', outcome: 'will_review', note: 'Seen next week.' },
        { step: 'close' },
        { step: 'clock', days: 8 }
      ]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code).toBe(0);
    expect(result.err).not.toContain('The recording was not written');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as {
      format: string; title: string; criteria: { id: string }[]; madeHow: string;
      frames: { afterMs: number; note: string; response: { recorded: boolean; serverTime: string } }[];
    };
    expect(written.format).toBe('clinicalantern-recorded-run-1');
    expect(written.title).toBe('Demo history to the bell');
    expect(written.criteria).toEqual([{ id: 'STOPP-C10' }]);
    expect(written.madeHow).toBe('A stand-in server answered. No model was called.');
    expect(written.frames[0].afterMs).toBe(0);
    expect(written.frames.every(frame => frame.response.recorded === true)).toBe(true);
    expect(new Set(written.frames.map(frame => frame.response.serverTime)).size).toBe(written.frames.length);
    expect(written.frames.map(frame => frame.note)).toEqual([
      '',
      'Entered by the recording script: the history was imported.',
      'Entered by the recording script: the finding was accepted.',
      'Entered by the recording script: the patient was told and agrees.',
      'Entered by the recording script: the letter was previewed.',
      'Entered by the recording script: the letter was marked as sent.',
      'Entered by the recording script: the doctor\'s reply was recorded.',
      'Entered by the recording script: the letter was closed.',
      'Entered by the recording script: the demo clock was moved.'
    ]);
    const sent = calls.find(call => call.route.endsWith('/sent'));
    expect(sent?.body).toEqual({ by: 'print', previewToken: 'preview-token' });
    const reply = calls.find(call => call.route.endsWith('/reply'));
    expect(reply?.body).toEqual({ outcome: 'will_review', note: 'Seen next week.' });
    const decision = calls.find(call => call.route.endsWith('/decision'));
    expect(decision?.body).toEqual({ action: 'accept' });
    expect(calls.some(call => call.route === '/api/reset')).toBe(true);
    expect(data.demoDays).toBe(8);
  });

  it('confirms a scan as it was read, and records bypass, accept anyway and dismiss', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const png = path.join(dir, 'page.png');
    fs.writeFileSync(png, 'not-a-real-picture');
    const outFile = path.join(dir, 'run.json');
    const data = {
      jobs: [] as unknown[],
      cases: [] as { id: string; source?: string; transcriptionConfirmed?: boolean; lines?: { text: string }[]; patient: { label: string } }[],
      findings: [] as { id: string; state: string; decision?: unknown }[]
    };
    const calls: { route: string; body: unknown }[] = [];
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') {
        data.cases.push({
          id: 'C0001', source: 'pdf-image', transcriptionConfirmed: false,
          lines: [{ text: '2026-01-02 | paracetamol' }],
          patient: { label: 'Fictional patient P-01' }
        });
        data.findings.push({ id: 'F0001', state: 'confirmed' }, { id: 'F0002', state: 'not_confirmed' }, { id: 'F0003', state: 'not_confirmed' });
        return { body: { caseId: 'C0001' } };
      }
      if (route === '/api/cases/C0001/confirm-transcription') {
        data.cases[0].transcriptionConfirmed = true;
        return { body: { ok: true } };
      }
      const decision = route.match(/^\/api\/findings\/([^/]+)\/decision$/);
      if (decision) {
        const found = data.findings.find(item => item.id === decision[1]);
        if (found) {
          found.decision = body;
          const action = (body as { action?: string }).action;
          found.state = action === 'dismiss' ? 'not_confirmed' : action === 'bypass' ? 'bypassed' : 'accepted';
        }
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: '2026-11-19T00:00:00.000Z', state: structuredClone(data) } };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const steps = writeSteps(dir, {
      title: 'Scan and the two decisions',
      about: 'A fictional scan is confirmed, one finding is bypassed, and two disputed findings are decided.',
      steps: [
        { step: 'import', file: png },
        { step: 'confirm', limitMs: 60000 },
        { step: 'bypass', id: 'F0001', reason: 'Short course.' },
        { step: 'accept-anyway', id: 'F0002', reason: 'The lines still show it.' },
        { step: 'dismiss', id: 'F0003' }
      ]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code).toBe(0);
    const confirm = calls.find(call => call.route.endsWith('/confirm-transcription'));
    expect(confirm?.body).toEqual({ rows: ['2026-01-02 | paracetamol'] });
    expect(calls.find(call => call.route.endsWith('F0001/decision'))?.body).toEqual({ action: 'bypass', reason: 'Short course.' });
    expect(calls.find(call => call.route.endsWith('F0002/decision'))?.body).toEqual({ action: 'accept', reason: 'The lines still show it.' });
    expect(calls.find(call => call.route.endsWith('F0003/decision'))?.body).toEqual({ action: 'dismiss' });
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { frames: { note: string }[]; madeHow: string };
    expect(written.madeHow).toContain('The local models did the screening.');
    expect(written.frames.map(frame => frame.note).filter(note => note !== '')).toEqual([
      'Entered by the recording script: the history was imported.',
      'Entered by the recording script: the rows of the scan were confirmed.',
      'Entered by the recording script: the finding was bypassed.',
      'Entered by the recording script: the disputed finding was accepted.',
      'Entered by the recording script: the disputed finding was dismissed.'
    ]);
  });

  it('saves no extra frame when only the server time changes, and writes nothing when the wait runs out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    let polls = 0;
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/state') {
        polls += 1;
        return {
          body: {
            recorded: false,
            serverTime: new Date(Date.UTC(2026, 10, 19, 0, 0, polls)).toISOString(),
            state: {
              jobs: [],
              cases: [{ id: 'C0001', patient: { label: 'Fictional patient P-01' } }],
              findings: polls >= 3 ? [{ id: 'F0001', state: 'confirmed' }] : [],
              letters: [],
              activity: []
            }
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const outFile = path.join(dir, 'run.json');
    const steps = writeSteps(dir, {
      title: 'Wait for the bell',
      about: 'The fictional history is already imported. The script waits for the bell.',
      steps: [{ step: 'wait-bell', limitMs: 60000 }]
    });
    const ok = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(ok.code).toBe(0);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { frames: { afterMs: number; response: { recorded: boolean } }[] };
    expect(written.frames).toHaveLength(2);
    expect(written.frames[0].afterMs).toBe(0);
    expect(written.frames[1].afterMs).toBeGreaterThan(0);
    expect(written.frames.every(frame => frame.response.recorded)).toBe(true);

    const missed = path.join(dir, 'miss.json');
    const late = writeSteps(dir, {
      title: 'Too late',
      about: 'The bell never rings.',
      steps: [{ step: 'wait-bell', limitMs: 300 }]
    });
    // The same server now already has polls >= 3, so a new wait would succeed. Use a fresh server.
    const quiet = await openServer((method, route) => {
      if (route === '/api/reset' || route === '/api/criteria') return { body: route === '/api/criteria' ? [] : { ok: true } };
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: new Date().toISOString(), state: { jobs: [], cases: [], findings: [], letters: [], activity: [] } } };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const failed = await run(['--base', `http://127.0.0.1:${quiet}`, '--steps', late, '--out', missed]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('was not reached');
    expect(fs.existsSync(missed)).toBe(false);
  });

  it('writes nothing for an unknown step, a missing place to write, or a label that is not fictional', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const demo = path.join(repoRoot, 'cases', '_demo', 'recorded-state.json');
    const before = fs.statSync(demo).mtimeMs;
    const unknownFile = writeSteps(dir, { title: 'No', about: 'No.', steps: [{ step: 'send' }] });
    const unknown = await run(['--steps', unknownFile, '--out', path.join(dir, 'no.json')]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('does not take: send');
    expect(fs.existsSync(path.join(dir, 'no.json'))).toBe(false);

    const missingStep = writeSteps(dir, { title: 'No step', about: 'The step has no name.', steps: [{}] });
    const missing = await run(['--steps', missingStep, '--out', path.join(dir, 'missing-step.json')]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('does not take: (missing)');
    expect(fs.existsSync(path.join(dir, 'missing-step.json'))).toBe(false);

    const bare = writeSteps(dir, { title: 'No out', about: 'No place to write.', steps: [] });
    const noOut = await run(['--steps', bare]);
    expect(noOut.code).toBe(1);
    expect(noOut.err).toContain('Say where to write');
    expect(fs.statSync(demo).mtimeMs).toBe(before);

    const outFile = path.join(dir, 'named.json');
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: 't', state: { jobs: [], cases: [{ patient: { label: 'Patient A' } }], findings: [], letters: [], activity: [] } } };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const named = writeSteps(dir, { title: 'Named', about: 'A label that is not fictional.', steps: [] });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', named, '--out', outFile]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('does not say "fictional"');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('refuses a step that would record the wrong thing, and writes no file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/state') {
        return {
          body: {
            recorded: false,
            serverTime: '2026-11-19T00:00:00.000Z',
            state: {
              jobs: [],
              cases: [{ id: 'C0001', patient: { label: 'Fictional patient P-01' } }],
              findings: [
                { id: 'F0001', state: 'confirmed' },
                { id: 'F0002', state: 'not_confirmed' }
              ],
              letters: [{ id: 'L0001', status: 'ready' }],
              activity: []
            }
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const refused: { steps: unknown[]; message: string }[] = [
      { steps: [{ step: 'import' }], message: 'The import step needs a file.' },
      { steps: [{ step: 'import', file: 'no-such-recording-file.csv' }], message: 'The import step cannot find no-such-recording-file.csv.' },
      { steps: [{ step: 'bypass', reason: '   ' }], message: 'The bypass step needs a short reason.' },
      { steps: [{ step: 'accept-anyway' }], message: 'The accept-anyway step needs a short reason.' },
      { steps: [{ step: 'sent', by: 'fax' }], message: 'The sent step must say "print" or "email".' },
      { steps: [{ step: 'reply', outcome: '  ' }], message: 'The reply step needs an outcome.' },
      { steps: [{ step: 'clock', days: -1 }], message: 'The clock step needs a whole number of days, 0 or more.' },
      { steps: [{ step: 'clock', days: 1.5 }], message: 'The clock step needs a whole number of days, 0 or more.' },
      { steps: [{ step: 'wait-bell', limitMs: 0 }], message: 'A wait needs a time limit greater than zero.' },
      { steps: [{ step: 'accept', id: 'F9999' }], message: 'Finding F9999 is not at the bell.' },
      { steps: [{ step: 'dismiss', id: 'F0001' }], message: 'Finding F0001 is not a disputed finding.' },
      { steps: [{ step: 'tick', id: 'L9999' }], message: 'Letter L9999 is not in the state.' },
      { steps: [{ step: 'close' }], message: 'No letter is ready to close.' }
    ];
    for (const item of refused) {
      const steps = writeSteps(dir, {
        title: 'Refused step',
        about: 'A fictional history. This step must not be recorded.',
        steps: item.steps
      });
      const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
      expect(result.code, item.message).toBe(1);
      expect(result.err).toContain(item.message);
      expect(fs.existsSync(outFile)).toBe(false);
    }
  });

  it('marks a letter sent by email, records a reason on dismiss, and sets the demo clock to today', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const data = {
      cases: [{ id: 'C0001', patient: { label: 'Fictional patient P-01' } }],
      findings: [
        { id: 'F0001', state: 'confirmed' },
        { id: 'F0002', state: 'not_confirmed', decision: undefined as unknown }
      ],
      letters: [{ id: 'L0001', status: 'ready' }] as { id: string; status: string }[],
      demoDays: 9
    };
    const calls: { route: string; body: unknown }[] = [];
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10' }] };
      if (route === '/api/letters/L0001/sent') {
        data.letters[0].status = 'sent';
        return { body: { ok: true } };
      }
      if (route === '/api/findings/F0002/decision') {
        data.findings[1].decision = body;
        return { body: { ok: true } };
      }
      if (route === '/api/demo-clock') {
        data.demoDays = (body as { days: number }).days;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return {
          body: {
            recorded: false,
            serverTime: '2026-11-19T00:00:00.000Z',
            state: structuredClone(data)
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const steps = writeSteps(dir, {
      title: 'Email, dismiss, and today',
      about: 'A fictional letter is sent by email, a disputed finding is dismissed, and the clock is today.',
      steps: [
        { step: 'sent', by: 'email' },
        { step: 'dismiss', id: 'F0002', reason: 'Not this patient.' },
        { step: 'clock', days: 0 }
      ]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code).toBe(0);
    expect(result.err).not.toContain('The recording was not written');
    expect(calls.find(call => call.route.endsWith('/sent'))?.body).toEqual({ by: 'email' });
    expect(calls.find(call => call.route.endsWith('/decision'))?.body).toEqual({ action: 'dismiss', reason: 'Not this patient.' });
    expect(calls.find(call => call.route.endsWith('/demo-clock'))?.body).toEqual({ days: 0 });
    expect(data.demoDays).toBe(0);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { frames: { note: string }[] };
    expect(written.frames.map(frame => frame.note).filter(note => note !== '')).toEqual([
      'Entered by the recording script: the letter was marked as sent.',
      'Entered by the recording script: the disputed finding was dismissed.',
      'Entered by the recording script: the demo clock was moved.'
    ]);
  });

  it('confirms the rows the step names, and writes nothing when the steps or the criteria are not a list', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const notList = path.join(dir, 'not-list.json');
    fs.writeFileSync(notList, '[]');
    const badShape = await run(['--steps', notList, '--out', outFile]);
    expect(badShape.code).toBe(1);
    expect(badShape.err).toContain('The steps file must hold a title, an about line, and a list of steps.');
    expect(fs.existsSync(outFile)).toBe(false);

    const blankTitle = writeSteps(dir, { title: '   ', about: 'A fictional history.', steps: [] });
    const noTitle = await run(['--steps', blankTitle, '--out', outFile]);
    expect(noTitle.code).toBe(1);
    expect(noTitle.err).toContain('The steps file must hold a title and one sentence about the run.');
    expect(fs.existsSync(outFile)).toBe(false);

    const blankAbout = writeSteps(dir, { title: 'A title', about: '   ', steps: [] });
    const noAbout = await run(['--steps', blankAbout, '--out', outFile]);
    expect(noAbout.code).toBe(1);
    expect(noAbout.err).toContain('The steps file must hold a title and one sentence about the run.');
    expect(fs.existsSync(outFile)).toBe(false);

    const png = path.join(dir, 'page.png');
    fs.writeFileSync(png, 'not-a-real-picture');
    const calls: { route: string; body: unknown }[] = [];
    const data = {
      jobs: [] as unknown[],
      cases: [] as { id: string; source?: string; transcriptionConfirmed?: boolean; lines?: { text: string }[]; patient: { label: string } }[]
    };
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: { id: 'STOPP-C10' } };
      if (route === '/api/cases' && method === 'POST') {
        data.cases.push({
          id: 'C0001', source: 'pdf-image', transcriptionConfirmed: false, lines: [],
          patient: { label: 'Fictional patient P-01' }
        });
        return { body: { caseId: 'C0001' } };
      }
      if (route === '/api/cases/C0001/confirm-transcription') {
        data.cases[0].transcriptionConfirmed = true;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: '2026-11-19T00:00:00.000Z', state: structuredClone(data) } };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const notCriteria = writeSteps(dir, {
      title: 'Criteria are not a list',
      about: 'A fictional history. Nothing should be written.',
      steps: []
    });
    const refused = await run(['--server', `http://127.0.0.1:${port}`, '--steps', notCriteria, '--out', outFile]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('GET /criteria did not return a list.');
    expect(fs.existsSync(outFile)).toBe(false);

    const rows = ['2026-03-04 | ibuprofen 200 mg'];
    const named = writeSteps(dir, {
      title: 'Named rows',
      about: 'A fictional scan is confirmed with the rows the step names.',
      steps: [
        { step: 'import', file: png },
        { step: 'confirm', limitMs: 60000, rows }
      ]
    });
    const server2 = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') {
        data.cases = [{
          id: 'C0001', source: 'pdf-image', transcriptionConfirmed: false, lines: [],
          patient: { label: 'Fictional patient P-01' }
        }];
        return { body: { caseId: 'C0001' } };
      }
      if (route === '/api/cases/C0001/confirm-transcription') {
        data.cases[0].transcriptionConfirmed = true;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: '2026-11-19T00:00:00.000Z', state: structuredClone(data) } };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const confirmed = await run(['--server', `http://127.0.0.1:${server2}`, '--steps', named, '--out', outFile]);
    expect(confirmed.code, confirmed.err).toBe(0);
    expect(calls.find(call => call.route.endsWith('/confirm-transcription'))?.body).toEqual({ rows });
  });

  it('writes nothing when the steps file cannot be read, and when a picture is sent with a CSV', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const missing = path.join(dir, 'missing-steps.json');
    const gone = await run(['--steps', missing, '--out', outFile]);
    expect(gone.code).toBe(1);
    expect(gone.err).toContain(`The steps file could not be read: ${missing}`);
    expect(fs.existsSync(outFile)).toBe(false);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{');
    const badJson = await run(['--steps', broken, '--out', outFile]);
    expect(badJson.code).toBe(1);
    expect(badJson.err).toContain(`The steps file could not be read: ${broken}`);
    expect(fs.existsSync(outFile)).toBe(false);

    const csv = path.join(dir, 'rows.csv');
    const png = path.join(dir, 'page.png');
    fs.writeFileSync(csv, 'date,medicine\n2026-01-02,paracetamol\n');
    fs.writeFileSync(png, 'not-a-real-picture');
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/state') {
        return {
          body: {
            recorded: false,
            serverTime: '2026-11-19T00:00:00.000Z',
            state: { jobs: [], cases: [{ patient: { label: 'Fictional patient P-01' } }], findings: [], letters: [], activity: [] }
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const mixed = writeSteps(dir, {
      title: 'A picture with a CSV',
      about: 'A fictional history. These two files must not be sent together.',
      steps: [{ step: 'import', files: [csv, png] }]
    });
    const refused = await run(['--server', `http://127.0.0.1:${port}`, '--steps', mixed, '--out', outFile]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('Only PNG pictures can be sent together. A CSV or a PDF is one file.');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('sends two scan pages as one import, and a reply that has no note', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const first = path.join(dir, 'page-1.png');
    const second = path.join(dir, 'page-2.png');
    fs.writeFileSync(first, 'page-one');
    fs.writeFileSync(second, 'page-two');
    const outFile = path.join(dir, 'run.json');
    const calls: { route: string; body: unknown }[] = [];
    const data = {
      cases: [] as { id: string; patient: { label: string }; source: string }[],
      letters: [] as { id: string; status: string; reply?: unknown }[]
    };
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') {
        data.cases = [];
        data.letters = [];
        return { body: { ok: true } };
      }
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') {
        data.cases.push({ id: 'C0001', patient: { label: 'Fictional patient P-01' }, source: 'pdf-image' });
        data.letters.push({ id: 'L0001', status: 'sent' });
        return { body: { caseId: 'C0001' } };
      }
      if (route === '/api/letters/L0001/reply') {
        data.letters[0].status = 'reply_recorded';
        data.letters[0].reply = body;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: '2026-11-19T00:00:00.000Z', state: structuredClone(data) } };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const steps = writeSteps(dir, {
      title: 'Two pages and a reply',
      about: 'A fictional scan of two pages is imported, then a reply is recorded with no note.',
      steps: [
        { step: 'import', files: [first, second] },
        { step: 'reply', outcome: 'will_review' }
      ]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code, result.err).toBe(0);
    const imported = calls.find(call => call.route === '/api/cases')?.body as { fileName: string; source: string; pageImages: string[] };
    expect(imported.fileName).toBe('page-1.png');
    expect(imported.source).toBe('pdf-image');
    expect(imported.pageImages).toEqual([
      Buffer.from('page-one').toString('base64'),
      Buffer.from('page-two').toString('base64')
    ]);
    const reply = calls.find(call => call.route.endsWith('/reply'))?.body as Record<string, unknown>;
    expect(reply).toEqual({ outcome: 'will_review' });
    expect(Object.hasOwn(reply, 'note')).toBe(false);
  });

  it('sends the pages named in file, and leaves off a reply note that is not text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const first = path.join(dir, 'scan-a.png');
    const second = path.join(dir, 'scan-b.png');
    fs.writeFileSync(first, 'scan-a');
    fs.writeFileSync(second, 'scan-b');
    const outFile = path.join(dir, 'run.json');
    const calls: { route: string; body: unknown }[] = [];
    const data = {
      cases: [] as { id: string; patient: { label: string }; source: string }[],
      letters: [] as { id: string; status: string }[]
    };
    const port = await openServer((method, route, body) => {
      if (method === 'POST') calls.push({ route, body });
      if (route === '/api/reset') {
        data.cases = [];
        data.letters = [];
        return { body: { ok: true } };
      }
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') {
        data.cases.push({ id: 'C0001', patient: { label: 'Fictional patient P-01' }, source: 'pdf-image' });
        data.letters.push({ id: 'L0001', status: 'sent' });
        return { body: { caseId: 'C0001' } };
      }
      if (route === '/api/letters/L0001/reply') {
        data.letters[0].status = 'reply_recorded';
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        return { body: { recorded: false, serverTime: '2026-11-19T00:00:00.000Z', state: structuredClone(data) } };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const steps = writeSteps(dir, {
      title: 'Pages named in file',
      about: 'A fictional scan is imported from file, and a reply note that is not text is left off.',
      steps: [
        { step: 'import', file: [first, second] },
        { step: 'reply', outcome: 'will_review', note: 12 }
      ]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code, result.err).toBe(0);
    const imported = calls.find(call => call.route === '/api/cases')?.body as { fileName: string; source: string; pageImages: string[] };
    expect(imported.fileName).toBe('scan-a.png');
    expect(imported.source).toBe('pdf-image');
    expect(imported.pageImages).toEqual([
      Buffer.from('scan-a').toString('base64'),
      Buffer.from('scan-b').toString('base64')
    ]);
    expect(calls.find(call => call.route.endsWith('/reply'))?.body).toEqual({ outcome: 'will_review' });
  });

  it('waits to confirm a scan until the reading job for that case has finished', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    let stateReads = 0;
    let confirmAt = 0;
    const data = {
      jobs: [{ id: 'J0001', caseId: 'C0001', status: 'running' }] as { id: string; caseId: string; status: string }[],
      cases: [{
        id: 'C0001',
        source: 'pdf-image',
        transcriptionConfirmed: false,
        lines: [{ text: '2026-01-02 | paracetamol' }],
        patient: { label: 'Fictional patient P-01' }
      }]
    };
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10' }] };
      if (route === '/api/cases/C0001/confirm-transcription' && method === 'POST') {
        confirmAt = stateReads;
        if (data.jobs.length > 0) confirmAt = -1;
        data.cases[0].transcriptionConfirmed = true;
        return { body: { ok: true } };
      }
      if (route === '/api/state') {
        stateReads += 1;
        if (stateReads >= 3) data.jobs = [];
        return {
          body: {
            recorded: false,
            serverTime: `2026-11-19T00:00:0${stateReads}.000Z`,
            state: structuredClone(data)
          }
        };
      }
      return { status: 404, body: { error: 'not here' } };
    });
    const steps = writeSteps(dir, {
      title: 'Confirm after the reading job',
      about: 'A fictional scan is confirmed only once the reading job has finished.',
      steps: [{ step: 'confirm', limitMs: 60000 }]
    });
    const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
    expect(result.code, result.err).toBe(0);
    expect(stateReads).toBeGreaterThanOrEqual(3);
    expect(confirmAt).toBeGreaterThanOrEqual(3);
    expect(data.cases[0].transcriptionConfirmed).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it('uses the default how-line when madeHow is blank, and the flag wins over the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10' }] };
      if (route === '/api/state') {
        return {
          body: {
            recorded: false,
            serverTime: '2026-11-19T00:00:00.000Z',
            state: { jobs: [], cases: [], findings: [], letters: [], activity: [] }
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const base = ['--server', `http://127.0.0.1:${port}`];
    const noLimit = writeSteps(dir, {
      title: 'No limit on the file',
      about: 'A fictional history. The file wait is zero and the step sets none.',
      waitMs: 0,
      steps: [{ step: 'wait-bell' }]
    });
    const refused = await run([...base, '--steps', noLimit, '--out', outFile]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('A wait needs a time limit greater than zero.');
    expect(fs.existsSync(outFile)).toBe(false);

    const blankHow = writeSteps(dir, {
      title: 'Blank how',
      about: 'A fictional history with a how-line of only spaces.',
      madeHow: '   ',
      steps: []
    });
    const blank = await run([...base, '--steps', blankHow, '--out', outFile]);
    expect(blank.code, blank.err).toBe(0);
    const blankWritten = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { madeHow: string };
    expect(blankWritten.madeHow).toBe('The local models did the screening. The recording script entered the pharmacist\'s steps.');

    const fileHow = writeSteps(dir, {
      title: 'Flag wins',
      about: 'A fictional history whose file names one how-line and the flag names another.',
      madeHow: 'From the file.',
      steps: []
    });
    const flagged = await run([...base, '--steps', fileHow, '--how', 'From the flag.', '--out', outFile]);
    expect(flagged.code, flagged.err).toBe(0);
    const flaggedWritten = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { madeHow: string };
    expect(flaggedWritten.madeHow).toBe('From the flag.');
  });

  it('names a missing finding, a missing letter, and a scan that never appears', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-record-'));
    made.push(dir);
    const outFile = path.join(dir, 'run.json');
    const port = await openServer((method, route) => {
      if (route === '/api/reset') return { body: { ok: true } };
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/state') {
        return {
          body: {
            recorded: false,
            serverTime: '2026-11-19T00:00:00.000Z',
            state: {
              jobs: [],
              cases: [{ id: 'C0001', patient: { label: 'Fictional patient P-01' }, source: 'csv' }],
              findings: [],
              letters: [],
              activity: []
            }
          }
        };
      }
      return { status: 404, body: { error: `${method} ${route}` } };
    });
    const refused: { steps: unknown[]; message: string }[] = [
      { steps: [{ step: 'accept' }], message: 'No finding is at the bell.' },
      { steps: [{ step: 'bypass', reason: 'Short course.' }], message: 'No finding is at the bell.' },
      { steps: [{ step: 'dismiss' }], message: 'No disputed finding is waiting.' },
      { steps: [{ step: 'accept-anyway', reason: 'The lines still show it.' }], message: 'No disputed finding is waiting.' },
      { steps: [{ step: 'tick' }], message: 'No letter is ready for this step.' },
      { steps: [{ step: 'preview' }], message: 'No letter is ready for this step.' },
      { steps: [{ step: 'sent' }], message: 'No letter is ready to mark as sent.' },
      { steps: [{ step: 'reply', outcome: 'will_review' }], message: 'No sent letter is waiting for a reply.' },
      { steps: [{ step: 'close' }], message: 'No letter is ready to close.' },
      { steps: [{ step: 'confirm', limitMs: 400 }], message: 'The rows of the scan was not reached' }
    ];
    for (const item of refused) {
      const steps = writeSteps(dir, {
        title: 'Nothing is waiting',
        about: 'A fictional history. This step must not be recorded.',
        steps: item.steps
      });
      const result = await run(['--server', `http://127.0.0.1:${port}`, '--steps', steps, '--out', outFile]);
      expect(result.code, item.message).toBe(1);
      expect(result.err).toContain(item.message);
      expect(fs.existsSync(outFile)).toBe(false);
    }
  });
});
