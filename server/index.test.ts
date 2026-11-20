// Starts the real server as its own process, the way "npm start" does. No model is called:
// the state is empty, so there is nothing to screen. LANTERN_NO_WARMUP=1 keeps the warm-up off.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const started: ChildProcess[] = [];
const made: string[] = [];

afterEach(async () => {
  for (const child of started.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function startServer(port: number, dataDir: string, activeFile = 'cases/_demo/active.json', extra: Record<string, string> = {}): Started {
  const child = spawn(process.execPath, ['server/index.ts'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), LANTERN_DATA_DIR: dataDir, LANTERN_ACTIVE_FILE: activeFile, LANTERN_NO_WARMUP: '1', ...extra },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  started.push(child);
  let text = '';
  child.stdout?.on('data', chunk => { text += String(chunk); });
  child.stderr?.on('data', chunk => { text += String(chunk); });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  return { child, output: () => text, exited };
}

async function waitFor(what: string, done: () => boolean, ms = 15000): Promise<void> {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

describe('starting the server twice by mistake', () => {
  it('the second start ends with a plain message and does not touch the state file of the first', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-index-'));
    made.push(dataDir);
    const port = await freePort();
    const stateFile = path.join(dataDir, 'state.json');

    const first = startServer(port, dataDir);
    await waitFor('the first server to start', () => first.output().includes('ClinicaLANTERN server:') || first.child.exitCode !== null);
    expect(first.child.exitCode).toBeNull();
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');
    const before = { text: fs.readFileSync(stateFile, 'utf8'), time: fs.statSync(stateFile).mtimeMs };
    await new Promise(resolve => setTimeout(resolve, 60));               // so a second write would carry a later time

    const second = startServer(port, dataDir);
    const code = await second.exited;
    expect(code).toBe(1);
    expect(second.output()).toContain(`Port ${port} is already in use.`);
    // Before the fix the second process read the state, "recovered" it, wrote the file and started
    // the queue, and only then found the port taken.
    expect(fs.statSync(stateFile).mtimeMs).toBe(before.time);
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before.text);
    // The first server holds writer.lock. The second added nothing of its own.
    expect(fs.readdirSync(dataDir).sort()).toEqual(['state.json', 'writer.lock']);
    // The first server is still answering.
    expect((await fetch(`http://127.0.0.1:${port}/api/state`)).status).toBe(200);
  }, 30000);

  it('a second port does not write the same data folder', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-index-'));
    made.push(dataDir);
    const portA = await freePort();
    const portB = await freePort();
    expect(portB).not.toBe(portA);
    const stateFile = path.join(dataDir, 'state.json');

    const first = startServer(portA, dataDir);
    await waitFor('the first server to start', () => first.output().includes('ClinicaLANTERN server:') || first.child.exitCode !== null);
    expect(first.child.exitCode).toBeNull();
    const before = { text: fs.readFileSync(stateFile, 'utf8'), time: fs.statSync(stateFile).mtimeMs };
    await new Promise(resolve => setTimeout(resolve, 60));

    const second = startServer(portB, dataDir);
    await waitFor('the second server to refuse the folder', () => second.child.exitCode !== null || second.output().includes('ClinicaLANTERN server:'));
    expect(second.child.exitCode).toBe(1);
    expect(second.output()).toContain('already using');
    expect(fs.statSync(stateFile).mtimeMs).toBe(before.time);
    expect(fs.readFileSync(stateFile, 'utf8')).toBe(before.text);
    expect((await fetch(`http://127.0.0.1:${portA}/api/state`)).status).toBe(200);
  }, 30000);

  it('serves the built page, and still answers when the criteria list cannot be read', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-index-'));
    made.push(dataDir);
    // The test brings its own page, so npm test does not need a built dist/.
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-dist-'));
    made.push(distDir);
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html lang="en"><head><title>ClinicaLANTERN</title></head><body>page</body></html>');
    const port = await freePort();
    const missing = path.join(dataDir, 'missing-active.json');

    const server = startServer(port, dataDir, missing, { LANTERN_DIST_DIR: distDir });
    // The criteria line is printed after the address. Wait for the last line, or the start has not finished.
    await waitFor('the server to finish starting', () => server.output().includes('Fictional patients only.') || server.child.exitCode !== null);
    expect(server.child.exitCode).toBeNull();
    expect(server.output()).toContain('Criteria: NOT LOADED.');
    expect(server.output()).toContain(`The list of criteria could not be read (${missing})`);
    expect(server.output()).toContain('Fictional patients only.');

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>ClinicaLANTERN</title>');

    const absent = await fetch(`http://127.0.0.1:${port}/no-such-file.js`);
    expect(absent.status).toBe(404);
    expect(await absent.text()).toBe('Not found.');

    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');

    const criteria = await fetch(`http://127.0.0.1:${port}/api/criteria`);
    expect(criteria.status).toBe(503);
    const body = await criteria.json() as { error: string };
    expect(body.error).toContain('The criteria could not be loaded.');
    expect(body.error).toContain('The list of criteria could not be read');
  }, 30000);
});

function tempDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-index-'));
  made.push(dataDir);
  return dataDir;
}

function writeList(dataDir: string, list: unknown): string {
  const file = path.join(dataDir, 'list.json');
  fs.writeFileSync(file, JSON.stringify(list));
  return file;
}

function hasCriterionFile(id: string): boolean {
  return fs.existsSync(path.join(repoRoot, 'criteria', id, 'criterion.json'));
}

interface Listed { active: string[]; further?: string[] }

function listedCriteria(): Listed {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'criteria', 'active.json'), 'utf8')) as Listed;
}

async function up(port: number, dataDir: string, listFile: string): Promise<Started> {
  const server = startServer(port, dataDir, listFile);
  await waitFor(
    'the server to finish starting',
    () => server.output().includes('Fictional patients only.') || server.child.exitCode !== null
  );
  return server;
}

describe('what the start says about the criteria list', () => {
  it('names a further criterion whose file is missing, and keeps the ten', async () => {
    const dataDir = tempDir();
    const ten = listedCriteria().active.filter(hasCriterionFile);
    expect(ten.length).toBeGreaterThan(0);
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, {
      active: ten, further: ['NOT-A-REAL-CRITERION'], reserves: []
    }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criterion NOT LOADED: NOT-A-REAL-CRITERION.');
    expect(out).toContain(`Criteria in use: ${ten.join(', ')}`);
    expect(out).not.toContain('Criteria: NOT LOADED.');

    const criteria = await (await fetch(`http://127.0.0.1:${port}/api/criteria`)).json() as { id: string }[];
    expect(criteria.map(item => item.id)).toEqual(ten);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');
  }, 30000);

  it('stops screening when one of the ten cannot be read, and still answers', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, {
      active: ['STOPP-C10', 'NOT-A-REAL-TEN'], reserves: []
    }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criteria: NOT LOADED.');
    expect(out).toContain('NOT-A-REAL-TEN');
    expect(out).not.toContain('Criterion NOT LOADED:');

    const criteria = await fetch(`http://127.0.0.1:${port}/api/criteria`);
    expect(criteria.status).toBe(503);
    const body = await criteria.json() as { error: string };
    expect(body.error).toContain('The criteria could not be loaded.');
    expect(body.error).toContain('NOT-A-REAL-TEN');
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');
  }, 30000);

  it('stays up when the further entry is not a list', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, {
      active: ['STOPP-C10'], further: 'no', reserves: []
    }));
    expect(server.child.exitCode, server.output()).toBeNull();
    expect(server.output()).toContain('Criteria: NOT LOADED.');
    expect(server.output()).toContain('The "further" entry in the list of criteria is not a list');
    expect((await fetch(`http://127.0.0.1:${port}/api/state`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/criteria`)).status).toBe(503);
  }, 30000);

  it('counts past twenty criteria and names the first ten', async () => {
    const dataDir = tempDir();
    const listed = listedCriteria();
    const ten = listed.active.filter(hasCriterionFile).slice(0, 10);
    const further = (listed.further ?? []).filter(hasCriterionFile).filter(id => !ten.includes(id)).slice(0, 15);
    expect(ten.length + further.length).toBeGreaterThan(20);
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, { active: ten, further, reserves: [] }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const match = server.output().match(/Criteria in use: (\d+)\. The first ten \((\d+)\): (.+)\. Further: (\d+)\./);
    expect(match, server.output()).not.toBeNull();
    const total = Number(match?.[1]);
    const first = Number(match?.[2]);
    const named = match?.[3]?.split(', ') ?? [];
    const rest = Number(match?.[4]);
    expect(total).toBeGreaterThan(20);
    expect(first).toBe(ten.length);
    expect(named).toEqual(ten);
    expect(rest).toBe(total - first);

    const criteria = await (await fetch(`http://127.0.0.1:${port}/api/criteria`)).json() as { id: string }[];
    expect(criteria).toHaveLength(total);
    expect(criteria.slice(0, ten.length).map(item => item.id)).toEqual(ten);
  }, 30000);

  it('trims spaces around the port, the data folder and the list, and an empty ten with a missing further file is not loaded', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const listFile = writeList(dataDir, { active: [], further: ['NOT-A-REAL-CRITERION'], reserves: [] });
    const server = startServer(port, dataDir, ` ${listFile} `, {
      PORT: ` ${port} `,
      LANTERN_DATA_DIR: ` ${dataDir} `
    });
    await waitFor(
      'the server to finish starting',
      () => server.output().includes('Fictional patients only.') || server.child.exitCode !== null
    );
    expect(server.child.exitCode, server.output()).toBeNull();
    expect(server.output()).toContain(`http://127.0.0.1:${port}`);
    expect(server.output()).toContain(dataDir);
    expect(fs.existsSync(path.join(dataDir, 'state.json'))).toBe(true);
    expect(server.output()).toContain('Criteria: NOT LOADED.');
    expect(server.output()).toContain('NOT-A-REAL-CRITERION');
    expect(server.output()).not.toContain('Criterion NOT LOADED:');

    const bad = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '//', method: 'GET' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toContain('The address could not be read.');
  }, 30000);

  it('stays up when the list names no criterion, and says the list is empty', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, { active: [], further: [], reserves: [] }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criteria: NOT LOADED. The list of criteria is empty.');
    expect(out).not.toContain('Criteria in use:');
    expect(out).not.toContain('Criterion NOT LOADED:');
    expect(out).toContain('Fictional patients only.');

    const criteria = await fetch(`http://127.0.0.1:${port}/api/criteria`);
    expect(criteria.status).toBe(503);
    const body = await criteria.json() as { error: string };
    expect(body.error).toContain('The criteria could not be loaded.');
    expect(body.error).toContain('The list of criteria is empty.');
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');
  }, 30000);

  it('stays up when the active entry is not a list', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, { active: 'STOPP-C10', further: [], reserves: [] }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criteria: NOT LOADED.');
    expect(out).toContain('The list of criteria has no "active" list');
    expect(out).not.toContain('Criteria in use:');
    expect(out).not.toContain('Criterion NOT LOADED:');
    expect((await fetch(`http://127.0.0.1:${port}/api/criteria`)).status).toBe(503);
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json() as { now: { text: string } };
    expect(state.now.text).toBe('Idle');
  }, 30000);

  it('leaves out a further name that is not a folder name, and keeps the ten', async () => {
    const dataDir = tempDir();
    const ten = listedCriteria().active.filter(hasCriterionFile).slice(0, 3);
    expect(ten.length).toBe(3);
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, { active: ten, further: ['bad id'], reserves: [] }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criterion NOT LOADED: bad id.');
    expect(out).toContain('is not a valid folder name');
    expect(out).toContain(`Criteria in use: ${ten.join(', ')}`);
    expect(out).not.toContain('Criteria: NOT LOADED.');
    const criteria = await (await fetch(`http://127.0.0.1:${port}/api/criteria`)).json() as { id: string }[];
    expect(criteria.map(item => item.id)).toEqual(ten);
  }, 30000);

  it('lists a repeated name once, in the ten and again after them', async () => {
    const dataDir = tempDir();
    const port = await freePort();
    const server = await up(port, dataDir, writeList(dataDir, {
      active: ['STOPP-C10', 'STOPP-C10'], further: ['STOPP-C10'], reserves: []
    }));
    expect(server.child.exitCode, server.output()).toBeNull();
    const out = server.output();
    expect(out).toContain('Criteria in use: STOPP-C10');
    expect(out).not.toContain('STOPP-C10, STOPP-C10');
    expect(out).not.toContain('Criterion NOT LOADED:');
    const criteria = await (await fetch(`http://127.0.0.1:${port}/api/criteria`)).json() as { id: string }[];
    expect(criteria.map(item => item.id)).toEqual(['STOPP-C10']);
  }, 30000);
});
