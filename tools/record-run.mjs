// Writes a recording the judges' view can play.
//
// Two ways:
//
//   1. A snapshot of a run that has already finished (the first version):
//        node tools/record-run.mjs [--base http://127.0.0.1:8787] [--out cases/_demo/recorded-state.json]
//      Make the run first (npm run smoke), then record while the server still runs.
//
//   2. A run recorded as it happens, from a small file of steps:
//        node tools/record-run.mjs --server http://127.0.0.1:8787 --steps <file> --out <file>
//      It starts a clean demo (POST /api/reset), asks GET /api/state twice a second, and saves a
//      frame each time the answer changes. A change of serverTime alone is not a change.
//      Every saved frame has recorded: true. The tool changes no model answer and writes no letter text.
//
// The steps file is JSON:
//   { "title": "...", "about": "...", "madeHow": "...", "waitMs": 480000,
//     "steps": [ { "step": "import", "file": "cases/_demo/positive.csv" }, { "step": "wait-bell" } ] }
//
// Step words: import, wait-bell, wait-letter, accept, bypass, accept-anyway, dismiss,
// confirm, tick, preview, sent, reply, close, clock.
// import takes "file" (a .csv, a .pdf, or one .png) or "files" (png pages).
// bypass and accept-anyway take "reason". dismiss may take "reason".
// reply takes "outcome" and may take "note". sent may take "by" ("print" or "email").
// clock takes "days" (a whole number, 0 or more). A step may take "id" to name the finding or the letter.
// Every wait uses limitMs on the step, or waitMs on the file, or 8 minutes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'clinicalantern-recorded-run-1';
const POLL_MS = 500;
const DEFAULT_WAIT_MS = 8 * 60 * 1000;
const DEFAULT_HOW = 'The local models did the screening. The recording script entered the pharmacist\'s steps.';
const STEP_WORDS = [
  'import', 'wait-bell', 'wait-letter', 'accept', 'bypass', 'accept-anyway', 'dismiss',
  'confirm', 'tick', 'preview', 'sent', 'reply', 'close', 'clock'
];
const NOTES = {
  import: 'Entered by the recording script: the history was imported.',
  accept: 'Entered by the recording script: the finding was accepted.',
  bypass: 'Entered by the recording script: the finding was bypassed.',
  'accept-anyway': 'Entered by the recording script: the disputed finding was accepted.',
  dismiss: 'Entered by the recording script: the disputed finding was dismissed.',
  confirm: 'Entered by the recording script: the rows of the scan were confirmed.',
  tick: 'Entered by the recording script: the patient was told and agrees.',
  preview: 'Entered by the recording script: the letter was previewed.',
  sent: 'Entered by the recording script: the letter was marked as sent.',
  reply: 'Entered by the recording script: the doctor\'s reply was recorded.',
  close: 'Entered by the recording script: the letter was closed.',
  clock: 'Entered by the recording script: the demo clock was moved.'
};

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};

