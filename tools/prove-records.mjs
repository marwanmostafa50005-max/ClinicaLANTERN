// Live proof of records that also carry conditions and results (docs/SPEC.md section 6a).
// It calls the real local models. It does not use the server: it loads a drafted criterion from a
// wave folder with loadCriteriaFrom, reads its test histories, and runs each one through the screen
// (Model 1) and the double-check (Model 2). Then it does the same for the two demo histories, to
// show that a criterion without facts gives what it gave before.
//
//   node tools/prove-records.mjs                          three drafted criteria and the two demo histories
//   node tools/prove-records.mjs --only STOPP-E1,START-B3 these drafted criteria
//   node tools/prove-records.mjs --no-demo                leave the demo histories out
//   node tools/prove-records.mjs --letters                also have Model 3 write the letter for every finding at the bell
//   node tools/prove-records.mjs --server                 also take one "no fact" history through the server's own engine,
//                                                         in this process and with its state file in a throwaway folder
//   node tools/prove-records.mjs --waves <folder>         where the wave folders are
//   node tools/prove-records.mjs --write docs/PROOF_RECORDS.md --json <file>
//   node tools/prove-records.mjs --list                   names the drafted criteria that need facts; calls no model
//
// For each history it prints: file, suspected, possible, missing facts, confirmed, cited lines, and
// whether that is what the answer part of the criterion expects.
// Fictional patients only. One model call at a time: stop other model work first.
// Importing this file does not call a model. The proof runs only when this file is the one that was started.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../pipeline/config.ts';
import { loadCriteriaFrom, needsFacts } from '../pipeline/criteria.ts';
import { parseCsv } from '../pipeline/csv.ts';
import { screenCriterion, screenHistory } from '../pipeline/screen.ts';
import { checkFinding } from '../pipeline/check.ts';
import { draftLetter } from '../pipeline/letter.ts';
import { findingLines } from '../shared/lines.ts';
import { factLineKind, listFacts } from '../shared/facts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const WAVES = path.resolve(option('--waves', 'C:\\Users\\AdamG\\ClinicaLANTERN-Lantern-runtime\\waves-claude'));
// One with a result fact, one with a condition fact, one START item (a medicine that should be there is not supplied).
const DEFAULT_IDS = ['STOPP-E1', 'STOPP-B2', 'START-B3'];
const ONLY = option('--only', '').split(',').map(s => s.trim()).filter(Boolean);
const WRITE = option('--write', '');
const JSON_OUT = option('--json', '');
const DEMO = !args.includes('--no-demo');
const LETTERS = args.includes('--letters');
const SERVER = args.includes('--server');

const started = performance.now();
const since = () => Math.round((performance.now() - started) / 100) / 10;
const say = text => console.log(`+${since().toFixed(1).padStart(6)} s  ${text}`);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

/** Every drafted criterion of the wave folders: its ID, its wave and where its files are. */
function draftedCriteria() {
  const found = new Map();
  if (!fs.existsSync(WAVES)) return found;
  for (const wave of fs.readdirSync(WAVES).filter(name => /^W\d+$/.test(name)).sort()) {
    const dir = path.join(WAVES, wave, 'criteria');
    if (!fs.existsSync(dir)) continue;
    for (const id of fs.readdirSync(dir).sort()) {
      if (fs.existsSync(path.join(dir, id, 'criterion.json')) && !found.has(id)) {
        found.set(id, { id, wave, criteriaDir: dir, casesDir: path.join(WAVES, wave, 'cases') });
      }
    }
  }
  return found;
}

/** What the answer part expects of one history, in a few words, and the kind of case it is. */
export function expectationOf(entry) {
  if (entry.kind === 'near_miss') return { want: 'none', words: 'no finding' };
  if (entry.kind === 'clean') return { want: 'none', words: 'no finding' };
  const possible = /^\s*possible finding/i.test(entry.about ?? '') || /nofact/i.test(entry.file ?? '');
  return possible
    ? { want: 'possible', words: 'a possible finding at the bell' }
    : { want: 'finding', words: 'a confirmed finding with the planted lines' };
}

