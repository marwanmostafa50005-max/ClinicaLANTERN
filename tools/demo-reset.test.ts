import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

const script = 'tools/demo-reset.ps1';

function run(port: number): Promise<{ status: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', script, '-Port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk.toString(); });
    child.stderr.on('data', chunk => { text += chunk.toString(); });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('error', reject);
    child.on('exit', status => {
      clearTimeout(timer);
      resolve({ status, text });
    });
  });
}

describe('demo-reset.ps1', () => {
  it('resets, puts the clock back to 0, and prints health and the criteria in use', async () => {
    const seen: { method: string; url: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
      if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/health') {
          res.end(JSON.stringify({ ollama: 'up', displayNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' } }));
          return;
        }
        if (req.url === '/api/criteria') {
          res.end(JSON.stringify([{ id: 'STOPP-C10' }, { id: 'START-H1' }]));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await run(port);
      expect(result.status, result.text).toBe(0);
      expect(seen.map(call => `${call.method} ${call.url}`)).toEqual([
        'POST /api/reset',
        'POST /api/demo-clock',
        'GET /api/health',
        'GET /api/criteria'
      ]);
      expect(seen[1].body).toContain('"days":0');
      expect(result.text).toContain('A clean demo was started.');
      expect(result.text).toContain('Health:');
      expect(result.text).toContain('Mantle');
      expect(result.text).toContain('Criteria in use: STOPP-C10, START-H1');
    } finally {
      await new Promise(resolve => server.close(() => resolve(undefined)));
    }
  }, 20000);

  it('says none when no criterion is in use, and skips an item with no id', async () => {
    const server = http.createServer((req, res) => {
      if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/health') {
          res.end(JSON.stringify({ ollama: 'up' }));
          return;
        }
        if (req.url === '/api/criteria') {
          res.end(JSON.stringify([{ name: 'not an id' }, { id: '' }]));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await run(port);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Criteria in use: none');
      expect(result.text).not.toContain('not an id');
    } finally {
      await new Promise(resolve => server.close(() => resolve(undefined)));
    }
  }, 20000);

  it('prints the one criterion when the answer is one object', async () => {
    const server = http.createServer((req, res) => {
      if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/health') {
          res.end(JSON.stringify({ ollama: 'up' }));
          return;
        }
        if (req.url === '/api/criteria') {
          res.end(JSON.stringify({ id: 'STOPP-C10' }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await run(port);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Criteria in use: STOPP-C10');
      expect(result.text).not.toContain('none');
    } finally {
      await new Promise(resolve => server.close(() => resolve(undefined)));
    }
  }, 20000);

  it('does not say a clean demo was started when the server does not answer', async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address() as AddressInfo;
        probe.close(() => resolve(address.port));
      });
    });
    const result = await run(port);
    expect(result.status).not.toBe(0);
    expect(result.text).not.toContain('A clean demo was started.');
  }, 20000);

  it('stops when the clock cannot be put back, and does not say a clean demo was started', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
      req.on('data', () => undefined);
      req.on('end', () => {
        seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
        if (req.url === '/api/demo-clock') {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end('The clock was not moved.');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await run(port);
      expect(result.status).not.toBe(0);
      expect(result.text).not.toContain('A clean demo was started.');
      expect(seen).toContain('POST /api/reset');
      expect(seen).toContain('POST /api/demo-clock');
      expect(seen.some(call => call.startsWith('GET /api/'))).toBe(false);
    } finally {
      await new Promise(resolve => server.close(() => resolve(undefined)));
    }
  }, 20000);

  it('keeps the ids that are present and skips a gap in the list', async () => {
    const server = http.createServer((req, res) => {
      if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/criteria') {
          res.end(JSON.stringify([{ id: 'STOPP-C10' }, { label: 'no id' }, { id: 'START-H1' }]));
          return;
        }
        res.end(JSON.stringify({ ollama: 'up' }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await run(port);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Criteria in use: STOPP-C10, START-H1');
      expect(result.text).not.toContain('no id');
    } finally {
      await new Promise(resolve => server.close(() => resolve(undefined)));
    }
  }, 20000);
});
