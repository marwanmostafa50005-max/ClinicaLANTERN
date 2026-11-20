// The sign-off page for the clinical reviewer.
// Start:  node tools\signoff\server.mjs      then open  http://127.0.0.1:8790
// (Add --open to have the address opened in the browser. PORT sets another port.)
// It listens on this computer only (127.0.0.1). It reads the criteria from disk on every request,
// and writes two files after a click: the criteria ledger (docs\signoff\ledger.json) and, for a
// condition list only, the lists ledger (docs\signoff\lists-ledger.json). A list decision never
// changes the criteria ledger. Nothing is written into a criterion file here. That is done by apply.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, buildIndex, statusOf, countAll, resultOf, opinionOf, auditOf, auditHealth, signoffCounts, maySignCriterion,
  factRuleLines, criterionRuleLines,
  readConditionMarkers, conditionMarkerLines, conditionMarkerMeds, conditionListsPage, conditionNote, CONDITION_LIST_NOTE,
  conditionHit, listLedgerKey, listFingerprint, listMedicineNames, listDecisionOf, listDecisionCounts,
  readListsLedger, writeListsLedger, listsLedgerFile,
  casesOf, plantedElsewhere, readHistory,
  readLedger, writeLedger, readFresh, readCached, forget, freshRequest, jsonOf, localIso, splitNumbered, familyWord, byName,
  WHERE_WORDS, LedgerError
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const PAGE_FILE = path.join(HERE, 'page.html');
const MARK_FILE = path.join(cfg.repo, 'public', 'mark.svg');
const PLAIN_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="16" y="16" width="480" height="480" rx="96" fill="#071d49"/>' +
  '<path d="M150 124V404H258" fill="none" stroke="#edbf67" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<g stroke="#27c2d0" stroke-width="12" stroke-linecap="round"><line x1="300" y1="172" x2="430" y2="172"/><line x1="236" y1="256" x2="444" y2="256"/><line x1="232" y1="330" x2="400" y2="330"/></g></svg>';

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOf = v => (typeof v === 'string' ? v.trim() : '');
const namesOf = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []);

// ---------- the ledger, with one guard ----------

// The ledger as this window last read or wrote it. If the file is removed from the disk while the
// page is running (a clean-up by another program, a folder that was moved), it is put back from here
// at the next request, so that the decisions made so far are not replaced by an empty ledger.
let remembered = null;
let putBack = 0;
const holdsSomething = l => Boolean(textOf(l.reviewer)) || Object.keys(l.entries ?? {}).length > 0 || Object.keys(l.not_drafted_agreed ?? {}).length > 0;

/** True only when the file is plainly not there, three times over a fifth of a second. A file that is busy for a moment is not missing. */
function ledgerIsGone() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.statSync(cfg.ledger); return false; } catch (e) { if (!e || e.code !== 'ENOENT') return false; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
  }
  return true;
}

function ledgerNow() {
  if (remembered !== null && ledgerIsGone()) {
    writeLedger(cfg, JSON.parse(remembered));
    putBack++;
    console.log(`${localIso()}  The ledger file was missing from the disk. It was put back from this window's memory: ${cfg.ledger}`);
  }
  const ledger = readLedger(cfg);
  remembered = holdsSomething(ledger) ? JSON.stringify(ledger) : null;
  return ledger;
}

function saveLedger(ledger) {
  writeLedger(cfg, ledger);
  remembered = holdsSomething(ledger) ? JSON.stringify(ledger) : null;
}

// The lists ledger, remembered the same way. A list decision is saved only here, never in the criteria ledger.
let rememberedLists = null;

function listsFileGone() {
  try { fs.statSync(listsLedgerFile(cfg)); return false; } catch (e) { return Boolean(e && e.code === 'ENOENT'); }
}

function listsNow() {
  if (rememberedLists !== null && listsFileGone()) {
    writeListsLedger(cfg, JSON.parse(rememberedLists));
    console.log(`${localIso()}  The lists ledger was missing from the disk. It was put back from this window's memory: ${listsLedgerFile(cfg)}`);
  }
  const data = readListsLedger(cfg);
  rememberedLists = Object.keys(data.lists).length ? JSON.stringify(data) : null;
  return data;
}

