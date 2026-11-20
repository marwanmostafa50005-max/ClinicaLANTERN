// The join test. It drives the running local server through the whole loop with the real models,
// with the same calls and the same request bodies as the page (src/api.ts):
//   import, confirmed finding, accept, letter ready, edit, patient agreed, sent, reply, close;
//   then the near miss (it must end clear); then the same finding once more, bypassed with a reason;
//   then a long history of 310 lines whose two medicines never sit in the same part.
// Fictional patients only. No real person.
//
//   1. Start Ollama and the server first (docs/RUNNING.md):   npm start
//   2. Run:   node tools/smoke.mjs [options]
//
// Options:
//   --base <address>     the local server (default http://127.0.0.1:8787)
//   --shots <folder>     also take pictures of the real page with headless Edge while the run goes on
//                        (live-*.png). Opening the bell or a letter in a picture marks it as seen,
//                        exactly as it does for the pharmacist.
//   --out <file.json>    write what happened, with the timings
//   --criterion <id>     the criterion the demo histories are about (default DEMO-NSAID-ANTICOAG)
//   --no-reset           do not start from a clean state
//   --no-bypass          leave out the round with the bypass
//   --no-long            leave out the last round (the long history read in parts; about one and a half minutes)
//
// It resets the server state first. The server keeps the old state as a dated backup.
// It ends with code 0 when every check passed, 1 when a check failed, 2 when it could not run.
// Importing this file does not start the join test. The test runs only when this file is the one that was started.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { edgePicture, findEdge, ROOT, sleep } from './edge.mjs';
import { findingLines } from '../shared/lines.ts';
import { letterFindingIds, MIXED_WRITING_LINE, PATIENT_MODEL_LINE } from '../shared/patient-letter.ts';

/** The value after a named option. A missing value, or another option in that place, keeps the fallback. */
export function takeOption(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
}

/** The server address. A trailing slash is dropped. With no --base, the address is port 8787. */
export function serverBase(argv) {
  return takeOption(argv, '--base', 'http://127.0.0.1:8787').replace(/\/+$/, '');
}

export function wantsReset(argv) {
  return !argv.includes('--no-reset');
}

export function wantsBypass(argv) {
  return !argv.includes('--no-bypass');
}

export function wantsLong(argv) {
  return !argv.includes('--no-long');
}

const args = process.argv.slice(2);
const option = (name, fallback) => takeOption(args, name, fallback);
const BASE = serverBase(args);
const OUT = option('--out', '');
const SHOTS = option('--shots', '');
const CRITERION = option('--criterion', 'DEMO-NSAID-ANTICOAG');
const RESET = wantsReset(args);
const BYPASS = wantsBypass(args);
const LONG = wantsLong(args);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'lantern.config.json'), 'utf8').replace(/^\uFEFF/, ''));
const OLLAMA = String(config.ollamaBase || 'http://127.0.0.1:27435').replace(/\/+$/, '');
const OVERDUE_DAYS = Number.isInteger(config.overdueDays) ? config.overdueDays : 7;

const FICTIONAL_LINE = 'Fictional patient. No real person.';
export const COUNT_KEYS = [
  'historiesScreened', 'findingsConfirmed', 'accepted', 'bypassed', 'lettersReady', 'lettersSent',
  'repliesRecorded', 'closed', 'overdue', 'bellBadge', 'letterBadge'
];

const started = performance.now();
const record = {
  startedAt: new Date().toISOString(), base: BASE, criterion: CRITERION,
  checks: [], timeline: [], timings: {}, shots: [], mostModelsInMemory: 0
};
const since = () => Math.round((performance.now() - started) / 100) / 10;
const secondsFrom = t0 => Math.round((performance.now() - t0) / 100) / 10;

function say(text) {
  console.log(`+${since().toFixed(1).padStart(6)} s  ${text}`);
}

