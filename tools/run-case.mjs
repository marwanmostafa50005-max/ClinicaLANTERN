// Sends one CSV history to the running local server and writes down what the models did with it:
// every criterion with its result and its seconds, and every finding with the lines the two models cited.
// It decides nothing: findings stay under the bell for the pharmacist. Fictional patients only.
//
//   node tools/run-case.mjs <history.csv> [--base http://127.0.0.1:8787] [--out file.json] [--shots folder]
//
// It works with whatever criteria the server has in use. It does not reset the server.
// --shots takes three pictures of the real page with headless Edge: the main page half way through
// the screening, and the import panel and the bell panel at the end. Opening the bell panel in a
// picture marks its findings as seen, as it does for the pharmacist.
import fs from 'node:fs';
import path from 'node:path';
import { edgePicture, ROOT, sleep } from './edge.mjs';
import { isPossible, listFacts, missingFactsOf } from '../shared/facts.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
};
const FILE = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const BASE = option('--base', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const OUT = option('--out', '');
const SHOTS = option('--shots', '');

if (!FILE) {
  console.log('Use: node tools/run-case.mjs <history.csv> [--base http://127.0.0.1:8787] [--out file.json] [--shots folder]');
  process.exit(2);
}

const started = performance.now();
const since = () => Math.round((performance.now() - started) / 100) / 10;
const say = text => console.log(`+${since().toFixed(1).padStart(6)} s  ${text}`);

async function api(method, route, body) {
  const res = await fetch(BASE + '/api' + route, {
    method,
    cache: 'no-store',
    headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json };
}

async function picture(name, route) {
  if (!SHOTS) return;
  const file = path.join(path.resolve(ROOT, SHOTS), `${name}-1366x768.png`);
  const ok = await edgePicture(file, BASE + route, 1366, 768);
  say(`        picture ${ok ? 'taken' : 'NOT taken'}: ${path.relative(ROOT, file)}`);
}

let code = 2;
try {
  const full = path.resolve(FILE);
  const fileName = path.basename(full);
  const csvText = fs.readFileSync(full, 'utf8');
  const criteria = (await api('GET', '/criteria')).json;
  if (!Array.isArray(criteria)) throw new Error('The server did not send its criteria. Is it running?');
  const label = id => criteria.find(c => c.id === id)?.label ?? id;
  say(`Server ${BASE}. Criteria in use: ${criteria.map(c => c.id).join(', ')}.`);

  const imported = await api('POST', '/cases', { fileName, source: 'csv', csvText });
  const caseId = imported.json?.caseId;
  if (imported.status !== 200 || !caseId) throw new Error(`The server refused the history: ${imported.json?.error ?? imported.status}`);
  say(`Imported ${fileName} as ${caseId}.`);

  const record = { startedAt: new Date().toISOString(), base: BASE, file: path.relative(ROOT, full).split(path.sep).join('/'), caseId, criteriaInUse: criteria.map(c => c.id), timeline: [] };
  let lastNow = '';
  let screenedAt = null;
  let halfWay = false;
  let final = null;
  for (;;) {
    const s = (await api('GET', '/state')).json;
    if (s.now.text !== lastNow) {
      lastNow = s.now.text;
      record.timeline.push({ at: since(), now: lastNow });
      say(`status line: "${lastNow}"`);
    }
    const c = s.state.cases.find(x => x.id === caseId);
    if (c.cannotAssess) throw new Error(`Cannot assess: ${c.cannotAssess}`);
    const runs = c.screening.criteria;
    if (!halfWay && runs.filter(r => r.status !== 'waiting').length > runs.length / 2 && c.screening.status === 'running') {
      halfWay = true;
      await picture('run-case-01-screening-half-way', '/');
    }
    if (screenedAt === null && c.screening.status === 'done') screenedAt = since();
    const mine = s.state.findings.filter(f => f.caseId === caseId);
    const busy = s.state.jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (c.screening.status === 'done' && mine.every(f => f.state !== 'suspected') && !busy) {
      final = s;
      break;
    }
    if (since() > 1800) throw new Error('Timed out after 30 minutes.');
    await sleep(250);
  }

  const c = final.state.cases.find(x => x.id === caseId);
  const findings = final.state.findings.filter(f => f.caseId === caseId);
  record.patient = c.patient;
  record.lines = c.lines.length;
  record.parts = c.parts;
  record.secondsImportToScreened = screenedAt;
  record.secondsImportToChecked = since();
  record.criteria = c.screening.criteria;
  record.findings = findings;
  record.counts = final.counts;

  console.log('');
  console.log(`${fileName}: ${c.patient.label}, ${c.lines.length} lines${c.parts > 1 ? `, screened in ${c.parts} parts` : ''}.`);
  console.log(`Screened in ${screenedAt} s. Every suspected finding was double-checked after ${record.secondsImportToChecked} s.`);
  console.log('');
  console.log('Criterion                      Model 1                 Seconds');
  for (const run of c.screening.criteria) {
    const words = run.status === 'clear' ? 'nothing suspected' : run.status === 'suspected' ? 'SUSPECTED' : run.status === 'failed' ? 'COULD NOT BE SCREENED' : run.status;
    console.log(`${label(run.criterionId).padEnd(30)} ${words.padEnd(23)} ${String(run.seconds ?? '').padStart(6)}${run.error ? '  ' + run.error : ''}`);
  }
  console.log('');
  if (findings.length === 0) console.log('No finding was suspected.');
  for (const f of findings) {
    const state = f.state === 'confirmed' ? (f.check?.completed ? 'CONFIRMED by Model 2: it is under the bell' : 'SECOND CHECK NOT COMPLETED: it is under the bell')
      : f.state === 'not_confirmed' ? 'not confirmed by Model 2: it is in the grey list' : f.state;
    console.log(`${label(f.criterionId)}: ${state}.`);
    // A possible finding (docs/SPEC.md section 6a): the medicines match and the record does not show a fact the criterion needs.
    if (isPossible(f)) console.log(`  Possible finding. The record does not show: ${listFacts(missingFactsOf(f)) || 'a fact this criterion needs'}.`);
    console.log(`  Model 1 cited ${f.screen.lineIds.join(', ') || 'no valid line'}: ${f.screen.reason}`);
    if (f.check) console.log(`  Model 2 (${f.check.seconds} s) cited ${f.check.lineIds.join(', ') || 'no line'}: ${f.check.whatMatches}`);
  }
  await picture('run-case-02-import-panel', '/?panel=import');
  await picture('run-case-03-bell-panel', '/?panel=bell');
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUT), JSON.stringify(record, null, 1));
    console.log(`\nWritten: ${OUT}`);
  }
  code = c.screening.criteria.some(r => r.status === 'failed') || findings.some(f => f.check && !f.check.completed) ? 1 : 0;
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error('Stopped:', message);
  if (/fetch failed|ECONNREFUSED/i.test(message)) console.error(`Is the server running at ${BASE}? Start it with: npm start`);
}
process.exit(code);
