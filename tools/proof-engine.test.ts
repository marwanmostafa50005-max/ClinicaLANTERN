// tools/proof-engine.mjs drives a running server through one case. These tests do not do that.
// They name the options, which jobs count as idle, and a server that does not answer.
// No model is called, and the proof is not started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface ProofModule {
  takeOption: (argv: string[], name: string, fallback: string) => string;
  serverBase: (argv: string[]) => string;
  wantsReset: (argv: string[]) => boolean;
  idle: (state: { state: { jobs: { status: string }[] } }) => boolean;
  caseOf: (state: { state: { cases: { id: string }[] } }, id: string) => { id: string } | undefined;
  findingsOf: (state: { state: { findings: { caseId: string }[] } }, id: string) => { caseId: string }[];
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'proof-engine.mjs');
const proof = await import(new URL('./proof-engine.mjs', import.meta.url).href) as ProofModule;
const made: string[] = [];
const servers: http.Server[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

function run(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.on('data', chunk => { out += String(chunk); });
    child.stderr.on('data', chunk => { err += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

describe('proof-engine', () => {
  it('reads the options and leaves the saved state alone only when asked', () => {
    expect(proof.takeOption(['--out', 'result.json'], '--out', '')).toBe('result.json');
    expect(proof.takeOption(['--out'], '--out', 'missing')).toBe('missing');
    expect(proof.takeOption([], '--criterion', 'DEMO-NSAID-ANTICOAG')).toBe('DEMO-NSAID-ANTICOAG');
    expect(proof.serverBase([])).toBe('http://127.0.0.1:8787');
    expect(proof.serverBase(['--base', 'http://127.0.0.1:9/'])).toBe('http://127.0.0.1:9');
    expect(proof.takeOption(['--base', '--out'], '--base', 'http://127.0.0.1:8787')).toBe('--out');
    expect(proof.wantsReset([])).toBe(true);
    expect(proof.wantsReset(['--no-reset'])).toBe(false);
  });

  it('is idle when no job is queued or running, and finds one case', () => {
    const state = {
      state: {
        jobs: [{ status: 'done' }],
        cases: [{ id: 'C0001' }, { id: 'C0002' }],
        findings: [{ caseId: 'C0001' }, { caseId: 'C0002' }, { caseId: 'C0001' }]
      }
    };
    expect(proof.idle(state)).toBe(true);
    expect(proof.idle({ state: { jobs: [{ status: 'queued' }] } })).toBe(false);
    expect(proof.idle({ state: { jobs: [{ status: 'running' }] } })).toBe(false);
    expect(proof.idle({ state: { jobs: [] } })).toBe(true);
    expect(proof.caseOf(state, 'C0002')?.id).toBe('C0002');
    expect(proof.caseOf(state, 'C0009')).toBeUndefined();
    expect(proof.findingsOf(state, 'C0001')).toHaveLength(2);
    expect(proof.findingsOf(state, 'C0009')).toEqual([]);
  });

  it('counts a failed job as idle, and drops every trailing slash on the server address', () => {
    expect(proof.idle({ state: { jobs: [{ status: 'failed' }] } })).toBe(true);
    expect(proof.idle({ state: { jobs: [{ status: 'done' }, { status: 'failed' }] } })).toBe(true);
    expect(proof.idle({ state: { jobs: [{ status: 'failed' }, { status: 'queued' }] } })).toBe(false);
    expect(proof.serverBase(['--base', 'http://127.0.0.1:9///'])).toBe('http://127.0.0.1:9');
    expect(proof.serverBase(['--base', 'http://127.0.0.1:9'])).toBe('http://127.0.0.1:9');
    expect(proof.takeOption(['--out', '', '--out', 'later.json'], '--out', 'fallback')).toBe('fallback');
    expect(proof.takeOption(['--scan', 'a.png', '--scan', 'b.png'], '--scan', '')).toBe('a.png');
    expect(proof.wantsReset(['--base', 'http://127.0.0.1:9', '--no-reset'])).toBe(false);
    expect(proof.wantsReset(['--no-reset-please'])).toBe(true);
  });

  it('drops a base that is only slashes, and keeps a scan path of 0', () => {
    expect(proof.serverBase(['--base', '/'])).toBe('');
    expect(proof.serverBase(['--base', '///'])).toBe('');
    expect(proof.takeOption(['--scan', '0'], '--scan', '')).toBe('0');
    expect(proof.idle({ state: { jobs: [{ status: '' }] } })).toBe(true);
  });

  it('keeps a path on the server address and drops only the slashes at the end', () => {
    expect(proof.serverBase(['--base', 'http://127.0.0.1:9/api/'])).toBe('http://127.0.0.1:9/api');
    expect(proof.serverBase(['--out', 'result.json'])).toBe('http://127.0.0.1:8787');
    expect(proof.takeOption(['--criterion', '0'], '--criterion', 'DEMO')).toBe('0');
    expect(proof.takeOption(['--out', ' '], '--out', 'fallback')).toBe(' ');
    expect(proof.idle({ state: { jobs: [{ status: 'done' }, { status: 'running' }, { status: 'done' }] } })).toBe(false);
    expect(proof.caseOf({ state: { cases: [{ id: 'C0001' }] } }, 'C0001')?.id).toBe('C0001');
    expect(proof.findingsOf({ state: { findings: [{ caseId: 'C0002' }] } }, 'C0001')).toEqual([]);
  });

  it('does not start the proof when the file is imported', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/proof-engine.mjs'"], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const timer = setTimeout(() => child.kill(), 8000);
    const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
    clearTimeout(timer);
    expect(code).toBe(0);
    expect(out).not.toContain('engine proof');
  });

  it('stops when the server does not answer, and writes the address it tried', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-proof-'));
    made.push(dir);
    const outFile = path.join(dir, 'record.json');
    const server = http.createServer((_req, res) => res.end('{}'));
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const result = await run(['--base', `${base}/`, '--out', outFile, '--no-reset']);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN engine proof against ${base}.`);
    expect(result.err).toContain('The proof run stopped with an error:');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { base: string; error: string; checks: unknown[] };
    expect(written.base).toBe(base);
    expect(written.error.length).toBeGreaterThan(0);
    expect(written.checks).toEqual([]);
  });

  it('stops before a case when Ollama is up but the model list is missing', async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      hits.push(url.pathname);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ollama: 'up', version: '0', models: null }));
    });
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-proof-'));
    made.push(dir);
    const outFile = path.join(dir, 'record.json');
    const base = `http://127.0.0.1:${port}`;
    const result = await run(['--base', base, '--out', outFile, '--no-reset']);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN engine proof against ${base}.`);
    expect(result.err).toContain("Cannot read properties of null (reading 'screen')");
    expect(hits).toEqual(['/api/health']);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: unknown[] };
    expect(written.checks).toEqual([]);
  });

  it('treats a job status in the wrong case as idle, and stops when the health body has no model list', async () => {
    expect(proof.wantsReset(['--No-reset'])).toBe(true);
    expect(proof.idle({ state: { jobs: [{ status: 'Queued' }] } })).toBe(true);
    expect(proof.idle({ state: { jobs: [{ status: 'Running' }] } })).toBe(true);
    const doubled = { state: { cases: [{ id: 'C0001' }, { id: 'C0001' }], findings: [] } };
    expect(proof.caseOf(doubled, 'C0001')).toBe(doubled.state.cases[0]);

    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      hits.push(url.pathname);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ollama: 'up', version: '0' }));
    });
    servers.push(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-proof-'));
    made.push(dir);
    const outFile = path.join(dir, 'record.json');
    const base = `http://127.0.0.1:${port}`;
    const result = await run(['--base', base, '--out', outFile, '--no-reset']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Cannot read properties of undefined (reading 'screen')");
    expect(hits).toEqual(['/api/health']);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: unknown[] };
    expect(written.checks).toEqual([]);
  });

  it('counts a cancelled job as idle, and drops a slash after a query', () => {
    const findingA = { caseId: 'C0002' };
    const findingB = { caseId: 'C0001' };
    const findingC = { caseId: 'C0002' };
    const state = {
      state: {
        jobs: [{ status: 'cancelled' }, { status: ' queued' }],
        cases: [{ id: 'C0001' }, { id: 'C0003' }],
        findings: [findingA, findingB, findingC]
      }
    };
    expect(proof.idle(state)).toBe(true);
    expect(proof.caseOf(state, 'C0003')).toBe(state.state.cases[1]);
    expect(proof.findingsOf(state, 'C0002')).toEqual([findingA, findingC]);
    expect(proof.serverBase(['--base', 'http://127.0.0.1:9/api?x=1/'])).toBe('http://127.0.0.1:9/api?x=1');
    expect(proof.wantsReset(['--scan', 'page.png'])).toBe(true);
    expect(proof.takeOption(['--base', 'http://127.0.0.1:9', '--out'], '--out', 'none')).toBe('none');
  });
});