/** Each inner list of must_cite needs at least one of its lines among the cited ones. Returns the lists with none. */
export function groupsNotCited(entry, criterionId, cited) {
  const groups = (entry.findings ?? []).filter(f => f.criterion === criterionId).flatMap(f => f.must_cite ?? []);
  return groups.filter(group => !group.some(id => cited.includes(String(id).toUpperCase())));
}

/** Judges one row against the answer part. Returns { ok, why }. */
export function judge(row) {
  const { want } = row.expect;
  const atBell = row.suspected && row.check !== null && (row.check.confirmed || !row.check.completed || row.check.unclear === true);
  const confirmed = row.suspected && row.check !== null && row.check.completed && row.check.confirmed;
  if (row.error) return { ok: false, why: row.error };
  if (want === 'none') {
    if (!row.suspected) return { ok: true, why: 'Model 1 suspected nothing.' };
    if (!atBell) return { ok: true, why: 'Model 1 suspected it and Model 2 turned it back.' };
    return { ok: false, why: confirmed ? 'A false flag: it was confirmed.' : 'A false flag: it reached the bell without a plain yes.' };
  }
  if (!row.suspected) return { ok: false, why: 'Missed: Model 1 suspected nothing.' };
  const missing = groupsNotCited(row.entry, row.criterionId, row.cited);
  const lines = missing.length === 0 ? '' : ` Planted lines not cited: ${missing.map(g => g.join('/')).join('; ')}.`;
  if (want === 'possible') {
    if (!row.possible) return { ok: false, why: `It was not marked as a possible finding.${lines}` };
    if (!atBell) return { ok: false, why: `Model 2 turned the possible finding back.${lines}` };
    if (missing.length > 0) return { ok: false, why: lines.trim() };
    return { ok: true, why: confirmed ? 'Confirmed as a possible finding.' : 'At the bell as a possible finding, without a plain yes from Model 2.' };
  }
  if (!confirmed) return { ok: false, why: `Not confirmed by Model 2.${lines}` };
  if (missing.length > 0) return { ok: false, why: lines.trim() };
  if (row.possible) return { ok: false, why: 'Confirmed with the planted lines, but marked as a possible finding though the record holds the fact.' };
  return { ok: true, why: 'Confirmed, with the planted lines.' };
}

export function checkWords(row) {
  if (!row.suspected) return '-';
  if (row.check === null) return 'not run';
  if (!row.check.completed) return 'not completed';
  if (row.check.confirmed) return 'yes';
  return row.check.unclear ? 'unclear' : 'no';
}

export const cell = text => String(text).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/**
 * One history through the server's own engine (server/engine.ts), in this process: import, the
 * screen, the double-check, the pharmacist's accept, the letter. The state file is written to a
 * throwaway folder and read back, so what is reported is what the server saved and what the API
 * would give. No port is opened and the state of the real server is not touched.
 */
