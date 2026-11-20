import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveInside, serveStatic } from './static.ts';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-static-'));
  made.push(dir);
  return dir;
}

function listen(distDir: string, pathnameOf?: (url: string) => string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const raw = req.url ?? '/';
    const pathname = pathnameOf ? pathnameOf(raw) : new URL(raw, 'http://127.0.0.1').pathname;
    serveStatic(distDir, req, res, pathname);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

describe('resolveInside', () => {
  it('stays inside the folder and refuses a path that leaves it', () => {
    const root = tempDir();
    expect(resolveInside(root, '/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveInside(root, 'assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveInside(root, '/')).toBe(root);
    expect(resolveInside(root, '/../secret')).toBeNull();
    expect(resolveInside(root, '/%2e%2e/secret')).toBeNull();
    expect(resolveInside(root, '/%')).toBeNull();
    expect(resolveInside(root, '/a\\b')).toBeNull();
    expect(resolveInside(root, '/C:/windows')).toBeNull();
    expect(resolveInside(root, '/bad\0name')).toBeNull();
  });

  it('allows a step up that comes back inside, and refuses a null byte written as a percent', () => {
    const root = tempDir();
    expect(resolveInside(root, '/foo/../index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveInside(root, '/foo/../../secret')).toBeNull();
    expect(resolveInside(root, '/%00name')).toBeNull();
    expect(resolveInside(root, '/note:1')).toBeNull();
  });

  it('keeps an empty path and a once-decoded name inside the folder', () => {
    const root = tempDir();
    expect(resolveInside(root, '')).toBe(root);
    expect(resolveInside(root, '/%252e%252e/secret')).toBe(path.join(root, '%2e%2e', 'secret'));
    expect(resolveInside(root, '/file%20name.txt')).toBe(path.join(root, 'file name.txt'));
  });
});

describe('serveStatic', () => {
  it('says the page has not been built, and refuses a method that is not GET', async () => {
    const dist = tempDir();
    const server = await listen(dist);
    try {
      const home = await fetch(server.base + '/');
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(home.headers.get('cache-control')).toBe('no-store');
      expect(await home.text()).toContain('The page has not been built yet.');

      const missing = await fetch(server.base + '/app.js');
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('The page has not been built yet.');

      const head = await fetch(server.base + '/', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
      expect(await head.text()).toBe('');

      const posted = await fetch(server.base + '/', { method: 'POST' });
      expect(posted.status).toBe(405);
      expect(await posted.text()).toBe('This address only takes GET.');
    } finally {
      await server.close();
    }
  });

  it('serves a built file, the page for an address with no file ending, and a hashed file with a long cache', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), '<h1>built</h1>');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app-Abcd1234.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dist, 'notes.txt'), 'plain');
    const server = await listen(dist);
    try {
      const home = await fetch(server.base + '/');
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(home.headers.get('cache-control')).toBe('no-cache');
      expect(await home.text()).toBe('<h1>built</h1>');

      const route = await fetch(server.base + '/letters');
      expect(route.status).toBe(200);
      expect(await route.text()).toBe('<h1>built</h1>');

      const script = await fetch(server.base + '/assets/app-Abcd1234.js');
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(script.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await script.text()).toBe('console.log(1)');

      const head = await fetch(server.base + '/notes.txt', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength('plain')));
      expect(await head.text()).toBe('');

      const missing = await fetch(server.base + '/missing.js');
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe('Not found.');
    } finally {
      await server.close();
    }
  });

  it('refuses a path that leaves the built page, and a link that points outside it', async () => {
    const dist = tempDir();
    const outside = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dist, 'leak.txt'), 'file');
    const server = await listen(dist, () => '/../secret');
    try {
      const escaped = await fetch(server.base + '/');
      expect(escaped.status).toBe(403);
      expect(await escaped.text()).toBe('Not allowed.');
    } finally {
      await server.close();
    }

    const linked = await listen(dist);
    try {
      const leak = await fetch(linked.base + '/leak.txt');
      expect(leak.status).toBe(403);
      expect(await leak.text()).toBe('Not allowed.');
    } finally {
      await linked.close();
    }
  });

  it('serves a file with no known ending as raw bytes', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.writeFileSync(path.join(dist, 'blob.bin'), 'xyz');
    const server = await listen(dist);
    try {
      const blob = await fetch(server.base + '/blob.bin');
      expect(blob.status).toBe(200);
      expect(blob.headers.get('content-type')).toBe('application/octet-stream');
      expect(await blob.text()).toBe('xyz');
    } finally {
      await server.close();
    }
  });

  it('names a style sheet and a picture, keeps a long cache only for a long hash, and sends no body for HEAD on a miss', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app.Abcd1234.css'), 'body{}');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abcdefg.js'), 'short');
    fs.writeFileSync(path.join(dist, 'assets', 'mark.Abcd1234.svg'), '<svg/>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-Abcd1234.min.js'), 'min');
    fs.writeFileSync(path.join(dist, 'data.JSON'), '{}');
    fs.writeFileSync(path.join(dist, 'sheet.csv'), 'a,b');
    const server = await listen(dist);
    try {
      const css = await fetch(server.base + '/assets/app.Abcd1234.css');
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(css.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await css.text()).toBe('body{}');

      const short = await fetch(server.base + '/assets/app-abcdefg.js');
      expect(short.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(short.headers.get('cache-control')).toBe('no-cache');
      expect(await short.text()).toBe('short');

      const svg = await fetch(server.base + '/assets/mark.Abcd1234.svg');
      expect(svg.headers.get('content-type')).toBe('image/svg+xml');
      expect(svg.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

      const minned = await fetch(server.base + '/assets/app-Abcd1234.min.js');
      expect(minned.status).toBe(200);
      expect(minned.headers.get('cache-control')).toBe('no-cache');

      const json = await fetch(server.base + '/data.JSON');
      expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(json.headers.get('cache-control')).toBe('no-cache');

      const sheet = await fetch(server.base + '/sheet.csv');
      expect(sheet.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(await sheet.text()).toBe('a,b');

      const headMiss = await fetch(server.base + '/missing.css', { method: 'HEAD' });
      expect(headMiss.status).toBe(404);
      expect(headMiss.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(headMiss.headers.get('content-length')).toBe(String(Buffer.byteLength('Not found.')));
      expect(headMiss.headers.get('cache-control')).toBe('no-store');
      expect(await headMiss.text()).toBe('');
    } finally {
      await server.close();
    }
  });

  it('names a script module, a jpeg picture, a font in capitals, and a folder that looks like a script', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'app-Abcd1234.mjs'), 'export {}');
    fs.writeFileSync(path.join(dist, 'assets', 'pic-Abcd1234.jpg'), 'jpg');
    fs.writeFileSync(path.join(dist, 'assets', 'pic-Abcd1234.jpeg'), 'jpeg');
    fs.writeFileSync(path.join(dist, 'assets', 'font-Abcd1234.WOFF2'), 'font');
    fs.writeFileSync(path.join(dist, 'assets', 'codec-Abcd1234.wasm'), 'wasm');
    fs.writeFileSync(path.join(dist, 'note.pdf'), '%PDF');
    fs.mkdirSync(path.join(dist, 'fake.js'));
    const server = await listen(dist);
    try {
      const mjs = await fetch(server.base + '/assets/app-Abcd1234.mjs');
      expect(mjs.status).toBe(200);
      expect(mjs.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(mjs.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await mjs.text()).toBe('export {}');

      const jpg = await fetch(server.base + '/assets/pic-Abcd1234.jpg');
      expect(jpg.headers.get('content-type')).toBe('image/jpeg');
      expect(jpg.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

      const jpeg = await fetch(server.base + '/assets/pic-Abcd1234.jpeg');
      expect(jpeg.headers.get('content-type')).toBe('image/jpeg');
      expect(jpeg.headers.get('cache-control')).toBe('no-cache');
      expect(await jpeg.text()).toBe('jpeg');

      const font = await fetch(server.base + '/assets/font-Abcd1234.WOFF2');
      expect(font.headers.get('content-type')).toBe('font/woff2');
      expect(font.headers.get('cache-control')).toBe('no-cache');
      expect(await font.text()).toBe('font');

      const wasm = await fetch(server.base + '/assets/codec-Abcd1234.wasm');
      expect(wasm.headers.get('content-type')).toBe('application/wasm');
      expect(wasm.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

      const pdf = await fetch(server.base + '/note.pdf');
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
      expect(pdf.headers.get('cache-control')).toBe('no-cache');
      expect(await pdf.text()).toBe('%PDF');

      const folder = await fetch(server.base + '/fake.js');
      expect(folder.status).toBe(404);
      expect(await folder.text()).toBe('Not found.');
    } finally {
      await server.close();
    }

    const blocked = await listen(dist, () => '/../secret');
    try {
      const head = await fetch(blocked.base + '/', { method: 'HEAD' });
      expect(head.status).toBe(403);
      expect(head.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength('Not allowed.')));
      expect(head.headers.get('cache-control')).toBe('no-store');
      expect(await head.text()).toBe('');
    } finally {
      await blocked.close();
    }
  });

  it('names a png and a gif, keeps a long cache for a hashed web font, and counts bytes on HEAD', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.mkdirSync(path.join(dist, 'case'));
    fs.writeFileSync(path.join(dist, 'assets', 'mark-Abcd1234.png'), 'png');
    fs.writeFileSync(path.join(dist, 'assets', 'mark.gif'), 'gif');
    fs.writeFileSync(path.join(dist, 'assets', 'font-Abcd1234.woff'), 'woff');
    fs.writeFileSync(path.join(dist, 'assets', 'app-Abcd1234.js.map'), '{}');
    const mark = Buffer.from('é', 'utf8');
    fs.writeFileSync(path.join(dist, 'note.txt'), mark);
    const server = await listen(dist);
    try {
      const png = await fetch(server.base + '/assets/mark-Abcd1234.png');
      expect(png.status).toBe(200);
      expect(png.headers.get('content-type')).toBe('image/png');
      expect(png.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await png.text()).toBe('png');

      const gif = await fetch(server.base + '/assets/mark.gif');
      expect(gif.headers.get('content-type')).toBe('image/gif');
      expect(gif.headers.get('cache-control')).toBe('no-cache');
      expect(await gif.text()).toBe('gif');

      const woff = await fetch(server.base + '/assets/font-Abcd1234.woff');
      expect(woff.headers.get('content-type')).toBe('font/woff');
      expect(woff.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await woff.text()).toBe('woff');

      const map = await fetch(server.base + '/assets/app-Abcd1234.js.map');
      expect(map.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(map.headers.get('cache-control')).toBe('no-cache');
      expect(await map.text()).toBe('{}');

      const head = await fetch(server.base + '/note.txt', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(mark.length).toBe(2);
      expect(head.headers.get('content-length')).toBe('2');
      expect(await head.text()).toBe('');

      const folder = await fetch(server.base + '/case');
      expect(folder.status).toBe(200);
      expect(await folder.text()).toBe('page');
    } finally {
      await server.close();
    }
  });

  it('names a webp picture, an icon, and a true-type font, and does not keep a long cache for them', async () => {
    const dist = tempDir();
    fs.writeFileSync(path.join(dist, 'index.html'), 'page');
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'assets', 'mark-Abcd1234.webp'), 'webp');
    fs.writeFileSync(path.join(dist, 'favicon.ico'), 'ico');
    fs.writeFileSync(path.join(dist, 'assets', 'face.TTF'), 'ttf');
    const server = await listen(dist);
    try {
      const webp = await fetch(server.base + '/assets/mark-Abcd1234.webp');
      expect(webp.status).toBe(200);
      expect(webp.headers.get('content-type')).toBe('image/webp');
      expect(webp.headers.get('cache-control')).toBe('no-cache');
      expect(await webp.text()).toBe('webp');

      const ico = await fetch(server.base + '/favicon.ico');
      expect(ico.headers.get('content-type')).toBe('image/x-icon');
      expect(ico.headers.get('cache-control')).toBe('no-cache');
      expect(await ico.text()).toBe('ico');

      const ttf = await fetch(server.base + '/assets/face.TTF');
      expect(ttf.headers.get('content-type')).toBe('font/ttf');
      expect(ttf.headers.get('cache-control')).toBe('no-cache');
      expect(await ttf.text()).toBe('ttf');
    } finally {
      await server.close();
    }
  });
});
