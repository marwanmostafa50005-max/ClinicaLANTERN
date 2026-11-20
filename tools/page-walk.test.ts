// tools/page-walk.mjs clicks through the real page in Edge. These tests do not.
// They name which steps run, and a server that does not answer. No model is called, and Edge is not started.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface Walk {
  takeOption: (argv: string[], name: string, fallback: string) => string;
  serverBase: (argv: string[]) => string;
  ALL_STEPS: string[];
  stepsOf: (argv: string[]) => string[];
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'page-walk.mjs');
const walk = await import(new URL('./page-walk.mjs', import.meta.url).href) as Walk;
const made: string[] = [];
const servers: http.Server[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

/** Answers /api/criteria and nothing else, so the walk stops before Edge starts. */
function standIn(body: string): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/criteria') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function recordFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-walk-'));
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

describe('page-walk', () => {
  it('runs every step unless one is named or left out', () => {
    expect(walk.ALL_STEPS).toEqual(['loop', 'near', 'pdf', 'picture', 'scan-pdf', 'phone']);
    expect(walk.stepsOf([])).toEqual(walk.ALL_STEPS);
    expect(walk.stepsOf(['--steps', 'phone, loop'])).toEqual(['loop', 'phone']);
    expect(walk.stepsOf(['--steps', 'nope'])).toEqual([]);
    expect(walk.stepsOf(['--no-scan'])).toEqual(['loop', 'near', 'pdf', 'phone']);
    expect(walk.stepsOf(['--no-scan-pdf'])).toEqual(['loop', 'near', 'pdf', 'picture', 'phone']);
    expect(walk.stepsOf(['--steps', 'picture,scan-pdf', '--no-scan'])).toEqual([]);
    expect(walk.serverBase([])).toBe('http://127.0.0.1:8787');
    expect(walk.serverBase(['--base', 'http://127.0.0.1:9/'])).toBe('http://127.0.0.1:9');
    expect(walk.takeOption(['--shots', '--out'], '--shots', 'docs/screens')).toBe('docs/screens');
  });

  it('trims step names, and drops every trailing slash on the server address', () => {
    expect(walk.stepsOf(['--steps', ' phone , nope , loop '])).toEqual(['loop', 'phone']);
    expect(walk.stepsOf(['--steps', 'nope', '--steps', 'loop'])).toEqual([]);
    expect(walk.serverBase(['--base', 'http://127.0.0.1:9///'])).toBe('http://127.0.0.1:9');
    expect(walk.takeOption(['--base', ''], '--base', 'http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });

  it('does not start Edge when the file is imported', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', "import './tools/page-walk.mjs'"], {
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
    expect(out).not.toContain('page walk');
  });

  it('stops when the server does not answer, before Edge is started, and names the address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-walk-'));
    made.push(dir);
    const outFile = path.join(dir, 'record.json');
    const server = http.createServer((_req, res) => res.end('{}'));
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    const result = await run(['--base', `${base}/`, '--out', outFile, '--no-scan']);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN page walk against ${base}.`);
    expect(result.err).toContain('The page walk stopped:');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { base: string; error: string; checks: unknown[]; shots: unknown[] };
    expect(written.base).toBe(base);
    expect(written.error.length).toBeGreaterThan(0);
    expect(written.checks).toEqual([]);
    expect(written.shots).toEqual([]);
  });

  it('stops before Edge when the demo criterion is not in use', async () => {
    const base = await standIn(JSON.stringify([{ id: 'OTHER' }]));
    const outFile = recordFile();
    const result = await run(['--base', `${base}/`, '--out', outFile, '--no-scan']);
    expect(result.code).toBe(2);
    expect(result.out).toContain(`ClinicaLANTERN page walk against ${base}.`);
    expect(result.err).toContain('The criterion DEMO-NSAID-ANTICOAG is not in use on this server.');
    expect(result.err).not.toContain('Microsoft Edge');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { error: string; checks: unknown[]; shots: unknown[] };
    expect(written.error).toContain('DEMO-NSAID-ANTICOAG is not in use');
    expect(written.checks).toEqual([]);
    expect(written.shots).toEqual([]);
  });

  it('stops before Edge when the named criterion is not in use', async () => {
    const base = await standIn(JSON.stringify([{ id: 'DEMO-NSAID-ANTICOAG' }]));
    const outFile = recordFile();
    const result = await run(['--base', base, '--out', outFile, '--criterion', 'NAMED-ONE', '--steps', 'phone']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('The criterion NAMED-ONE is not in use on this server.');
    expect(result.err).not.toContain('Microsoft Edge');
  });

  it('stops before Edge when the criteria answer is not a list', async () => {
    const base = await standIn('{"ok":true}');
    const outFile = recordFile();
    const result = await run(['--base', base, '--out', outFile]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('The criterion DEMO-NSAID-ANTICOAG is not in use on this server.');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: unknown[]; shots: unknown[] };
    expect(written.checks).toEqual([]);
    expect(written.shots).toEqual([]);
  });

  it('stops before Edge when the criteria answer is not JSON', async () => {
    const base = await standIn('not-json');
    const outFile = recordFile();
    const result = await run(['--base', base, '--out', outFile]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('not valid JSON');
    expect(result.err).not.toContain('Microsoft Edge');
    const written = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { checks: unknown[] };
    expect(written.checks).toEqual([]);
  });

  it('keeps the first value of an option, and leaves a step name in the wrong case out', () => {
    expect(walk.takeOption(
      ['--base', 'http://127.0.0.1:9', '--base', 'http://127.0.0.1:10'],
      '--base',
      'http://127.0.0.1:8787'
    )).toBe('http://127.0.0.1:9');
    expect(walk.stepsOf(['--steps', ''])).toEqual(walk.ALL_STEPS);
    expect(walk.stepsOf(['--steps', ','])).toEqual([]);
    expect(walk.stepsOf(['--steps', 'loop,loop,phone'])).toEqual(['loop', 'phone']);
    expect(walk.stepsOf(['--steps', 'Loop'])).toEqual([]);
    expect(walk.stepsOf(['--steps', 'phone', '--no-scan'])).toEqual(['phone']);
    expect(walk.serverBase(['--base', '///'])).toBe('');
    expect(walk.serverBase(['--base'])).toBe('http://127.0.0.1:8787');
  });

  it('reads a steps value of spaces as no steps, and drops only the scanned PDF when that switch is set', () => {
    expect(walk.stepsOf(['--steps', '   '])).toEqual([]);
    expect(walk.stepsOf(['--steps', 'scan-pdf,picture', '--no-scan-pdf'])).toEqual(['picture']);
    expect(walk.takeOption(['--out', '0'], '--out', 'record.json')).toBe('0');
    expect(walk.takeOption(['--missing', 'kept'], '--out', 'record.json')).toBe('record.json');
    expect(walk.serverBase(['--base', 'http://127.0.0.1:9/extra/'])).toBe('http://127.0.0.1:9/extra');
    expect(walk.serverBase(['--base', '   '])).toBe('   ');
  });
});
