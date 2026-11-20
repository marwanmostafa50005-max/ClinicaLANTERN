// tools/check-cases.mjs
//
// TEST TOOLING ONLY. Never import this file from pipeline/ or server/.
// The screening is done by the models (docs/SPEC.md section 7.1). This file is not the screening.
//
// It is a plain name match for the people who write the fictional test histories.
// It answers one question: "Going by medicine names alone, which criteria could this history set off?"
// It is used for three jobs:
//   1. to find overlaps nobody meant (a history written for one criterion that also meets another);
//   2. to check the answer sheet against the histories (every expected finding has its medicines,
//      and every line the sheet names really holds a listed medicine, or is a fact row);
//   3. to check a wave folder in place, before its criteria are in the repository (--wave).
//
// How it reads a history. It takes the "medicine" and "brand" columns of each row and looks for the
// ingredient and brand names in the medicine groups of each criterion file. A criterion is shown as
// NAMES PRESENT when all of its groups have a medicine in the history. Six criteria do not need
// every group, so they have their own name rule (see HOW_GROUPS_COMBINE below).
//
// Two headers are read (docs/SPEC.md sections 6 and 6a):
//   the 12 columns: patient_ref, patient_age, patient_sex, dispense_date, medicine, brand, strength,
//                   form, quantity, repeats_left, directions, prescriber
//   the 15 columns: the same, and record_type, detail, value. A row whose record_type is condition,
//                   result or observation is a fact row. Its medicine columns are empty.
// Line IDs run over all rows in file order, supplies and facts alike, as pipeline/csv.ts does.
//
// What it does not do. It does not judge doses, directions, how long a pack lasts or age.
// It does not judge a fact row: whether a result meets a criterion is for the models and a person.
// It shows the supply dates and the gap in days, and a person reads the rest.
// STOPP-A3 also covers drug classes that are not in its lists (two statins, for example).
// This tool cannot see those. Read the medicine list of each history for them (--list).
//
// Run:
//   node tools/check-cases.mjs                 every history against every criterion in the pool
//   node tools/check-cases.mjs --list          also print the medicines in each history
//   node tools/check-cases.mjs --parts         also print criteria with only some of their names present
//   node tools/check-cases.mjs --sheet <file>  compare with this answer sheet
//   node tools/check-cases.mjs --criteria <file>  the list of criteria to use
//   node tools/check-cases.mjs --only <text>   only histories whose path holds this text
//   node tools/check-cases.mjs --with-demo     include cases/_demo
//   node tools/check-cases.mjs --wave <folder> check a wave folder in place. Give it again, or use
//                                              commas, for several. A folder that holds wave folders
//                                              stands for all of them. With --all every problem is
//                                              printed. With --json the answer is JSON only.
//
// Which files it reads when no option names them. The signed answer sheet (cases/expected.json) and
// the list in use (criteria/active.json) go together. So do the two proposed files
// (cases/expected.proposed.json and criteria/active.proposed.json). The signed pair is used as soon
// as the signed sheet exists. Until then the proposed pair is used. A proposed file that is still on
// disk after sign-off is not checked, and the tool says so. Its first lines name the files it used.
//
// The last lines are the verdicts: one line for each criterion, "ok" or what is wrong.
// Ends with code 0 only when every criterion is ok, 1 when something is wrong, 2 when it could not
// run. A criterion folder that holds NOT_DRAFTED.md in place of a criterion is listed as "not
// drafted". That is not counted as wrong. Names that are present but not expected by the sheet are
// listed, not counted as wrong: a near miss is exactly that. Read each one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWaveFolders } from '../eval/wave.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = path.join(ROOT, 'cases');
const CRITERIA_DIR = path.join(ROOT, 'criteria');
const WINDOW_DAYS = 60;                       // the prototype's convention for "supplied together"

// Paths that are never opened.
const NEVER_OPEN = ['sealed', 'holdout', 'review-card', 'founder-review-queue', 'synthetic_cases'];

// How the groups of a criterion combine. A criterion not listed here needs every one of its groups.
const HOW_GROUPS_COMBINE = {
  'STOPP-A3': 'two_in_one_group',             // two different ingredients from the same group
  'STOPP-M1': 'two_anywhere',                 // two different ingredients from any of the groups
  'STOPP-L2': 'first_without_second',         // group A with no group B supplied near it
  'PROMPT-RS-3': 'first_without_second',
  'BRISNIK-HR-F2': 'first_plus_two_others',   // group A and at least two of the other groups
  'BRISNIK-HR-A3': 'any_group'                // either group; the dose decides, and a person reads it
};

const HOW_IN_WORDS = {
  all: 'needs every group',
  two_in_one_group: 'needs two different ingredients from one group',
  two_anywhere: 'needs two different ingredients from any groups',
  first_without_second: 'needs group A with no group B supplied within 60 days',
  first_plus_two_others: 'needs group A and two of the other groups',
  any_group: 'needs either group; the dose decides'
};

// Other spellings seen on labels. The left side is read as the right side.
const OTHER_SPELLINGS = [
  ['frusemide', 'furosemide'],
  ['indomethacin', 'indometacin'],
  ['cyclosporin', 'ciclosporin'],
  ['cyclosporine', 'ciclosporin'],
  ['dothiepin', 'dosulepin'],
  ['benztropine', 'benzatropine'],
  ['benzhexol', 'trihexyphenidyl'],
  ['ethacrynic acid', 'etacrynic acid'],
  ['sennosides', 'senna'],
  ['sennoside', 'senna'],
  ['ispaghula', 'psyllium husk'],
  ['psyllium', 'psyllium husk'],
  ['macrogol', 'macrogol 3350']
];

// Forms that some group notes leave out (skin, eye, nose and inhaled products).
const FORM_TO_READ_THE_NOTE_FOR = /\b(cream|gel|ointment|lotion|shampoo|eye|ear|nasal|nose|inhaler|inhalation|puffer)\b/i;

// ---------- small helpers ----------

