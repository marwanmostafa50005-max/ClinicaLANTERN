import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity } from '../shared/types.ts';
import { activityToCsv, csvCell, writeActivity } from './export-activity.ts';

const made: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise(resolve => server.close(() => resolve(undefined)));
  }
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('export-activity', () => {
  it('writes time, kind, text, model, case, finding, letter and criterion', () => {
    const rows: Activity[] = [{
      at: '2026-11-19T08:00:00.000Z',
      kind: 'decision',
      text: 'The pharmacist accepted the finding, and said "yes".',
      model: 'lantern-screen',
      caseId: 'C0001',
      findingId: 'F0001',
      letterId: 'T0001',
      criterionId: 'STOPP-C10'
    }];
    const csv = activityToCsv(rows);
    expect(csv.split('\n')[0]).toBe('time,kind,text,model,case,finding,letter,criterion');
    expect(csv).toContain('"The pharmacist accepted the finding, and said ""yes""."');
    expect(csv).toContain('STOPP-C10');
    expect(activityToCsv([])).toBe('time,kind,text,model,case,finding,letter,criterion\n');
  });

  it('quotes a mark, and leaves an empty place for a field that was not set', () => {
    expect(csvCell('"')).toBe('""""');
    expect(csvCell(undefined)).toBe('');
    const csv = activityToCsv([{
      at: '2026-11-19T08:00:00.000Z',
      kind: 'error',
      text: '"'
    }]);
    expect(csv).toBe('time,kind,text,model,case,finding,letter,criterion\n2026-11-19T08:00:00.000Z,error,"""",,,,,\n');
  });

  it('quotes a comma and a line break in the text', () => {
    const rows: Activity[] = [{
      at: '2026-11-19T08:00:00.000Z',
      kind: 'error',
      text: 'Line one,\r\nline two'
    }];
    const csv = activityToCsv(rows);
    expect(csv).toContain('"Line one,\r\nline two"');
    expect(csv.split('\n')[0]).toBe('time,kind,text,model,case,finding,letter,criterion');
  });

  it('reads the activity log from a running server and adds no other call', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        state: {
          version: 1, cases: [], findings: [], letters: [], jobs: [],
          activity: [{ at: '2026-11-19T08:00:00.000Z', kind: 'reset', text: 'A clean demo was started.' }]
        }
      }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-activity-'));
    made.push(dir);
    const out = path.join(dir, 'activity.csv');
    await writeActivity(`http://127.0.0.1:${port}`, out);
    expect(seen).toEqual(['/api/state']);
    expect(fs.readFileSync(out, 'utf8')).toContain('A clean demo was started.');
  });

  it('stops when the state has no activity log, and when the server refuses', async () => {
    const noLog = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: { cases: [] } }));
    });
    servers.push(noLog);
    await new Promise<void>(resolve => noLog.listen(0, '127.0.0.1', () => resolve()));
    const noLogPort = (noLog.address() as { port: number }).port;
    await expect(writeActivity(`http://127.0.0.1:${noLogPort}/`, 'data/unused.csv')).rejects.toThrow(
      'The state has no activity log.'
    );

    const refused = http.createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('no');
    });
    servers.push(refused);
    await new Promise<void>(resolve => refused.listen(0, '127.0.0.1', () => resolve()));
    const refusedPort = (refused.address() as { port: number }).port;
    await expect(writeActivity(`http://127.0.0.1:${refusedPort}`, 'data/unused.csv')).rejects.toThrow(
      'GET /api/state answered 500'
    );

    const broken = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json');
    });
    servers.push(broken);
    await new Promise<void>(resolve => broken.listen(0, '127.0.0.1', () => resolve()));
    const brokenPort = (broken.address() as { port: number }).port;
    await expect(writeActivity(`http://127.0.0.1:${brokenPort}`, 'data/unused.csv')).rejects.toThrow();
  });

  it('the command writes the file', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ state: { version: 1, cases: [], findings: [], letters: [], jobs: [], activity: [] } }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-activity-'));
    made.push(dir);
    const out = path.join(dir, 'activity.csv');
    const result = await new Promise<{ status: number | null; text: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        'tools/export-activity.ts', '--server', `http://127.0.0.1:${port}`, '--out', out
      ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', chunk => { text += chunk.toString(); });
      child.stderr.on('data', chunk => { text += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', status => resolve({ status, text }));
    });
    expect(result.status, result.text).toBe(0);
    expect(result.text).toContain('0 lines.');
    expect(fs.readFileSync(out, 'utf8').startsWith('time,kind,text,model,case,finding,letter,criterion\n')).toBe(true);
  });

  it('says one line when the log has one row', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        state: {
          version: 1, cases: [], findings: [], letters: [], jobs: [],
          activity: [{ at: '2026-11-19T08:00:00.000Z', kind: 'reset', text: 'A clean demo was started.' }]
        }
      }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-activity-'));
    made.push(dir);
    const out = path.join(dir, 'activity.csv');
    const result = await new Promise<{ status: number | null; text: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        'tools/export-activity.ts', '--server', `http://127.0.0.1:${port}`, '--out', out
      ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', chunk => { text += chunk.toString(); });
      child.stderr.on('data', chunk => { text += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', status => resolve({ status, text }));
    });
    expect(result.status, result.text).toBe(0);
    expect(result.text).toContain('1 line.');
    expect(result.text).not.toContain('1 lines.');
  });

  it('stops when the file to write is missing, and when the server is another option', async () => {
    const run = (args: string[]) => new Promise<{ status: number | null; text: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['tools/export-activity.ts', ...args], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let text = '';
      child.stdout.on('data', chunk => { text += chunk.toString(); });
      child.stderr.on('data', chunk => { text += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', status => resolve({ status, text }));
    });
    const missing = await run(['--server', 'http://127.0.0.1:9']);
    expect(missing.status).toBe(1);
    expect(missing.text).toContain('Usage: node tools/export-activity.ts');
    const other = await run(['--server', '--out', 'data/unused.csv']);
    expect(other.status).toBe(1);
    expect(other.text).toContain('Usage: node tools/export-activity.ts');
    expect(other.text).not.toContain('Written:');
  });
});
