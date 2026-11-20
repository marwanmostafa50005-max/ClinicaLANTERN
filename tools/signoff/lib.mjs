// Shared by server.mjs and apply.mjs.
// It knows where the criteria live, which copy of a criterion is the newest, how the ledger is
// read and written, and how a signature is written into a criterion file without touching any
// other byte. Node built-in modules only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO = path.resolve(HERE, '..', '..');
const HOME = path.dirname(REAL_REPO);

// ---------- settings ----------

/**
 * Where everything is. Each root can be set by an environment variable, for tests.
 * When SIGNOFF_REPO is set, the other roots are NOT taken from the real folders: a root that is not
 * given is simply absent. A test can therefore never read or sign a real file by accident.
 */
export function loadConfig(env = process.env) {
  const custom = Boolean(env.SIGNOFF_REPO);
  const repo = path.resolve(env.SIGNOFF_REPO || REAL_REPO);
  const runtime = path.join(HOME, 'ClinicaLANTERN-Lantern-runtime');
  const hub = path.join(HOME, 'ClinicaLANTERN-AgentHub', 'fireup');
  const pick = (given, real) => (given ? path.resolve(given) : custom ? null : real);
  const port = Number(env.PORT);
  return {
    repo,
    waves: pick(env.SIGNOFF_WAVES, path.join(runtime, 'waves-claude')),
    board: pick(env.SIGNOFF_BOARD, path.join(hub, 'w', 'kimiwork', 'waves')),
    ledger: path.resolve(env.SIGNOFF_LEDGER || path.join(repo, 'docs', 'signoff', 'ledger.json')),
    run0: pick(env.SIGNOFF_RUN0, path.join(runtime, 'run0', 'results', 'results.json')),
    summary: pick(env.SIGNOFF_SUMMARY, path.join(hub, 'runs', 'waves', 'summary.json')),
    gemini: pick(env.SIGNOFF_GEMINI, path.join(hub, 'gemini', 'reviews')),
    audit: pick(env.SIGNOFF_AUDIT, path.join(hub, 'pack', 'audit', 'AUDIT_BY_CRITERION.json')),
    sheet: path.join(repo, 'docs', 'CRITERIA_SHEET.md'),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8790
  };
}

// ---------- small helpers ----------

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const byName = (a, b) => collator.compare(a, b);