const BASE = (option('--server', '') || option('--base', 'http://127.0.0.1:8787')).replace(/\/+$/, '');
const HOW = option('--how', 'npm run smoke');
const BY = option('--by', 'The steps of the pharmacist were made by the join test script, not by a person.');
const OUT = path.resolve(ROOT, option('--out', 'cases/_demo/recorded-state.json'));
const STEPS = option('--steps', '');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function get(route) {
  const res = await fetch(BASE + '/api' + route, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${route} answered ${res.status}`);
  return res.json();
}

async function post(route, body) {
  const res = await fetch(BASE + '/api' + route, {
    method: 'POST',
    headers: { Accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try { json = JSON.parse(text); } catch { json = {}; }
  }
  if (!res.ok) {
    const message = typeof json.error === 'string' && json.error.trim() !== ''
      ? json.error
      : `POST ${route} answered ${res.status}`;
    throw new Error(message);
  }
  return json;
}

async function recordSnapshot() {
  const [snap, criteria, health] = await Promise.all([get('/state'), get('/criteria'), get('/health')]);
  if (snap.recorded) throw new Error('This server plays a recording itself. Record from a live run.');
  const state = snap.state;
  if (state.jobs.some(j => j.status === 'queued' || j.status === 'running')) {
    throw new Error('The server is still working. Wait until the status line says Idle, then record.');
  }
  if (state.cases.length === 0) throw new Error('There is nothing to record: no history was imported.');
  if (!state.cases.every(c => /fictional/i.test(c.patient.label))) throw new Error('A patient label does not say "fictional". Nothing was written.');

  const times = state.activity.map(a => Date.parse(a.at)).filter(Number.isFinite);
  const day = new Date(Math.min(...times)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const recording = {
    note: `A real run on the entrant's computer on ${day}, with the three local models through Ollama ${health.version ?? ''}`.trim() +
      `. ${BY} Fictional patient. No real person.`,
    how: HOW,
    recordedAt: snap.serverTime,
    models: health.names,
    criteria,
    state
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(recording, null, 1) + '\n');
  console.log(`Written: ${path.relative(ROOT, OUT)}`);
  console.log(`${state.cases.length} histories, ${state.findings.length} findings, ${state.letters.length} letters, ${state.activity.length} steps in the activity log.`);
  console.log('Next: npm run build:replay');
}

function signature(snap) {
  const copy = structuredClone(snap);
  delete copy.serverTime;
  return JSON.stringify(copy);
}

function findStepsFile(file) {
  const fromRoot = path.resolve(ROOT, file);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const fromCwd = path.resolve(process.cwd(), file);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fromRoot;
}

function readSteps(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`The steps file could not be read: ${file}`);
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) {
    throw new Error('The steps file must hold a title, an about line, and a list of steps.');
  }
  if (typeof raw.title !== 'string' || raw.title.trim() === '' || typeof raw.about !== 'string' || raw.about.trim() === '') {
    throw new Error('The steps file must hold a title and one sentence about the run.');
  }
  for (const step of raw.steps) {
    const name = step && typeof step.step === 'string' ? step.step : '';
    if (!STEP_WORDS.includes(name)) {
      throw new Error(`The steps file names a step this tool does not take: ${name || '(missing)'}.`);
    }
  }
  return raw;
}

function limitMs(file, step) {
  const n = step.limitMs ?? file.waitMs ?? DEFAULT_WAIT_MS;
  if (!Number.isFinite(n) || n <= 0) throw new Error('A wait needs a time limit greater than zero.');
  return n;
}

function casesOf(snap) {
  return Array.isArray(snap?.state?.cases) ? snap.state.cases : [];
}

function findingsOf(snap) {
  return Array.isArray(snap?.state?.findings) ? snap.state.findings : [];
}

function lettersOf(snap) {
  return Array.isArray(snap?.state?.letters) ? snap.state.letters : [];
}

function assertFictional(frames) {
  for (const frame of frames) {
    for (const row of casesOf(frame.response)) {
      const label = row?.patient?.label ?? '';
      if (!/fictional/i.test(String(label))) {
        throw new Error('A patient label does not say "fictional". Nothing was written.');
      }
    }
  }
}

class Recorder {
  constructor() {
    this.frames = [];
    this.lastSig = null;
    this.lastAt = 0;
    this.pendingNote = '';
  }

  async poll() {
    const snap = await get('/state');
    const sig = signature(snap);
    if (sig === this.lastSig) return snap;
    const now = Date.now();
    const response = structuredClone(snap);
    response.recorded = true;
    this.frames.push({
      afterMs: this.frames.length === 0 ? 0 : Math.max(0, now - this.lastAt),
      note: this.pendingNote,
      response
    });
    this.pendingNote = '';
    this.lastSig = sig;
    this.lastAt = now;
    return snap;
  }

