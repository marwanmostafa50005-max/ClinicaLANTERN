import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

const script = path.join(process.cwd(), 'tools', 'demo-clock.ps1');

function run(args: string[]): Promise<{ status: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function standIn(): Promise<{ port: number; seen: unknown[]; close: () => Promise<void> }> {
  const seen: unknown[] = [];
  const server = http.createServer((req, res) => {
    if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const body = JSON.parse(raw) as { days: number };
        seen.push({ method: req.method, url: req.url, body });
        const when = new Date(Date.UTC(2026, 10, 18 + body.days, 1, 0, 0)).toISOString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ serverTime: when }));
      } catch (error) {
        seen.push({ method: req.method, url: req.url, raw, error: String(error) });
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(error));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        seen,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

describe('demo-clock.ps1', () => {
  it('refuses a negative number of days and does not need a server', async () => {
    const result = await run(['-Days', '-1', '-Port', '1']);
    expect(result.status).not.toBe(0);
    expect(result.text).toMatch(/whole number of days, 0 or more/);
  }, 20000);

  it('posts the number of days and prints the server time', async () => {
    const server = await standIn();
    try {
      const ahead = await run(['-Days', '8', '-Port', String(server.port)]);
      expect(ahead.status, ahead.text + '\n' + JSON.stringify(server.seen)).toBe(0);
      expect(ahead.text).toContain('Demo clock: 8 days ahead. Server time:');
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 8 } });

      const back = await run(['-Days', '0', '-Port', String(server.port)]);
      expect(back.status, back.text).toBe(0);
      expect(back.text).toContain('The demo clock is back to the real date. Server time:');
      expect(server.seen[1]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 0 } });
    } finally {
      await server.close();
    }
  }, 20000);

  it('refuses to run when the number of days is missing, and does not need a server', async () => {
    const result = await run(['-Port', '9']);
    expect(result.status).not.toBe(0);
    expect(result.text).toMatch(/missing mandatory parameters: Days/);
    expect(result.text).not.toMatch(/days ahead|real date/);
  }, 20000);

  it('does not say the clock moved when the server does not answer', async () => {
    const port = await closedPort();
    const result = await run(['-Days', '3', '-Port', String(port)]);
    expect(result.status).not.toBe(0);
    expect(result.text).not.toMatch(/days ahead|real date/);
  }, 20000);

  it('does not say the clock moved when the server refuses the call', async () => {
    const server = await refuse(500, 'The clock was not moved.');
    try {
      const result = await run(['-Days', '3', '-Port', String(server.port)]);
      expect(result.status).not.toBe(0);
      expect(result.text).not.toMatch(/days ahead|real date/);
    } finally {
      await server.close();
    }
  }, 20000);

  it('rounds a half day to the even number, and a word is not a number of days', async () => {
    const server = await standIn();
    try {
      const half = await run(['-Days', '0.5', '-Port', String(server.port)]);
      expect(half.status, half.text).toBe(0);
      expect(half.text).toContain('The demo clock is back to the real date. Server time:');
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 0 } });

      const even = await run(['-Days', '2.5', '-Port', String(server.port)]);
      expect(even.status, even.text).toBe(0);
      expect(even.text).toContain('Demo clock: 2 days ahead. Server time:');
      expect(server.seen[1]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 2 } });
    } finally {
      await server.close();
    }
    const word = await run(['-Days', 'no', '-Port', '1']);
    expect(word.status).not.toBe(0);
    expect(word.text).not.toMatch(/days ahead|real date/);
  }, 30000);

  it('sends a fraction of a day as the nearest whole number', async () => {
    const server = await standIn();
    try {
      const result = await run(['-Days', '1.5', '-Port', String(server.port)]);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Demo clock: 2 days ahead. Server time:');
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 2 } });
    } finally {
      await server.close();
    }
  }, 20000);

  it('refuses a port that is not a whole number, and prints an empty server time when the reply names none', async () => {
    const word = await run(['-Days', '4', '-Port', 'no']);
    expect(word.status).not.toBe(0);
    expect(word.text).toMatch(/Port/);
    expect(word.text).not.toMatch(/days ahead|real date/);

    const server = await bare();
    try {
      const result = await run(['-Days', '4', '-Port', String(server.port)]);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Demo clock: 4 days ahead. Server time:');
      expect(result.text).not.toMatch(/Server time: \S/);
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 4 } });
    } finally {
      await server.close();
    }
  }, 30000);

  it('says one day in the same words, refuses a day count that is too big, and prints a blank time when the reply is not JSON', async () => {
    const server = await standIn();
    try {
      const one = await run(['-Days', '1', '-Port', String(server.port)]);
      expect(one.status, one.text).toBe(0);
      expect(one.text).toContain('Demo clock: 1 days ahead. Server time:');
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 1 } });
    } finally {
      await server.close();
    }

    const huge = await run(['-Days', '3000000000', '-Port', '1']);
    expect(huge.status).not.toBe(0);
    expect(huge.text).not.toMatch(/days ahead|real date/);

    const plain = await refuse(200, 'not json', 'application/json');
    try {
      const result = await run(['-Days', '6', '-Port', String(plain.port)]);
      expect(result.status, result.text).toBe(0);
      expect(result.text).toContain('Demo clock: 6 days ahead. Server time:');
      expect(result.text).not.toMatch(/Server time: \S/);
    } finally {
      await plain.close();
    }
  }, 30000);

  it('accepts the switches in the wrong case, rounds 3.5 up and 4.5 down, and refuses an unknown switch', async () => {
    const server = await standIn();
    try {
      const lower = await run(['-days', '3', '-port', String(server.port)]);
      expect(lower.status, lower.text).toBe(0);
      expect(lower.text).toContain('Demo clock: 3 days ahead. Server time:');
      expect(server.seen[0]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 3 } });

      const up = await run(['-Days', '3.5', '-Port', String(server.port)]);
      expect(up.status, up.text).toBe(0);
      expect(up.text).toContain('Demo clock: 4 days ahead. Server time:');
      expect(server.seen[1]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 4 } });

      const down = await run(['-Days', '4.5', '-Port', String(server.port)]);
      expect(down.status, down.text).toBe(0);
      expect(down.text).toContain('Demo clock: 4 days ahead. Server time:');
      expect(server.seen[2]).toEqual({ method: 'POST', url: '/api/demo-clock', body: { days: 4 } });
    } finally {
      await server.close();
    }

    const extra = await run(['-Days', '1', '-Port', '1', '-Extra', 'no']);
    expect(extra.status).not.toBe(0);
    expect(extra.text).not.toMatch(/days ahead|real date/);
  }, 30000);
});

function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

function bare(): Promise<{ port: number; seen: unknown[]; close: () => Promise<void> }> {
  const seen: unknown[] = [];
  const server = http.createServer((req, res) => {
    if (String(req.headers.expect ?? '').toLowerCase().includes('100-continue')) res.writeContinue();
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, body: JSON.parse(raw) as { days: number } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        seen,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

function refuse(status: number, body: string, type = 'text/plain; charset=utf-8'): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}