function plain(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasPhrase(text, phrase) {
  return phrase !== '' && ` ${text} `.includes(` ${phrase} `);
}

function startsWithPhrase(text, phrase) {
  return phrase !== '' && (text === phrase || text.startsWith(`${phrase} `));
}

// Some editors put a byte order mark at the start of a file. It is not part of the text.
function withoutMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(file) {
  return JSON.parse(withoutMark(fs.readFileSync(file, 'utf8')));
}

function shown(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : Math.round(t / 86400000);
}

function unique(list) {
  return [...new Set(list)];
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isFolder(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function isFile(target) {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

function neverOpened(target) {
  const low = String(target).toLowerCase();
  return NEVER_OPEN.some((word) => low.includes(word));
}

function byName(a, b) {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

// ---------- reading a history ----------

// Splits CSV text into rows of cells. Handles quotes, doubled quotes and CRLF.
function readCsvTable(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = withoutMark(text);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// The 12 columns of a dispensing history (docs/SPEC.md section 6).
const COLUMNS = [
  'patient_ref', 'patient_age', 'patient_sex', 'dispense_date', 'medicine', 'brand',
  'strength', 'form', 'quantity', 'repeats_left', 'directions', 'prescriber'
];

// The three optional columns of a record that also carries facts (docs/SPEC.md section 6a).
const FACT_COLUMNS = ['record_type', 'detail', 'value'];
const FACT_TYPES = ['condition', 'result', 'observation'];
const SUPPLY_TYPES = ['', 'dispensed'];

// Line IDs follow the order of the rows in the file, as pipeline/csv.ts does: L001 is the first row,
// and a fact row takes a line ID like a supply row.
function readHistory(file) {
  const table = readCsvTable(fs.readFileSync(file, 'utf8'));
  const problems = [];
  if (table.length === 0) return { lines: [], age: null, ref: '', problems: ['The file is empty.'], columns: 0, facts: 0 };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const at = Object.fromEntries([...COLUMNS, ...FACT_COLUMNS].map((name) => [name, header.indexOf(name)]));
  for (const name of COLUMNS) if (at[name] === -1) problems.push(`The column "${name}" is missing.`);
  // The header is the 12 columns, or the 15. One or two of the three fact columns is a slip.
  const factColumns = FACT_COLUMNS.filter((name) => at[name] !== -1);
  if (factColumns.length > 0 && factColumns.length < FACT_COLUMNS.length) {
    problems.push(`The header has ${factColumns.join(' and ')} but not ${FACT_COLUMNS.filter((name) => at[name] === -1).join(' and ')}. A record with facts needs all three: record_type, detail, value.`);
  }
  const get = (record, name) => (at[name] === -1 ? '' : (record[at[name]] ?? '').trim());
  const lines = [];
  const refs = new Set();
  let age = null;
  let supplies = 0;
  let facts = 0;
  for (let r = 1; r < table.length; r++) {
    const record = table[r];
    const id = `L${String(lines.length + 1).padStart(3, '0')}`;
    const date = get(record, 'dispense_date');
    const day = dayNumber(date);
    const typeText = get(record, 'record_type').toLowerCase();
    const isFact = FACT_TYPES.includes(typeText);
    const medicine = get(record, 'medicine');
    const brand = get(record, 'brand');
    const detail = get(record, 'detail');
    const value = get(record, 'value');
    if (isFact) {
      // A fact row: a condition, a result or an observation. The date is the date it was recorded.
      facts++;
      const a = typeText === 'observation' ? 'an' : 'a';
      if (day === null) problems.push(`${id}: the date "${date}" of this ${typeText} row is not in the form YYYY-MM-DD.`);
      if (!detail) problems.push(`${id}: ${a} ${typeText} row needs its name in the "detail" column.`);
      if (medicine || brand) problems.push(`${id}: ${a} ${typeText} row must not name a medicine. A row holds a supply or a fact, not both.`);
    } else {
      supplies++;
      if (!SUPPLY_TYPES.includes(typeText)) {
        problems.push(`${id}: the record type "${get(record, 'record_type')}" is not known. Use dispensed, condition, result or observation, or leave it empty for a supply.`);
      }
      if (day === null) problems.push(`${id}: the date "${date}" is not in the form YYYY-MM-DD.`);
      if (!medicine && !brand) problems.push(`${id}: no medicine name.`);
      if (detail || value) problems.push(`${id}: a supply row has text in "detail" or "value". Those two columns are for fact rows.`);
    }
    const ref = get(record, 'patient_ref');
    if (ref) refs.add(ref);
    const ageText = get(record, 'patient_age');
    if (/^\d{1,3}$/.test(ageText)) age = Math.max(age ?? 0, Number(ageText));
    lines.push({
      id, date, day, medicine, brand,
      type: isFact ? typeText : 'supply',
      isFact,
      detail,
      value,
      strength: get(record, 'strength'),
      form: get(record, 'form'),
      quantity: get(record, 'quantity'),
      directions: get(record, 'directions'),
      // The two name columns, in plain form, with other spellings rewritten. A fact row names no medicine.
      names: (isFact ? ['', ''] : [medicine, brand]).map((n) => {
        let p = plain(n);
        for (const [from, to] of OTHER_SPELLINGS) {
          if (hasPhrase(p, from) && !hasPhrase(p, to)) p = ` ${p} `.replace(` ${from} `, ` ${to} `).trim();
        }
        return p;
      })
    });
  }
  if (lines.length === 0 || supplies === 0) problems.push('The file has no supply rows.');
  if (refs.size > 1) problems.push(`More than one patient reference: ${[...refs].join(', ')}.`);
  // The supplies are in date order. A fact row may sit anywhere: it is not part of that order.
  const supplyLines = lines.filter((l) => !l.isFact);
  for (let i = 1; i < supplyLines.length; i++) {
    if (supplyLines[i].day !== null && supplyLines[i - 1].day !== null && supplyLines[i].day < supplyLines[i - 1].day) {
      problems.push(`${supplyLines[i].id}: the date is earlier than the supply before it.`);
      break;
    }
  }
  return { lines, age, ref: [...refs][0] ?? '', problems, columns: header.length, facts };
}

function findHistories(dir, withDemo) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (NEVER_OPEN.some((word) => entry.name.toLowerCase().includes(word))) continue;
    if (entry.isDirectory()) {
      if (entry.name === '_demo' && !withDemo) continue;
      out.push(...findHistories(full, withDemo));
    } else if (entry.name.toLowerCase().endsWith('.csv')) {
      out.push(full);
    }
  }
  return out.sort();
}

// ---------- reading the criteria ----------

// The medicine groups of a criterion file, ready for the name match.
// A brand may carry a note in brackets, as in "Targin (oxycodone with naloxone)". The brand is then
// matched by the name before the bracket too, because a label shows the name alone.
function groupsOf(raw) {
  return (Array.isArray(raw?.medicine_groups) ? raw.medicine_groups : []).filter(isObject).map((g) => {
    const names = [];                                  // { text, ingredient, kind }
    for (const ingredient of Array.isArray(g.ingredients) ? g.ingredients : []) names.push({ text: plain(ingredient), ingredient, kind: 'ingredient' });
    for (const [ingredient, brands] of Object.entries(isObject(g.brands) ? g.brands : {})) {
      if (!names.some((n) => n.kind === 'ingredient' && n.ingredient === ingredient)) {
        names.push({ text: plain(ingredient), ingredient, kind: 'ingredient' });
      }
      for (const brand of Array.isArray(brands) ? brands : []) {
        const texts = unique([plain(brand), plain(String(brand).replace(/\s*\([^)]*\)\s*$/, ''))]).filter((t) => t !== '');
        for (const text of texts) names.push({ text, ingredient, kind: 'brand' });
      }
    }
    return { key: g.key, name: g.name ?? '', names };
  });
}

function loadCriteria(listFile) {
  const list = readJson(listFile);
  const seen = new Set();
  const ids = [];
  for (const [role, names] of [['active', list.active], ['reserve', list.reserves], ['further', list.further]]) {
    for (const id of Array.isArray(names) ? names : []) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push({ id, role });
    }
  }
  return ids.map(({ id, role }) => {
    const raw = readJson(path.join(CRITERIA_DIR, id, 'criterion.json'));
    // A further criterion has its own rule in its file. How its groups combine is not known here,
    // so it is matched on the histories in its own folder only, and never judged by the group rule.
    const how = role === 'further' ? 'own_rule' : (HOW_GROUPS_COMBINE[id] ?? 'all');
    return { id, role, label: raw.label ?? id, how, groups: groupsOf(raw), raw };
  });
}

// Which ingredients of one group does one line hold? An ingredient name may sit in either name
// column (generic packs carry it in the brand). A brand name must start the brand column.
function matchLine(group, line) {
  const ingredients = new Set();
  for (const n of group.names) {
    if (n.kind === 'ingredient') {
      if (line.names.some((text) => hasPhrase(text, n.text))) ingredients.add(n.ingredient);
    } else if (startsWithPhrase(line.names[1], n.text)) {
      ingredients.add(n.ingredient);
    }
  }
  return [...ingredients];
}

// ---------- one criterion on one history ----------

function gapBetween(hitsA, hitsB, differentIngredientsOnly = false) {
  let best = null;
  for (const a of hitsA) {
    for (const b of hitsB) {
      if (a.line === b.line) continue;
      if (differentIngredientsOnly && a.ingredients.join('+') === b.ingredients.join('+')) continue;
      if (a.line.day === null || b.line.day === null) continue;
      const gap = Math.abs(a.line.day - b.line.day);
      if (best === null || gap < best) best = gap;
    }
  }
  return best;
}

function gapWords(gap) {
  if (gap === null) return 'the gap between the supply dates could not be worked out';
  if (gap <= WINDOW_DAYS) return `closest supply dates ${gap} days apart (inside ${WINDOW_DAYS} days)`;
  return `closest supply dates ${gap} days apart (OUTSIDE ${WINDOW_DAYS} days by supply date; check how long each pack lasts)`;
}

function nameOf(hit) {
  const label = hit.line.brand || hit.line.medicine;
  return FORM_TO_READ_THE_NOTE_FOR.test(hit.line.form) ? `${label} [form: ${hit.line.form}; read the group note]` : label;
}

function groupWords(part) {
  const byProduct = new Map();
  for (const hit of part.hits) {
    const name = nameOf(hit);
    if (!byProduct.has(name)) byProduct.set(name, []);
    byProduct.get(name).push(hit.line.id);
  }
  const names = [...byProduct.entries()].map(([name, ids]) => `${name} ${ids.join(' ')}`).join('; ');
  return `${part.group.key} (${part.group.name}): ${names}`;
}

function spanWords(hits) {
  const dated = hits.filter((h) => h.line.day !== null);
  if (dated.length === 0) return '';
  const first = dated[0].line;
  const last = dated[dated.length - 1].line;
  return `${hits.length} ${hits.length === 1 ? 'supply' : 'supplies'}, ${first.date} to ${last.date} (${last.day - first.day} days from first to last). ` +
    `Latest directions: "${last.directions}" (${last.strength}, qty ${last.quantity}).`;
}

function evaluate(criterion, history) {
  const parts = criterion.groups.map((group) => {
    const hits = [];
    for (const line of history.lines) {
      if (line.isFact) continue;                 // a fact row holds no medicine
      const ingredients = matchLine(group, line);
      if (ingredients.length > 0) hits.push({ line, ingredients });
    }
    return { group, hits, ingredients: unique(hits.flatMap((h) => h.ingredients)) };
  });
  const present = parts.filter((p) => p.hits.length > 0);
  const all = present.flatMap((p) => p.hits);
  const result = { criterion, parts, present, namesPresent: false, detail: '', lineIds: unique(all.map((h) => h.line.id)) };
  if (present.length === 0) return result;

  switch (criterion.how) {
    case 'own_rule':
      // The criterion's own rule decides. This tool only says which listed medicines are there.
      result.detail = present.map((p) => `group ${p.group.key}: ${spanWords(p.hits)}`).join(' | ');
      break;
    case 'two_in_one_group': {
      const doubled = present.filter((p) => p.ingredients.length >= 2);
      result.namesPresent = doubled.length > 0;
      if (result.namesPresent) {
        result.detail = doubled
          .map((p) => `two or more of group ${p.group.key}: ${p.ingredients.join(', ')}; ${gapWords(gapBetween(p.hits, p.hits, true))}`)
          .join(' | ');
      }
      break;
    }
    case 'two_anywhere': {
      const ingredients = unique(all.flatMap((h) => h.ingredients));
      result.namesPresent = ingredients.length >= 2;
      if (result.namesPresent) result.detail = `${ingredients.join(', ')}; ${gapWords(gapBetween(all, all, true))}`;
      break;
    }
    case 'first_without_second': {
      const first = parts[0];
      const second = parts[1];
      if (!first || first.hits.length === 0) break;
      const cover = second?.hits ?? [];
      const uncovered = first.hits.filter((a) =>
        !cover.some((b) => a.line.day !== null && b.line.day !== null && Math.abs(a.line.day - b.line.day) <= WINDOW_DAYS));
      result.namesPresent = uncovered.length > 0;
      if (cover.length === 0) {
        result.detail = `group ${first.group.key} is supplied and no group ${second?.group.key ?? 'B'} medicine is supplied at all. ${spanWords(first.hits)}`;
      } else if (uncovered.length > 0) {
        result.detail = `${uncovered.length} of ${first.hits.length} group ${first.group.key} supplies have no group ${second.group.key} supply within ${WINDOW_DAYS} days: ${uncovered.map((h) => h.line.id).join(' ')}`;
      } else {
        result.detail = `every group ${first.group.key} supply has a group ${second.group.key} supply within ${WINDOW_DAYS} days`;
      }
      break;
    }
    case 'first_plus_two_others': {
      const first = parts[0];
      const others = parts.slice(1).filter((p) => p.hits.length > 0);
      result.namesPresent = !!first && first.hits.length > 0 && others.length >= 2;
      if (result.namesPresent) {
        result.detail = others.map((p) => `${first.group.key} to ${p.group.key}: ${gapWords(gapBetween(first.hits, p.hits))}`).join(' | ');
      }
      break;
    }
    case 'any_group': {
      result.namesPresent = true;
      result.detail = present.map((p) => `group ${p.group.key}: ${spanWords(p.hits)}`).join(' | ');
      break;
    }
    default: {
      result.namesPresent = present.length === parts.length;
      if (!result.namesPresent) break;
      if (parts.length === 1) {
        result.detail = spanWords(parts[0].hits);
      } else {
        const gaps = [];
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            gaps.push(`${parts[i].group.key} to ${parts[j].group.key}: ${gapWords(gapBetween(parts[i].hits, parts[j].hits))}`);
          }
        }
        result.detail = gaps.join(' | ');
      }
    }
  }
  return result;
}