/** Local time with its offset, for example 2026-11-19T08:15:02+11:00. The first ten characters are the local date. */
export function localIso(d = new Date()) {
  const pad = n => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

// These are never opened, whatever asks for them.
const NEVER = ['sealed', 'holdout', 'review-card', 'founder-review-queue'];
export function allowed(file) {
  const low = String(file).toLowerCase();
  return !NEVER.some(word => low.includes(word)) && path.basename(low) !== 'synthetic_cases.py';
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------- reading files, remembered by file time ----------

const fileCache = new Map();

/** The bytes of a file with their hash. Read again only when the file's time or size has changed. Returns null when there is no such file. */
export function readCached(file) {
  if (!file || !allowed(file)) return null;
  let st;
  try { st = fs.statSync(file); } catch { fileCache.delete(file); return null; }
  if (!st.isFile()) return null;
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const entry = { file, mtimeMs: st.mtimeMs, size: st.size, hash: sha256(buf), text: buf.toString('utf8').replace(/^﻿/, '') };
  fileCache.set(file, entry);
  return entry;
}

/** Forgets what was remembered about a file, so that it is read again. */
export function forget(file) {
  fileCache.delete(file);
}

/** The bytes of a file as they are on disk now, never from memory. Used at the moment of signing. */
export function readFresh(file) {
  if (!file || !allowed(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    return { buf, hash: sha256(buf) };
  } catch {
    return null;
  }
}

/** The file as JSON. { value } or { error }. Remembered with the file. */
export function jsonOf(cached) {
  if (!cached) return { error: 'There is no such file.' };
  if (cached.json === undefined) {
    try { cached.json = { value: JSON.parse(cached.text) }; } catch (e) { cached.json = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return cached.json;
}

function listDir(dir) {
  if (!dir || !allowed(dir)) return [];
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const textOf = v => (typeof v === 'string' ? v.trim() : '');
const namesOf = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []);

// ---------- the places a criterion can be, newest first ----------

const WAVE_NAME = /^W(\d+)(?:-r(\d+))?$/i;

function wavesIn(root, notes, what) {
  const base = [];
  const repaired = [];
  for (const d of listDir(root)) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    const m = WAVE_NAME.exec(d.name);
    if (!m) {
      if (fs.existsSync(path.join(dir, 'criteria'))) notes.push(`The folder ${d.name} ${what} was not read. Its name is not W and a number, or W, a number, -r and a number.`);
      continue;
    }
    const wave = { name: d.name, n: Number(m[1]), r: m[2] === undefined ? 0 : Number(m[2]), dir };
    (m[2] === undefined ? base : repaired).push(wave);
  }
  base.sort((a, b) => a.n - b.n);
  repaired.sort((a, b) => b.r - a.r || a.n - b.n);
  return { base, repaired };
}

/**
 * Every place, in the order that decides which copy is shown:
 * the repository, then a repaired wave on the board, then the board, then the drafts in waves-claude.
 */
export function listPlaces(cfg, notes = []) {
  const places = [{
    where: 'repo', name: 'repository', wave: null,
    criteriaDir: path.join(cfg.repo, 'criteria'), casesDir: path.join(cfg.repo, 'cases'), notesFile: null
  }];
  const add = (where, wave) => places.push({
    where, name: wave.name, wave: wave.name,
    criteriaDir: path.join(wave.dir, 'criteria'), casesDir: path.join(wave.dir, 'cases'), notesFile: path.join(wave.dir, 'WAVE.md')
  });
  const board = wavesIn(cfg.board, notes, 'on the board');
  const drafts = wavesIn(cfg.waves, notes, 'in waves-claude');
  board.repaired.forEach(w => add('board_repair', w));
  board.base.forEach(w => add('board', w));
  drafts.repaired.forEach(w => add('waves_repair', w));
  drafts.base.forEach(w => add('waves', w));
  return places;
}

export const WHERE_WORDS = {
  repo: 'the repository',
  board_repair: 'a repaired wave on the build board',
  board: 'the build board',
  waves_repair: 'a repaired wave of drafts',
  waves: 'the drafts (waves-claude)'
};

// ---------- which list is the first ten ----------

function readSets(cfg) {
  const read = name => {
    const c = readCached(path.join(cfg.repo, 'criteria', name));
    const j = c ? jsonOf(c).value : null;
    return isObj(j) && Array.isArray(j.active) ? { name, active: namesOf(j.active), reserves: namesOf(j.reserves) } : null;
  };
  const inUse = read('active.json');
  const proposed = read('active.proposed.json');
  if (inUse && inUse.active.length === 10) return inUse;
  if (proposed && proposed.active.length > 0) return proposed;
  return inUse ?? { name: null, active: [], reserves: [] };
}

// ---------- the wave notes (WAVE.md): one line per criterion, written by the drafter ----------

const CLASS_WORD = /^(?:class\s*)?([ABC])(?:\s*\(.*\))?$/i;
const DOUBT_WORD = /\b(?:Doubts to check|Doubts|Checks?|Not drafted)\s*[:.]\s/i;

function splitWaveLine(rest) {
  let parts = rest.split(/\s+\|\s+/);
  let head = '';
  if (parts.length > 1 && CLASS_WORD.test(parts[0].trim())) {
    head = parts.shift().trim();
  } else if (parts.length === 1) {
    const comma = /^((?:class\s+[ABC]\b[^,|]*)|[ABC])\s*,\s*/i.exec(rest);
    if (comma) {
      head = comma[1].trim();
      parts = [rest.slice(comma[0].length)];
    }
  }
  let title = '';
  let body = '';
  if (parts.length >= 2) {
    title = parts[0];
    body = parts.slice(1).join(' | ');
  } else {
    const m = DOUBT_WORD.exec(parts[0]);
    if (m && m.index > 0) {
      title = parts[0].slice(0, m.index);
      body = parts[0].slice(m.index);
    } else {
      body = parts[0];
    }
  }
  const k = CLASS_WORD.exec(head);
  return {
    klass: k ? k[1].toUpperCase() : '',
    beside: head.replace(/^(?:class\s*)?[ABC]\b\s*/i, '').replace(/^\((.*)\)$/, '$1').trim(),   // what stands beside the class letter
    title: title.trim().replace(/[.,;:]$/, ''),
    text: body.trim().replace(/^(?:Doubts to check|Doubts|Checks?)\s*:\s*/i, '')
  };
}

/** Reads a WAVE.md. Lines that start with one of the wave's criteria belong to it. Every other line is a note for the whole wave. */
export function parseWaveNotes(text, ids) {
  const byId = new Map();
  const common = [];
  const longestFirst = [...ids].sort((a, b) => b.length - a.length);
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bare = line.replace(/^(?:[-*+]\s+)/, '').replace(/^[*`_]+/, '');
    const upper = bare.toUpperCase();
    const id = longestFirst.find(x => upper.startsWith(x.toUpperCase()) && !/[A-Za-z0-9-]/.test(bare.charAt(x.length)));
    if (!id) {
      common.push(line.replace(/^#+\s*/, '').replace(/^ALL\s*\|\s*/i, ''));
      continue;
    }
    const rest = bare.slice(id.length).replace(/^[*`_]*\s*[|,:.]?\s*/, '');
    const parsed = splitWaveLine(rest);
    const before = byId.get(id);
    if (before) before.text = `${before.text} ${parsed.text}`.trim();
    else byId.set(id, parsed);
  }
  return { byId, common };
}

/** Splits "(1) one. (2) two." into its numbered points. Returns null when the text is not numbered that way. */
export function splitNumbered(text) {
  const mark = /\((\d{1,2})\)\s+/g;
  const run = [];
  let m;
  while ((m = mark.exec(text))) {
    if (Number(m[1]) === run.length + 1) run.push({ at: m.index, end: mark.lastIndex });
  }
  if (run.length < 2) return null;
  return {
    lead: text.slice(0, run[0].at).trim(),
    items: run.map((mk, i) => text.slice(mk.end, i + 1 < run.length ? run[i + 1].at : text.length).trim())
  };
}

function waveNotesOf(place, ids) {
  const c = place.notesFile ? readCached(place.notesFile) : null;
  if (!c) return null;
  const key = [...ids].sort().join('|');
  if (!c.wave || c.waveKey !== key) {
    c.wave = parseWaveNotes(c.text, ids);
    c.waveKey = key;
  }
  return c.wave;
}

// ---------- the criteria sheet (docs/CRITERIA_SHEET.md): the "Please check" notes for the nineteen ----------

const sheetKey = s => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');

export function parseCriteriaSheet(text) {
  const notes = new Map();
  let questions = [];
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  const untilRule = start => {
    const out = [];
    let j = start;
    while (j < lines.length && !/^---\s*$/.test(lines[j]) && !/^##\s/.test(lines[j])) out.push(lines[j++]);
    while (out.length && !out[out.length - 1].trim()) out.pop();
    while (out.length && !out[0].trim()) out.shift();
    return out;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const numbered = /^##\s+\d+\.\s+(.+?):\s+(.*)$/.exec(line);
    if (numbered) {
      let j = i + 1;
      while (j < lines.length && !/^##\s/.test(lines[j]) && !/^\*\*Please check\*\*/.test(lines[j])) j++;
      if (j < lines.length && /^\*\*Please check\*\*/.test(lines[j])) {
        const first = lines[j].replace(/^\*\*Please check\*\*\s*/, '').trim();
        const block = untilRule(j + 1);
        notes.set(sheetKey(numbered[1]), { from: 'Please check' + (first ? ' ' + first : ''), lines: block });
      }
      continue;
    }
    if (/^##\s+Questions that apply to several criteria/i.test(line)) {
      questions = untilRule(i + 1);
      continue;
    }
    const reserve = /^-\s+\*\*R\d+\.\s+(.+?):\s+(.*?)\*\*\s*$/.exec(line);
    if (reserve) {
      const block = [];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}-\s+/.test(lines[j])) block.push(lines[j++].replace(/^\s+/, ''));
      notes.set(sheetKey(reserve[1]), { from: 'Notes on this reserve', lines: block });
    }
  }
  return { notes, questions };
}

function sheetOf(cfg) {
  const c = readCached(cfg.sheet);
  if (!c) return null;
  if (!c.sheet) c.sheet = parseCriteriaSheet(c.text);
  return c.sheet;
}

// ---------- the index: one entry for each criterion ----------

const FAMILY_WORDS = {
  STOPP_START: 'STOPP/START', EU7: 'EU(7)-PIM', BRISNIK: 'Brisnik', OPTIMISE: 'OPTIMISE',
  PROMPT: 'PROMPT', BANSAL: 'Bansal', PINCER: 'PINCER',
  // Families added on the founder's orders of 18 November (waves W152 and W161 up).
  KHAWAGI: 'Khawagi', CKD: 'CKD', DREISCHULTE: 'Dreischulte', SCOTRESP: 'Scottish respiratory',
  POPI: 'POPI', VTE: 'VTE', POISONSTD: 'Poisons standard', GERARD: 'Gerard', USMEC: 'US MEC',
  CARETRACK: 'CareTrack', CDCOPIOID: 'CDC opioid', UKKA: 'UKKA'
};
export const familyWord = key => FAMILY_WORDS[key] ?? key;

/** The same content with the signature fields taken out, as a hash. Two copies with the same key say the same thing. */
function contentKey(cached) {
  if (cached.contentKey) return cached.contentKey;
  const j = jsonOf(cached).value;
  if (isObj(j)) {
    const { draft: _d, signed_by_clinical_reviewer: _s, ...rest } = j;
    cached.contentKey = sha256(Buffer.from(JSON.stringify(rest)));
  } else {
    cached.contentKey = cached.hash;
  }
  return cached.contentKey;
}

// ---------- the words of a file, apart from its layout ----------

const SIGNATURE_FIELDS = new Set(['draft', 'signed_by_clinical_reviewer']);
const canon = v => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);

/**
 * One short fingerprint for each field of a criterion, the two signature fields left out.
 * Two files with the same parts say the same thing, however they are laid out (line ends, spacing,
 * the order of the fields). A changed word, number or list entry changes the part it is in.
 */
export function contentParts(j) {
  if (!isObj(j)) return null;
  const parts = {};
  for (const k of Object.keys(j).sort()) {
    if (!SIGNATURE_FIELDS.has(k)) parts[k] = sha256(Buffer.from(JSON.stringify(canon(j[k])), 'utf8')).slice(0, 16);
  }
  return parts;
}

/**
 * The rules that decide when the pharmacist is asked, and what an answer does.
 * Every fact is spelled out, including the default, so a signature is of the whole criterion.
 */
export function factRuleLines(fact) {
  if (!isObj(fact)) return [];
  const lines = [];
  const ask = fact.ask_when;
  if (ask === 'always') lines.push('Asked for every patient. The pharmacist may answer it or leave it.');
  else if (isObj(ask) && textOf(ask.group)) lines.push(`Asked when a medicine of group ${textOf(ask.group)} is supplied.`);
  else lines.push('Asked only when a possible finding is waiting for this fact.');
  const close = fact.close_when;
  if (isObj(close) && textOf(close.group)) {
    const months = Number.isInteger(close.months) && close.months > 0 ? close.months : 6;
    lines.push(`A standing question is not asked when a medicine of group ${textOf(close.group)} was supplied in the last ${months} months.`);
  }
  const options = Array.isArray(fact.options) ? fact.options.filter(isObj) : [];
  if (options.length) {
    const effects = { meets: 'the fact is met', does_not_meet: 'the fact is not met', unknown: 'not known, and a possible finding stays' };
    lines.push('Answers: ' + options.map(o => `${textOf(o.words)} (${effects[o.effect] || textOf(o.effect) || 'no effect written'})`).join('; ') + '.');
  } else {
    lines.push('Answers: Yes (the fact is met), No (the fact is not met), Not known (a possible finding stays).');
  }
  const known = new Set(['kind', 'what', 'meets', 'ask_when', 'close_when', 'options']);
  for (const [key, value] of Object.entries(fact)) {
    if (known.has(key)) continue;
    lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return lines;
}

/**
 * One shared list of medicines for each condition, read from criteria/_markers/condition-markers.json.
 * The file is remembered by its time and size, the same way every other file is. A missing file, a file
 * that cannot be read, or a file that is not this list, is not an error: the page is unchanged.
 * The list is not part of a criterion, so it is not part of a signature.
 */
// The clinical reviewer's standard for these lists (20 November 2026): every name is one the SNOMED AU medicines list
// holds; the link from a medicine to a condition comes from its Australian registered indication or PBS restriction.
// How far the reading has gone is written by the list file itself (its field reading_stage) and shown after this note.
export const CONDITION_LIST_NOTE = 'One list for each condition, shared by every criterion that needs it. Every name is one the SNOMED AU medicines list holds, checked by program. The link from a medicine to the condition is its Australian registered indication or PBS restriction. It is a draft until you say it is right. To correct a list, press NEEDS A CHANGE on any criterion that shows it and say what is missing or wrong.';

/** The note for the page: the standing sentence, then how far the reading has gone, as the list file says it. */
export function conditionNote(doc) {
  if (!doc) return '';
  const stage = textOf(doc.stage);
  return stage ? `${CONDITION_LIST_NOTE} ${stage}` : CONDITION_LIST_NOTE;
}
export const CONDITION_LIST_PENDING = 'The list of medicines for this condition is being researched tonight.';

export function markersFile(repo) {
  return path.join(repo, 'criteria', '_markers', 'condition-markers.json');
}

const normFact = s => textOf(s).toLowerCase();

/** "ingredient (brand, brand)", or the ingredient alone when no brand is named. Empty when there is no ingredient. */
function medicineName(item) {
  if (!isObj(item)) return '';
  const ingredient = textOf(item.ingredient);
  if (!ingredient) return '';
  const brands = namesOf(item.brands);
  return brands.length ? `${ingredient} (${brands.join(', ')})` : ingredient;
}

/**
 * The source that follows a medicine. An https page is a link whose words are `source`
 * (or the address, when no source words are given). Any other page is plain words.
 * A source with no page is those words. Neither is "source not recorded".
 */
export function sourceShow(item) {
  const source = textOf(isObj(item) ? item.source : '');
  const page = textOf(isObj(item) ? item.page : '');
  const https = /^https:\/\//i.test(page);
  if (https) return { words: source || page, href: page };
  if (page && source) return { words: `${source} ${page}`, href: '' };
  if (source) return { words: source, href: '' };
  if (page) return { words: page, href: '' };
  return { words: 'source not recorded', href: '' };
}

/**
 * A medicine of the second class ("other medicines used for it") has no source of its own: it never opens a
 * question. It is shown by its name. When the list gives the reason why it is not among the medicines that point to
 * the condition (no registered indication or PBS restriction was read for it; it points only under one brand or one
 * strength), that reason follows the name in brackets. The words "source not recorded" belong to a medicine that
 * points to the condition and has no source, never to this class. (20 November 22:30, the coordinator: after
 * G-LIST-SOURCES every one of these medicines was followed by "source not recorded".)
 */
function otherNote(item) {
  const why = textOf(isObj(item) ? item.mostly_used_for : '');
  return /no registered indication|only under the brand|only at the strength/i.test(why) ? `(${why})` : '';
}

/** One medicine as the page shows it: the name, then the source words, and the link when the page is https. */
export function medicineEntries(list, other = false) {
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const name = medicineName(item);
    if (!name) return null;
    // an item of the second class that carries a source of its own is shown with it, as any medicine; one that has
    // none (every item of the lists file today) is shown by its name, with the reason when the list gives one
    if (other && !textOf(item.source) && !textOf(item.page)) return { name, words: otherNote(item), href: '' };
    const source = sourceShow(item);
    return { name, words: source.words, href: source.href };
  }).filter(Boolean);
}

function medicineText(list, other = false) {
  return medicineEntries(list, other).map(entry => (entry.words ? `${entry.name} ${entry.words}` : entry.name)).join('; ');
}

function linesForCondition(c) {
  const pointing = medicineText(c.points_to_it);
  const other = medicineText(c.also_used_for_it, true);
  const lines = [
    `Medicines that point to this condition (the application asks about it when one is supplied):${pointing ? ' ' + pointing : ''}`,
    `Other medicines used for it, which have other uses (never asked alone):${other ? ' ' + other : ''}`
  ];
  const none = textOf(c.no_medicine_points_to_it);
  if (none) lines.push(`No medicine points to this condition: ${none}`);
  const miss = textOf(c.what_the_list_misses);
  if (miss) lines.push(`What the list can miss: ${miss}`);
  return lines;
}

/** The shared lists, or null when there is nothing to show. Never throws. */
export function readConditionMarkers(repo) {
  const cached = readCached(markersFile(repo));
  if (!cached) return null;
  const parsed = jsonOf(cached);
  if (!isObj(parsed.value) || !Array.isArray(parsed.value.conditions)) return null;
  return { conditions: parsed.value.conditions.filter(isObj), stage: textOf(parsed.value.reading_stage) };
}

/**
 * The lines for one condition fact. null when there is no file.
 * The fact name is matched to fact_names without regard to case or outer spaces.
 * A file that has no list for that name says the list is still being researched.
 */
export function conditionHit(doc, what) {
  if (!doc) return null;
  const key = normFact(what);
  if (!key) return null;
  return doc.conditions.find(c => namesOf(c.fact_names).some(name => normFact(name) === key)) ?? null;
}

export function conditionMarkerLines(doc, what) {
  if (!doc) return null;
  const hit = conditionHit(doc, what);
  if (!hit) return [CONDITION_LIST_PENDING];
  return linesForCondition(hit);
}

/**
 * The two medicine lists as entries, so the page can make an https source a link.
 * null when there is no file, or no list for this fact (the pending sentence is then the lines).
 */
export function conditionMarkerMeds(doc, what) {
  const hit = conditionHit(doc, what);
  if (!hit) return null;
  return {
    pointing: medicineEntries(hit.points_to_it),
    other: medicineEntries(hit.also_used_for_it, true)
  };
}

/** What /api/list adds so the page can show the lists. null when the file is not there. */
export function conditionListsView(doc) {
  if (!doc) return null;
  return {
    note: conditionNote(doc),
    conditions: doc.conditions.map(c => ({
      condition: textOf(c.condition),
      question: textOf(c.question),
      fact_names: namesOf(c.fact_names),
      lines: linesForCondition(c)
    }))
  };
}

/** The key in lists-ledger.json: the condition's name, lower case, outer spaces removed. */
export function listLedgerKey(condition) {
  return textOf(isObj(condition) ? condition.condition : condition).toLowerCase();
}

/** sha256 of one condition's entry. Keys are sorted at every level, so layout does not change it. */
export function listFingerprint(condition) {
  return sha256(Buffer.from(JSON.stringify(canon(condition)), 'utf8'));
}

/** The medicine names on a condition, in file order, as the page shows each name. */
export function listMedicineNames(condition) {
  if (!isObj(condition)) return [];
  const out = [];
  for (const item of [
    ...(Array.isArray(condition.points_to_it) ? condition.points_to_it : []),
    ...(Array.isArray(condition.also_used_for_it) ? condition.also_used_for_it : [])
  ]) {
    const name = medicineName(item);
    if (name) out.push(name);
  }
  return out;
}

/**
 * What a saved decision means for the condition as the file holds it now.
 * state is right, change, not_looked, or changed_since (the fingerprint is no longer the one he decided on).
 * A changed_since decision does not count as decided. added and removed are medicine names.
 */
export function listDecisionOf(saved, condition) {
  const fingerprint = listFingerprint(condition);
  const key = listLedgerKey(condition);
  if (!saved || (saved.decision !== 'right' && saved.decision !== 'change')) {
    return { key, state: 'not_looked', fingerprint };
  }
  const base = {
    key,
    at: textOf(saved.at),
    by: textOf(saved.by),
    note: typeof saved.note === 'string' ? saved.note : '',
    fingerprint
  };
  if (saved.fingerprint !== fingerprint) {
    const before = Array.isArray(saved.medicines) ? saved.medicines.filter(x => typeof x === 'string') : null;
    const now = listMedicineNames(condition);
    return {
      ...base,
      state: 'changed_since',
      was: saved.decision,
      added: before ? now.filter(n => !before.includes(n)) : [],
      removed: before ? before.filter(n => !now.includes(n)) : [],
      namesKnown: Boolean(before)
    };
  }
  return { ...base, state: saved.decision };
}

/** Counts for /api/list listDecisions. A list that changed since the decision is not counted as right or change. */
export function listDecisionCounts(doc, lists) {
  const counts = { right: 0, change: 0, notLookedAt: 0, changedSince: 0 };
  if (!doc) return counts;
  const saved = isObj(lists?.lists) ? lists.lists : {};
  for (const c of doc.conditions) {
    const view = listDecisionOf(saved[listLedgerKey(c)], c);
    if (view.state === 'right') counts.right++;
    else if (view.state === 'change') counts.change++;
    else if (view.state === 'changed_since') counts.changedSince++;
    else counts.notLookedAt++;
  }
  return counts;
}

/** Criteria that show this condition, in the order of the sign-off list. Each carries its number. */
export function criteriaShowingCondition(index, condition) {
  const names = new Set(namesOf(condition?.fact_names).map(normFact));
  if (!names.size || !index || !Array.isArray(index.entries)) return [];
  const out = [];
  for (const entry of index.entries) {
    const facts = entry.json && Array.isArray(entry.json.needs_facts) ? entry.json.needs_facts : [];
    const shows = facts.some(f => isObj(f) && normFact(f.kind) === 'condition' && names.has(normFact(f.what)));
    if (shows) out.push({ id: entry.id, label: entry.label, n: entry.n || '' });
  }
  return out;
}

/**
 * The condition lists for the page: question, both medicine lists, the miss lines, the criteria that
 * show each one, and the decision. null when the file is not there.
 */
export function conditionListsPage(doc, index, listsLedger) {
  const view = conditionListsView(doc);
  if (!view) return null;
  const saved = isObj(listsLedger?.lists) ? listsLedger.lists : {};
  view.conditions = doc.conditions.map(c => ({
    condition: textOf(c.condition),
    key: listLedgerKey(c),
    question: textOf(c.question),
    fact_names: namesOf(c.fact_names),
    lines: linesForCondition(c),
    pointing: medicineEntries(c.points_to_it),
    // an "other" medicine is shown by its name, as under a criterion (not followed by "source not recorded")
    other: medicineEntries(c.also_used_for_it, true),
    none: textOf(c.no_medicine_points_to_it),
    miss: textOf(c.what_the_list_misses),
    criteria: criteriaShowingCondition(index, c),
    decision: listDecisionOf(saved[listLedgerKey(c)], c)
  }));
  return view;
}

/** only_sex and count_supplies, in the same plain words the rest of the page uses. */
export function criterionRuleLines(j) {
  if (!isObj(j)) return [];
  const lines = [];
  if (j.only_sex === 'female' || j.only_sex === 'male') {
    lines.push(`A standing question is withheld unless the patient is ${j.only_sex}. A missing sex is still asked.`);
  }
  const count = j.count_supplies;
  if (isObj(count)) {
    const forms = Array.isArray(count.form_has) ? count.form_has.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
    const span = count.window === 'last' ? 'the latest run of months' : 'any run of months';
    const months = Number.isInteger(count.months) ? count.months : '';
    lines.push(`The application counts supplies of group ${textOf(count.group)} over ${months} months (${span})${forms.length ? `, only when the form has: ${forms.join(', ')}` : ''}.`);
  }
  return lines;
}

/** The same for a note that says why a criterion was not drafted: its text, line ends and outer spaces apart. */
export function noteParts(text) {
  const plain = String(text).replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').trim();
  return { text: sha256(Buffer.from(plain, 'utf8')).slice(0, 16) };
}

/** The names of the parts that differ between two sets of fingerprints. null when either set is missing. */
export function changedParts(before, now) {
  if (!isObj(before) || !isObj(now)) return null;
  const names = new Set([...Object.keys(before), ...Object.keys(now)]);
  return [...names].filter(k => before[k] !== now[k]).sort();
}

/** True when a ledger entry kept the fingerprints of what the reviewer read, and these parts are the same ones. */
export function sameWordsAs(saved, partsNow) {
  if (!isObj(saved) || !isObj(saved.parts) || Object.keys(saved.parts).length === 0) return false;
  const diff = changedParts(saved.parts, partsNow);
  return Array.isArray(diff) && diff.length === 0;
}

/** The wording the models are given, in one string, as the scorer keeps it. Used to tell whether a scored run read this text. */
export function modelTextKey(j) {
  if (!isObj(j)) return '';
  const groups = (Array.isArray(j.medicine_groups) ? j.medicine_groups : []).map((g, i) => {
    const brands = {};
    if (isObj(g?.brands)) for (const [k, v] of Object.entries(g.brands)) brands[k] = namesOf(v);
    return [textOf(g?.key) || String.fromCharCode(65 + i), textOf(g?.name), namesOf(g?.ingredients), brands, textOf(g?.note)];
  });
  return JSON.stringify([textOf(j.label), textOf(j.statement), textOf(j.rule_for_models), groups]);
}

let requestNo = 0;
/** Called at the start of every request. What was worked out for an earlier request is not used again: the folders are read afresh. */
export function freshRequest() {
  requestNo++;
}

let indexMemo = { no: -1, key: '', value: null };

/**
 * Reads the folders and returns one entry for each criterion, in reading order.
 * The contents of each file are remembered by file time, so this is quick. Within one request the
 * listing is worked out once. Pass fresh=true to read the folders again in any case.
 */
export function buildIndex(cfg, fresh = false) {
  const memoKey = JSON.stringify([cfg.repo, cfg.board, cfg.waves, cfg.sheet]);
  if (!fresh && indexMemo.value && indexMemo.key === memoKey && indexMemo.no === requestNo) return indexMemo.value;

  const problems = [];
  const places = listPlaces(cfg, problems);
  const copies = new Map();        // id -> copies, newest first
  for (const place of places) {
    const ids = [];
    for (const d of listDir(place.criteriaDir)) {
      if (!d.isDirectory() || d.name.startsWith('_') || d.name.startsWith('.')) continue;
      if (!SAFE_ID.test(d.name)) { problems.push(`The folder "${d.name}" in ${place.name} was not read. Its name cannot be a criterion number.`); continue; }
      const dir = path.join(place.criteriaDir, d.name);
      const criterion = readCached(path.join(dir, 'criterion.json'));
      const notDrafted = criterion ? null : readCached(path.join(dir, 'NOT_DRAFTED.md'));
      if (!criterion && !notDrafted) {
        problems.push(`${d.name} in ${place.name} has no criterion.json and no NOT_DRAFTED.md. It is not listed from there.`);
        continue;
      }
      ids.push(d.name);
      if (!copies.has(d.name)) copies.set(d.name, []);
      copies.get(d.name).push({ place, kind: criterion ? 'criterion' : 'not_drafted', file: (criterion ?? notDrafted).file, c: criterion ?? notDrafted });
    }
    place.ids = ids;
    place.caseIds = new Set(listDir(place.casesDir).filter(d => d.isDirectory()).map(d => d.name));
  }

  const sets = readSets(cfg);
  const sheet = sheetOf(cfg);
  const leftOut = [];
  const entries = [];
  const prefixFamily = new Map();
  const prefixSpaced = new Map();

  for (const [id, list] of copies) {
    const top = list[0];
    const parsed = top.kind === 'criterion' ? jsonOf(top.c) : {};
    const j = isObj(parsed.value) ? parsed.value : null;
    const prefix = id.split('-')[0].toUpperCase();
    if (/^DEMO-/i.test(id) || (j && /^demo$/i.test(textOf(j.family)))) {
      leftOut.push({ id, why: 'It is the demo criterion that tests the engine. It is not one of the 413.' });
      continue;
    }
    if (j) {
      if (textOf(j.family) && !prefixFamily.has(prefix)) prefixFamily.set(prefix, textOf(j.family));
      if (textOf(j.label) && !prefixSpaced.has(prefix)) prefixSpaced.set(prefix, textOf(j.label).startsWith(id.replace('-', ' ')));
      if (textOf(j.id) && textOf(j.id) !== id) problems.push(`${id}: the file says its id is "${textOf(j.id)}". The folder name is used.`);
    }
    entries.push({
      id, kind: top.kind, top, copies: list, json: j,
      error: top.kind === 'criterion' && !j ? (parsed.error ? `The file is not valid JSON (${parsed.error}).` : 'The file is not a JSON object.') : null
    });
  }

  // The wave notes and the sheet notes for each entry.
  for (const e of entries) {
    e.waveLines = [];
    for (const copy of e.copies) {
      const notes = waveNotesOf(copy.place, copy.place.ids ?? []);
      const line = notes?.byId.get(e.id);
      if (line && !e.waveLines.some(x => x.line.text === line.text)) e.waveLines.push({ place: copy.place, line, common: notes.common });
    }
    e.sheetNote = sheet?.notes.get(sheetKey(e.id)) ?? null;
    const fromWave = e.waveLines[0]?.line;
    const prefix = e.id.split('-')[0].toUpperCase();
    e.family = (e.json && textOf(e.json.family)) || prefixFamily.get(prefix) || prefix;
    e.label = (e.json && textOf(e.json.label)) || (prefixSpaced.get(prefix) === false ? e.id : e.id.replace('-', ' '));
    e.title = (e.json && textOf(e.json.title)) || fromWave?.title || '';
    e.facts = Boolean(e.json && Array.isArray(e.json.needs_facts) && e.json.needs_facts.length > 0);
    e.klass = e.kind === 'not_drafted' ? 'C' : (fromWave?.klass || (e.facts ? 'B' : 'A'));
    e.urgency = e.json && e.json.urgency === 'same_day' ? 'same_day' : 'routine';
    e.hash = e.top.c.hash;
    if (e.top.c.parts === undefined) e.top.c.parts = e.kind === 'not_drafted' ? noteParts(e.top.c.text) : contentParts(e.json);
    e.parts = e.top.c.parts;                 // null when the file cannot be read as a criterion
    e.doubts = e.waveLines.some(x => x.line.text) || Boolean(e.sheetNote && e.sheetNote.lines.length);
    const ten = sets.active.indexOf(e.id);
    const reserve = sets.reserves.indexOf(e.id);
    e.set = ten !== -1 ? 'ten' : reserve !== -1 ? 'reserve' : 'further';
    e.n = ten !== -1 ? String(ten + 1) : reserve !== -1 ? `R${reserve + 1}` : '';
    e.rank = ten !== -1 ? ten : reserve !== -1 ? 100 + reserve : 1000;
  }

  entries.sort((a, b) => a.rank - b.rank || byName(familyWord(a.family), familyWord(b.family)) || byName(a.id, b.id));
  entries.forEach((e, i) => { e.position = i + 1; });

  for (const id of [...sets.active, ...sets.reserves]) {
    if (!copies.has(id)) problems.push(`${id} is in ${sets.name} but no file was found for it.`);
  }

  // The 413 extract files in the repository name every criterion there should be.
  const expected = listDir(path.join(cfg.repo, 'criteria', '_extract'))
    .filter(d => d.isFile() && /\.json$/i.test(d.name)).map(d => d.name.replace(/\.json$/i, ''));
  const listed = new Set(entries.map(e => e.id));
  const tally = {
    total: entries.length,
    repo: entries.filter(e => e.top.place.where === 'repo').length,
    boardRepair: entries.filter(e => e.top.place.where === 'board_repair').length,
    board: entries.filter(e => e.top.place.where === 'board').length,
    waves: entries.filter(e => e.top.place.where === 'waves' || e.top.place.where === 'waves_repair').length,
    drafted: entries.filter(e => e.kind === 'criterion').length,
    notDrafted: entries.filter(e => e.kind === 'not_drafted').length,
    expected: expected.length || null,
    missing: expected.filter(id => !listed.has(id)).sort(byName),
    notExpected: expected.length ? entries.filter(e => !expected.includes(e.id)).map(e => e.id) : [],
    leftOut, problems,
    setsFrom: sets.name
  };

  const value = { places, entries, byId: new Map(entries.map(e => [e.id, e])), tally, sheet, sets };
  indexMemo = { no: requestNo, key: memoKey, value };
  return value;
}

// ---------- test histories ----------

/** The test histories of a criterion: from the first place, in the same order, that holds a cases folder for it. */
export function casesOf(index, cfg, id) {
  for (const place of index.places) {
    if (!place.caseIds?.has(id)) continue;
    const dir = path.join(place.casesDir, id);
    const names = listDir(dir).filter(d => d.isFile()).map(d => d.name);
    const csvs = names.filter(n => /\.csv$/i.test(n)).sort(byName);
    const hasPart = names.includes('expected.part.json');
    if (csvs.length === 0 && !hasPart) continue;
    let answers = [];
    let answersFrom = null;
    if (hasPart) {
      const j = jsonOf(readCached(path.join(dir, 'expected.part.json'))).value;
      answers = Array.isArray(j) ? j : Array.isArray(j?.cases) ? j.cases : [];
      answersFrom = 'expected.part.json';
    } else if (place.where === 'repo') {
      for (const name of ['expected.json', 'expected.proposed.json']) {
        const j = jsonOf(readCached(path.join(place.casesDir, name))).value;
        const all = Array.isArray(j?.cases) ? j.cases : [];
        const mine = all.filter(c => typeof c?.file === 'string' && c.file.startsWith(id + '/'));
        if (mine.length) { answers = mine; answersFrom = name; break; }
      }
    }
    return { place, dir, csvs, answers: answers.filter(isObj), answersFrom };
  }
  return null;
}

let crossMemo = { index: null, value: null };

/** Histories in another criterion's folder that also plant this criterion. Worked out once for each listing. */
export function plantedElsewhere(index, cfg, id) {
  if (crossMemo.index !== index) {
    const map = new Map();
    for (const e of index.entries) {
      if (e.kind !== 'criterion') continue;
      const cases = casesOf(index, cfg, e.id);
      for (const c of cases?.answers ?? []) {
        for (const f of Array.isArray(c.findings) ? c.findings : []) {
          const other = textOf(f?.criterion);
          if (!other || other === e.id) continue;
          if (!map.has(other)) map.set(other, []);
          map.get(other).push({ folder: e.id, file: String(c.file ?? '').split('/').pop(), about: textOf(c.about) });
        }
      }
    }
    crossMemo = { index, value: map };
  }
  return crossMemo.value.get(id) ?? [];
}

/** Splits CSV text into rows and fields. Quotes, doubled quotes, line breaks inside quotes, CRLF and a BOM are handled. The same reading as pipeline/csv.ts. */
export function readCsvTable(csvText) {
  const text = String(csvText).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawAnything = false;
  const endRow = () => { row.push(field); field = ''; rows.push(row); row = []; sawAnything = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') { field = ''; inQuotes = true; sawAnything = true; }
    else if (ch === ',') { row.push(field); field = ''; sawAnything = true; }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else { field += ch; sawAnything = true; }
  }
  if (sawAnything || field !== '' || row.length > 0) endRow();
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

/** One history as numbered lines. L001 is the first row under the heading row, as the engine numbers them. */
export function readHistory(file, cited = []) {
  const c = readCached(file);
  if (!c) return null;
  const table = readCsvTable(c.text);
  if (table.length === 0) return { patient: null, lines: [] };
  const heads = table[0].map(h => h.trim().toLowerCase());
  const at = name => heads.indexOf(name);
  const cell = (r, name) => { const i = at(name); return i === -1 ? '' : (r[i] ?? '').trim(); };
  const want = new Set(cited);
  let patient = null;
  const lines = table.slice(1).map((r, i) => {
    const id = 'L' + String(i + 1).padStart(3, '0');
    if (!patient) patient = { ref: cell(r, 'patient_ref'), age: cell(r, 'patient_age'), sex: cell(r, 'patient_sex') };
    const type = cell(r, 'record_type');
    const brand = cell(r, 'brand');
    const medicine = cell(r, 'medicine');
    let name = brand || medicine;
    if (brand && medicine && brand.toLowerCase() !== medicine.toLowerCase()) name = `${brand} (${medicine})`;
    const detail = cell(r, 'detail');
    const value = cell(r, 'value');
    return {
      id, cited: want.has(id), type, date: cell(r, 'dispense_date'),
      what: type && !name ? [detail, value].filter(Boolean).join(': ') : [name, cell(r, 'strength'), cell(r, 'form')].filter(Boolean).join(' '),
      brandOnly: Boolean(brand && !medicine),
      quantity: cell(r, 'quantity'), repeats: cell(r, 'repeats_left'), directions: cell(r, 'directions'), prescriber: cell(r, 'prescriber')
    };
  });
  return { patient, lines };
}

// ---------- scored results and second opinions ----------

function run0Of(cfg) {
  const c = readCached(cfg.run0);
  if (!c) return null;
  if (!c.run0) {
    const j = jsonOf(c).value;
    const byId = new Map();
    const texts = new Map();
    if (isObj(j)) {
      // Numbers are matched loosely ("STOPP C10" is "STOPP-C10"), so a file that writes the label still finds its criterion.
      for (const crit of Array.isArray(j.criteria) ? j.criteria : []) if (isObj(crit) && textOf(crit.id)) texts.set(sheetKey(crit.id), modelTextKey(crit));
      for (const s of Array.isArray(j.score?.criteria) ? j.score.criteria : []) {
        if (!isObj(s) || !textOf(s.criterionId)) continue;
        byId.set(sheetKey(s.criterionId), {
          verdict: textOf(s.verdict), reasons: namesOf(s.reasons), caveats: namesOf(s.caveats),
          planted: Number(s.planted) || 0, caught: Number(s.caught) || 0,
          falseFlags: Array.isArray(s.falseFlags) ? s.falseFlags.length : 0,
          lettersNeeded: Number(s.letters?.needed) || 0, lettersProduced: Number(s.letters?.produced) || 0,
          textKey: texts.get(sheetKey(s.criterionId)) ?? null
        });
      }
    }
    c.run0 = { byId, when: textOf(j?.finishedAt) || new Date(c.mtimeMs).toISOString(), mtimeMs: c.mtimeMs, partRun: Boolean(j?.partRun), bad: !isObj(j) };
    c.json = undefined;          // the whole file is large: keep only what is shown
    c.text = '';
  }
  return c.run0;
}

function summaryOf(cfg) {
  const c = readCached(cfg.summary);
  if (!c) return null;
  if (!c.summary) {
    const j = jsonOf(c).value;
    const byId = new Map();
    const list = Array.isArray(j?.criteria) ? j.criteria : Array.isArray(j) ? j : [];
    for (const row of list) {
      if (!isObj(row) || !textOf(row.id)) continue;
      byId.set(sheetKey(row.id), { result: textOf(row.result), reason: textOf(row.reason), wave: textOf(row.wave), run: typeof row.run === 'string' || typeof row.run === 'number' ? String(row.run) : '' });
    }
    c.summary = { byId, mtimeMs: c.mtimeMs, bad: !isObj(j) && !Array.isArray(j) };
  }
  return c.summary;
}

/** The scored result of one entry, in plain words. bucket is "pass", "fail" or "none". */
export function resultOf(cfg, entry) {
  const run0 = run0Of(cfg);
  const summary = summaryOf(cfg);
  const a = run0?.byId.get(sheetKey(entry.id));
  const b = summary?.byId.get(sheetKey(entry.id));
  const useSummary = b && (!a || summary.mtimeMs >= run0.mtimeMs);
  if (useSummary) {
    const word = b.result.toUpperCase();
    const bucket = word === 'PASS' ? 'pass' : word === 'NOT PASSING' || word === 'FAIL' ? 'fail' : 'none';
    const scoredCopy = b.wave ? entry.copies.find(c => c.place.wave && c.place.wave.toLowerCase() === b.wave.toLowerCase()) : null;
    const older = Boolean(scoredCopy && entry.kind === 'criterion' && scoredCopy.kind === 'criterion' && contentKey(scoredCopy.c) !== contentKey(entry.top.c));
    return {
      bucket, word: word === 'PASS' ? 'PASS' : word === 'NOT PASSING' || word === 'FAIL' ? 'Not passing' : word === 'NOT DRAFTED' ? 'Not drafted' : (b.result || 'Not scored yet'),
      lines: [b.reason].filter(Boolean),
      from: ['Wave runs', b.wave, b.run ? `run ${b.run}` : ''].filter(Boolean).join(', '),
      when: new Date(summary.mtimeMs).toISOString(),
      older: older ? `This result was scored on the copy in ${b.wave}. The file shown here is different, so the result may be for an earlier version.` : ''
    };
  }
  if (a) {
    const lines = [];
    if (a.planted) lines.push(`${a.caught} of ${a.planted} planted findings caught.`);
    if (a.lettersNeeded) lines.push(`${a.lettersProduced} of ${a.lettersNeeded} letters produced.`);
    lines.push(`False flags: ${a.falseFlags}. A false flag is counted. It is not a failure.`);
    lines.push(...a.reasons, ...a.caveats);
    const v = a.verdict;
    const changed = entry.json && a.textKey !== null && a.textKey !== modelTextKey(entry.json);
    return {
      bucket: v === 'PASS' ? 'pass' : v === 'FAIL' || v === 'PASS_PART' ? 'fail' : 'none',
      word: v === 'PASS' ? 'PASS' : v === 'FAIL' ? 'Not passing' : v === 'PASS_PART' ? 'Part run only. Not a full pass.' : 'Not scored yet',
      lines: v === 'NOT_TESTED' ? ['No planted finding for this criterion was in the run.', ...a.caveats] : lines,
      from: 'Run of the first ten' + (run0.partRun ? ' (a part run)' : ''),
      when: run0.when,
      older: changed ? 'The wording or the medicine list in this file has changed since that run. The result is for an earlier version.' : ''
    };
  }
  return { bucket: 'none', word: entry.kind === 'not_drafted' ? 'Not drafted, so not scored' : 'Not scored yet', lines: [], from: '', when: '', older: '' };
}

function opinionsOf(cfg) {
  const files = listDir(cfg.gemini).filter(d => d.isFile() && /\.json$/i.test(d.name)).map(d => path.join(cfg.gemini, d.name));
  const byId = new Map();
  const cachedFiles = files.map(f => readCached(f)).filter(Boolean).sort((x, y) => x.mtimeMs - y.mtimeMs || byName(x.file, y.file));
  for (const c of cachedFiles) {
    const j = jsonOf(c).value;
    const list = Array.isArray(j) ? j : Array.isArray(j?.reviews) ? j.reviews : Array.isArray(j?.criteria) ? j.criteria : isObj(j) && textOf(j.criterion) ? [j] : [];
    for (const row of list) {
      if (!isObj(row)) continue;
      const id = sheetKey(textOf(row.criterion) || textOf(row.id));
      if (!id) continue;
      const points = (Array.isArray(row.points) ? row.points : typeof row.points === 'string' ? [row.points] : [])
        .map(p => (typeof p === 'string' ? p.trim() : isObj(p) ? textOf(p.text) || textOf(p.point) || JSON.stringify(p) : String(p))).filter(Boolean);
      const earlier = byId.get(id)?.count ?? 0;
      byId.set(id, { verdict: textOf(row.verdict).toLowerCase(), points, file: path.basename(c.file), when: new Date(c.mtimeMs).toISOString(), count: earlier + 1 });
    }
  }
  return byId;
}

let opinionMemo = { no: -1, key: '', value: new Map() };
/** Gemini's second opinion on one entry, the newest one when there are several. null when there is none. */
export function opinionOf(cfg, id) {
  if (!cfg.gemini) return null;
  if (opinionMemo.key !== cfg.gemini || opinionMemo.no !== requestNo) opinionMemo = { no: requestNo, key: cfg.gemini, value: opinionsOf(cfg) };
  return opinionMemo.value.get(sheetKey(id)) ?? null;
}

// ---------- the audit of 19 November ----------

let auditMemo = { key: '', value: {} };
/** The whole audit file, read again when it changes on disk (it is rewritten during the day). {} when absent. */
export function auditsOf(cfg) {
  if (!cfg.audit) return {};
  let stat = null;
  try { stat = fs.statSync(cfg.audit); } catch { return {}; }
  const key = `${cfg.audit}|${stat.mtimeMs}|${stat.size}`;
  if (auditMemo.key === key) return auditMemo.value;
  let value = {};
  try {
    const j = JSON.parse(fs.readFileSync(cfg.audit, 'utf8'));
    if (isObj(j)) value = j;
  } catch {
    value = {};
  }
  auditMemo = { key, value };
  return value;
}

const AUDIT_FINALS = ['SOUND', 'CHANGE', 'FOUNDER', 'SET ASIDE', 'BEING SETTLED'];
const AUDIT_DECISIONS = ['ERROR', 'AUSTRALIA', 'FOUNDER', 'IMPROVEMENT', 'SETTLED', 'BEING SETTLED'];
const AUDIT_STATUSES = ['DONE', 'TO BE APPLIED', 'WAITING FOR ITS TEST', 'FOR YOU', 'NO CHANGE', 'SET ASIDE', 'SETTLED, NO CHANGE', 'BEING SETTLED'];
const FINAL_TEST_STATES = ['PASSED', 'DID NOT PASS', 'NEW TEXT', 'WAITING', 'SET ASIDE', 'NOT IN THE FINAL TEST'];
const FINAL_TEST_TALLY = new Set(['PASSED', 'DID NOT PASS', 'NEW TEXT', 'WAITING']);
const POINT_CLOSED = new Set(['DONE', 'NO CHANGE', 'SET ASIDE', 'SETTLED, NO CHANGE']);

let healthMemo = '';
/** Whether the audit file is present and can be read as JSON. Signing needs this to be ok. */
export function auditHealth(cfg) {
  if (!cfg.audit) return { ok: false, error: 'The audit file is not configured.' };
  // This is asked once for every row of the list, and the file is several megabytes: on 20 November one list
  // of 597 rows read and parsed it 597 times and took 9 to 20 seconds. A file that was read as sound is not
  // read again until its time or its size on disk changes (the same test auditsOf uses, just above). A file
  // that is missing or cannot be read is never remembered: it is looked at again at every call.
  let stamp = '';
  try { const st = fs.statSync(cfg.audit); stamp = `${cfg.audit}|${st.mtimeMs}|${st.size}`; } catch { stamp = ''; }
  if (stamp && healthMemo === stamp) return { ok: true };
  let text;
  try {
    text = fs.readFileSync(cfg.audit, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, error: 'The audit file is missing.' };
    return { ok: false, error: 'The audit file could not be read.' };
  }
  try {
    const j = JSON.parse(text.replace(/^﻿/, ''));
    if (!isObj(j)) return { ok: false, error: 'The audit file could not be read.' };
  } catch {
    return { ok: false, error: 'The audit file could not be read.' };
  }
  healthMemo = stamp;
  return { ok: true };
}

/** P and T from the whole audit file: states PASSED, DID NOT PASS, NEW TEXT and WAITING count toward T. */
export function countFinalTest(audits) {
  let passed = 0;
  let total = 0;
  for (const raw of Object.values(audits ?? {})) {
    if (!isObj(raw)) continue;
    const state = textOf(raw.final_test?.state);
    if (!FINAL_TEST_TALLY.has(state)) continue;
    total++;
    if (state === 'PASSED') passed++;
  }
  return { passed, total };
}

/** A listed criterion is in use unless the audit marked it set aside or it was not drafted. */
export function entryInUse(entry, audit) {
  if (entry.kind === 'not_drafted') return false;
  if (audit && audit.final === 'SET ASIDE') return false;
  return true;
}

export function isSignedEntry(entry, ledger) {
  const s = statusOf(entry, ledger);
  return s.state === 'signed' || s.state === 'file_signed' || s.state === 'nd_agreed';
}

/** Ready when in use, audit_complete is true, and not signed yet. */
export function readyToSignEntry(entry, ledger, audit) {
  if (entry.kind !== 'criterion') return false;
  if (!entryInUse(entry, audit)) return false;
  if (!audit || audit.auditComplete !== true || audit.textMatches !== true) return false;
  return !isSignedEntry(entry, ledger);
}

/** Counts for the top line and the sign-off filters. */
export function signoffCounts(index, ledger, cfg) {
  const health = auditHealth(cfg);
  const audits = health.ok ? auditsOf(cfg) : {};
  const finalTest = countFinalTest(audits);
  let ready = 0;
  let signed = 0;
  let notReady = 0;
  let needsChange = 0;
  const filterCounts = { ready: 0, not_ready: 0, signed: 0, change: 0, all: index.entries.length };
  for (const entry of index.entries) {
    const audit = health.ok ? auditOf(cfg, entry.id, entry.parts) : null;
    const st = statusOf(entry, ledger);
    if (st.state === 'change' || st.state === 'nd_change') needsChange++;
    if (isSignedEntry(entry, ledger)) {
      signed++;
      filterCounts.signed++;
    }
    if (st.state === 'change' || st.state === 'nd_change') filterCounts.change++;
    if (!entryInUse(entry, audit)) continue;
    if (readyToSignEntry(entry, ledger, audit)) { ready++; filterCounts.ready++; }
    else if (entry.kind === 'criterion' && (!audit || audit.auditComplete !== true)) { notReady++; filterCounts.not_ready++; }
  }
  return {
    auditOk: health.ok,
    auditError: health.ok ? '' : health.error,
    finalTest,
    ready,
    signed,
    notReady,
    needsChange,
    filterCounts
  };
}

/**
 * The audit record of one criterion, normalized: the final word, the note for the founder,
 * the points with their statuses, and whether any point waits for the founder.
 * null when the audit has no record for this id (the page says "audit: not yet reported").
 */
export function auditOf(cfg, id, partsNow) {
  const raw = auditsOf(cfg)[sheetKey(id)];
  if (!isObj(raw)) return null;
  const points = (Array.isArray(raw.points) ? raw.points : []).filter(isObj).map(p => ({
    decision: AUDIT_DECISIONS.includes(p.decision) ? p.decision : '',
    field: textOf(p.field),
    problem: textOf(p.problem),
    change: textOf(p.change),
    status: AUDIT_STATUSES.includes(p.status) ? p.status : ''
  }));
  const forYou = points.some(p => p.status === 'FOR YOU');
  // What waits for the founder comes first on the page, in its own words ("Your decision:").
  points.sort((a, b) => (b.status === 'FOR YOU') - (a.status === 'FOR YOU'));
  const ft = isObj(raw.final_test) ? raw.final_test : {};
  const ftState = FINAL_TEST_STATES.includes(ft.state) ? ft.state : textOf(ft.state);
  const ftText = textOf(ft.text);
  const openPoints = points.filter(p => p.status && !POINT_CLOSED.has(p.status)).length;
  const note = textOf(raw.note_for_founder);
  let extraNote = '';
  if (note && ftText && note.startsWith(ftText)) extraNote = note.slice(ftText.length).replace(/^[\s.]+/, '').trim();
  else if (note && note !== ftText) extraNote = note;
  return {
    final: AUDIT_FINALS.includes(raw.final) ? raw.final : '',
    auditComplete: raw.audit_complete === true,
    /** True only when this audit record names the text it read, and that text is the one on the page. */
    textMatches: isObj(raw.parts) && isObj(partsNow) && sameWordsAs({ parts: raw.parts }, partsNow),
    note,
    extraNote,
    needsRescore: raw.needs_rescore === true,
    forYou,
    finalTest: {
      state: ftState,
      text: ftText || note,
      caught: Number(ft.caught) || 0,
      planted: Number(ft.planted) || 0,
      disputed: Number(ft.disputed) || 0,
      falseFlags: Number(ft.false_flags) || 0
    },
    pointsSummary: {
      total: points.length,
      open: openPoints,
      line: points.length
        ? `Audit of 19 November: ${points.length} point${points.length === 1 ? '' : 's'}, ${openPoints ? `${openPoints} still open` : 'all closed'}`
        : 'Audit of 19 November: no points'
    },
    counts: points.reduce((m, p) => { const k = p.status || 'OTHER'; m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    points
  };
}

/** True when the founder may sign this criterion (audit file ok and audit_complete). */
export function maySignCriterion(cfg, entry) {
  const health = auditHealth(cfg);
  if (!health.ok) return false;
  if (entry.kind === 'not_drafted') return true;
  const audit = auditOf(cfg, entry.id, entry.parts);
  return Boolean(audit && audit.auditComplete && audit.textMatches);
}

// ---------- the ledger ----------

export class LedgerError extends Error {}

/**
 * The ledger as it is on disk now. A missing file is an empty ledger.
 * A file that cannot be read as a ledger throws: it is never replaced by an empty one.
 */
/**
 * The signature the founder asked for: his name with his registration number in brackets, written
 * beside every criterion he signs, with nothing for him to type. It comes from the file
 * docs/signoff/reviewer.json in the repository: { "name": "...", "registration": "..." }.
 * When that file is absent (as in the tests) there is no default and the page asks for a name.
 */
export function defaultReviewer(cfg) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cfg.repo, 'docs', 'signoff', 'reviewer.json'), 'utf8').replace(/^﻿/, ''));
    const name = typeof j.name === 'string' ? j.name.trim() : '';
    const reg = typeof j.registration === 'string' ? j.registration.trim() : '';
    if (!name) return '';
    return reg ? `${name} (${reg})` : name;
  } catch {
    return '';
  }
}

