// Serves the built page from dist/ when it exists. Only files inside dist/ can be reached.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.csv': 'text/csv; charset=utf-8'
};

const NOT_BUILT =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>ClinicaLANTERN</title>' +
  '<body style="font-family:Segoe UI,Arial,sans-serif;margin:40px;color:#14233b">' +
  '<h1>ClinicaLANTERN</h1><p>The local server is running. The page has not been built yet.</p>' +
  '<p>Run <code>npm run build</code> and then <code>npm start</code>, or use <code>npm run dev</code>.</p></body></html>';

function sendText(res: ServerResponse, status: number, type: string, text: string, head: boolean): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(head ? undefined : text);
}

/**
 * Works out which file inside distDir a request path points at.
 * Returns null when the path is not allowed: it leaves distDir, or carries characters a file path must not have.
 */
export function resolveInside(distDir: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return null;
  const root = path.resolve(distDir);
  const target = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Answers a request for the page or one of its files. */
export function serveStatic(distDir: string, req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const method = (req.method ?? 'GET').toUpperCase();
  const head = method === 'HEAD';
  if (method !== 'GET' && !head) {
    sendText(res, 405, 'text/plain; charset=utf-8', 'This address only takes GET.', false);
    return;
  }
  const index = path.join(distDir, 'index.html');
  if (!isFile(index)) {
    sendText(res, pathname === '/' ? 200 : 404, 'text/html; charset=utf-8', NOT_BUILT, head);
    return;
  }
  const target = resolveInside(distDir, pathname);
  if (target === null) {
    sendText(res, 403, 'text/plain; charset=utf-8', 'Not allowed.', head);
    return;
  }
  let file = target;
  if (!isFile(file)) {
    // An address without a file ending is the page itself. A missing file with an ending is a 404.
    if (path.extname(target) !== '') {
      sendText(res, 404, 'text/plain; charset=utf-8', 'Not found.', head);
      return;
    }
    file = index;
  }
  // The real location must still be inside dist/ (a link inside dist/ could point elsewhere).
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    sendText(res, 404, 'text/plain; charset=utf-8', 'Not found.', head);
    return;
  }
  const realRoot = fs.realpathSync(distDir);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    sendText(res, 403, 'text/plain; charset=utf-8', 'Not allowed.', head);
    return;
  }
  const type = TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream';
  const stat = fs.statSync(real);
  const hashed = /[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg|jpg|wasm|mjs)$/.test(path.basename(real));
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  if (head) {
    res.end();
    return;
  }
  fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
}