// The lines the sheet names for one expected finding, checked against one history.
// A line that is a fact row is fine: a finding that needs a fact must cite the fact line.
// A supply line must hold a medicine the criterion lists. One case is left to a person: when the
// history holds none of the listed medicines at all, the criterion is about a medicine that is not
// supplied, and its own rule says which lines to cite. Then the tool says so and counts nothing.
function checkCitedLines(criterionId, groups, history, holding) {
  const problems = [];
  const notes = [];
  if (groups.length === 0 || groups.some((g) => !Array.isArray(g) || g.length === 0)) {
    problems.push(`The sheet names no line, or an empty group of lines, for ${criterionId}.`);
  }
  const lineOf = new Map(history.lines.map((l) => [l.id, l]));
  const notListed = [];
  for (const id of unique(groups.flat())) {
    const line = lineOf.get(id);
    if (!line) problems.push(`The sheet names line ${id} for ${criterionId}, but the history has no such line.`);
    else if (line.isFact) continue;
    else if (!holding.has(id)) notListed.push(id);
  }
  if (notListed.length > 0) {
    if (holding.size === 0) {
      notes.push(`No medicine listed by ${criterionId} is supplied in this history, so the lines the sheet names (${notListed.join(' ')}) were not checked against its list. Read the rule: it is about a medicine that is not supplied.`);
    } else {
      for (const id of notListed) problems.push(`The sheet names line ${id} for ${criterionId}, but that line holds no medicine listed by ${criterionId}.`);
    }
  }
  return { problems, notes };
}