export function readLedger(cfg) {
  let text;
  try {
    text = fs.readFileSync(cfg.ledger, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { reviewer: defaultReviewer(cfg), entries: {} };
    throw new LedgerError(`The ledger file could not be opened (${cfg.ledger}): ${e instanceof Error ? e.message : String(e)}`);
  }
  let j;
  try { j = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    throw new LedgerError(`The ledger file is damaged and was left as it is (${cfg.ledger}). Nothing was changed. The folder "backups" beside it holds earlier copies.`);
  }
  if (!isObj(j) || (j.entries !== undefined && !isObj(j.entries)) || (j.not_drafted_agreed !== undefined && !isObj(j.not_drafted_agreed))) {
    throw new LedgerError(`The ledger file does not have the expected shape and was left as it is (${cfg.ledger}).`);
  }
  if (!isObj(j.entries)) j.entries = {};
  if (typeof j.reviewer !== 'string') j.reviewer = '';
  // The founder's signature always carries his registration number in brackets (see defaultReviewer).
  const fixed = defaultReviewer(cfg);
  if (fixed) j.reviewer = fixed;
  return j;
}

/**
 * A save that was cut short (the window was closed, the computer stopped) leaves a half-written
 * temporary file beside the real one. The real file is whole. The leftovers are removed here,
 * once they are older than a minute, so that they do not pile up.
 */
function removeStaleTemps(file) {
  const dir = path.dirname(file);
  const lead = path.basename(file) + '.tmp-';
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(lead) || !/^\d+-\d+$/.test(name.slice(lead.length))) continue;
    const p = path.join(dir, name);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 60000) fs.unlinkSync(p); } catch { /* another save may own it */ }
  }
}

