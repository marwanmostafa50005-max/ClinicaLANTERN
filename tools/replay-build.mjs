// Builds the judges' view and copies recorded real runs beside it.
//
//   node tools/replay-build.mjs [--from eval/recorded] [--out dist-replay]
//   npm run build:replay -- --from data/recorded
//
// The page is built in Vite mode replay, with relative addresses, into the out folder.
// Every recording in the from folder is copied into <out>/recorded/, and <out>/recorded/index.json
// is written from their titles. A frame whose recorded flag is not true is refused: nothing from
// that folder is copied. A made-up sample is left out.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'clinicalantern-recorded-run-1';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const flag = name => args.includes(name);

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--from' || arg === '--out') {
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(`Say the folder after ${arg}.`);
    i += 1;
    continue;
  }
  if (arg === '--no-build') continue;
  fail(`Unknown option ${arg}.`);
}

const fromDir = path.resolve(ROOT, option('--from', 'eval/recorded'));
const outDir = path.resolve(ROOT, option('--out', 'dist-replay'));
const noBuild = flag('--no-build');

function runNode(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** A sample built for looking at the page, not a run recorded from the server. */
export function isMadeUp(data) {
  const text = `${data?.title ?? ''}\n${data?.about ?? ''}\n${data?.madeHow ?? ''}`;
  return /made[\s-]?up/i.test(text) || /nothing was recorded from a live run/i.test(text);
}

export function recordingError(data, name) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT) {
    return `${name} is not a recorded run this build can copy.`;
  }
  if (typeof data.title !== 'string' || data.title.trim() === '') return `${name} has no title.`;
  if (!Array.isArray(data.frames) || data.frames.length === 0) return `${name} has no frames.`;
  for (const frame of data.frames) {
    if (!frame || typeof frame !== 'object' || !frame.response || frame.response.recorded !== true) {
      return `${name} has a frame that is not marked as a recorded run.`;
    }
  }
  return '';
}

export function recordingsIn(folder) {
  if (!fs.existsSync(folder)) return { runs: [], skipped: [], errors: [], missing: true };
  const names = fs.readdirSync(folder)
    .filter(name => name.endsWith('.json') && name !== 'index.json')
    .sort((a, b) => a.localeCompare(b));
  const runs = [];
  const skipped = [];
  const errors = [];
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    } catch {
      errors.push(`${name} could not be read.`);
      continue;
    }
    if (isMadeUp(data)) {
      skipped.push(name);
      continue;
    }
    const error = recordingError(data, name);
    if (error) errors.push(error);
    else runs.push({ name, data });
  }
  return { runs, skipped, errors, missing: false };
}

export function writeRecorded(runs, folder) {
  const dest = path.join(folder, 'recorded');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(dest)) {
    if (name.endsWith('.json')) fs.rmSync(path.join(dest, name));
  }
  const index = { runs: [] };
  for (const run of runs) {
    const base = path.basename(run.name);
    const safe = base === run.name && !base.includes('..') ? base : '';
    if (!safe.endsWith('.json')) {
      throw new Error(`${run.name} is not a recording file name this build can copy.`);
    }
    fs.writeFileSync(path.join(dest, safe), JSON.stringify(run.data, null, 1) + '\n');
    index.runs.push({
      file: safe,
      title: String(run.data.title).trim(),
      about: typeof run.data.about === 'string' ? run.data.about.trim() : ''
    });
  }
  fs.writeFileSync(path.join(dest, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}

function buildPage() {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  runNode(tsc, ['--noEmit']);
  runNode(vite, ['build', '--mode', 'replay', '--outDir', outDir, '--base', './']);
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  if (!noBuild) buildPage();
  const found = recordingsIn(fromDir);
  if (found.missing) console.log(`No recordings in ${fromDir}.`);
  if (found.errors.length > 0) fail(found.errors.join('\n'));
  for (const name of found.skipped) console.log(`Left out (made up): ${name}`);
  const index = writeRecorded(found.runs, outDir);
  console.log(`Recorded runs copied: ${index.runs.length}.`);
  console.log(`Index: ${path.join(outDir, 'recorded', 'index.json')}`);
}