async function throughTheServer(cfg, criterion, file) {
  const { Engine } = await import('../server/engine.ts');
  const { StateStore } = await import('../server/store.ts');
  const { PageImages } = await import('../server/images.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-prove-records-'));
  try {
    const store = new StateStore(dir);
    store.load();
    const engine = new Engine({
      cfg, store, images: new PageImages(path.join(dir, 'images')),
      loadCriteria: async () => [criterion],
      // Joined the way server/index.ts joins them.
      pipeline: {
        screenCriterion: (c, patient, lines, k, signal) => screenCriterion(c, patient, lines, k, { signal }),
        screenHistory: (c, patient, lines, list, hooks, signal) => screenHistory(c, patient, lines, list, { signal }, hooks),
        checkFinding: (c, patient, lines, k, screen, signal) => checkFinding(c, patient, lines, k, screen, { signal }),
        draftLetter: (c, patient, lines, k, finding, signal) => draftLetter(c, patient, lines, k, finding, { signal }),
        transcribePageImage: async () => ({ ok: false, error: 'Not used in this proof.' })
      }
    });
    await engine.start();
    await engine.importCase({ fileName: path.basename(file), source: 'csv', csvText: fs.readFileSync(file, 'utf8') });
    await engine.whenIdle();
    const first = engine.state.findings[0];
    const bell = engine.stateResponse().counts.bellBadge;
    if (first && first.state === 'confirmed') {
      engine.decide(first.id, { action: 'accept' });
      await engine.whenIdle();
    }
    // What the server saved, read back from its state file.
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    const finding = saved.findings[0] ?? null;
    const letter = saved.letters[0] ?? null;
    return {
      file: path.basename(file),
      criterion: criterion.id,
      lines: saved.cases[0]?.lines.length ?? 0,
      factLines: (saved.cases[0]?.lines ?? []).filter(l => factLineKind(l.text) !== null).length,
      bellBadgeBeforeAccept: bell,
      finding: finding && { state: finding.state, possible: finding.possible, missingFacts: finding.screen.missingFacts, lineIds: finding.screen.lineIds, checkConfirmed: finding.check?.confirmed ?? null },
      letter: letter && {
        status: letter.status, origin: letter.draft?.origin ?? null, checkNotes: letter.draft?.checkNotes ?? [],
        saysRecordDoesNotShow: /The record we hold does not show: /.test(letter.body), asksToConfirm: /\bconfirm/i.test(letter.body), body: letter.body
      },
      log: saved.activity.map(a => a.text)
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const drafted = draftedCriteria();
  if (args.includes('--list')) {
    for (const d of drafted.values()) {
      const [criterion] = await loadCriteriaFrom(d.criteriaDir, [d.id]);
      if (needsFacts(criterion)) console.log(`${d.wave} ${d.id}: ${criterion.needs_facts.map(f => f.kind).join(', ')}`);
    }
    return 0;
  }

  const cfg = loadConfig(ROOT);
  const groups = [];          // { criterion, title, rows }
  const ids = ONLY.length > 0 ? ONLY : DEFAULT_IDS;
  for (const id of ids) {
    const d = drafted.get(id);
    if (!d) {
      say(`${id}: no drafted criterion of this name was found under ${WAVES}.`);
      continue;
    }
    const [criterion] = await loadCriteriaFrom(d.criteriaDir, [id]);
    const part = readJson(path.join(d.casesDir, id, 'expected.part.json'));
    const rows = part.map(entry => ({ entry, file: path.join(d.casesDir, entry.file), shown: entry.file }));
    groups.push({ criterion, wave: d.wave, rows });
  }
  if (DEMO) {
    const [demo] = await loadCriteriaFrom(path.join(ROOT, 'criteria'), ['DEMO-NSAID-ANTICOAG']);
    const sheet = readJson(path.join(ROOT, 'cases', '_demo', 'expected.demo.json'));
    const rows = sheet.cases
      .filter(entry => entry.file === '_demo/positive.csv' || entry.file === '_demo/near-miss.csv')
      .map(entry => ({ entry, file: path.join(ROOT, 'cases', entry.file), shown: entry.file }));
    groups.push({ criterion: demo, wave: 'the repository', rows });
  }
  if (groups.length === 0) {
    say('Nothing to run.');
    return 1;
  }

  // Read every history first. A history that cannot be read is never screened.
  for (const group of groups) {
    for (const row of group.rows) {
      row.criterionId = group.criterion.id;
      row.expect = expectationOf(row.entry);
      row.suspected = false;
      row.possible = false;
      row.missingFacts = [];
      row.check = null;
      row.screen = null;
      row.cited = [];
      row.seconds = { screen: 0, check: 0 };
      try {
        const parsed = parseCsv(fs.readFileSync(row.file, 'utf8'));
        row.patient = parsed.patient;
        row.lines = parsed.lines;
        row.factLines = parsed.lines.filter(l => factLineKind(l.text) !== null).length;
        if (parsed.problems.length > 0) row.error = `The history cannot be assessed. ${parsed.problems.join(' ')}`;
      } catch (e) {
        row.error = `The history could not be read. ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  // Stage 1: Model 1 screens every history. Stage 2: Model 2 checks every suspected finding.
  // The two stages are kept apart so the model in memory changes only once.
  const all = groups.flatMap(group => group.rows.map(row => ({ group, row })));
  say(`Stage 1 of 2. Model 1 (${cfg.models.screen}) screens ${all.length} histories.`);
  for (const { group, row } of all) {
    if (row.error) continue;
    const t0 = performance.now();
    const outcome = await screenCriterion(cfg, row.patient, row.lines, group.criterion);
    row.seconds.screen = Math.round((performance.now() - t0) / 100) / 10;
    if (!outcome.ok) {
      row.error = `Could not be screened. ${outcome.error}`;
      say(`${row.shown}: ${row.error}`);
      continue;
    }
    row.suspected = outcome.suspected;
    row.screen = outcome.result;
    row.missingFacts = outcome.result.missingFacts ?? [];
    row.possible = outcome.suspected && row.missingFacts.length > 0;
    row.cited = findingLines({ screen: outcome.result }).all;
    say(`${row.shown}: ${outcome.suspected ? (row.possible ? 'possible finding' : 'suspected') : 'nothing suspected'} (${row.seconds.screen} s)`);
  }
  const toCheck = all.filter(({ row }) => !row.error && row.suspected);
  say(`Stage 2 of 2. Model 2 (${cfg.models.check}) checks ${toCheck.length} suspected findings.`);
  for (const { group, row } of toCheck) {
    const t0 = performance.now();
    row.check = await checkFinding(cfg, row.patient, row.lines, group.criterion, row.screen);
    row.seconds.check = Math.round((performance.now() - t0) / 100) / 10;
    row.cited = findingLines({ screen: row.screen, check: row.check }).all;
    say(`${row.shown}: second check ${checkWords(row)} (${row.seconds.check} s)`);
  }

  // Stage 3, only when asked for: Model 3 writes the letter for every finding that reached the bell
  // on a history that plants one. The proof stands in for the pharmacist who accepts the finding.
  const atBell = row => row.suspected && row.check !== null && (row.check.confirmed || !row.check.completed || row.check.unclear === true);
  const toWrite = LETTERS ? all.filter(({ row }) => !row.error && row.expect.want !== 'none' && atBell(row)) : [];
  if (LETTERS) say(`Stage 3. Model 3 (${cfg.models.letter}) writes ${toWrite.length} letters.`);
  for (const { group, row } of toWrite) {
    const finding = {
      id: 'F0001', caseId: 'C0001', criterionId: group.criterion.id, state: 'accepted', possible: row.possible,
      screen: row.screen, check: row.check, seenByPharmacist: true,
      decision: { action: 'accept', by: cfg.pharmacy.pharmacist, at: new Date().toISOString() }
    };
    const t0 = performance.now();
    const draft = await draftLetter(cfg, row.patient, row.lines, group.criterion, finding);
    const body = draft.body;
    const says = [];
    if (row.possible) {
      const line = `The record we hold does not show: ${listFacts(row.missingFacts)}.`;
      says.push(body.includes(line) ? 'It carries the line "The record we hold does not show".' : 'The line "The record we hold does not show" is MISSING.');
      says.push(/\bconfirm/i.test(body) ? 'It asks the doctor to confirm.' : 'It does NOT ask the doctor to confirm.');
    } else {
      says.push(body.includes('The record we hold does not show') ? 'It wrongly says the record does not show a fact.' : 'It does not call the finding a possible one.');
    }
    const planted = (row.entry.findings ?? []).flatMap(f => f.must_cite ?? []);
    const shown = planted.filter(group2 => group2.some(id => {
      const line = row.lines.find(l => l.id === String(id).toUpperCase());
      return line !== undefined && body.includes(line.text);
    })).length;
    says.push(`It prints a line of ${shown} of ${planted.length} planted groups.`);
    row.letter = {
      origin: draft.origin, templateReason: draft.templateReason ?? null, checkNotes: draft.checkNotes, subject: draft.subject, body,
      seconds: Math.round((performance.now() - t0) / 100) / 10, says,
      ok: (draft.origin === 'model') && shown === planted.length &&
        (row.possible ? body.includes('The record we hold does not show: ') && /\bconfirm/i.test(body) : !body.includes('The record we hold does not show'))
    };
    say(`${row.shown}: letter ${draft.origin === 'model' ? 'written by the model' : 'built from the template'}${draft.checkNotes.length > 0 ? ' with notes' : ''} (${row.letter.seconds} s)`);
  }

  // Stage 4, only when asked for: the first "no fact" history once more, this time through the server's engine.
  let served = null;
  if (SERVER) {
    const pick = all.find(({ group, row }) => !row.error && row.expect.want === 'possible' && needsFacts(group.criterion));
    if (pick) {
      say(`Stage 4. ${pick.row.shown} goes through the server's own engine: import, screen, double-check, accept, letter.`);
      served = await throughTheServer(cfg, pick.group.criterion, pick.row.file);
      say(`The server saved: state "${served.finding?.state}", possible ${served.finding?.possible}, letter ${served.letter?.origin ?? 'none'}.`);
    } else {
      say('Stage 4 was left out: no "no fact" history is in this run.');
    }
  }

  // The table.
  const out = [];
  let asExpected = 0;
  let total = 0;
  for (const group of groups) {
    const c = group.criterion;
    const facts = needsFacts(c) ? c.needs_facts.map(f => `${f.kind}: ${f.what}`).join('; ') : 'none';
    out.push('', `### ${c.label}: ${c.title}`, '', `From ${group.wave}. Facts it needs: ${facts}.`, '');
    out.push('| History | Lines (facts) | Suspected | Possible | Missing facts | Confirmed | Cited lines | Expected | As expected |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const row of group.rows) {
      const verdict = judge(row);
      row.verdict = verdict;
      total++;
      if (verdict.ok) asExpected++;
      out.push('| ' + [
        path.basename(row.shown),
        row.lines ? `${row.lines.length} (${row.factLines})` : '-',
        row.error ? '-' : row.suspected ? 'yes' : 'no',
        row.error ? '-' : row.possible ? 'yes' : 'no',
        row.missingFacts.length > 0 ? row.missingFacts.join('; ') : '-',
        row.error ? '-' : checkWords(row),
        row.cited.length > 0 ? row.cited.join(' ') : '-',
        row.expect.words,
        `${verdict.ok ? 'YES' : 'NO'}. ${verdict.why}`
      ].map(cell).join(' | ') + ' |');
    }
    out.push('');
    for (const row of group.rows) {
      if (row.screen) out.push(`- ${path.basename(row.shown)}, Model 1 (${row.seconds.screen} s): ${cell(row.screen.reason)}`);
      if (row.check) out.push(`- ${path.basename(row.shown)}, Model 2 (${row.seconds.check} s): ${cell(row.check.whatMatches)}`);
      if (row.letter) {
        const how = row.letter.origin === 'model'
          ? (row.letter.checkNotes.length === 0 ? 'written by the model, first draft passed the checks' : 'written by the model, second draft passed the checks')
          : `built from the template (${row.letter.templateReason ?? 'no reason given'})`;
        out.push(`- ${path.basename(row.shown)}, Model 3 (${row.letter.seconds} s): letter ${how}. ${row.letter.says.join(' ')}` +
          (row.letter.checkNotes.length > 0 ? ` Check notes: ${cell(row.letter.checkNotes.join(' '))}` : ''));
      }
    }
  }
  if (served) {
    const f = served.finding;
    const l = served.letter;
    out.push('', `### Through the server: ${served.criterion}, ${served.file}`, '');
    out.push('What the server wrote to its state file, which is what `GET /api/state` gives the page:', '');
    out.push('| What | Value |', '|---|---|');
    out.push(`| Lines imported (facts) | ${served.lines} (${served.factLines}) |`);
    out.push(`| Finding | ${f ? `state "${f.state}", possible: ${f.possible}` : 'none'} |`);
    out.push(`| screen.missingFacts | ${f && f.missingFacts.length > 0 ? cell(f.missingFacts.join('; ')) : '-'} |`);
    out.push(`| Lines Model 1 cited | ${f ? f.lineIds.join(' ') : '-'} |`);
    out.push(`| Bell badge before the accept | ${served.bellBadgeBeforeAccept} |`);
    out.push(`| Letter | ${l ? `${l.status}, ${l.origin === 'model' ? 'written by the model' : 'built from the template'}${l.checkNotes.length > 0 ? ', with check notes' : ''}` : 'none'} |`);
    out.push(`| The letter says "The record we hold does not show" | ${l ? (l.saysRecordDoesNotShow ? 'yes' : 'NO') : '-'} |`);
    out.push(`| The letter asks the doctor to confirm | ${l ? (l.asksToConfirm ? 'yes' : 'NO') : '-'} |`);
    out.push('', 'The activity log of that run:', '');
    for (const text of served.log) out.push(`- ${cell(text)}`);
  }
  const letters = all.map(({ row }) => row.letter).filter(Boolean);
  const lettersGood = letters.filter(l => l.ok).length;
  const summary = `${asExpected} of ${total} histories gave what the answer part expects.` +
    (LETTERS ? ` ${lettersGood} of ${letters.length} letters were written by the model, passed the letter checks and say what a letter of their kind must say.` : '');
  console.log(out.join('\n'));
  console.log('');
  console.log(summary);

  const record = {
    ranAt: new Date().toISOString(),
    seconds: since(),
    models: cfg.models,
    waves: WAVES,
    summary,
    throughTheServer: served,
    groups: groups.map(group => ({
      criterion: group.criterion.id,
      from: group.wave,
      needs_facts: group.criterion.needs_facts ?? [],
      rows: group.rows.map(row => ({
        file: row.shown, expected: row.expect.words, asExpected: row.verdict.ok, why: row.verdict.why,
        suspected: row.suspected, possible: row.possible, missingFacts: row.missingFacts,
        confirmed: checkWords(row), cited: row.cited, mustCite: (row.entry.findings ?? []).flatMap(f => f.must_cite ?? []),
        screen: row.screen, check: row.check, letter: row.letter ?? null, error: row.error ?? null, seconds: row.seconds
      }))
    }))
  };
  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(record, null, 1));
  }
  if (WRITE) {
    const when = new Date().toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short', hour12: false });
    const flags = [
      DEMO ? '' : ' --no-demo', LETTERS ? ' --letters' : '', SERVER ? ' --server' : '', ONLY.length > 0 ? ' --only ' + ONLY.join(',') : ''
    ].join('');
    const doc = [
      '## The live table',
      '',
      `Run on ${when} with \`node tools/prove-records.mjs${flags}\`. ` +
        `Models: ${cfg.models.screen} (screen), ${cfg.models.check} (double-check)${LETTERS || SERVER ? ` and ${cfg.models.letter} (letter)` : ''}, ` +
        `through Ollama at ${cfg.ollamaBase}. ` +
        `The whole run took ${since()} seconds. Fictional patients only.`,
      '',
      `**${summary}**`,
      ...out,
      ''
    ].join('\n');
    fs.mkdirSync(path.dirname(path.resolve(WRITE)), { recursive: true });
    fs.writeFileSync(path.resolve(WRITE), doc);
    say(`Written: ${WRITE}`);
  }
  return asExpected === total ? 0 : 2;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main().then(code => { process.exitCode = code; }, e => {
    console.error('The proof stopped with an error:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
