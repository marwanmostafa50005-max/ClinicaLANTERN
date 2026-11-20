// tools/smoke.mjs drives a running server through the whole loop. These tests do not.
// They name the options, and a server that does not answer. No model is called, and Edge is not started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface Smoke {
  takeOption: (argv: string[], name: string, fallback: string) => string;
  serverBase: (argv: string[]) => string;
  wantsReset: (argv: string[]) => boolean;
  wantsBypass: (argv: string[]) => boolean;
  wantsLong: (argv: string[]) => boolean;
  COUNT_KEYS: string[];
}

interface Hit {
  method: string;
  path: string;
}

type Stand = 'no-criterion' | 'no-page' | 'after-reset' | 'thin' | 'reset-plain';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'smoke.mjs');
const smoke = await import(new URL('./smoke.mjs', import.meta.url).href) as Smoke;
const made: string[] = [];
const servers: http.Server[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

/** A stand-in that answers the opening calls and then stops the walk. No model is called. */
function standIn(mode: Stand): Promise<{ base: string; hits: Hit[] }> {
  const hits: Hit[] = [];
  const named = mode === 'after-reset' || mode === 'thin' || mode === 'reset-plain';
  const criterion = {
    id: named ? 'DEMO-NSAID-ANTICOAG' : 'OTHER',
    label: 'Demo',
    title: 'An NSAID with an anticoagulant',
    statement: mode === 'thin' ? '   ' : 'Do not supply both.',
    source: { credit: 'A demo credit line.' },
    cannot_be_seen: 'The dose on a faded line.',
    signed_by_clinical_reviewer: mode === 'thin' ? { name: '' } : null
  };
  const html = mode === 'no-page'
    ? '<html><body>not the app</body></html>'
    : '<!doctype html><html><head><link href="/assets/app.css" rel="stylesheet"></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    hits.push({ method: req.method ?? '', path: url.pathname });
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end('/* app */');
      return;
    }
    if (url.pathname === '/assets/app.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end('body{}');
      return;
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ollama: 'up',
        version: '0',
        models: mode === 'thin'
          ? { screen: 'lantern-screen', check: 'lantern-check' }
          : { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
        names: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' }
      }));
      return;
    }
    if (url.pathname === '/api/criteria') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([criterion]));
      return;
    }
    if (url.pathname === '/api/reset') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mode === 'reset-plain' ? { ok: false } : { ok: true, backup: 'backup-1.json' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('');
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ base: `http://127.0.0.1:${port}`, hits });
    });
  });
}

function recordFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-smoke-'));
  made.push(dir);
  return path.join(dir, 'record.json');
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