function saveLists(data) {
  writeListsLedger(cfg, data);
  const written = readListsLedger(cfg);
  rememberedLists = Object.keys(written.lists).length ? JSON.stringify(written) : null;
  return written;
}

// ---------- what the page is given ----------

function lightEntry(entry, ledger) {
  const status = statusOf(entry, ledger);
  const opinion = opinionOf(cfg, entry.id);
  const audit = auditOf(cfg, entry.id, entry.parts);
  const canSign = maySignCriterion(cfg, entry) && entry.kind === 'criterion' && !entry.error
    && status.state !== 'signed' && status.state !== 'file_signed' && status.state !== 'change';
  return {
    id: entry.id, label: entry.label, title: entry.title, family: entry.family, set: entry.set, n: entry.n,
    kind: entry.kind, facts: entry.facts, urgent: entry.urgency === 'same_day',
    where: entry.top.place.where, wave: entry.top.place.wave, hash: entry.hash,
    state: status.state, result: resultOf(cfg, entry).bucket, opinion: opinion ? opinion.verdict : '',
    doubts: entry.doubts, bad: Boolean(entry.error),
    canSign,
    audit: audit ? {
      final: audit.final, forYou: audit.forYou, points: audit.points.length,
      auditComplete: audit.auditComplete,
      textMatches: audit.textMatches,
      finalTestState: audit.finalTest.state,
      finalTestText: audit.finalTest.text,
      setAside: audit.final === 'SET ASIDE'
    } : null
  };
}

function listPayload(index, ledger) {
  const families = new Map();
  for (const e of index.entries) families.set(e.family, (families.get(e.family) ?? 0) + 1);
  const t = index.tally;
  const signoff = signoffCounts(index, ledger, cfg);
  const markers = readConditionMarkers(cfg.repo);
  const lists = listsNow();
  return {
    serverTime: localIso(),
    reviewer: ledger.reviewer ?? '',
    counts: countAll(index, ledger),
    signoff,
    tally: {
      total: t.total, expected: t.expected, repo: t.repo, boardRepair: t.boardRepair, board: t.board,
      drafts: index.entries.filter(e => e.kind === 'criterion' && e.top.place.where.startsWith('waves')).length,
      notDrafted: t.notDrafted, missing: t.missing, notExpected: t.notExpected, leftOut: t.leftOut, problems: t.problems, setsFrom: t.setsFrom
    },
    families: [...families.entries()].map(([key, count]) => ({ key, word: familyWord(key), count })).sort((a, b) => byName(a.word, b.word)),
    entries: index.entries.map(e => lightEntry(e, ledger)),
    undo: undoTop(),
    ledgerFile: cfg.ledger,
    putBack,                                            // how many times the ledger file had gone missing and was put back
    conditionLists: conditionListsPage(markers, index, lists),
    listDecisions: listDecisionCounts(markers, lists)
  };
}

function listMarkFor(markers, lists, what) {
  const hit = conditionHit(markers, what);
  if (!hit) return null;
  const saved = isObj(lists?.lists) ? lists.lists[listLedgerKey(hit)] : null;
  const view = listDecisionOf(saved, hit);
  return {
    key: view.key,
    condition: textOf(hit.condition),
    state: view.state,
    at: view.at || '',
    note: view.note || '',
    added: view.added || [],
    removed: view.removed || [],
    namesKnown: Boolean(view.namesKnown),
    fingerprint: view.fingerprint
  };
}

