// Live proof of the engine: drives the running local server through one whole case with the real
// models, and writes down what happened with timings. Fictional patients only.
//
//   1. start the server:   npm start        (or: node server/index.ts)
//   2. run this:           node tools/proof-engine.mjs [--base http://127.0.0.1:8787] [--out result.json]
//                                                      [--scan page.png] [--no-reset]
//
// It resets the server state first (the server keeps the old state as a dated backup).
// It only talks to the local server, and asks Ollama which model is in memory (a read, not a model call).
// Importing this file does not start the proof. The proof runs only when this file is the one that was started.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The value after a named option, or the fallback when the option is missing or has no value. */
export function takeOption(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
}

/** The server address. A trailing slash is dropped. With no --base, the address is port 8787. */
export function serverBase(argv) {
  return takeOption(argv, '--base', 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

/** True unless --no-reset was given. The proof then leaves the server's saved state as it is. */
export function wantsReset(argv) {
  return !argv.includes('--no-reset');
}

const args = process.argv.slice(2);
const option = (name, fallback) => takeOption(args, name, fallback);
const BASE = serverBase(args);
const OUT = option('--out', '');
const SCAN = option('--scan', '');
const RESET = wantsReset(args);
const CRITERION = option('--criterion', 'DEMO-NSAID-ANTICOAG');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'lantern.config.json'), 'utf8').replace(/^\uFEFF/, ''));
const OLLAMA = String(config.ollamaBase || 'http://127.0.0.1:27435').replace(/\/+$/, '');

const started = performance.now();
const record = { startedAt: new Date().toISOString(), base: BASE, steps: [], timeline: [], checks: [] };
const since = () => Math.round((performance.now() - started) / 100) / 10;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function say(text) {
  console.log(`+${since().toFixed(1).padStart(6)} s  ${text}`);
}