function check(name, ok, detail = '') {
  record.checks.push({ name, ok: Boolean(ok), detail });
  say(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  return Boolean(ok);
}

/** One call to the local server, sent the way the page sends it. */
async function api(method, route, body) {
  const res = await fetch(BASE + '/api' + route, {
    method,
    cache: 'no-store',
    headers: method === 'GET'
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, type: res.headers.get('content-type') ?? '' };
}

const getState = async () => (await api('GET', '/state')).json;
const idle = s => !s.state.jobs.some(j => j.status === 'queued' || j.status === 'running');
const caseOf = (s, id) => s.state.cases.find(c => c.id === id);
const findingsOf = (s, id) => s.state.findings.filter(f => f.caseId === id);
/** The one letter that holds this finding, including a later point of the same patient. */
const letterOf = (s, findingId) => s.state.letters.find(l => letterFindingIds(l).includes(findingId));

/**
 * Who the letter says drafted it. A mixed letter uses the mixed line even though the letter's
 * own draft stays "model". A template letter has no writing line.
 */
function saysWhoDrafted(letter) {
  const origins = (letter.points ?? []).map(point => point.draft?.origin);
  const model = origins.includes('model') || letter.draft?.origin === 'model';
  const template = origins.includes('template') || letter.draft?.origin === 'template';
  if (model && template) return letter.body.includes(MIXED_WRITING_LINE);
  if (model) return letter.body.includes(PATIENT_MODEL_LINE);
  return !letter.body.includes('Built from the standard letter template.');
}

// ---------- a watcher that notes the status line and the model in memory, all through the run ----------

let watching = true;
let lastNow = '';
let lastModels = '';

async function modelsInMemory() {
  try {
    const res = await fetch(OLLAMA + '/api/ps', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return (data.models ?? []).map(m => String(m.name).replace(/:latest$/, ''));
  } catch {
    return null;
  }
}

async function watch() {
  while (watching) {
    try {
      const s = await getState();
      const text = s?.now?.text;
      if (typeof text === 'string' && text !== lastNow) {
        lastNow = text;
        record.timeline.push({ at: since(), now: text, stage: s.now.stage });
        say(`        status line: "${text}"`);
      }
      const models = await modelsInMemory();
      if (models) {
        record.mostModelsInMemory = Math.max(record.mostModelsInMemory, models.length);
        const names = models.join(', ') || 'none';
        if (names !== lastModels) {
          lastModels = names;
          record.timeline.push({ at: since(), inMemory: names });
          say(`        model in memory: ${names}`);
        }
      }
    } catch {
      // The main run reports a server that stops answering.
    }
    await sleep(300);
  }
}

async function waitFor(what, done, timeoutSeconds = 900) {
  const t0 = performance.now();
  for (;;) {
    const s = await getState();
    if (s && done(s)) return s;
    if ((performance.now() - t0) / 1000 > timeoutSeconds) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(250);
  }
}

const sawStatus = pattern => record.timeline.some(t => typeof t.now === 'string' && pattern.test(t.now));

// ---------- pictures of the real page (only with --shots) ----------

const EDGE = findEdge();
const SHOT_DIR = SHOTS ? path.resolve(ROOT, SHOTS) : '';

/**
 * Takes one picture of the page with headless Edge, 1366 by 768.
 * (Edge started this way cannot be made narrower than about 500 points, so the phone-size
 * pictures are taken by tools/page-walk.mjs instead.)
 */
async function shot(name, route) {
  if (!SHOTS) return;
  if (!EDGE) {
    say(`        no picture ${name}: Microsoft Edge was not found`);
    return;
  }
  const file = path.join(SHOT_DIR, `${name}-1366x768.png`);
  const t0 = performance.now();
  const ok = await edgePicture(file, BASE + route, 1366, 768);
  record.shots.push({ name, route, file: path.relative(ROOT, file).split(path.sep).join('/'), ok, seconds: secondsFrom(t0) });
  say(`        picture ${ok ? 'taken' : 'NOT taken'}: ${path.relative(ROOT, file)}`);
}

// ---------- the run ----------

async function importCsv(fileName) {
  const csvText = fs.readFileSync(path.join(ROOT, 'cases', '_demo', fileName), 'utf8');
  // The page sends exactly this for a CSV file (src/lib/importFile.ts).
  return api('POST', '/cases', { fileName, source: 'csv', csvText });
}

async function main() {
  say(`ClinicaLANTERN join test against ${BASE}. Fictional patients only.`);

  // ----- the page and the three read calls -----
  const page = await fetch(BASE + '/', { cache: 'no-store' });
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
  check('the server serves the built page', page.status === 200 && html.includes('id="root"') && assets.length >= 2,
    `${assets.length} files named in the page`);
  let assetsOk = assets.length > 0;
  for (const a of assets) {
    const res = await fetch(BASE + a);
    const type = res.headers.get('content-type') ?? '';
    await res.arrayBuffer();
    if (res.status !== 200 || !(a.endsWith('.css') ? type.startsWith('text/css') : type.startsWith('text/javascript'))) assetsOk = false;
  }
  check('the page script and style are served with the right type', assetsOk, assets.join(', '));

  const health = await api('GET', '/health');
  record.health = health.json;
  check('GET /api/health: Ollama is up and the three models are there',
    health.status === 200 && health.json?.ollama === 'up' && health.json.models?.screen && health.json.models?.check && health.json.models?.letter,
    `Ollama ${health.json?.version ?? '?'}: ${Object.values(health.json?.names ?? {}).join(', ')}`);

  const criteriaAnswer = await api('GET', '/criteria');
  const criteria = Array.isArray(criteriaAnswer.json) ? criteriaAnswer.json : [];
  record.criteria = criteria.map(c => c.id);
  const criterion = criteria.find(c => c.id === CRITERION);
  check('GET /api/criteria: a list that holds the demo criterion', criteriaAnswer.status === 200 && Boolean(criterion),
    `in use: ${record.criteria.join(', ') || 'none'}`);
  if (!criterion) {
    throw new Error(
      `The criterion ${CRITERION} is not in use. Start the server with the demo list: ` +
      'set LANTERN_ACTIVE_FILE to cases/_demo/active.json, then npm start. See docs/RUNNING.md.');
  }
  const text = v => typeof v === 'string' && v.trim() !== '';
  check('every criterion carries what the page shows: label, title, statement, credit line, what cannot be seen',
    criteria.every(c => text(c.id) && text(c.label) && text(c.title) && text(c.statement) && text(c.source?.credit) && text(c.cannot_be_seen) &&
      (c.signed_by_clinical_reviewer === null || text(c.signed_by_clinical_reviewer?.name))));

  if (RESET) {
    const reset = await api('POST', '/reset');
    record.reset = reset.json;
    check('POST /api/reset starts a clean state', reset.status === 200 && reset.json?.ok === true,
      reset.json?.backup ? `the old state was kept as ${reset.json.backup}` : 'there was nothing to keep');
    const clean = await getState();
    check('the clean state is empty, all counts are 0 and the status line says Idle',
      clean.state.version === 1 && clean.state.cases.length === 0 && clean.state.findings.length === 0 && clean.state.letters.length === 0 &&
      COUNT_KEYS.every(k => clean.counts[k] === 0) && Object.keys(clean.counts).length === COUNT_KEYS.length &&
      clean.now.text === 'Idle' && clean.now.stage === null && clean.recorded === false && text(clean.serverTime),
      JSON.stringify(clean.counts));
  }
  const before = (await getState()).counts;
  void watch();

  // ----- the positive history: import, Model 1, Model 2 -----
  let t = performance.now();
  const imported = await importCsv('positive.csv');
  const caseId = imported.json?.caseId;
  check('POST /api/cases takes positive.csv and answers with the case ID', imported.status === 200 && /^C\d{4}$/.test(caseId ?? ''), `case ${caseId}`);
  const fresh = caseOf(await getState(), caseId);
  check('the imported case has the shape the page reads',
    fresh && fresh.fileName === 'positive.csv' && fresh.source === 'csv' && fresh.transcriptionConfirmed === true && fresh.parts === 1 &&
    fresh.patient.label === 'Fictional patient F-001' && fresh.patient.age === 72 && fresh.lines.length === 45 &&
    fresh.lines[0].id === 'L001' && fresh.lines[44].id === 'L045' && !fresh.cannotAssess &&
    fresh.screening.criteria.length === criteria.length && text(fresh.importedAt),
    fresh ? `${fresh.patient.label}, ${fresh.lines.length} lines, ${fresh.screening.criteria.length} criteria to screen` : 'case not found');
  check('a line reads as SPEC section 6 says',
    fresh?.lines[35]?.text === '2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample',
    fresh?.lines[35]?.text ?? '');

  await waitFor('Model 1 to start', s => s.now.stage === 'screen' || caseOf(s, caseId)?.screening.status === 'done');
  await shot('live-01-model-1-screening', '/');
  await waitFor('screening of the positive history', s => caseOf(s, caseId)?.screening.status === 'done');
  record.timings.positiveImportToScreened = secondsFrom(t);
  await waitFor('Model 2 to start', s => s.now.stage === 'check' || findingsOf(s, caseId).every(f => f.state !== 'suspected'));
  await shot('live-02-model-2-checking', '/');
  const checked = await waitFor('the second check', s => idle(s) && findingsOf(s, caseId).every(f => f.state !== 'suspected'));
  record.timings.positiveImportToConfirmed = secondsFrom(t);

  const positiveCase = caseOf(checked, caseId);
  const finding = findingsOf(checked, caseId).find(f => f.criterionId === CRITERION);
  record.positive = { caseId, criteria: positiveCase.screening.criteria, finding };
  check('the status line said what Mantle was doing', sawStatus(/^Mantle is screening: criterion \d+ of \d+/),
    record.timeline.filter(x => x.stage === 'screen').map(x => x.now).join(' / '));
  check('the status line said what Lumen was doing', sawStatus(/^Lumen is double-checking \d+ findings?$/),
    record.timeline.filter(x => x.stage === 'check').map(x => x.now).join(' / '));
  check('Model 1 suspected the finding and Model 2 confirmed it',
    finding?.state === 'confirmed' && finding.check?.confirmed === true && finding.check.completed === true && finding.seenByPharmacist === false,
    finding ? `Model 1 ${finding.screen.seconds} s, Model 2 ${finding.check?.seconds} s` : 'no finding');
  if (!finding) throw new Error('The planted finding did not reach the bell. The run stops here.');
  record.timings.screenSeconds = finding.screen.seconds;
  record.timings.checkSeconds = finding.check?.seconds;
  const celebrex = positiveCase.lines.filter(l => l.text.includes('Celebrex')).map(l => l.id);
  // The page shows the lines of both models, by the one rule the letter and the scorer use too (shared/lines.ts).
  const shownOnThePage = findingLines(finding).all;
  check('the lines the bell panel will highlight hold both Celebrex supplies',
    celebrex.length === 2 && celebrex.every(id => shownOnThePage.includes(id)) && shownOnThePage.every(id => positiveCase.lines.some(l => l.id === id)),
    `Celebrex is on ${celebrex.join(', ')}; highlighted ${shownOnThePage.join(', ')}`);
  check('Model 2 said what matches and what cannot be seen', text(finding.check?.whatMatches) && text(finding.check?.whatCannotBeSeen),
    finding.check?.whatMatches ?? '');
  check('the counts and the bell badge show the confirmed finding',
    checked.counts.historiesScreened === before.historiesScreened + 1 && checked.counts.findingsConfirmed === before.findingsConfirmed + 1 &&
    checked.counts.bellBadge === before.bellBadge + 1, JSON.stringify(checked.counts));

  // ----- the pharmacist looks and decides -----
  await shot('live-03-bell-badge', '/');
  await shot('live-04-bell-panel', '/?panel=bell');
  if (SHOTS && EDGE) {
    const afterPicture = await getState();
    check('opening the bell panel on the real page cleared the bell badge', afterPicture.counts.bellBadge === before.bellBadge,
      `bellBadge ${afterPicture.counts.bellBadge}`);
  }
  const seen = await api('POST', `/findings/${finding.id}/seen`);
  const afterSeen = await getState();
  check('POST /api/findings/:id/seen clears the bell badge', seen.status === 200 && seen.json?.finding?.seenByPharmacist === true &&
    afterSeen.counts.bellBadge === before.bellBadge, `bellBadge ${afterSeen.counts.bellBadge}`);
  const noReason = await api('POST', `/findings/${finding.id}/decision`, { action: 'bypass' });
  check('a bypass without a reason is refused in plain words', noReason.status === 400 && text(noReason.json?.error), noReason.json?.error ?? '');

  t = performance.now();
  const accepted = await api('POST', `/findings/${finding.id}/decision`, { action: 'accept' });
  check('POST /api/findings/:id/decision accept: the finding is accepted and a letter is queued',
    accepted.status === 200 && accepted.json?.finding?.state === 'accepted' && accepted.json.finding.decision?.action === 'accept');
  const drafting = await getState();
  const draftingLetter = letterOf(drafting, finding.id);
  check('the letter shows at once as being written', draftingLetter && (draftingLetter.status === 'drafting' || draftingLetter.status === 'ready') &&
    drafting.counts.accepted === before.accepted + 1, `letter ${draftingLetter?.id} is ${draftingLetter?.status}`);
  await waitFor('Model 3 to start', s => s.now.stage === 'letter' || letterOf(s, finding.id)?.status === 'ready');
  await shot('live-05-model-3-writing', '/');
  // Screening has already finished, so every confirmed finding of this patient is known.
  // A second one joins the same letter. The demo history has only one, and the run says so.
  let other = null;
  if (draftingLetter) {
    const waiting = findingsOf(drafting, caseId).find(f => f.id !== finding.id && f.state === 'confirmed');
    if (waiting) {
      const again = await api('POST', `/findings/${waiting.id}/decision`, { action: 'accept' });
      const joinedNow = letterOf(await getState(), waiting.id);
      const joined = again.status === 200 && again.json?.finding?.state === 'accepted' && joinedNow?.id === draftingLetter.id;
      check('a second accept on the same patient joins the one letter', joined, waiting.id);
      if (joined) other = waiting;
    } else {
      check('this history had one confirmed finding, so the letter stays one point', true, `case ${caseId}`);
    }
  }
  const ready = await waitFor('the letter', s => {
    if (!idle(s)) return false;
    const held = letterOf(s, finding.id);
    if (!held || held.status !== 'ready') return false;
    if (other && !(letterFindingIds(held).includes(other.id) && letterFindingIds(held).length === 2)) return false;
    return true;
  });
  record.timings.acceptToLetterReady = secondsFrom(t);
  let letter = letterOf(ready, finding.id);
  record.letter = { id: letter.id, subject: letter.subject, draft: letter.draft };
  record.timings.letterSeconds = letter.draft?.seconds;
  check('the status line said what Ogee was doing', sawStatus(/^Ogee is writing \d+ letters?$/),
    record.timeline.filter(x => x.stage === 'letter').map(x => x.now).join(' / '));
  check('Model 3 wrote the letter', letter.status === 'ready' && text(letter.subject) && letter.body.length > 400 && letter.body === letter.draft?.body &&
    letter.editedByPharmacist === false && letter.seenByPharmacist === false,
    `origin ${letter.draft?.origin}, ${letter.draft?.checkNotes.length} check notes, ${letter.draft?.seconds} s`);
  check('the letter carries the criterion text, its credit line, the cited lines and the fictional-patient line',
    letter.body.includes(FICTIONAL_LINE) && letter.body.includes(criterion.statement) && letter.body.includes(criterion.source.credit) &&
    positiveCase.lines.filter(l => celebrex.includes(l.id)).every(l => letter.body.includes(l.text)));
  check('the letter says who drafted it', saysWhoDrafted(letter),
    `origin ${letter.draft?.origin}, points ${(letter.points ?? []).map(point => point.draft?.origin).join(', ') || 'one'}`);
  const pointCount = letterFindingIds(letter).length;
  check('the counts and the letter badge show the one ready letter', ready.counts.lettersReady === before.lettersReady + 1 &&
    ready.counts.letterBadge === before.letterBadge + 1 && pointCount === (other ? 2 : 1),
    `${pointCount} ${pointCount === 1 ? 'point' : 'points'}, ${JSON.stringify(ready.counts)}`);

  // ----- the pharmacist finishes: seen, edit, agreement, sent, reply, close -----
  await shot('live-06-letter-badge', '/');
  await shot('live-07-letter-panel', '/?panel=letter');
  if (SHOTS && EDGE) {
    const afterPicture = await getState();
    check('opening the letter on the real page cleared the letter badge', afterPicture.counts.letterBadge === before.letterBadge,
      `letterBadge ${afterPicture.counts.letterBadge}`);
  }
  const letterSeen = await api('POST', `/letters/${letter.id}/seen`);
  check('POST /api/letters/:id/seen clears the letter badge', letterSeen.status === 200 && (await getState()).counts.letterBadge === before.letterBadge);

  const editedBody = letter.body.replace('Dear Doctor,', 'Dear Doctor,\n\n(Edited by the pharmacist during the join test.)');
  const edit = await api('PUT', `/letters/${letter.id}`, { subject: letter.subject, body: editedBody, expectedRevision: letter.draftRevision ?? 0 });
  check('PUT /api/letters/:id saves the pharmacist\'s edit', edit.status === 200 && edit.json?.letter?.editedByPharmacist === true &&
    edit.json.letter.body === editedBody && edit.json.letter.draft?.body === letter.body);
  const agree = await api('POST', `/letters/${letter.id}/agree`, { agreed: true });
  const unagree = await api('POST', `/letters/${letter.id}/agree`, { agreed: false });
  const agreeAgain = await api('POST', `/letters/${letter.id}/agree`, { agreed: true });
  check('POST /api/letters/:id/agree: the tick can be set, taken away and set again',
    agree.status === 200 && text(agree.json?.letter?.patientAgreed?.at) && unagree.status === 200 && unagree.json?.letter?.patientAgreed === undefined &&
    agreeAgain.status === 200 && text(agreeAgain.json?.letter?.patientAgreed?.at));
  const preview = await api('POST', `/letters/${letter.id}/preview`);
  check('POST /api/letters/:id/preview shows the letter as it will leave', preview.status === 200 && preview.json?.text === preview.json?.letter?.body &&
    typeof preview.json?.previewedAt === 'string' && preview.json?.emailDraft?.text && preview.json.emailDraft.to === undefined);
  const sent = await api('POST', `/letters/${letter.id}/sent`, { by: 'print', previewToken: preview.json?.previewToken });
  const due = Date.parse(sent.json?.letter?.dueAt) - Date.parse(sent.json?.letter?.sentAt);
  check('POST /api/letters/:id/sent: the letter is sent and a reply is due', sent.status === 200 && sent.json?.letter?.status === 'sent' &&
    sent.json.letter.sentBy === 'print' && due === OVERDUE_DAYS * 24 * 60 * 60 * 1000, `reply due in ${OVERDUE_DAYS} days: ${sent.json?.letter?.dueAt}`);
  const lateEdit = await api('PUT', `/letters/${letter.id}`, { subject: 'x', body: 'y' });
  check('a sent letter can no longer be changed', lateEdit.status === 409 && text(lateEdit.json?.error), lateEdit.json?.error ?? '');
  await shot('live-08-letter-sent', '/?panel=letter');
  const reply = await api('POST', `/letters/${letter.id}/reply`, { outcome: 'will_review', note: 'Join test: the practice rang. The doctor will review the patient next week.' });
  check('POST /api/letters/:id/reply records the doctor\'s answer', reply.status === 200 && reply.json?.letter?.status === 'reply_recorded' &&
    reply.json.letter.reply?.outcome === 'will_review' && text(reply.json.letter.reply.note));
  const closed = await api('POST', `/letters/${letter.id}/close`);
  check('POST /api/letters/:id/close closes the case', closed.status === 200 && closed.json?.letter?.status === 'closed' && text(closed.json.letter.closedAt));
  const afterLoop = await getState();
  check('the counts show the closed loop', afterLoop.counts.lettersSent === before.lettersSent + 1 && afterLoop.counts.repliesRecorded === before.repliesRecorded + 1 &&
    afterLoop.counts.closed === before.closed + 1 && afterLoop.counts.lettersReady === before.lettersReady && afterLoop.counts.overdue === before.overdue,
    JSON.stringify(afterLoop.counts));
  await shot('live-09-letter-closed', '/?panel=letter');

  // ----- the near miss: it must end clear -----
  t = performance.now();
  const nearImported = await importCsv('near-miss.csv');
  const nearId = nearImported.json?.caseId;
  const nearDone = await waitFor('the near miss', s => idle(s) && caseOf(s, nearId)?.screening.status === 'done' && findingsOf(s, nearId).every(f => f.state !== 'suspected'));
  record.timings.nearMissImportToDone = secondsFrom(t);
  const nearCase = caseOf(nearDone, nearId);
  const nearFindings = findingsOf(nearDone, nearId);
  const nearRun = nearCase.screening.criteria.find(c => c.criterionId === CRITERION);
  record.nearMiss = { caseId: nearId, lines: nearCase.lines.length, criteria: nearCase.screening.criteria, findings: nearFindings };
  record.timings.nearMissScreenSeconds = nearRun?.seconds;
  check('the near miss ends clear: nothing reaches the bell', nearImported.status === 200 && nearRun?.status === 'clear' &&
    !nearFindings.some(f => f.state === 'confirmed') && nearDone.counts.bellBadge === before.bellBadge &&
    nearDone.counts.findingsConfirmed === before.findingsConfirmed + 1 && nearDone.counts.historiesScreened === before.historiesScreened + 2,
    `criterion ${nearRun?.status} in ${nearRun?.seconds} s, findings for this history: ${nearFindings.length}`);

  // ----- the same finding once more: bypassed with a reason -----
  if (BYPASS) {
    t = performance.now();
    const again = await importCsv('positive.csv');
    const againId = again.json?.caseId;
    const againDone = await waitFor('the second positive history', s => idle(s) && caseOf(s, againId)?.screening.status === 'done' && findingsOf(s, againId).every(f => f.state !== 'suspected'));
    record.timings.secondPositiveImportToConfirmed = secondsFrom(t);
    const second = findingsOf(againDone, againId).find(f => f.criterionId === CRITERION);
    check('the same history gives the same finding the second time', second?.state === 'confirmed',
      second ? `Model 1 ${second.screen.seconds} s, Model 2 ${second.check?.seconds} s` : 'no finding');
    if (second) {
      const reason = 'Join test: the doctor already knows and has a plan.';
      const bypassed = await api('POST', `/findings/${second.id}/decision`, { action: 'bypass', reason });
      const afterBypass = await getState();
      check('POST /api/findings/:id/decision bypass keeps the reason and queues no letter',
        bypassed.status === 200 && bypassed.json?.finding?.state === 'bypassed' && bypassed.json.finding.decision?.reason === reason &&
        !letterOf(afterBypass, second.id) && afterBypass.counts.bypassed === before.bypassed + 1 && afterBypass.counts.bellBadge === before.bellBadge,
        JSON.stringify(afterBypass.counts));
    }
  }

  // ----- a long history: the two medicines of the finding never sit in the same part -----
  if (LONG) {
    t = performance.now();
    const csvText = fs.readFileSync(path.join(ROOT, 'cases', '_demo', 'long-split.csv'), 'utf8');
    const long = await api('POST', '/cases', { fileName: 'long-split.csv', source: 'csv', csvText });
    const longId = long.json?.caseId;
    const longDone = await waitFor('the long history',
      s => idle(s) && caseOf(s, longId)?.screening.status === 'done' && findingsOf(s, longId).every(f => f.state !== 'suspected'), 1200);
    record.timings.longImportToChecked = secondsFrom(t);
    const longCase = caseOf(longDone, longId);
    const longFinding = findingsOf(longDone, longId).find(f => f.criterionId === CRITERION);
    const longRun = longCase.screening.criteria.find(c => c.criterionId === CRITERION);
    record.long = { caseId: longId, lines: longCase.lines.length, parts: longCase.parts, criteria: longCase.screening.criteria, finding: longFinding };
    record.timings.longScreenSeconds = longRun?.seconds;
    check('the long history is taken and is read in overlapping parts', long.status === 200 && longCase.lines.length === 310 && longCase.parts === 3,
      `${longCase.lines.length} lines, ${longCase.parts} parts`);
    check('the status line said which part of the long history was being read, and then that the listed lines were read together',
      sawStatus(/^Mantle is screening: criterion \d+ of \d+ \(long history, part \d+ of \d+\)/) && sawStatus(/\(long history, reading the listed lines together\)/),
      record.timeline.filter(x => typeof x.now === 'string' && x.now.includes('long history')).map(x => x.now).join(' / '));
    const celebrexLong = longCase.lines.filter(l => l.text.includes('Celebrex')).map(l => l.id);
    const xareltoLong = longCase.lines.filter(l => l.text.includes('Xarelto')).map(l => l.id);
    const partOf = id => { const n = Number(id.slice(1)); return n <= 150 ? 1 : n <= 240 ? 2 : 3; };
    check('no part of the long history holds both medicines', celebrexLong.length === 2 && xareltoLong.length === 34 &&
      xareltoLong.every(id => Number(id.slice(1)) <= 120) && celebrexLong.every(id => Number(id.slice(1)) > 270),
      `Xarelto is on ${xareltoLong[0]} to ${xareltoLong[xareltoLong.length - 1]} (part ${partOf(xareltoLong[0])}); Celebrex is on ${celebrexLong.join(' and ')} (part ${partOf(celebrexLong[0])})`);
    const shownLong = longFinding ? findingLines(longFinding).all : [];
    check('the finding is found all the same: Model 1 read the listed lines together, and it reached the bell',
      longFinding?.state === 'confirmed' && celebrexLong.some(id => shownLong.includes(id)) && xareltoLong.some(id => shownLong.includes(id)),
      longFinding ? `Model 1 ${longRun?.seconds} s, cited ${longFinding.screen.lineIds.join(', ')}; Model 2 ${longFinding.check?.seconds} s, cited ${longFinding.check?.lineIds.join(', ')}` : 'no finding');
    const listed = longFinding?.screen.listedLineIds ?? [];
    check('the second check read the same listed lines together',
      longFinding?.check?.completed === true && celebrexLong.every(id => listed.includes(id)) && xareltoLong.filter(id => listed.includes(id)).length >= 4,
      `${listed.length} lines were listed and read together`);
  }

  // ----- the end -----
  const final = await waitFor('the server to be idle', s => idle(s), 60);
  await shot('live-10-import-panel', '/?panel=import');
  await shot('live-11-bell-panel-after', '/?panel=bell');
  await shot('live-12-main-after', '/');
  watching = false;
  record.counts = final.counts;
  record.activity = final.state.activity;
  const kinds = new Set(final.state.activity.map(a => a.kind));
  check('the activity log holds every kind of step', ['import', 'screen', 'check', 'decision', 'letter', 'letter_status'].every(k => kinds.has(k)),
    `${final.state.activity.length} entries`);
  check('the server is idle at the end', final.now.text === 'Idle' && final.now.stage === null);
  check('Ollama never held more than one model at a time', record.mostModelsInMemory <= 1, `most seen together: ${record.mostModelsInMemory}`);
  if (SHOTS && EDGE) check('every picture was taken', record.shots.every(s => s.ok), `${record.shots.filter(s => s.ok).length} of ${record.shots.length}`);
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  let code = 2;
  try {
    await main();
    record.passed = record.checks.every(c => c.ok);
    code = record.passed ? 0 : 1;
    say(record.passed
      ? `ALL ${record.checks.length} CHECKS PASSED.`
      : `FAILED: ${record.checks.filter(c => !c.ok).map(c => c.name).join('; ')}`);
    say(`Timings in seconds: ${JSON.stringify(record.timings)}`);
  } catch (e) {
    record.error = e instanceof Error ? e.message : String(e);
    console.error('The join test stopped:', record.error);
    if (/fetch failed|ECONNREFUSED/i.test(record.error)) console.error(`Is the server running at ${BASE}? Start it with: npm start`);
  }
  watching = false;
  record.finishedAt = new Date().toISOString();
  record.seconds = since();
  if (OUT) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
      fs.writeFileSync(path.resolve(OUT), JSON.stringify(record, null, 1));
      say(`Written: ${OUT}`);
    } catch (e) {
      console.error('The record could not be written:', e instanceof Error ? e.message : e);
    }
  }
  await sleep(400);          // lets the watcher end its last call
  process.exit(code);
}