function criterionView(j) {
  const markers = readConditionMarkers(cfg.repo);
  const lists = listsNow();
  const src = isObj(j.source) ? j.source : {};
  const known = new Set(['id', 'label', 'family', 'title', 'statement', 'statement_origin', 'source', 'plain_summary', 'medicine_groups',
    'needs_facts', 'rule_for_models', 'cannot_be_seen', 'ask_the_gp', 'urgency', 'draft', 'signed_by_clinical_reviewer',
    'only_sex', 'count_supplies']);
  const other = {};
  for (const [k, v] of Object.entries(j)) if (!known.has(k)) other[k] = v;
  return {
    statement: textOf(j.statement),
    origin: j.statement_origin === 'published' ? 'published' : 'entrant',
    summary: textOf(j.plain_summary),
    source: {
      credit: textOf(src.credit) || textOf(src.citation), licence: textOf(src.licence),
      confirmed: src.licence_status === 'confirmed_by_founder', notice: textOf(src.modification_notice)
    },
    groups: (Array.isArray(j.medicine_groups) ? j.medicine_groups : []).filter(isObj).map((g, i) => {
      const ingredients = namesOf(g.ingredients);
      const brands = [];
      if (isObj(g.brands)) for (const [ingredient, list] of Object.entries(g.brands)) brands.push([ingredient, namesOf(list)]);
      return { key: textOf(g.key) || String.fromCharCode(65 + i), name: textOf(g.name), ingredients, brands, note: textOf(g.note) };
    }),
    facts: (Array.isArray(j.needs_facts) ? j.needs_facts : []).filter(isObj).map(f => {
      const kind = textOf(f.kind);
      const what = textOf(f.what);
      return {
        kind, what, meets: textOf(f.meets), rules: factRuleLines(f),
        markers: kind.toLowerCase() === 'condition' ? conditionMarkerLines(markers, what) : null,
        markerMeds: kind.toLowerCase() === 'condition' ? conditionMarkerMeds(markers, what) : null,
        listMark: kind.toLowerCase() === 'condition' ? listMarkFor(markers, lists, what) : null
      };
    }),
    conditionNote: conditionNote(markers),
    questionRules: criterionRuleLines(j),
    rule: textOf(j.rule_for_models), cannot: textOf(j.cannot_be_seen), ask: textOf(j.ask_the_gp),
    urgency: j.urgency === 'same_day' ? 'same_day' : 'routine',
    other: Object.keys(other).length ? JSON.stringify(other, null, 2) : ''
  };
}

/** The published statement of a criterion that was not drafted, from the extract file in the repository. */
function extractView(id) {
  const c = readCached(path.join(cfg.repo, 'criteria', '_extract', `${id}.json`));
  const j = c ? jsonOf(c).value : null;
  if (!isObj(j) || !textOf(j.statement)) return null;
  const src = isObj(j.source) ? j.source : {};
  return { statement: textOf(j.statement), credit: textOf(src.credit) || textOf(src.citation), licence: textOf(src.licence) };
}

const KIND_WORDS = {
  'pos-brand': 'brand names only', 'pos-buried': 'buried in a long history',
  'pos-fact': 'the fact is on the record', 'pos-nofact': 'the fact is not on the record'
};

function historiesView(index, entry) {
  const cases = entry.kind === 'criterion' ? casesOf(index, cfg, entry.id) : null;
  const list = [];
  if (cases) {
    const seen = new Set();
    for (const a of cases.answers) {
      const file = String(a.file ?? '').split('/').pop();
      seen.add(file);
      const findings = (Array.isArray(a.findings) ? a.findings : []).filter(isObj);
      const kind = textOf(a.kind);
      list.push({
        folder: entry.id, file, kind,
        tag: kind === 'positive' ? 'Planted' : kind === 'near_miss' ? 'Near miss: must not flag' : kind === 'clean' ? 'Clean: must not flag' : 'Not in the answer sheet',
        how: KIND_WORDS[file.replace(/\.csv$/i, '')] ?? '',
        about: textOf(a.about),
        alsoFor: findings.map(f => textOf(f.criterion)).filter(x => x && x !== entry.id),
        there: cases.csvs.includes(file)
      });
    }
    for (const file of cases.csvs) {
      if (!seen.has(file)) list.push({ folder: entry.id, file, kind: '', tag: 'Not in the answer sheet', how: '', about: '', alsoFor: [], there: true });
    }
  }
  const elsewhere = entry.kind === 'criterion'
    ? plantedElsewhere(index, cfg, entry.id).map(x => ({ folder: x.folder, file: x.file, kind: 'positive', tag: 'Also planted', how: `in the folder of ${x.folder}`, about: x.about, alsoFor: [], there: true }))
    : [];
  return { list: [...list, ...elsewhere], from: cases ? cases.place.name : '' };
}