describe('smoke', () => {
  it('reads the options and keeps a fallback when the next word is another option', () => {
    expect(smoke.takeOption(['--out', 'result.json'], '--out', '')).toBe('result.json');
    expect(smoke.takeOption(['--base', '--out'], '--base', 'http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(smoke.serverBase([])).toBe('http://127.0.0.1:8787');
    expect(smoke.serverBase(['--base', 'http://127.0.0.1:9/'])).toBe('http://127.0.0.1:9');
    expect(smoke.takeOption([], '--criterion', 'DEMO-NSAID-ANTICOAG')).toBe('DEMO-NSAID-ANTICOAG');
    expect(smoke.wantsReset([])).toBe(true);
    expect(smoke.wantsReset(['--no-reset'])).toBe(false);
    expect(smoke.wantsBypass(['--no-bypass'])).toBe(false);
    expect(smoke.wantsLong([])).toBe(true);
    expect(smoke.COUNT_KEYS).toEqual([
      'historiesScreened', 'findingsConfirmed', 'accepted', 'bypassed', 'lettersReady', 'lettersSent',
      'repliesRecorded', 'closed', 'overdue', 'bellBadge', 'letterBadge'
    ]);
  });

  it('keeps a path on the server address, and a value that is not another option', () => {
    expect(smoke.serverBase(['--base', 'http://127.0.0.1:9/api/'])).toBe('http://127.0.0.1:9/api');
    expect(smoke.serverBase(['--out', 'result.json'])).toBe('http://127.0.0.1:8787');
    expect(smoke.takeOption(['--out', '-result.json'], '--out', 'fallback')).toBe('-result.json');
    expect(smoke.takeOption(['--shots', '0'], '--shots', '')).toBe('0');
    expect(smoke.wantsBypass([])).toBe(true);
    expect(smoke.wantsBypass(['--base', 'http://127.0.0.1:9', '--no-bypass'])).toBe(false);
    expect(smoke.wantsLong(['--no-long'])).toBe(false);
    expect(smoke.wantsLong(['--no-longer'])).toBe(true);
    expect(smoke.wantsReset(['--no-reset-please'])).toBe(true);
  });

  it('does not start the join test when the file is imported', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/smoke.mjs'"], {
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
    expect(out).not.toContain('join test');
  });

  it('stops when the server does not answer, and names the address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-smoke-'));
    made.push(dir);
    const outFile = path.join(dir, 'record.json');
    const server = http.createServer((_req, res) => res.end('{}'));
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const result = await run(['--base', `${base}/`, '--out', outFile, '--no-reset', '--no-bypass', '--no-long']);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN join test against ${base}.`);
    expect(result.err).toContain('The join test stopped:');
    expect(result.err).toContain(`Is the server running at ${base}?`);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { base: string; error: string; checks: unknown[] };
    expect(written.base).toBe(base);
    expect(written.error.length).toBeGreaterThan(0);
    expect(written.checks).toEqual([]);
  });

  it('stops when the demo criterion is not in use, before a reset or a case', async () => {
    const stand = await standIn('no-criterion');
    const outFile = recordFile();
    const result = await run(['--base', `${stand.base}/`, '--out', outFile]);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN join test against ${stand.base}.`);
    expect(result.out).toContain('OK   the server serves the built page');
    expect(result.out).toContain('OK   the page script and style are served with the right type');
    expect(result.out).toContain('OK   GET /api/health: Ollama is up and the three models are there');
    expect(result.out).toContain('FAIL GET /api/criteria: a list that holds the demo criterion');
    expect(result.err).toContain('The criterion DEMO-NSAID-ANTICOAG is not in use');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { error: string; checks: { name: string; ok: boolean }[] };
    expect(written.error).toContain('DEMO-NSAID-ANTICOAG is not in use');
    expect(written.checks.map(c => c.ok)).toEqual([true, true, true, false]);
    expect(stand.hits.some(h => h.path === '/api/reset')).toBe(false);
    expect(stand.hits.some(h => h.path === '/api/cases')).toBe(false);
  });

  it('names a page that is not the built app, then stops because the demo criterion is not in use', async () => {
    const stand = await standIn('no-page');
    const outFile = recordFile();
    const result = await run(['--base', `${stand.base}/`, '--out', outFile]);
    expect(result.code).toBe(2);
    expect(result.out).toContain('FAIL the server serves the built page');
    expect(result.out).toContain('FAIL the page script and style are served with the right type');
    expect(result.err).toContain('The criterion DEMO-NSAID-ANTICOAG is not in use');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: { name: string; ok: boolean }[] };
    expect(written.checks[0]).toEqual({ name: 'the server serves the built page', ok: false, detail: '0 files named in the page' });
    expect(stand.hits.some(h => h.path.startsWith('/assets/'))).toBe(false);
  });

  it('posts a reset, keeps the backup name, and stops when the clean state cannot be read', async () => {
    const stand = await standIn('after-reset');
    const outFile = recordFile();
    const result = await run(['--base', `${stand.base}/`, '--out', outFile, '--no-bypass', '--no-long']);
    expect(result.code).toBe(2);
    expect(result.out).toContain('OK   POST /api/reset starts a clean state (the old state was kept as backup-1.json)');
    expect(result.err).toContain("Cannot read properties of null (reading 'state')");
    expect(stand.hits.filter(h => h.path === '/api/reset').map(h => h.method)).toEqual(['POST']);
    expect(stand.hits.some(h => h.path === '/api/cases')).toBe(false);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: { ok: boolean }[] };
    expect(written.checks.every(c => c.ok)).toBe(true);
  });

  it('does not post a reset when --no-reset is set, and stops when the state cannot be read', async () => {
    const stand = await standIn('after-reset');
    const outFile = recordFile();
    const result = await run(['--base', `${stand.base}/`, '--out', outFile, '--no-reset', '--no-bypass', '--no-long']);
    expect(result.code).toBe(2);
    expect(result.out).not.toContain('POST /api/reset');
    expect(result.err).toContain("Cannot read properties of null (reading 'counts')");
    expect(stand.hits.some(h => h.path === '/api/reset')).toBe(false);
    expect(stand.hits.some(h => h.path === '/api/cases')).toBe(false);
  });

  it('fails the health check when the letter model is missing, and a blank statement is not shown', async () => {
    const stand = await standIn('thin');
    const outFile = recordFile();
    const result = await run(['--base', `${stand.base}/`, '--out', outFile, '--no-reset', '--no-bypass', '--no-long']);
    expect(result.code).toBe(2);
    expect(result.out).toContain('FAIL GET /api/health: Ollama is up and the three models are there');
    expect(result.out).toContain('OK   GET /api/criteria: a list that holds the demo criterion');
    expect(result.out).toContain('FAIL every criterion carries what the page shows');
    expect(result.err).toContain("Cannot read properties of null (reading 'counts')");
    expect(stand.hits.some(h => h.path === '/api/reset')).toBe(false);
    expect(stand.hits.some(h => h.path === '/api/cases')).toBe(false);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: { name: string; ok: boolean }[] };
    expect(written.checks.map(c => c.ok)).toEqual([true, true, false, true, false]);
  });

  it('names a reset that did not start a clean state, and does not import a history', async () => {
    const stand = await standIn('reset-plain');
    const outFile = recordFile();
    const result = await run(['--base', stand.base, '--out', outFile, '--no-bypass', '--no-long']);
    expect(result.code).toBe(2);
    expect(result.out).toContain('FAIL POST /api/reset starts a clean state (there was nothing to keep)');
    expect(result.out).not.toContain('the clean state is empty');
    expect(result.err).toContain("Cannot read properties of null (reading 'state')");
    expect(stand.hits.some(hit => hit.method === 'POST' && hit.path === '/api/reset')).toBe(true);
    expect(stand.hits.some(hit => hit.path === '/api/cases')).toBe(false);
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: { name: string; ok: boolean; detail: string }[] };
    const reset = written.checks.find(check => check.name.startsWith('POST /api/reset'));
    expect(reset).toEqual({
      name: 'POST /api/reset starts a clean state',
      ok: false,
      detail: 'there was nothing to keep'
    });
  });
});