// ---------- the medicine list of one history (--list) ----------

function listMedicines(history) {
  const byProduct = new Map();
  for (const line of history.lines) {
    const key = line.isFact
      ? ['fact', line.type, line.detail, line.value].join('|')
      : [line.brand, line.medicine, line.strength, line.form, line.directions].join('|');
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(line);
  }
  const out = [];
  for (const lines of byProduct.values()) {
    const line = lines[0];
    if (line.isFact) {
      out.push(`      ${line.type.toUpperCase()}: ${[line.detail, line.value].filter(Boolean).join(' ')} | ${lines.map((l) => `${l.date} ${l.id}`).join(' ')}`);
      continue;
    }
    const name = line.brand && line.medicine ? `${line.brand} (${line.medicine})` : line.brand || line.medicine;
    out.push(
      `      ${name} ${line.strength} ${line.form} | "${line.directions}" | qty ${line.quantity} | ` +
      `${lines.length} x, ${line.date} to ${lines[lines.length - 1].date} | ${lines.map((l) => l.id).join(' ')}`
    );
  }
  return out;
}

// ---------- a wave folder, checked in place ----------

// What the pipeline needs from a criterion file, and what the scorer needs to show with a finding.
function checkCriterionFile(raw, id) {
  const problems = [];
  if (!isObject(raw)) return ['criterion.json is not a JSON object.'];
  if (raw.id !== id) problems.push(`criterion.json gives the ID "${String(raw.id ?? '')}", but its folder is named ${id}.`);
  for (const field of ['label', 'statement', 'rule_for_models']) {
    if (!hasText(raw[field])) problems.push(`criterion.json has no "${field}".`);
  }
  if (!hasText(raw.source?.credit)) problems.push('criterion.json has no credit line (source.credit). A finding is shown with it.');
  const groups = raw.medicine_groups;
  if (groups !== undefined && groups !== null && !Array.isArray(groups)) problems.push('"medicine_groups" must be a list of groups.');
  (Array.isArray(groups) ? groups : []).forEach((g, index) => {
    const key = isObject(g) && hasText(g.key) ? g.key : String.fromCharCode(65 + index);
    if (!isObject(g)) { problems.push(`Medicine group ${key} is not an object.`); return; }
    const isNameList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
    if (g.ingredients !== undefined && !isNameList(g.ingredients)) problems.push(`Medicine group ${key}: "ingredients" must be a list of names.`);
    if (g.brands !== undefined && (!isObject(g.brands) || !Object.values(g.brands).every(isNameList))) {
      problems.push(`Medicine group ${key}: "brands" must give a list of brand names for each ingredient.`);
    }
    const named = (isNameList(g.ingredients) ? g.ingredients : []).filter(hasText).length +
      (isObject(g.brands) ? Object.values(g.brands).flat().filter(hasText).length : 0);
    if (named === 0) problems.push(`Medicine group ${key} names no medicine.`);
  });
  const facts = raw.needs_facts;
  if (facts !== undefined && facts !== null) {
    if (!Array.isArray(facts)) problems.push('"needs_facts" must be a list of facts.');
    else {
      facts.forEach((f, index) => {
        const where = `Needed fact ${index + 1}`;
        if (!isObject(f)) { problems.push(`${where} is not an object.`); return; }
        if (!FACT_TYPES.includes(String(f.kind ?? '').trim().toLowerCase())) problems.push(`${where}: "kind" must be condition, result or observation.`);
        if (!hasText(f.what)) problems.push(`${where}: "what" is missing.`);
        if (!hasText(f.meets)) problems.push(`${where}: "meets" is missing.`);
        if (f.options !== undefined && f.options !== null) {
          if (!Array.isArray(f.options)) problems.push(`${where}: "options" must be a list.`);
          else f.options.forEach((opt, n) => {
            const place = `${where}, option ${n + 1}`;
            if (!isObject(opt)) { problems.push(`${place} is not an object.`); return; }
            if (!hasText(opt.words)) problems.push(`${place}: "words" is missing.`);
            const effect = String(opt.effect ?? '').trim();
            if (effect !== 'meets' && effect !== 'does_not_meet' && effect !== 'unknown') {
              problems.push(`${place}: "effect" must be meets, does_not_meet or unknown.`);
            }
          });
        }
        if (f.ask_when !== undefined && f.ask_when !== null) {
          if (f.ask_when === 'always') {
            // The question stands for this patient.
          } else if (isObject(f.ask_when) && hasText(f.ask_when.group)) {
            const keys = (Array.isArray(groups) ? groups : []).filter(isObject).map((g) => (hasText(g.key) ? g.key.trim() : ''));
            if (!keys.includes(String(f.ask_when.group).trim())) {
              problems.push(`${where}: "ask_when" names group ${String(f.ask_when.group).trim()}, and the criterion has no medicine group with that key.`);
            }
          } else {
            problems.push(`${where}: "ask_when" must be "always" or an object with "group".`);
          }
        }
      });
    }
  }
  return problems;
}