  async waitUntil(ready, ms, what) {
    const deadline = Date.now() + ms;
    while (true) {
      const snap = await this.poll();
      if (ready(snap)) return snap;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${what} was not reached within ${Math.round(ms / 1000)} seconds.`);
      await sleep(Math.min(POLL_MS, left));
    }
  }

  async act(note, route, body) {
    this.pendingNote = note;
    await post(route, body);
    await this.poll();
  }
}

function bellFinding(snap, id) {
  const list = findingsOf(snap).filter(f => f.state === 'confirmed' && f.decision === undefined);
  const found = id ? list.find(f => f.id === id) : list[0];
  if (!found) throw new Error(id ? `Finding ${id} is not at the bell.` : 'No finding is at the bell.');
  return found;
}

function disputedFinding(snap, id) {
  const list = findingsOf(snap).filter(f => f.state === 'not_confirmed' && f.decision === undefined);
  const found = id ? list.find(f => f.id === id) : list[0];
  if (!found) throw new Error(id ? `Finding ${id} is not a disputed finding.` : 'No disputed finding is waiting.');
  return found;
}

function letterFor(snap, id, ok, missing) {
  if (id) {
    const found = lettersOf(snap).find(l => l.id === id);
    if (!found) throw new Error(`Letter ${id} is not in the state.`);
    return found;
  }
  const found = lettersOf(snap).find(ok);
  if (!found) throw new Error(missing);
  return found;
}

async function importBody(step) {
  const listed = Array.isArray(step.files) ? step.files : Array.isArray(step.file) ? step.file : step.file ? [step.file] : [];
  if (listed.length === 0) throw new Error('The import step needs a file.');
  const files = listed.map(file => {
    const found = findStepsFile(String(file));
    if (!fs.existsSync(found)) throw new Error(`The import step cannot find ${file}.`);
    return found;
  });
  const { bodyFor } = await import('./import-file.ts');
  return bodyFor(files);
}

async function runStep(rec, file, step) {
  const word = step.step;
  if (word === 'wait-bell') {
    await rec.waitUntil(
      snap => findingsOf(snap).some(f => f.state === 'confirmed'),
      limitMs(file, step),
      'A finding at the bell'
    );
    return;
  }
  if (word === 'wait-letter') {
    await rec.waitUntil(
      snap => lettersOf(snap).some(l => l.status === 'ready' && (!step.id || l.id === step.id)),
      limitMs(file, step),
      'A letter that is ready'
    );
    return;
  }
  if (word === 'import') {
    const body = await importBody(step);
    await rec.act(NOTES.import, '/cases', body);
    return;
  }
  if (word === 'confirm') {
    const snap = await rec.waitUntil(current => {
      const row = casesOf(current).find(c =>
        c.source === 'pdf-image' && !c.transcriptionConfirmed && (!step.id || c.id === step.id));
      if (!row) return false;
      const reading = Array.isArray(current.state?.jobs) && current.state.jobs.some(job =>
        job.caseId === row.id && (job.status === 'queued' || job.status === 'running'));
      const rowsReady = Array.isArray(step.rows) || (Array.isArray(row.lines) && row.lines.length > 0);
      return !reading && rowsReady;
    }, limitMs(file, step), 'The rows of the scan');
    const row = casesOf(snap).find(c => c.source === 'pdf-image' && !c.transcriptionConfirmed && (!step.id || c.id === step.id));
    const rows = Array.isArray(step.rows) ? step.rows : row.lines.map(line => line.text);
    await rec.act(NOTES.confirm, `/cases/${row.id}/confirm-transcription`, { rows });
    return;
  }

  const snap = await rec.poll();
  if (word === 'accept') {
    const finding = bellFinding(snap, step.id);
    await rec.act(NOTES.accept, `/findings/${finding.id}/decision`, { action: 'accept' });
    return;
  }
  if (word === 'bypass') {
    if (typeof step.reason !== 'string' || step.reason.trim() === '') throw new Error('The bypass step needs a short reason.');
    const finding = bellFinding(snap, step.id);
    await rec.act(NOTES.bypass, `/findings/${finding.id}/decision`, { action: 'bypass', reason: step.reason });
    return;
  }
  if (word === 'accept-anyway') {
    if (typeof step.reason !== 'string' || step.reason.trim() === '') throw new Error('The accept-anyway step needs a short reason.');
    const finding = disputedFinding(snap, step.id);
    await rec.act(NOTES['accept-anyway'], `/findings/${finding.id}/decision`, { action: 'accept', reason: step.reason });
    return;
  }
  if (word === 'dismiss') {
    const finding = disputedFinding(snap, step.id);
    const body = { action: 'dismiss' };
    if (typeof step.reason === 'string' && step.reason.trim() !== '') body.reason = step.reason;
    await rec.act(NOTES.dismiss, `/findings/${finding.id}/decision`, body);
    return;
  }
  if (word === 'tick' || word === 'preview') {
    const letter = letterFor(snap, step.id, l => l.status === 'ready', 'No letter is ready for this step.');
    if (word === 'tick') await rec.act(NOTES.tick, `/letters/${letter.id}/agree`, { agreed: true });
    else await rec.act(NOTES.preview, `/letters/${letter.id}/preview`, {});
    return;
  }
  if (word === 'sent') {
    const letter = letterFor(snap, step.id, l => l.status === 'ready', 'No letter is ready to mark as sent.');
    const by = step.by ?? 'print';
    if (by !== 'print' && by !== 'email') throw new Error('The sent step must say "print" or "email".');
    const previewToken = typeof letter.previewHash === 'string' ? letter.previewHash : '';
    await rec.act(NOTES.sent, `/letters/${letter.id}/sent`, previewToken ? { by, previewToken } : { by });
    return;
  }
  if (word === 'reply') {
    if (typeof step.outcome !== 'string' || step.outcome.trim() === '') throw new Error('The reply step needs an outcome.');
    const letter = letterFor(snap, step.id, l => l.status === 'sent' || l.status === 'reply_recorded', 'No sent letter is waiting for a reply.');
    const body = { outcome: step.outcome };
    if (typeof step.note === 'string') body.note = step.note;
    await rec.act(NOTES.reply, `/letters/${letter.id}/reply`, body);
    return;
  }
  if (word === 'close') {
    const letter = letterFor(snap, step.id, l => l.status === 'sent' || l.status === 'reply_recorded' || l.status === 'closed', 'No letter is ready to close.');
    await rec.act(NOTES.close, `/letters/${letter.id}/close`, {});
    return;
  }
  if (word === 'clock') {
    if (!Number.isInteger(step.days) || step.days < 0) throw new Error('The clock step needs a whole number of days, 0 or more.');
    await rec.act(NOTES.clock, '/demo-clock', { days: step.days });
  }
}

async function recordFromSteps() {
  const outOpt = option('--out', '');
  if (!outOpt) throw new Error('Say where to write the recording with --out.');
  const outFile = path.resolve(ROOT, outOpt);
  const stepsFile = findStepsFile(STEPS);
  if (!fs.existsSync(stepsFile)) throw new Error(`The steps file could not be read: ${stepsFile}`);
  const file = readSteps(stepsFile);
  const howPassed = args.indexOf('--how') >= 0 && args[args.indexOf('--how') + 1] && !args[args.indexOf('--how') + 1].startsWith('--');
  await post('/reset', {});
  const criteria = await get('/criteria');
  if (!Array.isArray(criteria)) throw new Error('GET /criteria did not return a list.');
  const rec = new Recorder();
  await rec.poll();
  for (const step of file.steps) await runStep(rec, file, step);
  assertFictional(rec.frames);
  const recording = {
    format: FORMAT,
    title: file.title.trim(),
    about: file.about.trim(),
    recordedAt: new Date().toISOString(),
    madeHow: (howPassed ? HOW : (typeof file.madeHow === 'string' && file.madeHow.trim() !== '' ? file.madeHow.trim() : DEFAULT_HOW)),
    criteria,
    frames: rec.frames
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(recording, null, 1) + '\n');
  console.log(`Written: ${path.relative(ROOT, outFile)}`);
  console.log(`${rec.frames.length} frames.`);
}

try {
  if (STEPS) await recordFromSteps();
  else await recordSnapshot();
} catch (e) {
  console.error('The recording was not written:', e instanceof Error ? e.message : e);
  if (/fetch failed|ECONNREFUSED/i.test(String(e))) console.error(`Is the server running at ${BASE}? Start it with: npm start`);
  process.exit(1);
}
