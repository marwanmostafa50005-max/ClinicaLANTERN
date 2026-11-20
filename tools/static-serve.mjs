// Serves one folder as files, on this computer only. Node's built-in modules, and nothing else.
// It prints every address it is asked for.
//
//   node tools/static-serve.mjs <folder> <port>
//   node tools/static-serve.mjs dist-replay 5174
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The file inside root for this address, or null when the address leaves the folder. */
export function fileFor(root, pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, rel);
  const fromRoot = path.relative(root, resolved);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null;
  return resolved;
}

export function startStaticServer(folder, port) {
  const root = path.resolve(folder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`There is no folder to serve at ${root}.`);
  }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    console.log(pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('This server only reads files.');
      return;
    }
    const target = fileFor(root, pathname);
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('This file is not in the recorded copy.');
      return;
    }
    let file = target;
    try {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('This file is not in the recorded copy.');
        return;
      }
      const body = fs.readFileSync(file);
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('This file could not be read.');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const realPort = address && typeof address === 'object' ? address.port : port;
      console.log(`http://127.0.0.1:${realPort}`);
      resolve({ server, port: realPort, root });
    });
  });
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  const [folder, portText] = process.argv.slice(2);
  if (!folder || !portText || process.argv.length > 4) fail('Usage: node tools/static-serve.mjs <folder> <port>');
  if (!/^\d+$/.test(portText)) fail('The port must be a whole number.');
  startStaticServer(folder, Number(portText)).catch(err => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
