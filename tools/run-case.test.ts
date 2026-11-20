// tools/run-case.mjs sends one history to a running server and prints what came back.
// These tests use a stand-in server on a free port. No model is called, and Edge is not started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'run-case.mjs');
const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function listen(handle: (method: string, route: string) => { status?: number; body: unknown }): Promise<number> {
  const server = http.createServer((req, res) => {
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const reply = handle(req.method ?? 'GET', route);
    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
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

function finished(status: 'clear' | 'suspected' | 'failed'): unknown {
  return {
    now: { text: 'Idle' },
    counts: { bell: 1 },
    state: {
      jobs: [],
      cases: [{
        id: 'C0001',
        patient: { label: 'Fictional patient F-001' },
        lines: [{ id: 'L001' }, { id: 'L002' }],
        parts: 1,
        screening: {
          status: 'done',
          criteria: [{ criterionId: 'STOPP-C10', status, seconds: 3 }]
        }
      }],
      findings: status === 'suspected' ? [{
        caseId: 'C0001',
        criterionId: 'STOPP-C10',
        state: 'confirmed',
        screen: { lineIds: ['L001', 'L002'], reason: 'Both medicines are supplied.' },
        check: { completed: true, seconds: 2, lineIds: ['L001'], whatMatches: 'The dates are within 60 days.' }
      }] : []
    }
  };
}

describe('run-case', () => {
  it('names the way to call it when no history is given', async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.out).toContain('node tools/run-case.mjs <history.csv>');
  });

  it('stops when the history file is not there', async () => {
    const result = await run([path.join(os.tmpdir(), 'lantern-no-such-history.csv')]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Stopped:');
  });

  it('stops when the server does not answer, and names the address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    const port = await listen(() => ({ body: {} }));
    const held = servers.pop();
    await new Promise<void>(resolve => held?.close(() => resolve()));
    const result = await run([csv, '--base', `http://127.0.0.1:${port}/`]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Stopped:');
    expect(result.err).toContain(`Is the server running at http://127.0.0.1:${port}?`);
  });

  it('prints a confirmed finding and writes the record when the run is already finished', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    const outFile = path.join(dir, 'nested', 'record.json');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    const port = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') return { body: finished('suspected') };
      return { status: 404, body: { error: 'not here' } };
    });
    const result = await run([csv, '--base', `http://127.0.0.1:${port}`, '--out', outFile]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Imported positive.csv as C0001.');
    expect(result.out).toContain('Fictional patient F-001, 2 lines.');
    expect(result.out).toContain('STOPP C10');
    expect(result.out).toContain('SUSPECTED');
    expect(result.out).toContain('CONFIRMED by Model 2: it is under the bell');
    expect(result.out).toContain('Model 1 cited L001, L002');
    expect(result.out).toContain(`Written: ${outFile}`);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { caseId: string; criteriaInUse: string[] };
    expect(written.caseId).toBe('C0001');
    expect(written.criteriaInUse).toEqual(['STOPP-C10']);
  });

  it('ends with code 1 when a criterion could not be screened', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    const port = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') return { body: finished('failed') };
      return { status: 404, body: {} };
    });
    const result = await run([csv, '--base', `http://127.0.0.1:${port}`]);
    expect(result.code).toBe(1);
    expect(result.out).toContain('COULD NOT BE SCREENED');
    expect(result.out).toContain('No finding was suspected.');
  });

  it('stops when the criteria are not a list, the history is refused, or the case cannot be assessed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');

    const notListPort = await listen(() => ({ body: { ok: true } }));
    const notList = await run([csv, '--base', `http://127.0.0.1:${notListPort}`]);
    expect(notList.code).toBe(2);
    expect(notList.err).toContain('The server did not send its criteria');
    expect(notList.err).not.toContain('Start it with: npm start');

    const refusedPort = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') return { status: 400, body: { error: 'The date cannot be read.' } };
      return { status: 404, body: {} };
    });
    const refused = await run([csv, '--base', `http://127.0.0.1:${refusedPort}`]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('The server refused the history: The date cannot be read.');

    const blockedPort = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        const body = finished('clear') as { state: { cases: { cannotAssess?: string }[] } };
        body.state.cases[0]!.cannotAssess = 'no date';
        return { body };
      }
      return { status: 404, body: {} };
    });
    const blocked = await run([csv, '--base', `http://127.0.0.1:${blockedPort}`]);
    expect(blocked.code).toBe(2);
    expect(blocked.err).toContain('Cannot assess: no date');
  });

  it('prints a clear screen in parts, and a possible finding whose second check did not finish', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');

    const clearPort = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        const body = finished('clear') as {
          state: { cases: { parts: number; screening: { criteria: { criterionId: string; status: string; seconds: number; error?: string }[] } }[] };
        };
        const one = body.state.cases[0]!;
        one.parts = 2;
        one.screening.criteria = [{ criterionId: 'NOT-IN-THE-LIST', status: 'clear', seconds: 4, error: 'kept for the note' }];
        return { body };
      }
      return { status: 404, body: {} };
    });
    const clear = await run(['--base', `http://127.0.0.1:${clearPort}`, csv]);
    expect(clear.code).toBe(0);
    expect(clear.out).toContain('2 lines, screened in 2 parts.');
    expect(clear.out).toContain('NOT-IN-THE-LIST');
    expect(clear.out).toContain('nothing suspected');
    expect(clear.out).toContain('kept for the note');
    expect(clear.out).toContain('No finding was suspected.');
    expect(clear.out).not.toContain('Written:');

    const greyPort = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        const body = finished('suspected') as {
          state: { findings: { caseId: string; criterionId: string; state: string; possible: boolean; screen: { lineIds: string[]; reason: string; missingFacts: string[] }; check: { completed: boolean; seconds: number; lineIds: string[]; whatMatches: string } }[] };
        };
        body.state.findings = [{
          caseId: 'C0001',
          criterionId: 'STOPP-C10',
          state: 'not_confirmed',
          possible: true,
          screen: { lineIds: [], reason: 'The fact is not on the record.', missingFacts: ['eGFR'] },
          check: { completed: false, seconds: 1, lineIds: [], whatMatches: 'The second model stopped.' }
        }];
        return { body };
      }
      return { status: 404, body: {} };
    });
    const grey = await run([csv, '--base', `http://127.0.0.1:${greyPort}`]);
    expect(grey.code).toBe(1);
    expect(grey.out).toContain('not confirmed by Model 2: it is in the grey list');
    expect(grey.out).toContain('Possible finding. The record does not show: eGFR.');
    expect(grey.out).toContain('Model 1 cited no valid line');
    expect(grey.out).toContain('Model 2 (1 s) cited no line');
  });

  it('prints a screen status as it is, and a possible finding that names no fact and has no second check', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    const port = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        const body = finished('clear') as {
          state: {
            cases: { screening: { criteria: { criterionId: string; status: string }[] } }[];
            findings: { caseId: string; criterionId: string; state: string; possible: boolean; screen: { lineIds: string[]; reason: string; missingFacts: string[] } }[];
          };
        };
        body.state.cases[0]!.screening.criteria = [{ criterionId: 'STOPP-C10', status: 'waiting' }];
        body.state.findings = [{
          caseId: 'C0001',
          criterionId: 'STOPP-C10',
          state: 'accepted',
          possible: true,
          screen: { lineIds: ['L001'], reason: 'The medicines match.', missingFacts: [] }
        }];
        return { body };
      }
      return { status: 404, body: {} };
    });
    const result = await run([csv, '--base', `http://127.0.0.1:${port}`]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('waiting');
    expect(result.out).toContain('STOPP C10: accepted.');
    expect(result.out).toContain('Possible finding. The record does not show: a fact this criterion needs.');
    expect(result.out).toContain('Model 1 cited L001');
    expect(result.out).not.toContain('Model 2');
    expect(result.out).not.toContain('No finding was suspected.');
  });

  it('prints a confirmed finding that has no second check, and a job status in the wrong case does not hold it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    const outFile = path.join(dir, 'record.json');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    let stateCalls = 0;
    const port = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        stateCalls += 1;
        const body = finished('suspected') as {
          state: {
            jobs: { status: string }[];
            cases: { screening: { criteria: { criterionId: string; status: string; seconds: number }[] } }[];
            findings: { caseId: string; criterionId: string; state: string; screen: { lineIds: string[]; reason: string } }[];
          };
        };
        body.state.jobs = [{ status: 'Running' }];
        body.state.cases[0]!.screening.criteria = [{ criterionId: 'STOPP-C10', status: 'suspected', seconds: 0 }];
        body.state.findings = [{
          caseId: 'C0001',
          criterionId: 'STOPP-C10',
          state: 'confirmed',
          screen: { lineIds: ['L001'], reason: 'Both medicines are supplied.' }
        }];
        return { body };
      }
      return { status: 404, body: {} };
    });
    const result = await run([
      csv,
      '--base', `http://127.0.0.1:${port}`,
      '--base', 'http://127.0.0.1:1',
      '--out', '--shots'
    ]);
    expect(result.code).toBe(0);
    expect(stateCalls).toBe(1);
    expect(result.out).toContain('SUSPECTED');
    expect(result.out).toMatch(/SUSPECTED\s+0/);
    expect(result.out).toContain('STOPP C10: SECOND CHECK NOT COMPLETED: it is under the bell.');
    expect(result.out).toContain('Model 1 cited L001');
    expect(result.out).not.toContain('Model 2');
    expect(result.out).not.toContain('Possible finding');
    expect(result.out).not.toContain('Written:');
    expect(result.out).not.toContain('picture');
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('waits while a job is running, and a history that comes back with no case is refused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-run-case-'));
    made.push(dir);
    const csv = path.join(dir, 'positive.csv');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    let stateCalls = 0;
    const port = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [{ id: 'STOPP-C10', label: 'STOPP C10' }] };
      if (route === '/api/cases' && method === 'POST') return { body: { caseId: 'C0001' } };
      if (route === '/api/state') {
        stateCalls += 1;
        const body = finished('suspected') as {
          now: { text: string };
          state: {
            jobs: { status: string }[];
            cases: { screening: { status: string; criteria: { criterionId: string; status: string; seconds: number }[] } }[];
            findings: { caseId: string; criterionId: string; state: string; screen: { lineIds: string[]; reason: string }; check?: { completed: boolean; seconds: number; lineIds: string[]; whatMatches: string } }[];
          };
        };
        if (stateCalls === 1) {
          body.now.text = 'Screening STOPP-C10';
          body.state.jobs = [];
          body.state.cases[0]!.screening.status = 'running';
          body.state.cases[0]!.screening.criteria = [{ criterionId: 'STOPP-C10', status: 'suspected', seconds: 1 }];
          body.state.findings = [];
          return { body };
        }
        if (stateCalls === 2) {
          body.now.text = 'Checking';
          body.state.jobs = [{ status: 'running' }];
          return { body };
        }
        body.now.text = 'Idle';
        body.state.jobs = [];
        body.state.findings.push({
          caseId: 'C9999',
          criterionId: 'STOPP-C10',
          state: 'suspected',
          screen: { lineIds: ['L009'], reason: 'OTHER-CASE-REASON' }
        });
        return { body };
      }
      return { status: 404, body: {} };
    });
    const result = await run([csv, '--base', `http://127.0.0.1:${port}`]);
    expect(result.code).toBe(0);
    expect(stateCalls).toBe(3);
    expect(result.out).toContain('status line: "Screening STOPP-C10"');
    expect(result.out).toContain('status line: "Checking"');
    expect(result.out).toContain('status line: "Idle"');
    expect(result.out).toContain('CONFIRMED by Model 2');
    expect(result.out).not.toContain('OTHER-CASE-REASON');
    expect(result.out).not.toContain('picture');

    const barePort = await listen((method, route) => {
      if (route === '/api/criteria') return { body: [] };
      if (route === '/api/cases' && method === 'POST') return { status: 200, body: {} };
      return { status: 404, body: {} };
    });
    const bare = await run([csv, '--base', `http://127.0.0.1:${barePort}`]);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('The server refused the history: 200');
  });
});