function doubtsView(index, entry) {
  const out = [];
  for (const w of entry.waveLines) {
    if (!w.line.text && !w.line.beside) continue;
    const numbered = splitNumbered(w.line.text);
    out.push({
      from: `The drafter's line in the notes of wave ${w.place.name}`,
      beside: w.line.beside,
      text: numbered ? numbered.lead : w.line.text,
      items: numbered ? numbered.items : []
    });
  }
  if (entry.sheetNote && entry.sheetNote.lines.length) out.push({ from: `The criteria sheet: ${entry.sheetNote.from}`, lines: entry.sheetNote.lines });
  const wave = entry.waveLines[0];
  return {
    list: out,
    waveNotes: wave && wave.common.length ? { from: wave.place.name, lines: wave.common } : null,
    questions: index.sheet ? index.sheet.questions : []
  };
}

function detailPayload(index, entry, ledger) {
  const status = statusOf(entry, ledger);
  const out = {
    ...lightEntry(entry, ledger),
    position: entry.position, total: index.entries.length, familyWord: familyWord(entry.family), klass: entry.klass,
    file: {
      where: WHERE_WORDS[entry.top.place.where], wave: entry.top.place.wave, path: entry.top.file,
      others: entry.copies.slice(1).map(c => (c.place.wave ? `${WHERE_WORDS[c.place.where]}, ${c.place.wave}` : WHERE_WORDS[c.place.where]))
    },
    status, reviewer: ledger.reviewer ?? '',
    result: resultOf(cfg, entry), opinion: opinionOf(cfg, entry.id),
    audit: auditOf(cfg, entry.id, entry.parts),
    doubts: doubtsView(index, entry),
    histories: historiesView(index, entry),
    undo: undoTop()
  };
  if (entry.kind === 'criterion' && entry.json) out.criterion = criterionView(entry.json);
  if (entry.kind === 'not_drafted') out.notDrafted = { reason: entry.top.c.text.trim(), published: extractView(entry.id) };
  if (entry.error) out.error = entry.error;
  return out;
}

let searchMemo = { key: '', value: null };
function searchPayload(index) {
  const key = index.entries.map(e => e.id + ':' + e.hash).join('|');
  if (searchMemo.key !== key) {
    const texts = {};
    for (const e of index.entries) {
      const j = e.json;
      const parts = [e.id, e.label, e.title, familyWord(e.family)];
      if (j) {
        parts.push(textOf(j.plain_summary), textOf(j.statement).slice(0, 3000));
        for (const g of Array.isArray(j.medicine_groups) ? j.medicine_groups : []) {
          if (!isObj(g)) continue;
          parts.push(textOf(g.name), ...namesOf(g.ingredients));
          if (isObj(g.brands)) for (const list of Object.values(g.brands)) parts.push(...namesOf(list));
        }
      }
      texts[e.id] = parts.join(' ').toLowerCase();
    }
    searchMemo = { key, value: { texts } };
  }
  return searchMemo.value;
}

// ---------- undo: the last clicks, kept while the server runs ----------

const undoStack = [];
const WHAT_WORDS = {
  sign: 'Signed', agree: 'Agreed to leave out', change: 'Asked for a change to', withdraw: 'Took back the decision on',
  'list-right': 'Marked the list right:', 'list-change': 'Asked for a change to the list:'
};

let undoSerial = 0;

function undoTop() {
  const top = undoStack[undoStack.length - 1];
  return top ? { id: top.id, text: `${WHAT_WORDS[top.what]} ${top.label}`, token: top.token } : null;
}

const snapshot = (ledger, id) => ({
  entry: isObj(ledger.entries[id]) ? ledger.entries[id] : null,
  agreed: isObj(ledger.not_drafted_agreed?.[id]) ? ledger.not_drafted_agreed[id] : null
});

function restore(ledger, id, snap) {
  if (snap.entry) ledger.entries[id] = snap.entry; else delete ledger.entries[id];
  if (snap.agreed) {
    if (!isObj(ledger.not_drafted_agreed)) ledger.not_drafted_agreed = {};
    ledger.not_drafted_agreed[id] = snap.agreed;
  } else if (isObj(ledger.not_drafted_agreed)) delete ledger.not_drafted_agreed[id];
}

const listRow = (data, key) => (isObj(data.lists?.[key]) ? data.lists[key] : null);