function check(name, ok, detail = '') {
  record.checks.push({ name, ok, detail });
  say(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  return ok;
}

async function api(method, route, body) {
  const res = await fetch(BASE + '/api' + route, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function inMemory() {
  try {
    const res = await fetch(OLLAMA + '/api/ps', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return (data.models ?? []).map(m => String(m.name).replace(/:latest$/, ''));
  } catch {
    return ['(Ollama did not answer)'];
  }
}

let lastNow = '';
let lastModels = '';

/**
 * Asks the server for the state until done(answer) is true. Notes every change of the "now" line
 * and every change of the model that Ollama has in memory.
 */
async function waitFor(what, done, timeoutSeconds = 900) {
  const t0 = performance.now();
  for (;;) {
    const { json } = await api('GET', '/state');
    if (json?.now?.text && json.now.text !== lastNow) {
      lastNow = json.now.text;
      record.timeline.push({ at: since(), now: lastNow });
      say(`now: "${lastNow}"`);
    }
    const models = (await inMemory()).join(', ') || 'none (a model is being changed)';
    if (models !== lastModels) {
      lastModels = models;
      record.timeline.push({ at: since(), inMemory: models });
      say(`        model in memory: ${models}`);
    }
    if (done(json)) return { state: json, seconds: Math.round((performance.now() - t0) / 100) / 10 };
    if ((performance.now() - t0) / 1000 > timeoutSeconds) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(250);
  }
}

export const idle = s => !s.state.jobs.some(j => j.status === 'queued' || j.status === 'running');
export const caseOf = (s, id) => s.state.cases.find(c => c.id === id);
export const findingsOf = (s, id) => s.state.findings.filter(f => f.caseId === id);

function rawRequest(method, route, headers, body) {
  const url = new URL(BASE);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: route, method, headers: { host: url.host, ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  say(`ClinicaLANTERN engine proof against ${BASE}. Fictional patients only.`);

  // ----- health and criteria -----
  const health = await api('GET', '/health');
  record.health = health.json;
  check('Ollama is up and the three models are there',
    health.json?.ollama === 'up' && health.json.models.screen && health.json.models.check && health.json.models.letter,
    `Ollama ${health.json?.version ?? '?'}`);
  const criteria = await api('GET', '/criteria');
  record.criteria = Array.isArray(criteria.json) ? criteria.json.map(c => c.id) : criteria.json;
  check('the criteria in use include the demo criterion', Array.isArray(criteria.json) && criteria.json.some(c => c.id === CRITERION), String(record.criteria));

  if (RESET) {
    const reset = await api('POST', '/reset');
    record.reset = reset.json;
    check('reset starts a clean state', reset.status === 200, reset.json?.backup ? `backup ${reset.json.backup}` : 'nothing to back up');
  }

  // ----- the positive history -----
  const positiveCsv = fs.readFileSync(path.join(ROOT, 'cases', '_demo', 'positive.csv'), 'utf8');
  let t = performance.now();
  const imported = await api('POST', '/cases', { fileName: 'positive.csv', source: 'csv', csvText: positiveCsv });
  const caseId = imported.json?.caseId;
  check('POST /cases takes the positive history and queues screening', imported.status === 200 && typeof caseId === 'string', `case ${caseId}`);

  const screened = await waitFor('screening of the positive history', s => caseOf(s, caseId)?.screening.status === 'done');
  const screenSeconds = Math.round((performance.now() - t) / 100) / 10;
  const checked = await waitFor('the second check', s => idle(s) && findingsOf(s, caseId).every(f => f.state !== 'suspected'));
  const toConfirmed = Math.round((performance.now() - t) / 100) / 10;
  const positiveCase = caseOf(checked.state, caseId);
  const finding = findingsOf(checked.state, caseId).find(f => f.criterionId === CRITERION);
  record.positive = {
    caseId,
    lines: positiveCase.lines.length,
    patient: positiveCase.patient,
    criteria: positiveCase.screening.criteria,
    secondsImportToScreened: screenSeconds,
    secondsImportToConfirmed: toConfirmed,
    finding
  };
  check('Model 1 suspected the finding and Model 2 confirmed it', finding?.state === 'confirmed' && finding.check?.confirmed === true && finding.check.completed === true,
    finding ? `screen ${finding.screen.seconds} s, check ${finding.check?.seconds} s` : 'no finding');
  const celebrex = positiveCase.lines.filter(l => l.text.includes('Celebrex')).map(l => l.id);
  const cited = new Set([...(finding?.screen.lineIds ?? []), ...(finding?.check?.lineIds ?? [])]);
  check('both Celebrex lines are cited', celebrex.length === 2 && celebrex.every(id => cited.has(id)), `Celebrex is on ${celebrex.join(', ')}; cited ${[...cited].join(', ')}`);
  check('the bell badge shows the confirmed finding', checked.state.counts.bellBadge >= 1, `bellBadge ${checked.state.counts.bellBadge}`);
  void screened;

  // ----- the pharmacist decides -----
  const seen = await api('POST', `/findings/${finding.id}/seen`);
  const afterSeen = (await api('GET', '/state')).json;
  check('marking the finding as seen clears the bell badge', seen.status === 200 && afterSeen.counts.bellBadge === checked.state.counts.bellBadge - 1);
  const noReason = await api('POST', `/findings/${finding.id}/decision`, { action: 'bypass' });
  check('bypass without a reason is refused', noReason.status === 400, noReason.json?.error);

  t = performance.now();
  const accepted = await api('POST', `/findings/${finding.id}/decision`, { action: 'accept' });
  check('accept queues the letter', accepted.status === 200 && accepted.json.finding.state === 'accepted');
  const ready = await waitFor('the letter', s => idle(s) && s.state.letters.some(l => l.findingId === finding.id && l.status === 'ready'));
  const letterSeconds = Math.round((performance.now() - t) / 100) / 10;
  const letter = ready.state.state.letters.find(l => l.findingId === finding.id);
  record.letter = { id: letter.id, secondsAcceptToReady: letterSeconds, draft: letter.draft };
  check('Model 3 wrote the letter', letter.status === 'ready' && typeof letter.body === 'string' && letter.body.length > 200,
    `origin ${letter.draft.origin}, ${letter.draft.checkNotes.length} check notes, ${letter.draft.seconds} s`);
  check('the letter carries the criterion text, its credit line and the fictional-patient line',
    letter.body.includes('Fictional patient. No real person.') && criteria.json.every(c => c.id !== CRITERION || (letter.body.includes(c.statement) && letter.body.includes(c.source.credit))));
  check('the letter badge shows the ready letter', ready.state.counts.letterBadge >= 1, `letterBadge ${ready.state.counts.letterBadge}`);

  // ----- the pharmacist finishes: edit, agreement, sent, reply, close -----
  await api('POST', `/letters/${letter.id}/seen`);
  const editedBody = letter.body.replace('Dear Doctor,', 'Dear Doctor,\n\n(Edited by the pharmacist during the proof run.)');
  const edit = await api('PUT', `/letters/${letter.id}`, { subject: letter.subject, body: editedBody, expectedRevision: letter.draftRevision ?? 0 });
  check('saving an edit', edit.status === 200 && edit.json.letter.editedByPharmacist === true && edit.json.letter.body.includes('Edited by the pharmacist'));
  const agree = await api('POST', `/letters/${letter.id}/agree`);
  check('recording that the patient agrees', agree.status === 200 && Boolean(agree.json.letter.patientAgreed));
  const preview = await api('POST', `/letters/${letter.id}/preview`);
  check('a preview is recorded before the letter can be marked as sent', preview.status === 200 && typeof preview.json?.text === 'string' && preview.json.emailDraft?.to === undefined);
  const sent = await api('POST', `/letters/${letter.id}/sent`, { by: 'print', previewToken: preview.json?.previewToken });
  check('marking the letter as sent', sent.status === 200 && sent.json.letter.status === 'sent' && Boolean(sent.json.letter.dueAt), `due ${sent.json.letter?.dueAt}`);
  const lateEdit = await api('PUT', `/letters/${letter.id}`, { subject: 'x', body: 'y' });
  check('a sent letter can no longer be changed', lateEdit.status === 409, lateEdit.json?.error);
  const reply = await api('POST', `/letters/${letter.id}/reply`, { outcome: 'will_review', note: 'Proof run: the doctor will review the patient next week.' });
  check('recording the doctor\'s reply', reply.status === 200 && reply.json.letter.status === 'reply_recorded');
  const closed = await api('POST', `/letters/${letter.id}/close`);
  check('closing the letter', closed.status === 200 && closed.json.letter.status === 'closed');

  // ----- the near miss -----
  const nearCsv = fs.readFileSync(path.join(ROOT, 'cases', '_demo', 'near-miss.csv'), 'utf8');
  t = performance.now();
  const nearImported = await api('POST', '/cases', { fileName: 'near-miss.csv', source: 'csv', csvText: nearCsv });
  const nearId = nearImported.json?.caseId;
  const nearDone = await waitFor('the near miss', s => idle(s) && caseOf(s, nearId)?.screening.status === 'done' && findingsOf(s, nearId).every(f => f.state !== 'suspected'));
  const nearSeconds = Math.round((performance.now() - t) / 100) / 10;
  const nearCase = caseOf(nearDone.state, nearId);
  const nearFindings = findingsOf(nearDone.state, nearId);
  record.nearMiss = { caseId: nearId, lines: nearCase.lines.length, criteria: nearCase.screening.criteria, findings: nearFindings, seconds: nearSeconds };
  const demoRun = nearCase.screening.criteria.find(c => c.criterionId === CRITERION);
  check('the near miss ends clear', demoRun?.status === 'clear' && !nearFindings.some(f => f.criterionId === CRITERION && f.state === 'confirmed'),
    `criterion status ${demoRun?.status}, ${demoRun?.seconds} s, findings ${nearFindings.length}`);

  // ----- a scanned page (optional) -----
  if (SCAN) {
    const png = fs.readFileSync(SCAN).toString('base64');
    t = performance.now();
    const scan = await api('POST', '/cases', { fileName: path.basename(SCAN), source: 'pdf-image', pageImages: [png], patient: { label: 'Fictional patient F-001', age: 72, sex: 'F' } });
    const scanId = scan.json?.caseId;
    const read = await waitFor('Model 1 to read the scanned page', s => idle(s) && ((caseOf(s, scanId)?.lines.length ?? 0) > 0 || Boolean(caseOf(s, scanId)?.cannotAssess)), 600);
    const readSeconds = Math.round((performance.now() - t) / 100) / 10;
    const scanCase = caseOf(read.state, scanId);
    check('Model 1 read the rows of the scanned page; nothing is screened before the pharmacist confirms',
      scanCase.lines.length > 0 && scanCase.transcriptionConfirmed === false && scanCase.screening.status === 'not_started',
      `${scanCase.lines.length} rows in ${readSeconds} s${scanCase.cannotAssess ? '; cannot assess: ' + scanCase.cannotAssess : ''}`);
    t = performance.now();
    const confirm = await api('POST', `/cases/${scanId}/confirm-transcription`);
    const scanDone = await waitFor('screening of the scanned page', s => idle(s) && caseOf(s, scanId)?.screening.status === 'done' && findingsOf(s, scanId).every(f => f.state !== 'suspected'));
    const scanFinding = findingsOf(scanDone.state, scanId).find(f => f.criterionId === CRITERION);
    record.scan = {
      caseId: scanId, file: path.basename(SCAN), rows: scanCase.lines, secondsToRead: readSeconds,
      secondsConfirmToChecked: Math.round((performance.now() - t) / 100) / 10, finding: scanFinding ?? null
    };
    check('after the pharmacist confirms the rows, the scan is screened and the finding is confirmed',
      confirm.status === 200 && scanFinding?.state === 'confirmed', scanFinding ? `lines ${scanFinding.check?.lineIds.join(', ')}` : 'no finding');
  }

  // ----- the server guards -----
  const url = new URL(BASE);
  const traversal = await rawRequest('GET', '/..%2f..%2fpackage.json', {});
  check('a path that tries to leave the page folder gets nothing', !traversal.body.includes('"clinicalantern"'), `status ${traversal.status}`);
  const elsewhere = await rawRequest('POST', '/api/reset', { origin: 'https://example.com', 'content-type': 'text/plain' }, '{}');
  check('a page from another website cannot call the server', elsewhere.status === 403, `status ${elsewhere.status}`);
  const otherName = await rawRequest('GET', '/api/state', { host: 'example.com' });
  check('the server answers only to a name of this computer', otherName.status === 403, `status ${otherName.status}`);
  const huge = await fetch(BASE + '/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"fileName":"x","source":"pdf-image","pageImages":["' + 'A'.repeat(41 * 1024 * 1024) + '"]}' })
    .then(res => res.status, () => 'connection closed');
  check('a body over 40 MB is refused', huge === 413 || huge === 'connection closed', `answer: ${huge}`);
  void url;

  // ----- the end state -----
  const final = (await api('GET', '/state')).json;
  record.counts = final.counts;
  record.now = final.now;
  record.activity = final.state.activity;
  record.jobs = final.state.jobs;
  check('the counts add up', final.counts.historiesScreened >= 2 && final.counts.accepted === 1 && final.counts.lettersSent === 1 &&
    final.counts.repliesRecorded === 1 && final.counts.closed === 1 && final.counts.bellBadge === (SCAN ? 1 : 0) && final.counts.letterBadge === 0,
    JSON.stringify(final.counts));
  check('the server is idle at the end', final.now.text === 'Idle');

  record.finishedAt = new Date().toISOString();
  record.seconds = since();
  record.passed = record.checks.every(c => c.ok);
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(record, null, 1));
    say(`Written: ${OUT}`);
  }
  say(record.passed ? `ALL ${record.checks.length} CHECKS PASSED.` : `FAILED: ${record.checks.filter(c => !c.ok).map(c => c.name).join('; ')}`);
  process.exitCode = record.passed ? 0 : 1;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main().catch(e => {
    console.error('The proof run stopped with an error:', e instanceof Error ? e.message : e);
    record.error = e instanceof Error ? e.message : String(e);
    if (OUT) {
      try { fs.writeFileSync(OUT, JSON.stringify(record, null, 1)); } catch { /* nothing more to do */ }
    }
    process.exitCode = 2;
  });
}
