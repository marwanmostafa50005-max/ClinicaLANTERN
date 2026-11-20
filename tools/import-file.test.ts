import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bodyFor, main, rowsFromPdf } from './import-file.ts';

const demo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cases', '_demo');
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('import-file', () => {
  it('reads the demo text PDF with the page row builder', async () => {
    const rows = await rowsFromPdf(path.join(demo, 'positive.pdf'));
    const supplies = rows.filter(row => /^\d{2}\/\d{2}\/\d{4} \| /.test(row));
    expect(supplies).toHaveLength(45);
    expect(supplies.some(row => row.includes('Xarelto'))).toBe(true);
    expect(rows.some(row => /Patient:\s*Fictional patient F-001/.test(row))).toBe(true);
    expect(rows.some(row => row.startsWith('Date | Medicine'))).toBe(true);
  }, 20000);

  it('sends a CSV as text and PNG pictures as page images', async () => {
    const csv = await bodyFor([path.join(demo, 'positive.csv')]);
    expect(csv.source).toBe('csv');
    expect(csv.csvText).toContain('Xarelto');
    expect(csv.fileName).toBe('positive.csv');
    const png = path.join(demo, 'positive-scan.png');
    const scan = await bodyFor([png]);
    expect(scan.source).toBe('pdf-image');
    expect(scan.pageImages).toHaveLength(1);
    expect(scan.pageImages?.[0].length).toBeGreaterThan(100);
  });

  it('sends several PNG pictures as the pages of one scan', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    const pages = [1, 2].map(n => {
      const file = path.join(dir, `page-${n}.png`);
      fs.writeFileSync(file, `page ${n}`);
      return file;
    });
    const scan = await bodyFor(pages);
    expect(scan).toEqual({
      fileName: 'page-1.png',
      source: 'pdf-image',
      pageImages: [Buffer.from('page 1').toString('base64'), Buffer.from('page 2').toString('base64')]
    });
  });

  it('refuses no file, a file it cannot send, and two files that are not pictures', async () => {
    await expect(bodyFor([])).rejects.toThrow(/Name a file/);
    await expect(bodyFor(['notes.txt'])).rejects.toThrow(/\.csv, a \.pdf or a \.png/);
    await expect(bodyFor(['one.csv', 'two.csv'])).rejects.toThrow(/Only PNG pictures can be sent together/);
  });

  it('reads a CSV whose ending is in capitals, and refuses a picture sent with a CSV', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    const csv = path.join(dir, 'History.CSV');
    fs.writeFileSync(csv, 'dispense_date,medicine\n2026-08-21,celecoxib\n');
    const body = await bodyFor([csv]);
    expect(body.source).toBe('csv');
    expect(body.fileName).toBe('History.CSV');
    expect(body.csvText).toContain('celecoxib');

    const png = path.join(dir, 'page.PNG');
    fs.writeFileSync(png, 'png');
    await expect(bodyFor([png, csv])).rejects.toThrow(/Only PNG pictures can be sent together/);
    await expect(bodyFor(['scan.JPG'])).rejects.toThrow('This tool sends a .csv, a .pdf or a .png file. scan.JPG is none of those.');
  });

  it('refuses a PDF that has no text rows', async () => {
    await expect(bodyFor([path.join(demo, 'positive-scan.pdf')])).rejects.toThrow(/no text rows/);
  }, 20000);

  it('refuses a start with no file, an unknown option, or a missing server address', async () => {
    await expect(main([])).rejects.toThrow(/Usage:/);
    await expect(main(['--wat'])).rejects.toThrow(/Unknown option/);
    await expect(main(['--server'])).rejects.toThrow(/server address/);
  });

  it('drops one trailing slash on the server address, then stops when that server is not there', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    const csv = path.join(dir, 'a.csv');
    fs.writeFileSync(csv, 'a,b\n');
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const n = typeof address === 'object' && address ? address.port : 0;
        probe.close(() => resolve(n));
      });
    });
    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      await expect(main([csv, '--server', `http://127.0.0.1:${port}///`])).rejects.toThrow();
    } finally {
      console.log = log;
    }
    expect(lines[0]).toBe(`Sending a.csv as csv to http://127.0.0.1:${port}//.`);
  });

  it('sends a text PDF as rows, and posts one CSV when the server answers', async () => {
    const pdf = await bodyFor([path.join(demo, 'positive.pdf')]);
    expect(pdf.source).toBe('pdf-text');
    expect(pdf.fileName).toBe('positive.pdf');
    expect(pdf.rows?.some(row => row.includes('Xarelto'))).toBe(true);
    expect(pdf.csvText).toBeUndefined();
    expect(pdf.pageImages).toBeUndefined();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    await expect(bodyFor([path.join(dir, 'missing.csv')])).rejects.toThrow(/ENOENT/);

    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        seen.push(`${req.method} ${req.url}`);
        const posted = Buffer.concat(chunks).toString('utf8');
        if (posted) seen.push(posted);
        const body = req.url === '/api/cases'
          ? { caseId: 'c-test' }
          : {
              state: {
                cases: [{
                  id: 'c-test',
                  fileName: 'a.csv',
                  source: 'csv',
                  lines: [{ text: 'row' }],
                  screening: { status: 'done' }
                }],
                findings: [],
                jobs: []
              },
              now: { text: 'Thursday' }
            };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const csv = path.join(dir, 'a.csv');
    fs.writeFileSync(csv, 'a,b\n');
    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      await main(['--confirm', csv, '--server', `http://127.0.0.1:${port}/`]);
    } finally {
      console.log = log;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    expect(lines[0]).toBe(`Sending a.csv as csv to http://127.0.0.1:${port}.`);
    expect(lines[1]).toBe('Case c-test.');
    expect(lines[2]).toBe('c-test a.csv: 1 lines, screening done. 0 findings at the bell. Thursday');
    expect(seen[0]).toBe('POST /api/cases');
    expect(seen[1]).toContain('"source":"csv"');
    expect(seen[2]).toBe('GET /api/state');
  }, 20000);

  it('stops when the server names no case, and when the history cannot be assessed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    const csv = path.join(dir, 'a.csv');
    fs.writeFileSync(csv, 'a,b\n');

    async function serve(reply: (url: string | undefined) => unknown): Promise<{ port: number; hits: string[]; close: () => Promise<void> }> {
      const hits: string[] = [];
      const server = http.createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        req.resume();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply(req.url)));
      });
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : 0);
        });
      });
      return { port, hits, close: () => new Promise(done => server.close(() => done())) };
    }

    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      const empty = await serve(() => ({}));
      try {
        await expect(main([csv, '--server', `http://127.0.0.1:${empty.port}`])).rejects.toThrow('The server did not return a case id.');
      } finally {
        await empty.close();
      }
      expect(lines).toEqual([`Sending a.csv as csv to http://127.0.0.1:${empty.port}.`]);
      expect(empty.hits).toEqual(['POST /api/cases']);

      lines.length = 0;
      const stuck = await serve(url => url === '/api/cases'
        ? { caseId: 'c-bad' }
        : {
            state: {
              cases: [{
                id: 'c-bad', fileName: 'a.csv', source: 'csv', lines: [],
                screening: { status: 'done' }, cannotAssess: 'The date column is missing.'
              }],
              findings: [], jobs: []
            },
            now: { text: '' }
          });
      try {
        await main([csv, '--server', `http://127.0.0.1:${stuck.port}`]);
      } finally {
        await stuck.close();
      }
      expect(lines).toEqual([
        `Sending a.csv as csv to http://127.0.0.1:${stuck.port}.`,
        'Case c-bad.',
        'c-bad a.csv: Cannot assess: The date column is missing.'
      ]);
      expect(stuck.hits).toEqual(['POST /api/cases', 'GET /api/state']);
    } finally {
      console.log = log;
    }
  });

  it('names a refused import, a case that is gone, and a scan that is not ready', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
    made.push(dir);
    const csv = path.join(dir, 'a.csv');
    fs.writeFileSync(csv, 'a,b\n');
    const png = path.join(dir, 'a.png');
    fs.writeFileSync(png, 'png');

    async function serve(
      reply: (method: string, url: string) => { status?: number; body: unknown }
    ): Promise<{ port: number; hits: string[]; close: () => Promise<void> }> {
      const hits: string[] = [];
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          hits.push(`${req.method} ${req.url}`);
          if (chunks.length > 0) hits.push(Buffer.concat(chunks).toString('utf8'));
          const answer = reply(req.method ?? 'GET', req.url ?? '');
          res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(answer.body));
        });
      });
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : 0);
        });
      });
      return { port, hits, close: () => new Promise(done => server.close(() => done())) };
    }

    const lines: string[] = [];
    const log = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    try {
      const named = await serve(() => ({ status: 400, body: { error: 'no date' } }));
      try {
        await expect(main([csv, '--server', `http://127.0.0.1:${named.port}`])).rejects.toThrow(/^no date$/);
      } finally {
        await named.close();
      }
      expect(lines).toEqual([`Sending a.csv as csv to http://127.0.0.1:${named.port}.`]);
      expect(named.hits.filter(hit => !hit.startsWith('{'))).toEqual(['POST /api/cases']);

      lines.length = 0;
      const bare = await serve(() => ({ status: 500, body: {} }));
      try {
        await expect(main([csv, '--server', `http://127.0.0.1:${bare.port}`])).rejects.toThrow('The server answered 500.');
      } finally {
        await bare.close();
      }
      expect(bare.hits.filter(hit => !hit.startsWith('{'))).toEqual(['POST /api/cases']);

      lines.length = 0;
      const gone = await serve((_method, url) => url === '/api/cases'
        ? { body: { caseId: 'c-gone' } }
        : { body: { state: { cases: [{ id: 'c-other' }], findings: [], jobs: [] }, now: { text: '' } } });
      try {
        await main([csv, '--server', `http://127.0.0.1:${gone.port}`]);
      } finally {
        await gone.close();
      }
      expect(lines).toEqual([
        `Sending a.csv as csv to http://127.0.0.1:${gone.port}.`,
        'Case c-gone.',
        'Case c-gone is not in the state.'
      ]);
      expect(gone.hits.filter(hit => hit.startsWith('GET'))).toEqual(['GET /api/state']);

      lines.length = 0;
      const unread = await serve((_method, url) => url === '/api/cases'
        ? { body: { caseId: 'c-scan' } }
        : {
            body: {
              state: {
                cases: [{
                  id: 'c-scan', fileName: 'a.png', source: 'pdf-image', lines: [],
                  screening: { status: 'running' }
                }],
                findings: [],
                jobs: [{ caseId: 'c-scan', stage: 'screen', status: 'Running' }]
              },
              now: { text: '' }
            }
          });
      try {
        await main([png, '--server', `http://127.0.0.1:${unread.port}`]);
      } finally {
        await unread.close();
      }
      expect(lines).toEqual([
        `Sending a.png as pdf-image to http://127.0.0.1:${unread.port}.`,
        'Case c-scan.',
        'c-scan a.png: 0 rows read from 0 pages. Waiting for the rows to be checked.',
        'c-scan: the scan was not read. Nothing is waiting to be confirmed.'
      ]);
      expect(unread.hits.filter(hit => hit.startsWith('GET'))).toEqual(['GET /api/state']);

      lines.length = 0;
      const waiting = await serve((_method, url) => url === '/api/cases'
        ? { body: { caseId: 'c-wait' } }
        : {
            body: {
              state: {
                cases: [{
                  id: 'c-wait', fileName: 'a.png', source: 'pdf-image', pages: 2,
                  lines: [{ text: '2026-08-21 | Xarelto' }],
                  screening: { status: 'running' }
                }],
                findings: [],
                jobs: []
              },
              now: { text: 'Reading' }
            }
          });
      try {
        await main([png, '--server', `http://127.0.0.1:${waiting.port}`]);
      } finally {
        await waiting.close();
      }
      expect(lines).toEqual([
        `Sending a.png as pdf-image to http://127.0.0.1:${waiting.port}.`,
        'Case c-wait.',
        'c-wait a.png: 1 rows read from 2 pages. Reading',
        'c-wait: waiting for the pharmacist to confirm 1 rows.'
      ]);
      expect(waiting.hits.some(hit => hit.includes('confirm-transcription'))).toBe(false);

      lines.length = 0;
      let polls = 0;
      const confirmed = await serve((method, url) => {
        if (url === '/api/cases' && method === 'POST') return { body: { caseId: 'c-ok' } };
        if (url.endsWith('/confirm-transcription')) return { body: { ok: true } };
        polls += 1;
        if (polls === 1) {
          return {
            body: {
              state: {
                cases: [{
                  id: 'c-ok', fileName: 'a.png', source: 'pdf-image', pages: 1,
                  lines: [{ text: 'row one' }],
                  screening: { status: 'running' }
                }],
                findings: [],
                jobs: []
              },
              now: { text: 'Reading' }
            }
          };
        }
        return {
          body: {
            state: {
              cases: [{
                id: 'c-ok', fileName: 'a.png', source: 'pdf-image', transcriptionConfirmed: true,
                lines: [{ text: 'row one' }],
                screening: { status: 'interrupted' }
              }],
              findings: [
                { caseId: 'c-ok', check: { confirmed: true, completed: true } },
                { caseId: 'c-ok', check: { confirmed: false, completed: true } },
                { caseId: 'c-other', check: { confirmed: true, completed: true } }
              ],
              jobs: []
            },
            now: { text: 'Idle' }
          }
        };
      });
      try {
        await main([png, '--confirm', '--server', `http://127.0.0.1:${confirmed.port}`]);
      } finally {
        await confirmed.close();
      }
      expect(lines).toEqual([
        `Sending a.png as pdf-image to http://127.0.0.1:${confirmed.port}.`,
        'Case c-ok.',
        'c-ok a.png: 1 rows read from 1 pages. Reading',
        'c-ok: confirmed 1 rows as they were read. Screening is queued.',
        'c-ok a.png: 1 lines, screening interrupted. 1 findings at the bell. Idle'
      ]);
      expect(confirmed.hits).toContain('POST /api/cases/c-ok/confirm-transcription');
      expect(confirmed.hits).toContain('{"rows":["row one"]}');
      expect(polls).toBe(2);
    } finally {
      console.log = log;
    }
  });
});