/** Changes one list decision, saves the lists ledger only, and remembers how to undo it. */
function actList(key, label, what, change) {
  const data = listsNow();
  const before = structuredClone(listRow(data, key));
  change(data);
  if (JSON.stringify(before) === JSON.stringify(listRow(data, key))) return data;
  const written = saveLists(data);
  undoStack.push({
    kind: 'list', id: key, label, what, before, after: structuredClone(listRow(written, key)), token: String(++undoSerial)
  });
  if (undoStack.length > 200) undoStack.shift();
  return written;
}

/** Changes the ledger for one entry, saves it, and remembers how to undo it. */
function act(entry, what, change) {
  const ledger = ledgerNow();
  const before = structuredClone(snapshot(ledger, entry.id));
  change(ledger);
  const after = structuredClone(snapshot(ledger, entry.id));
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    saveLedger(ledger);
    undoStack.push({ id: entry.id, label: entry.label, what, before, after, token: String(++undoSerial) });
    if (undoStack.length > 200) undoStack.shift();
  }
  return ledger;
}

// ---------- requests ----------

class Refused extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 100000) { reject(new Refused(413, 'That is too much text to save in one go.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!isObj(j)) throw new Error('not an object');
        resolve(j);
      } catch {
        reject(new Refused(400, 'The request could not be read.'));
      }
    });
    req.on('error', reject);
  });
}

