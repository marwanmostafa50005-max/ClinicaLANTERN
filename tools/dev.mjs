// Starts the local server and the page together, for working on the app.
//   npm run dev
// The server answers on http://127.0.0.1:8787 and the page, with live reload, on http://127.0.0.1:5173.
// Ctrl+C stops both. If one of them stops by itself, the other is stopped too.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The server port. A PORT that is not a whole number is left unused, and 8787 is used. */
export function serverPort(envPort) {
  return envPort && /^\d+$/.test(envPort) ? envPort : '8787';
}

/** A child is still running when it has neither exited nor been signalled. */
export function childAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Seconds after which both are stopped, from "--stop-after <seconds>".
 * Zero means they run until Ctrl+C. A missing number, zero, or a word is zero.
 */
export function stopAfterSeconds(argv) {
  const at = argv.indexOf('--stop-after');
  if (at < 0) return 0;
  const n = Number(argv[at + 1]);
  return n > 0 ? n : 0;
}

/** Splits a stream into whole lines and keeps the unfinished tail for the next chunk. */
export function completeLines(rest, chunk) {
  const lines = (rest + chunk).split(/\r?\n/);
  return { lines, rest: lines.pop() ?? '' };
}

function main() {
  const SERVER_PORT = serverPort(process.env.PORT);
  const children = [];
  let stopping = false;

  function stopAll(code) {
    if (stopping) return;
    stopping = true;
    const waiting = children.filter(childAlive);
    if (waiting.length === 0) process.exit(code);
    let left = waiting.length;
    for (const child of waiting) {
      child.once('exit', () => {
        left -= 1;
        if (left <= 0) process.exit(code);
      });
      try {
        child.kill();
      } catch {
        // It has already gone.
      }
    }
    // Do not hang if a child will not go.
    setTimeout(() => process.exit(code), 4000).unref();
  }

  function start(name, args) {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, PORT: SERVER_PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const tag = `[${name}] `;
    const relay = (stream, out) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        const taken = completeLines(rest, chunk);
        rest = taken.rest;
        for (const line of taken.lines) out.write(tag + line + '\n');
      });
      stream.on('end', () => {
        if (rest) out.write(tag + rest + '\n');
      });
    };
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    child.on('error', e => {
      console.error(`${tag}could not start: ${e.message}`);
      stopAll(1);
    });
    child.on('exit', (code, signal) => {
      if (stopping) return;
      console.log(`${tag}stopped (${signal ?? `code ${code}`}). Stopping the other one too.`);
      stopAll(typeof code === 'number' && code !== 0 ? code : 1);
    });
    children.push(child);
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(signal, () => {
      if (!stopping) console.log('\nStopping the server and the page.');
      stopAll(0);
    });
  }

  console.log('ClinicaLANTERN, working mode. Fictional patients only.');
  console.log(`Page:   http://127.0.0.1:5173   (live reload)`);
  console.log(`Server: http://127.0.0.1:${SERVER_PORT}`);
  console.log('Press Ctrl+C to stop both.\n');

  start('server', ['server/index.ts']);
  start('page', [path.join('node_modules', 'vite', 'bin', 'vite.js')]);

  // For testing this script: "node tools/dev.mjs --stop-after 10" stops both after 10 seconds,
  // the same way Ctrl+C does.
  const seconds = stopAfterSeconds(process.argv);
  if (seconds > 0) {
    setTimeout(() => {
      console.log('\nStopping the server and the page (--stop-after).');
      stopAll(0);
    }, seconds * 1000);
  }
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) main();