/** Writes every byte. A short write is continued. No progress is a failure, and the old file is kept. */
function writeAll(fd, bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let offset = 0;
  while (offset < buf.length) {
    const n = fs.writeSync(fd, buf, offset, buf.length - offset);
    if (n === 0) throw new Error('The file was not written in full. The previous copy was kept.');
    offset += n;
  }
}

function replaceFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  removeStaleTemps(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      // A virus scanner or another reader can hold the file for a moment.
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) {
        try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
        throw e;
      }
      sleepMs(60 * (attempt + 1));
    }
  }
}

/** Writes a file so that it is either the old one or the new one, never half of each. */
export function writeWhole(file, bytes) {
  replaceFile(file, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
}

/** Saves the ledger, then keeps one dated copy for each hour in which it was saved. */
export function writeLedger(cfg, ledger, now = new Date()) {
  const out = { reviewer: ledger.reviewer ?? '', entries: ledger.entries ?? {} };
  for (const [k, v] of Object.entries(ledger)) if (!(k in out)) out[k] = v;
  if (isObj(out.not_drafted_agreed) && Object.keys(out.not_drafted_agreed).length === 0) delete out.not_drafted_agreed;
  const text = JSON.stringify(out, null, 2) + '\n';
  writeWhole(cfg.ledger, text);
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}00`;
  const backup = path.join(path.dirname(cfg.ledger), 'backups', `ledger-${stamp}.json`);
  if (!fs.existsSync(backup)) {
    try { writeWhole(backup, text); } catch { /* the ledger itself is saved; the copy is tried again at the next click */ }
  }
}

/** The lists ledger sits beside the criteria ledger. It is a different file, and it is never ledger.json. */
export function listsLedgerFile(cfg) {
  return path.join(path.dirname(cfg.ledger), 'lists-ledger.json');
}

/**
 * The list decisions as they are on disk now. A missing file is an empty ledger.
 * A file that cannot be read as a lists ledger throws: it is never replaced by an empty one.
 */
export function readListsLedger(cfg) {
  const file = listsLedgerFile(cfg);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { version: 1, lists: {} };
    throw new LedgerError(`The lists ledger could not be opened (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  let j;
  try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch {
    throw new LedgerError(`The lists ledger is damaged and was left as it is (${file}). Nothing was changed. The folder "backups" beside it holds earlier copies.`);
  }
  if (!isObj(j) || (j.lists !== undefined && !isObj(j.lists))) {
    throw new LedgerError(`The lists ledger does not have the expected shape and was left as it is (${file}).`);
  }
  const lists = {};
  for (const [k, v] of Object.entries(isObj(j.lists) ? j.lists : {})) {
    if (isObj(v)) lists[String(k).toLowerCase()] = v;
  }
  return { version: 1, lists };
}

/** One saved decision, with the fields the founder asked for, then the medicine names he decided on. */
function listRowOut(v) {
  const decision = v.decision === 'right' || v.decision === 'change' ? v.decision : '';
  if (!decision) return null;
  const row = {
    decision,
    note: typeof v.note === 'string' ? v.note : '',
    at: typeof v.at === 'string' ? v.at : '',
    by: typeof v.by === 'string' ? v.by : '',
    fingerprint: typeof v.fingerprint === 'string' ? v.fingerprint : ''
  };
  if (Array.isArray(v.medicines)) row.medicines = v.medicines.filter(x => typeof x === 'string');
  return row;
}

/** Saves the lists ledger, then keeps one dated copy for each hour in which it was saved. Never deletes a copy. */
export function writeListsLedger(cfg, data, now = new Date()) {
  const lists = {};
  for (const [k, v] of Object.entries(isObj(data?.lists) ? data.lists : {})) {
    if (!isObj(v)) continue;
    const row = listRowOut(v);
    if (row) lists[String(k).toLowerCase()] = row;
  }
  const text = JSON.stringify({ version: 1, lists }, null, 2) + '\n';
  const file = listsLedgerFile(cfg);
  writeWhole(file, text);
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}00`;
  const backup = path.join(path.dirname(file), 'backups', `lists-ledger-${stamp}.json`);
  if (!fs.existsSync(backup)) {
    try { writeWhole(backup, text); } catch { /* the lists ledger itself is saved; the copy is tried again at the next click */ }
  }
}

// ---------- where one entry stands ----------

/**
 * state: unsigned, signed, change, look_again (a decision was made on an earlier version of the file),
 * file_signed (the file carries a signature that is not in the ledger),
 * nd_open, nd_agreed, nd_change (for a criterion that was not drafted).
 */
export function statusOf(entry, ledger) {
  const e = isObj(ledger.entries?.[entry.id]) ? ledger.entries[entry.id] : null;
  const agreed = isObj(ledger.not_drafted_agreed?.[entry.id]) ? ledger.not_drafted_agreed[entry.id] : null;
  const hash = entry.hash;
  // The file is not the same bytes any more, but it says the same thing: it was only laid out again.
  const sameWords = saved => saved.file_hash !== hash && sameWordsAs(saved, entry.parts);
  const changed = saved => changedParts(saved.parts, entry.parts);            // which parts differ, or null when that is not known
  if (entry.kind === 'not_drafted') {
    if (e && e.decision === 'change' && (e.file_hash === hash || sameWords(e))) return { state: 'nd_change', at: e.at, note: e.note ?? '' };
    if (agreed && (agreed.file_hash === hash || sameWords(agreed))) return { state: 'nd_agreed', at: agreed.at };
    if (e || agreed) return { state: 'nd_open', was: e ? e.decision : 'agreed', at: (e ?? agreed).at, note: e?.note ?? '' };
    return { state: 'nd_open' };
  }
  const inFile = entry.json && isObj(entry.json.signed_by_clinical_reviewer) ? entry.json.signed_by_clinical_reviewer : null;
  const fileSigned = inFile ? { name: textOf(inFile.name), date: textOf(inFile.date) } : null;
  if (e && e.decision === 'signed') {
    const by = textOf(e.reviewer);
    const signedBy = by ? { by } : {};
    if (e.file_hash === hash) return { state: 'signed', at: e.at, applied: false, fileSigned, ...signedBy };
    if (e.applied_hash && e.applied_hash === hash) return { state: 'signed', at: e.at, applied: true, appliedAt: e.applied_at ?? '', fileSigned, ...signedBy };
    if (sameWords(e)) {
      // Final when the file carries a signature: apply.mjs wrote it, and the file was laid out again afterwards.
      const applied = Boolean(fileSigned && entry.json.draft === false);
      return { state: 'signed', at: e.at, applied, appliedAt: applied ? e.applied_at ?? '' : '', sameWords: true, fileSigned, ...signedBy };
    }
    return { state: 'look_again', was: 'signed', at: e.at, changed: changed(e), fileSigned, ...signedBy };
  }
  if (e && e.decision === 'change') {
    if (e.file_hash === hash || sameWords(e)) return { state: 'change', at: e.at, note: e.note ?? '', fileSigned };
    return { state: 'look_again', was: 'change', at: e.at, note: e.note ?? '', changed: changed(e), fileSigned };
  }
  if (agreed) return { state: 'look_again', was: 'agreed', at: agreed.at, fileSigned };
  if (fileSigned && entry.json.draft === false) return { state: 'file_signed', fileSigned };
  return { state: 'unsigned', fileSigned };
}

export const needsReviewer = state => state === 'unsigned' || state === 'look_again' || state === 'nd_open';

export function countAll(index, ledger) {
  const counts = { total: index.entries.length, signed: 0, change: 0, left: 0, notDrafted: 0, lookAgain: 0, notDraftedDone: 0 };
  for (const entry of index.entries) {
    const s = statusOf(entry, ledger);
    if (entry.kind === 'not_drafted') {
      counts.notDrafted++;
      if (s.state !== 'nd_open') counts.notDraftedDone++;
    } else if (s.state === 'signed' || s.state === 'file_signed') counts.signed++;
    else if (s.state === 'change') counts.change++;
    else {
      counts.left++;
      if (s.state === 'look_again') counts.lookAgain++;
    }
  }
  return counts;
}

// ---------- writing a signature into a criterion file, byte for byte ----------

/**
 * Finds where the value of each top-level member of a JSON object starts and ends.
 * The text is read one byte to one character (latin1), so every position is a byte position.
 */
export function topLevelMembers(text) {
  const n = text.length;
  let i = 0;
  if (text.startsWith('ï»¿')) i = 3;       // a byte order mark, as three bytes
  const fail = what => { throw new Error(`The file is not a JSON object that can be edited safely (${what} at byte ${i}).`); };
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const string = () => {
    if (text[i] !== '"') fail('a name in quotes was expected');
    const start = ++i;
    while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= n) fail('a quote is not closed');
    return text.slice(start, i++);
  };
  const value = () => {
    const ch = text[i];
    if (ch === '"') { string(); return; }
    if (ch === '{' || ch === '[') {
      let depth = 0;
      while (i < n) {
        const c = text[i];
        if (c === '"') { string(); continue; }
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; return; } }
        i++;
      }
      fail('a bracket is not closed');
    }
    const start = i;
    while (i < n && !',}] \t\r\n'.includes(text[i])) i++;
    if (i === start) fail('a value was expected');
  };
  ws();
  if (text[i] !== '{') fail('the file does not start with {');
  const open = i++;
  const members = [];
  ws();
  if (text[i] === '}') return { members, open, close: i };
  for (;;) {
    ws();
    const keyStart = i;
    const key = string();
    ws();
    if (text[i] !== ':') fail('a colon was expected');
    i++;
    ws();
    const valueStart = i;
    value();
    members.push({ key, keyStart, valueStart, valueEnd: i });
    ws();
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '}') return { members, open, close: i };
    fail('a comma or } was expected');
  }
}

/**
 * Returns the bytes of a criterion file with "draft" set to false and "signed_by_clinical_reviewer"
 * set to { name, date }. Every other byte is the same as before. Throws when that cannot be promised.
 */
export function signedBytes(buf, name, date) {
  const text = buf.toString('latin1');
  const asBytes = s => Buffer.from(s, 'utf8').toString('latin1');
  const { members, close } = topLevelMembers(text);
  const wanted = [
    ['draft', 'false'],
    ['signed_by_clinical_reviewer', asBytes(`{ "name": ${JSON.stringify(name)}, "date": ${JSON.stringify(date)} }`)]
  ];
  const edits = [];
  const toAdd = [];
  for (const [key, valueText] of wanted) {
    const found = members.filter(m => m.key === key);
    if (found.length > 1) throw new Error(`The file holds "${key}" more than once.`);
    if (found.length === 1) edits.push({ start: found[0].valueStart, end: found[0].valueEnd, text: valueText });
    else toAdd.push(`"${key}": ${valueText}`);
  }
  if (toAdd.length) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (members.length === 0) {
      edits.push({ start: close, end: close, text: toAdd.join(', ') });
    } else {
      const last = members[members.length - 1];
      const lineStart = text.lastIndexOf('\n', last.keyStart) + 1;
      const lead = text.slice(lineStart, last.keyStart);
      const sep = /^[ \t]*$/.test(lead) && lineStart > 0 ? `,${eol}${lead}` : ', ';
      edits.push({ start: last.valueEnd, end: last.valueEnd, text: toAdd.map(t => sep + t).join('') });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const result = Buffer.from(out, 'latin1');

  // Proof, before anything is written: the new file says the same as the old one apart from the two fields.
  const strip = b => b.toString('utf8').replace(/^﻿/, '');
  const before = JSON.parse(strip(buf));
  const after = JSON.parse(strip(result));
  const want = { ...before, draft: false, signed_by_clinical_reviewer: { name, date } };
  if (JSON.stringify(after) !== JSON.stringify(want)) throw new Error('The edited file would not say the same as before. Nothing was written.');
  return result;
}