/** Only this computer, only this page. A page from another site cannot sign anything. */
function checkCaller(req, writing) {
  const hosts = [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`];
  if (!hosts.includes(String(req.headers.host ?? '').toLowerCase())) throw new Refused(403, 'This page answers only on this computer.');
  const origin = req.headers.origin;
  if (origin && !hosts.map(h => `http://${h}`).includes(String(origin).toLowerCase())) throw new Refused(403, 'This page answers only to itself.');
  if (writing) {
    if (req.headers['x-signoff'] !== '1') throw new Refused(403, 'This request did not come from the sign-off page.');
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Refused(415, 'The request could not be read.');
  }
}

function entryFor(index, id) {
  const entry = typeof id === 'string' ? index.byId.get(id) : null;
  if (!entry) throw new Refused(404, 'That criterion is not in the list any more. Reload the page.');
  return entry;
}

/** The file must still be the one the reviewer was shown. Read from disk at this moment. */
function sameFileAsShown(entry, shownHash) {
  const now = readFresh(entry.top.file);
  if (!now || now.hash !== shownHash || now.hash !== entry.hash) {
    forget(entry.top.file);
    throw new Refused(409, 'This file changed while you were reading it. The new version is on the page now. Please read it again.', { changed: true });
  }
  return now.hash;
}

function afterAction(index, entry, ledger) {
  return {
    ok: true, entry: lightEntry(entry, ledger), status: statusOf(entry, ledger), counts: countAll(index, ledger),
    signoff: signoffCounts(index, ledger, cfg), undo: undoTop()
  };
}

function afterList(index, ledger, lists) {
  const markers = readConditionMarkers(cfg.repo);
  return {
    ok: true, kind: 'list',
    counts: countAll(index, ledger),
    signoff: signoffCounts(index, ledger, cfg),
    listDecisions: listDecisionCounts(markers, lists),
    undo: undoTop()
  };
}

function conditionByKey(key) {
  const doc = readConditionMarkers(cfg.repo);
  const want = textOf(key).toLowerCase();
  if (!doc || !want) throw new Refused(404, 'That condition is not in the list any more. Reload the page.');
  const hit = doc.conditions.find(c => listLedgerKey(c) === want);
  if (!hit) throw new Refused(404, 'That condition is not in the list any more. Reload the page.');
  return hit;
}

function sameListAsShown(hit, shown) {
  const now = listFingerprint(hit);
  if (typeof shown !== 'string' || shown !== now) {
    throw new Refused(409, 'This list changed while you were reading it. The new version is on the page now. Please read it again.', { changed: true });
  }
  return now;
}

const actions = {
  '/api/reviewer'(body) {
    const name = textOf(body.name).replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Refused(400, 'Please type your name, between 2 and 80 characters.');
    const ledger = ledgerNow();
    if (ledger.reviewer !== name) {
      ledger.reviewer = name;
      saveLedger(ledger);
    }
    return { ok: true, reviewer: name };
  },

  '/api/sign'(body) {
    const index = buildIndex(cfg, true);
    const entry = entryFor(index, body.id);
    const health = auditHealth(cfg);
    if (!health.ok) throw new Refused(503, `${health.error} No criterion can be signed until it is back.`);
    if (!textOf(ledgerNow().reviewer)) throw new Refused(400, 'Type your name first.');
    if (entry.kind === 'criterion' && entry.error) throw new Refused(400, 'This file cannot be read, so it cannot be signed. Press NEEDS A CHANGE and say so.');
    const hash = sameFileAsShown(entry, body.file_hash);
    // The file he is looking at is refused first. Only then is the audit asked whether it read this text.
    if (!maySignCriterion(cfg, entry)) {
      const audit = auditOf(cfg, entry.id, entry.parts);
      const why = audit && audit.auditComplete && !audit.textMatches
        ? 'The audit was made for an earlier text of this criterion. It has to be read again before it can be signed.'
        : (audit?.finalTest?.text || 'The audit is not complete for this criterion.');
      throw new Refused(403, `Not ready to sign: ${why}`);
    }
    const standing = statusOf(entry, ledgerNow()).state;
    if (standing === 'change' || standing === 'nd_change') {
      // His written words are not replaced by one key press.
      throw new Refused(409, 'You asked for a change here. Remove that request first, then sign.');
    }
    const at = localIso();
    // The fingerprints of what he read are kept with the decision. If the file is only laid out again
    // later (line ends, spacing), the decision still stands. If a word changes, it does not.
    const seen = entry.parts ? { parts: entry.parts } : {};
    let ledger;
    if (entry.kind === 'not_drafted') {
      ledger = act(entry, 'agree', l => {
        if (statusOf(entry, l).state === 'nd_agreed') return;
        if (!isObj(l.not_drafted_agreed)) l.not_drafted_agreed = {};
        l.not_drafted_agreed[entry.id] = { at, file_hash: hash, ...seen };
        delete l.entries[entry.id];
      });
    } else {
      ledger = act(entry, 'sign', l => {
        const state = statusOf(entry, l).state;
        if (state === 'signed' || state === 'file_signed') return;       // already signed, on this version
        l.entries[entry.id] = { decision: 'signed', note: '', at, file_hash: hash, reviewer: textOf(l.reviewer), ...seen };
        if (isObj(l.not_drafted_agreed)) delete l.not_drafted_agreed[entry.id];
      });
    }
    return afterAction(index, entry, ledger);
  },

  '/api/change'(body) {
    const index = buildIndex(cfg, true);
    const entry = entryFor(index, body.id);
    if (!textOf(ledgerNow().reviewer)) throw new Refused(400, 'Type your name first.');
    const note = typeof body.note === 'string' ? body.note.replace(/\r\n/g, '\n').trim() : '';
    if (!note) throw new Refused(400, 'Please write what needs to change.');
    if (note.length > 6000) throw new Refused(400, 'That note is too long. Please keep it under 6,000 characters.');
    const hash = sameFileAsShown(entry, body.file_hash);
    const seen = entry.parts ? { parts: entry.parts } : {};
    const ledger = act(entry, 'change', l => {
      l.entries[entry.id] = { decision: 'change', note, at: localIso(), file_hash: hash, ...seen };
      if (isObj(l.not_drafted_agreed)) delete l.not_drafted_agreed[entry.id];
    });
    return afterAction(index, entry, ledger);
  },

  '/api/withdraw'(body) {
    const index = buildIndex(cfg, true);
    const entry = entryFor(index, body.id);
    const now = statusOf(entry, ledgerNow());
    if (now.state === 'signed' && now.applied) {
      throw new Refused(409, 'This signature has already been written into the file, so it cannot be taken back here. Press NEEDS A CHANGE and say why.');
    }
    const ledger = act(entry, 'withdraw', l => {
      delete l.entries[entry.id];
      if (isObj(l.not_drafted_agreed)) delete l.not_drafted_agreed[entry.id];
    });
    return afterAction(index, entry, ledger);
  },

  '/api/list-right'(body) {
    if (!textOf(ledgerNow().reviewer)) throw new Refused(400, 'Type your name first.');
    const hit = conditionByKey(body.key);
    const fingerprint = sameListAsShown(hit, body.fingerprint);
    const key = listLedgerKey(hit);
    const at = localIso();
    const by = textOf(ledgerNow().reviewer);
    const medicines = listMedicineNames(hit);
    const index = buildIndex(cfg, true);
    const lists = actList(key, textOf(hit.condition), 'list-right', data => {
      const row = data.lists[key];
      if (row && row.decision === 'right' && row.fingerprint === fingerprint && (row.note || '') === '') return;
      data.lists[key] = { decision: 'right', note: '', at, by, fingerprint, medicines };
    });
    return afterList(index, ledgerNow(), lists);
  },

  '/api/list-change'(body) {
    if (!textOf(ledgerNow().reviewer)) throw new Refused(400, 'Type your name first.');
    const note = typeof body.note === 'string' ? body.note.replace(/\r\n/g, '\n').trim() : '';
    if (!note) throw new Refused(400, 'Please write what needs to change.');
    if (note.length > 6000) throw new Refused(400, 'That note is too long. Please keep it under 6,000 characters.');
    const hit = conditionByKey(body.key);
    const fingerprint = sameListAsShown(hit, body.fingerprint);
    const key = listLedgerKey(hit);
    const at = localIso();
    const by = textOf(ledgerNow().reviewer);
    const medicines = listMedicineNames(hit);
    const index = buildIndex(cfg, true);
    const lists = actList(key, textOf(hit.condition), 'list-change', data => {
      const row = data.lists[key];
      if (row && row.decision === 'change' && row.fingerprint === fingerprint && row.note === note) return;
      data.lists[key] = { decision: 'change', note, at, by, fingerprint, medicines };
    });
    return afterList(index, ledgerNow(), lists);
  },

  '/api/undo'(body) {
    const index = buildIndex(cfg, true);
    const last = undoStack[undoStack.length - 1];
    if (!last) throw new Refused(409, 'There is nothing to undo.');
    if (textOf(body.token) !== last.token) {
      throw new Refused(409, 'That undo is for a different click. Nothing was changed.');
    }
    if (last.kind === 'list') {
      const data = listsNow();
      if (JSON.stringify(listRow(data, last.id)) !== JSON.stringify(last.after)) {
        undoStack.length = 0;
        throw new Refused(409, 'The ledger was changed from somewhere else, so the last click cannot be undone here.');
      }
      if (last.before) data.lists[last.id] = last.before; else delete data.lists[last.id];
      const written = saveLists(data);
      undoStack.pop();
      const words = last.what === 'list-change' && last.after && typeof last.after.note === 'string' ? last.after.note : '';
      const ledger = ledgerNow();
      return {
        ...afterList(index, ledger, written),
        id: last.id,
        undone: `${WHAT_WORDS[last.what]} ${last.label}`,
        note: words
      };
    }
    const ledger = ledgerNow();
    if (JSON.stringify(snapshot(ledger, last.id)) !== JSON.stringify(last.after)) {
      undoStack.length = 0;
      throw new Refused(409, 'The ledger was changed from somewhere else, so the last click cannot be undone here.');
    }
    restore(ledger, last.id, last.before);
    saveLedger(ledger);
    undoStack.pop();
    const entry = index.byId.get(last.id);
    // When the click that is taken back was a change request, his words leave the ledger.
    // They are handed back to the page, which puts them in the change box again, so that they are not lost.
    const words = last.what === 'change' && last.after.entry && typeof last.after.entry.note === 'string' ? last.after.entry.note : '';
    return {
      ok: true, id: last.id, undone: `${WHAT_WORDS[last.what]} ${last.label}`, note: words,
      entry: entry ? lightEntry(entry, ledger) : null, status: entry ? statusOf(entry, ledger) : null,
      counts: countAll(index, ledger), undo: undoTop()
    };
  }
};

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${cfg.port}`);
  const route = url.pathname;
  if (req.method === 'POST') {
    checkCaller(req, true);
    const action = actions[route];
    if (!action) throw new Refused(404, 'There is no such action.');
    const body = await readBody(req);
    freshRequest();
    send(res, 200, action(body));
    return;
  }
  freshRequest();                                    // every request reads the folders afresh
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new Refused(405, 'That is not something this page does.');
  checkCaller(req, false);

  if (route === '/' || route === '/index.html') {
    send(res, 200, fs.readFileSync(PAGE_FILE), 'text/html; charset=utf-8');
    return;
  }
  if (route === '/mark.svg') {
    const mark = readCached(MARK_FILE);
    send(res, 200, mark ? mark.text : PLAIN_MARK, 'image/svg+xml; charset=utf-8');
    return;
  }
  if (route === '/api/list') {
    const index = buildIndex(cfg);
    send(res, 200, listPayload(index, ledgerNow()));
    return;
  }
  if (route === '/api/search-index') {
    send(res, 200, searchPayload(buildIndex(cfg)));
    return;
  }
  if (route === '/api/criterion') {
    const index = buildIndex(cfg);
    const entry = entryFor(index, url.searchParams.get('id'));
    send(res, 200, detailPayload(index, entry, ledgerNow()));
    return;
  }
  if (route === '/api/history') {
    const index = buildIndex(cfg);
    const entry = entryFor(index, url.searchParams.get('id'));
    const folder = entryFor(index, url.searchParams.get('folder') || entry.id);
    const file = url.searchParams.get('file') ?? '';
    const cases = casesOf(index, cfg, folder.id);
    if (!cases || !cases.csvs.includes(file)) throw new Refused(404, 'That test history is not there any more.');
    const answer = cases.answers.find(a => String(a.file ?? '').split('/').pop() === file);
    const cited = (Array.isArray(answer?.findings) ? answer.findings : [])
      .filter(f => isObj(f) && f.criterion === entry.id)
      .flatMap(f => (Array.isArray(f.must_cite) ? f.must_cite.flat() : []))
      .filter(x => typeof x === 'string');
    const history = readHistory(path.join(cases.dir, file), cited);
    if (!history) throw new Refused(404, 'That test history could not be read.');
    send(res, 200, { folder: folder.id, file, from: cases.place.name, cited: cited.length, ...history });
    return;
  }
  throw new Refused(404, 'There is nothing at that address.');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof Refused) send(res, e.status, { ok: false, message: e.message, ...e.extra });
    else if (e instanceof LedgerError) send(res, 500, { ok: false, message: e.message, ledger: true });
    else {
      console.error(e);
      send(res, 500, { ok: false, message: 'Something went wrong on this computer. Nothing was changed. The window that runs the page shows the detail.' });
    }
  });
});

server.on('error', e => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`Port ${cfg.port} is already in use. The sign-off page may already be running: open http://127.0.0.1:${cfg.port}`);
    console.error('To use another port:  $env:PORT=8791; node tools\\signoff\\server.mjs');
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(cfg.port, '127.0.0.1', () => {
  let line = '';
  try {
    const index = buildIndex(cfg, true);
    const t = index.tally;
    const drafts = index.entries.filter(e => e.kind === 'criterion' && e.top.place.where.startsWith('waves')).length;
    line = `${t.total} criteria listed: ${t.repo} in the repository, ${t.boardRepair + t.board} on the build board, ${drafts} drafts in the waves, ${t.notDrafted} not drafted.`;
    if (t.expected && (t.missing.length || t.total !== t.expected)) line += ` Expected ${t.expected}. Missing: ${t.missing.join(', ') || 'none by name'}.`;
    for (const out of t.leftOut) line += `\nLeft out: ${out.id}. ${out.why}`;
    for (const p of t.problems) line += `\nNote: ${p}`;
  } catch (e) {
    line = `The criteria could not be listed: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.log('ClinicaLANTERN clinical reviewer sign-off');
  console.log(`Open this address in your browser:  http://127.0.0.1:${cfg.port}`);
  console.log(line);
  console.log(`Ledger: ${cfg.ledger}`);
  console.log('Leave this window open while you work. Press Ctrl+C here to stop.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    // Opens the address in the usual browser. Only when asked for, so that a test never opens a window.
    spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${cfg.port}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
