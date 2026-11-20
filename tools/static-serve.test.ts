// tools/static-serve.mjs serves one folder on this computer and prints every address.
// These tests use a free port. No model is called, and port 5174 is not used.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(repoRoot, 'tools', 'static-serve.mjs');
const children: { kill: () => void }[] = [];
const made: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('static-serve', () => {
  it('serves the page and the index, and prints each address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>Recorded run</p>');
    fs.mkdirSync(path.join(dir, 'recorded'));
    fs.writeFileSync(path.join(dir, 'recorded', 'index.json'), '{"runs":[]}\n');
    const child = spawn(process.execPath, [script, dir, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the static server did not start')), 5000);
      child.stdout.on('data', () => {
        const found = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`the static server stopped (${code})`));
      });
    });
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const index = await fetch(`http://127.0.0.1:${port}/recorded/index.json`);
    const escaped = await fetch(`http://127.0.0.1:${port}/../package.json`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Recorded run');
    expect(index.status).toBe(200);
    expect(await index.json()).toEqual({ runs: [] });
    expect(escaped.status).toBe(404);
    expect(await escaped.text()).not.toContain('clinicalantern');
    expect(out.split(/\r?\n/)).toContain('/');
    expect(out.split(/\r?\n/)).toContain('/recorded/index.json');
  });

  it('answers a folder, a picture, a look with no body, and a change, and refuses a bad address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    fs.mkdirSync(path.join(dir, 'pages'));
    fs.writeFileSync(path.join(dir, 'pages', 'index.html'), '<p>A recorded page</p>');
    fs.writeFileSync(path.join(dir, 'mark.svg'), '<svg></svg>');
    const child = spawn(process.execPath, [script, dir, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the static server did not start')), 5000);
      child.stdout.on('data', () => {
        const found = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`the static server stopped (${code})`));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/pages/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('A recorded page');
    const picture = await fetch(`${base}/mark.svg`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/svg+xml');
    const missing = await fetch(`${base}/missing.txt`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('This file is not in the recorded copy.');
    const bad = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/%zz', method: 'GET' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('error', reject);
      req.end();
    });
    expect(bad.status).toBe(404);
    expect(bad.body).toBe('This file is not in the recorded copy.');
    const head = await new Promise<{ status: number; length: string; body: string }>((resolve, reject) => {
      const req = http.request(`${base}/mark.svg`, { method: 'HEAD' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          length: String(res.headers['content-length'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8')
        }));
      });
      req.once('error', reject);
      req.end();
    });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(Number(head.length)).toBe(fs.statSync(path.join(dir, 'mark.svg')).size);
    const posted = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(`${base}/mark.svg`, { method: 'POST' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('error', reject);
      req.end();
    });
    expect(posted.status).toBe(405);
    expect(posted.body).toBe('This server only reads files.');
    fs.writeFileSync(path.join(dir, 'notes.bin'), 'abc');
    const bin = await fetch(`${base}/notes.bin`);
    expect(bin.status).toBe(200);
    expect(bin.headers.get('content-type')).toBe('application/octet-stream');
    expect(await bin.text()).toBe('abc');
    const nul = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/%00', method: 'GET' }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.once('error', reject);
      req.end();
    });
    expect(nul.status).toBe(404);
    expect(nul.body).toBe('This file is not in the recorded copy.');
    expect(out.split(/\r?\n/)).toContain('/mark.svg');
  });

  it('stops when the port is not a whole number', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    const result = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, dir, 'port'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      child.stderr.on('data', chunk => { err += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => resolve({ code, err }));
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('The port must be a whole number.');
  });

  it('stops when the folder is missing', async () => {
    const missing = path.join(os.tmpdir(), 'lantern-static-missing', String(Date.now()));
    const result = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, missing, '0'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      child.stderr.on('data', chunk => { err += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => resolve({ code, err }));
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain('There is no folder to serve');
  });

  it('ignores a query, refuses a folder with no page, and stops on an extra argument', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    fs.writeFileSync(path.join(dir, 'mark.svg'), '<svg></svg>');
    fs.mkdirSync(path.join(dir, 'bare'));
    const child = spawn(process.execPath, [script, dir, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the static server did not start')), 5000);
      child.stdout.on('data', () => {
        const found = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`the static server stopped (${code})`));
      });
    });
    const queried = await fetch(`http://127.0.0.1:${port}/mark.svg?x=1`);
    expect(queried.status).toBe(200);
    expect(await queried.text()).toBe('<svg></svg>');
    const bare = await fetch(`http://127.0.0.1:${port}/bare/`);
    expect(bare.status).toBe(404);
    expect(await bare.text()).toBe('This file is not in the recorded copy.');
    const extra = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const stopped = spawn(process.execPath, [script, dir, '0', 'again'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      stopped.stderr.on('data', chunk => { err += String(chunk); });
      stopped.once('error', reject);
      stopped.once('exit', code => resolve({ code, err }));
    });
    expect(extra.code).toBe(1);
    expect(extra.err).toContain('Usage: node tools/static-serve.mjs <folder> <port>');
    const climbed = await fetch(`http://127.0.0.1:${port}/%2e%2e/package.json`);
    expect(climbed.status).toBe(404);
    expect(await climbed.text()).toBe('This file is not in the recorded copy.');
  });

  it('names the type of a page, a style, a script, a picture and a font', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    const files: { name: string; type: string; body: string }[] = [
      { name: 'index.html', type: 'text/html; charset=utf-8', body: '<p>Recorded run</p>' },
      { name: 'app.css', type: 'text/css; charset=utf-8', body: 'body{color:navy}' },
      { name: 'app.js', type: 'text/javascript; charset=utf-8', body: 'console.log(1)' },
      { name: 'photo.jpg', type: 'image/jpeg', body: 'jpg' },
      { name: 'photo.jpeg', type: 'image/jpeg', body: 'jpeg' },
      { name: 'photo.webp', type: 'image/webp', body: 'webp' },
      { name: 'favicon.ico', type: 'image/x-icon', body: 'ico' },
      { name: 'hand.woff', type: 'font/woff', body: 'woff' },
      { name: 'hand.woff2', type: 'font/woff2', body: 'woff2' },
      { name: 'note.txt', type: 'text/plain; charset=utf-8', body: 'a note' },
      { name: 'app.js.map', type: 'application/json; charset=utf-8', body: '{}' },
      { name: 'MARK.PNG', type: 'image/png', body: 'PNG' }
    ];
    for (const file of files) fs.writeFileSync(path.join(dir, file.name), file.body);
    const child = spawn(process.execPath, [script, dir, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the static server did not start')), 5000);
      child.stdout.on('data', () => {
        const found = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`the static server stopped (${code})`));
      });
    });
    for (const file of files) {
      const answer = await fetch(`http://127.0.0.1:${port}/${file.name}`);
      expect(answer.status, file.name).toBe(200);
      expect(answer.headers.get('content-type'), file.name).toBe(file.type);
      expect(await answer.text(), file.name).toBe(file.body);
    }
  });

  it('says when a file cannot be read, and stops when it is started with no arguments', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
    made.push(dir);
    const locked = path.join(dir, 'locked.txt');
    fs.writeFileSync(locked, 'secret words');
    const child = spawn(process.execPath, [script, dir, '0'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', chunk => { out += String(chunk); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the static server did not start')), 5000);
      child.stdout.on('data', () => {
        const found = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`the static server stopped (${code})`));
      });
    });
    execFileSync('icacls', [locked, '/deny', '*S-1-1-0:(R)'], { stdio: 'pipe' });
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/locked.txt`);
      expect(answer.status).toBe(500);
      expect(await answer.text()).toBe('This file could not be read.');
    } finally {
      execFileSync('icacls', [locked, '/remove:d', '*S-1-1-0'], { stdio: 'pipe' });
    }
    const bare = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
      const stopped = spawn(process.execPath, [script], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let err = '';
      stopped.stderr.on('data', chunk => { err += String(chunk); });
      stopped.once('error', reject);
      stopped.once('exit', code => resolve({ code, err }));
    });
    expect(bare.code).toBe(1);
    expect(bare.err).toContain('Usage: node tools/static-serve.mjs <folder> <port>');
  });
});