// Checks one criterion of a wave folder: its criterion file, its answer part and its histories.
// Returns { id, status: "ok" | "not_ok" | "not_drafted", problems, notes, histories, needsFact }.
export function checkWaveCriterion(waveDir, id) {
  const problems = [];
  const notes = [];
  const folder = path.join(waveDir, 'criteria', id);
  const criterionFile = path.join(folder, 'criterion.json');
  const done = (status, histories = 0, needsFact = false) => ({ id, status, problems, notes, histories, needsFact });

  if (!isFile(criterionFile)) {
    if (isFile(path.join(folder, 'NOT_DRAFTED.md'))) return done('not_drafted');
    problems.push('The folder has no criterion.json and no NOT_DRAFTED.md.');
    return done('not_ok');
  }
  let raw;
  try {
    raw = readJson(criterionFile);
  } catch (err) {
    problems.push(`criterion.json could not be read. ${err instanceof Error ? err.message : String(err)}`);
    return done('not_ok');
  }
  problems.push(...checkCriterionFile(raw, id));
  const criterion = { id, role: 'wave', label: raw?.label ?? id, how: 'own_rule', groups: groupsOf(raw) };
  const needsFact = Array.isArray(raw?.needs_facts) && raw.needs_facts.length > 0;

  // ----- its part of the answer sheet -----
  const casesFolder = path.join(waveDir, 'cases', id);
  const partFile = path.join(casesFolder, 'expected.part.json');
  if (!isFile(partFile)) {
    problems.push(`cases/${id}/expected.part.json was not found.`);
    return done('not_ok', 0, needsFact);
  }
  let part;
  try {
    part = readJson(partFile);
  } catch (err) {
    problems.push(`expected.part.json could not be read. ${err instanceof Error ? err.message : String(err)}`);
    return done('not_ok', 0, needsFact);
  }
  const entries = Array.isArray(part) ? part : Array.isArray(part?.cases) ? part.cases : null;
  if (entries === null) {
    problems.push('expected.part.json is not a list of histories.');
    return done('not_ok', 0, needsFact);
  }
  if (entries.length === 0) problems.push('expected.part.json lists no history.');

  // ----- its histories -----
  const named = new Set();
  let planted = 0;
  for (const entry of entries) {
    if (!isObject(entry) || !hasText(entry.file)) {
      problems.push('An entry of expected.part.json has no "file".');
      continue;
    }
    const rel = entry.file.trim().replace(/\\/g, '/');
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const say = (text) => problems.push(`${name}: ${text}`);
    if (parts.length !== 2 || parts[0] !== id || parts.some((p) => p === '..' || p.trim() === '')) {
      problems.push(`expected.part.json names ${rel}. A history of this criterion is written as ${id}/<file>.csv.`);
      continue;
    }
    if (named.has(name.toLowerCase())) { say('it is listed twice in expected.part.json.'); continue; }
    named.add(name.toLowerCase());
    if (!['positive', 'near_miss', 'clean'].includes(entry.kind)) say('"kind" must be positive, near_miss or clean.');
    if (!hasText(entry.about)) say('it has no "about" sentence.');
    const findings = Array.isArray(entry.findings) ? entry.findings : null;
    if (findings === null) { say('"findings" must be a list.'); continue; }
    if (entry.kind === 'positive' && findings.length === 0) say('it is marked positive, but the sheet lists no finding.');
    if (entry.kind !== 'positive' && findings.length > 0) say(`it is marked ${entry.kind}, but the sheet lists a finding.`);
    if (/^pos-/i.test(name) && entry.kind !== 'positive') say(`its name says a finding is planted, but it is marked ${entry.kind}.`);

    const file = path.join(casesFolder, name);
    if (!isFile(file)) { say('the file was not found.'); continue; }
    if (!name.toLowerCase().endsWith('.csv')) { say('only CSV histories can be scored.'); continue; }
    let history;
    try {
      history = readHistory(file);
    } catch (err) {
      say(`the file could not be read. ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const p of history.problems) say(p);

    const result = evaluate(criterion, history);
    const holding = new Set(result.lineIds);
    for (const finding of findings) {
      if (!isObject(finding) || !hasText(finding.criterion)) { say('a finding has no "criterion".'); continue; }
      if (finding.criterion.trim() !== id) { say(`the sheet expects ${finding.criterion}. A history in this folder is scored for ${id} only.`); continue; }
      planted++;
      const groups = Array.isArray(finding.must_cite) ? finding.must_cite : [];
      if (!Array.isArray(finding.must_cite) || groups.some((g) => !Array.isArray(g) || g.some((x) => typeof x !== 'string'))) {
        say('"must_cite" must be a list of lists of line IDs.');
        continue;
      }
      const cited = checkCitedLines(id, groups, history, holding);
      for (const p of cited.problems) say(p);
      for (const n of cited.notes) notes.push(`${name}: ${n}`);
      // A history named pos-fact holds the fact: the finding must cite the fact line (docs/SPEC.md section 6a).
      if (/^pos-fact/i.test(name)) {
        const factIds = new Set(history.lines.filter((l) => l.isFact).map((l) => l.id));
        if (factIds.size === 0) say('it is named pos-fact, but it holds no condition, result or observation row.');
        else if (!groups.some((g) => g.length > 0 && g.every((x) => factIds.has(x)))) {
          say('it is named pos-fact, but the sheet names no fact line that must be cited.');
        }
      }
    }
  }
  // A history file that the answer part does not list would never be scored.
  let inFolder = [];
  try {
    inFolder = fs.readdirSync(casesFolder).filter((n) => n.toLowerCase().endsWith('.csv') && !neverOpened(n)).sort(byName);
  } catch {
    inFolder = [];
  }
  for (const name of inFolder) {
    if (!named.has(name.toLowerCase())) problems.push(`${name}: the file is in the folder, but expected.part.json does not list it.`);
  }
  if (entries.length > 0 && planted === 0) problems.push('The answer part has no planted finding for this criterion. It cannot pass.');
  return done(problems.length === 0 ? 'ok' : 'not_ok', named.size, needsFact);
}

// Checks every criterion folder of one wave folder. Returns { name, criteria: [...] }.
export function checkWaveFolder(waveDir, name = path.basename(waveDir)) {
  const criteriaDir = path.join(waveDir, 'criteria');
  let ids = [];
  try {
    ids = fs.readdirSync(criteriaDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !neverOpened(e.name)).map((e) => e.name).sort(byName);
  } catch {
    ids = [];
  }
  return { name, criteria: ids.map((id) => checkWaveCriterion(waveDir, id)) };
}

// One line for one criterion: "ok", "not drafted", or what is wrong.
export function verdictLine(item, all = false) {
  if (item.status === 'not_drafted') return `${item.id}  not drafted`;
  if (item.status === 'ok') {
    const kind = item.needsFact ? 'needs a fact' : 'supplies only';
    const read = item.notes.length > 0 ? `, ${item.notes.length} ${item.notes.length === 1 ? 'note' : 'notes'} to read` : '';
    return `${item.id}  ok  (${item.histories} ${item.histories === 1 ? 'history' : 'histories'}, ${kind}${read})`;
  }
  const max = all ? item.problems.length : 3;
  const more = item.problems.length - max;
  return `${item.id}  NOT OK  ${item.problems.slice(0, max).join(' | ')}${more > 0 ? ` | and ${more} more (--all shows every one)` : ''}`;
}

function runWaves(options) {
  const found = findWaveFolders(options.waves, process.cwd());
  if (found.errors.length > 0) throw new Error(found.errors.join(' '));
  const waves = found.waves.map((wave) => checkWaveFolder(wave.dir, wave.name));
  const every = waves.flatMap((w) => w.criteria);
  const counts = {
    criteria: every.length,
    ok: every.filter((c) => c.status === 'ok').length,
    not_ok: every.filter((c) => c.status === 'not_ok').length,
    not_drafted: every.filter((c) => c.status === 'not_drafted').length
  };
  if (options.json) {
    console.log(JSON.stringify({ tool: 'check-cases', mode: 'wave', all_ok: counts.not_ok === 0, counts, waves }, null, 2));
    return counts.not_ok === 0 ? 0 : 1;
  }
  const say = (line) => console.log(line);
  say('ClinicaLANTERN case check. Test tooling only. A plain name match. It is not the screening.');
  say('Fictional patients only.');
  for (const wave of waves) {
    say('');
    say(`Wave folder ${wave.name}: ${wave.criteria.length} criterion ${wave.criteria.length === 1 ? 'folder' : 'folders'}.`);
    for (const item of wave.criteria) {
      say(verdictLine(item, options.all));
      if (options.all || options.list) for (const note of item.notes) say(`      note: ${note}`);
    }
  }
  say('');
  say('SUMMARY');
  say(`Criteria: ${counts.criteria}. Ok: ${counts.ok}. Not ok: ${counts.not_ok}. Not drafted: ${counts.not_drafted}.`);
  const noted = every.filter((c) => c.notes.length > 0).length;
  if (noted > 0 && !(options.all || options.list)) say(`Criteria with a note to read: ${noted}. Run with --all to see the notes.`);
  say(counts.not_ok === 0 ? 'Every drafted criterion is ok.' : 'Fix what is not ok, then run this again.');
  return counts.not_ok === 0 ? 0 : 1;
}

// ---------- main ----------

function parseArgs(argv) {
  const options = { list: false, parts: false, withDemo: false, sheet: null, criteria: null, only: [], help: false, waves: [], all: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') options.list = true;
    else if (arg === '--parts') options.parts = true;
    else if (arg === '--with-demo') options.withDemo = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--sheet' && argv[i + 1]) options.sheet = argv[++i];
    else if (arg === '--criteria' && argv[i + 1]) options.criteria = argv[++i];
    else if (arg === '--only' && argv[i + 1]) options.only.push(argv[++i].toLowerCase());
    else if (arg === '--wave' && argv[i + 1]) options.waves.push(...argv[++i].split(',').map((w) => w.trim()).filter((w) => w !== ''));
    else if (arg.startsWith('--wave=') && arg.length > 7) options.waves.push(...arg.slice(7).split(',').map((w) => w.trim()).filter((w) => w !== ''));
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option, or an option with no value: ${arg}`);
  }
  if (options.waves.length > 0 && (options.sheet || options.criteria || options.withDemo || options.parts || options.only.length > 0)) {
    throw new Error('With --wave only --all, --list and --json can be used. A wave folder brings its own criteria and answer parts.');
  }
  return options;
}

function firstThatExists(files) {
  return files.find((f) => fs.existsSync(f)) ?? null;
}

function samePath(a, b) {
  const one = path.resolve(a);
  const two = path.resolve(b);
  return process.platform === 'win32' ? one.toLowerCase() === two.toLowerCase() : one === two;
}

// The files to read when no option names them. The signed answer sheet and the list in use go
// together, and so do the two proposed files. The signed pair wins as soon as the signed sheet
// exists, so a proposed file left on disk after sign-off is never checked in its place.
function chooseFiles(options) {
  const signedSheet = path.join(CASES_DIR, 'expected.json');
  const proposedSheet = path.join(CASES_DIR, 'expected.proposed.json');
  const listInUse = path.join(CRITERIA_DIR, 'active.json');
  const proposedList = path.join(CRITERIA_DIR, 'active.proposed.json');
  const notes = [];

  const sheetFile = options.sheet ? path.resolve(options.sheet) : firstThatExists([signedSheet, proposedSheet]);
  const withSignedSheet = sheetFile !== null && samePath(sheetFile, signedSheet);
  const criteriaFile = options.criteria
    ? path.resolve(options.criteria)
    : firstThatExists(withSignedSheet ? [listInUse, proposedList] : [proposedList, listInUse]);

  if (!options.sheet && withSignedSheet && fs.existsSync(proposedSheet)) {
    notes.push(`${shown(proposedSheet)} is still on disk. It was NOT checked. The signed sheet was. ` +
      'Delete the proposed sheet, or check it with --sheet.');
  }
  if (!options.criteria && criteriaFile !== null && samePath(criteriaFile, listInUse) && fs.existsSync(proposedList)) {
    notes.push(`${shown(proposedList)} is still on disk. It was NOT used. The list in use was. ` +
      'Delete the proposed list, or use it with --criteria.');
  }
  return { sheetFile, criteriaFile, notes };
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Use: node tools/check-cases.mjs [--list] [--parts] [--sheet <file>] [--criteria <file>] [--only <text>] [--with-demo]');
    console.log('  or node tools/check-cases.mjs --wave <folder> [--wave <folder>] [--all] [--json]');
    console.log('Test tooling only. A plain name match of the fictional test histories against the criteria. It is not the screening.');
    console.log('The last lines give one verdict for each criterion. It ends with code 0 only when every criterion is ok.');
    return 0;
  }
  if (options.waves.length > 0) return runWaves(options);

  const { sheetFile, criteriaFile, notes: fileNotes } = chooseFiles(options);
  if (!criteriaFile) throw new Error('No list of criteria was found.');
  const criteria = loadCriteria(criteriaFile);
  const byId = new Map(criteria.map((c) => [c.id, c]));

  const sheet = sheetFile ? readJson(sheetFile) : null;
  const sheetCases = Array.isArray(sheet?.cases) ? sheet.cases : [];
  const expectedByFile = new Map(sheetCases.map((c) => [String(c.file).replace(/\\/g, '/'), c]));

  let files = findHistories(CASES_DIR, options.withDemo);
  if (options.only.length > 0) {
    files = files.filter((f) => options.only.some((text) => shown(f).toLowerCase().includes(text)));
  }

  const problems = [];        // the sheet and the histories disagree
  const toRead = [];          // names present, not expected by the sheet
  const notes = [];           // things to read that are not counted as wrong
  let agreed = 0;
  const seenFiles = new Set();
  const say = (line) => console.log(line);
  const problem = (rel, text) => {
    problems.push(`${rel}: ${text}`);
    say(`   PROBLEM  ${text}`);
  };

  say('ClinicaLANTERN case check. Test tooling only. A plain name match. It is not the screening.');
  say('Fictional patients only.');
  const further = criteria.filter((c) => c.role === 'further').length;
  say(`Criteria: ${criteria.length} (${criteria.filter((c) => c.role === 'active').length} active, ` +
    `${criteria.filter((c) => c.role === 'reserve').length} reserves${further > 0 ? `, ${further} further` : ''}) from ${shown(criteriaFile)}.`);
  for (const c of criteria) if (c.how !== 'all' && c.how !== 'own_rule') say(`   ${c.id} ${HOW_IN_WORDS[c.how]}.`);
  say('   Every other criterion needs every one of its groups.');
  if (further > 0) say('   A further criterion has its own rule. It is matched on the histories in its own folder only, and its group rule is not judged.');
  if (sheet) {
    const sign = sheet.signed_by_clinical_reviewer;
    say(`Answer sheet: ${shown(sheetFile)}. ${sign ? `Signed by ${sign.name} on ${sign.date}.` : 'Not signed by the clinical reviewer yet.'}`);
    if (expectedByFile.size !== sheetCases.length) problem(shown(sheetFile), 'A history is listed more than once.');
  } else {
    say('Answer sheet: none found. Nothing is compared.');
  }
  for (const note of fileNotes) say(`NOTE  ${note}`);
  say(`Histories: ${files.length}.`);
  say('"NAMES PRESENT" means the medicine names a rule needs are in the history. Dates, doses, directions and age are for a person to read.');
  say('');

  for (const file of files) {
    const rel = path.relative(CASES_DIR, file).split(path.sep).join('/');
    const folder = rel.split('/').slice(0, -1).join('/');
    seenFiles.add(rel);
    const history = readHistory(file);
    const expected = expectedByFile.get(rel) ?? null;
    say(`${rel}   ${history.lines.length} lines${history.facts > 0 ? ` (${history.facts} fact ${history.facts === 1 ? 'row' : 'rows'})` : ''}, patient ${history.ref || '(no reference)'}, age ${history.age ?? 'not shown'}` +
      (expected ? `, sheet: ${expected.kind}` : ''));
    for (const p of history.problems) problem(rel, p);
    if (options.list) for (const row of listMedicines(history)) say(row);

    // A further criterion is matched on the histories in its own folder only.
    const results = criteria.filter((c) => c.role !== 'further' || c.id === folder).map((c) => evaluate(c, history));
    const findings = Array.isArray(expected?.findings) ? expected.findings : [];
    const expectedIds = new Set(findings.map((f) => f.criterion));
    for (const r of results) {
      const c = r.criterion;
      if (r.namesPresent) {
        const wanted = expectedIds.has(c.id);
        const tag = !expected ? '' : wanted ? '  [sheet expects it]' : '  [NOT in the sheet: read it]';
        say(`   NAMES PRESENT  ${c.id} (${c.role})${tag}`);
        for (const part of r.present) say(`      ${groupWords(part)}`);
        say(`      ${r.detail}`);
        if (expected) {
          if (wanted) agreed++;
          else toRead.push(`${rel}  ${c.id} (${c.role})  ${r.detail}`);
        }
      } else if (options.parts && r.present.length > 0) {
        say(`   some names     ${c.id} (${c.role})  ${r.present.map(groupWords).join(' | ')}${r.detail ? ` | ${r.detail}` : ''}`);
      }
    }

    // The sheet of the first ten lists the active criteria and the clean histories only.
    // A history of a further criterion or a reserve has its own sheet, so it is not reported
    // as missing from this one. It is still read for name matches, above.
    // A history whose criterion is active, and which this sheet does not list, is still reported.
    const onThisSheet = criteria.some((c) => c.role === 'active' && c.id === folder);
    if (sheet && !expected && onThisSheet) problem(rel, 'This history is not in the answer sheet.');
    for (const finding of findings) {
      const c = byId.get(finding.criterion);
      if (!c) {
        problem(rel, `The sheet expects ${finding.criterion}, which is not in the list of criteria.`);
        continue;
      }
      // The lines the sheet names are checked against the criterion's list wherever the history sits.
      const r = results.find((x) => x.criterion.id === c.id) ?? evaluate(c, history);
      // How the groups of a further criterion combine is not known here, so its names are not judged.
      if (c.how !== 'own_rule' && !r.namesPresent) problem(rel, `The sheet expects ${c.id}, but the names it needs are not in the history.`);
      const groups = Array.isArray(finding.must_cite) ? finding.must_cite : [];
      const cited = checkCitedLines(c.id, groups, history, new Set(r.lineIds));
      for (const p of cited.problems) problem(rel, p);
      for (const n of cited.notes) {
        notes.push(`${rel}: ${n}`);
        say(`   note  ${n}`);
      }
    }
    if (expected && expected.kind === 'positive' && findings.length === 0) problem(rel, 'Marked positive, but the sheet lists no finding.');
    if (expected && expected.kind !== 'positive' && findings.length > 0) problem(rel, `Marked ${expected.kind}, but the sheet lists a finding.`);
    say('');
  }

  if (sheet && options.only.length === 0) {
    for (const rel of expectedByFile.keys()) {
      if (!seenFiles.has(rel)) problems.push(`${rel}: listed in the answer sheet, but the file was not found.`);
    }
  }

  say('SUMMARY');
  say(`Files used: ${shown(criteriaFile)}${sheetFile ? ` and ${shown(sheetFile)}` : ''}.`);
  for (const note of fileNotes) say(`NOTE  ${note}`);
  if (!sheet) {
    say('No answer sheet was compared.');
    for (const line of problems) say(`   ${line}`);
  } else {
    const planted = criteria
      .map((c) => `${c.id} ${sheetCases.reduce((n, x) => n + (x.findings ?? []).filter((f) => f.criterion === c.id).length, 0)}`)
      .join(', ');
    say(`Expected findings in the sheet, by criterion: ${planted}.`);
    say(`Expected findings whose names are present: ${agreed}.`);
    say(`Names present but not expected by the sheet: ${toRead.length}. Read each one. A near miss belongs here. Anything else is an overlap to fix.`);
    for (const line of toRead) say(`   ${line}`);
    if (notes.length > 0) {
      say(`Notes to read, not counted as wrong: ${notes.length}.`);
      for (const line of notes) say(`   ${line}`);
    }
    say(`Disagreements between the sheet and the histories: ${problems.length}.${problems.length === 0 ? '' : ' These must be fixed.'}`);
    for (const line of problems) say(`   ${line}`);
  }

  // One verdict for each criterion: ok, or what is wrong. A problem belongs to the criterion whose
  // folder holds the history. What belongs to no criterion (a clean history, the sheet itself) comes last.
  say('');
  say('VERDICTS');
  const byFolder = new Map();
  for (const line of problems) {
    const folder = line.split(':')[0].split('/').slice(0, -1).join('/') || '(the answer sheet)';
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(line);
  }
  for (const c of criteria) {
    const mine = byFolder.get(c.id) ?? [];
    byFolder.delete(c.id);
    say(mine.length === 0 ? `${c.id}  ok` : `${c.id}  NOT OK  ${mine.slice(0, 3).join(' | ')}${mine.length > 3 ? ` | and ${mine.length - 3} more, listed above` : ''}`);
  }
  for (const [folder, lines] of byFolder) {
    say(`${folder}  NOT OK  ${lines.slice(0, 3).join(' | ')}${lines.length > 3 ? ` | and ${lines.length - 3} more, listed above` : ''}`);
  }
  say(problems.length === 0 ? 'Every criterion is ok.' : 'Fix what is not ok, then run this again.');
  return problems.length > 0 ? 1 : 0;
}

function startedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const here = fs.realpathSync(fileURLToPath(import.meta.url));
    const there = fs.realpathSync(path.resolve(entry));
    return process.platform === 'win32' ? here.toLowerCase() === there.toLowerCase() : here === there;
  } catch {
    return false;
  }
}

// The tool runs when it is started from the command line. Another tool (tools/adopt-wave.mjs)
// imports checkWaveFolder from it, and then nothing runs by itself.
if (startedDirectly()) {
  let code = 2;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    console.log(`The case check could not run. ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = code;
}
