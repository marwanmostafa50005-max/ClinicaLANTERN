// tools/extract-criteria.mjs
//
// Pulls the published statements for the pool of 19 criteria out of the earlier
// project's criteria package. Writes one small JSON file for each criterion to
// criteria/_extract/<NEW-ID>.json.
//
// From each card it takes only:
//   - the published statement text, unchanged
//   - the item label
//   - the source document fields
//   - the rights block
// It never copies or prints the earlier project's questions, atoms, expressions,
// expected answers, evaluation notes or test content.
//
// Run:    node tools/extract-criteria.mjs
//         node tools/extract-criteria.mjs "<folder of the earlier project>"
// Prints: one line for each criterion. The new id, a tab, then the number of
//         characters in the statement. Nothing else goes to standard output.
//
// The package is found through the earlier project's register. It is read once.
// Its size and SHA-256 must match the register before anything is written.
// If an identifier is not in the package the file says found:false. No text is guessed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO_ROOT, 'criteria', '_extract');

// The earlier project's folder sits beside this repository, unless a folder is given.
// With --all every card in the package is extracted (statement, label, source and rights only),
// so that further criteria can be drafted without anyone opening the package again.
const ALL = process.argv.includes('--all');
const FOLDER_ARG = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const OLD_PROJECT = FOLDER_ARG
  ? path.resolve(FOLDER_ARG)
  : path.resolve(REPO_ROOT, '..', 'ClinicaLANTERN Prototype');
const REGISTER_FILE = 'build-evidence/resumption-20261110/criteria-lane/CRITERIA_413_REGISTER_V1.json';

// The pool: new id, old id. The first ten are proposed for use. The rest are reserves.
const POOL = [
  ['STOPP-C10', 'LX-STOPP-C10'],
  ['STOPP-B3', 'LX-STOPP-B3'],
  ['STOPP-B13', 'LX-STOPP-B13'],
  ['STOPP-C14', 'LX-STOPP-C14'],
  ['STOPP-D18', 'LX-STOPP-D18'],
  ['STOPP-L2', 'LX-STOPP-L2'],
  ['STOPP-D8', 'LX-STOPP-D8'],
  ['STOPP-A3', 'LX-STOPP-A3'],
  ['STOPP-B11', 'LX-STOPP-B11'],
  ['PINCER-9', 'LX-PINCER-9'],
  ['BRISNIK-HR-F2', 'LX-BRISNIK-HR-F2'],
  ['STOPP-M1', 'LX-STOPP-M1'],
  ['EU7-F14', 'LX-EU7-F14'],
  ['PINCER-10', 'LX-PINCER-10'],
  ['PROMPT-CN-4', 'LX-PROMPT-CN-4'],
  ['STOPP-C13', 'LX-STOPP-C13'],
  ['STOPP-C1', 'LX-STOPP-C1'],
  ['PROMPT-RS-3', 'LX-PROMPT-RS-3'],
  ['BRISNIK-HR-A3', 'LX-BRISNIK-HR-A3'],
];

function stop(message) {
  process.stderr.write('extract-criteria: ' + message + '\n');
  process.exit(1);
}

// Paths this project must never open.
const PROTECTED_PARTS = ['sealed', 'holdout', 'review-card', 'founder-review-queue'];
function allowed(file) {
  const low = file.toLowerCase();
  if (path.basename(low) === 'synthetic_cases.py' || PROTECTED_PARTS.some((part) => low.includes(part))) {
    stop('refusing to open a protected path');
  }
  return file;
}

// Small helpers. They copy text as it is or return nothing. They never change text.
const text = (value) => (typeof value === 'string' && value !== '' ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const textList = (value) => list(value).filter((item) => typeof item === 'string' && item !== '');
function pick(object, keys) {
  const out = {};
  if (object && typeof object === 'object') {
    for (const key of keys) {
      if (typeof object[key] === 'string' && object[key] !== '') out[key] = object[key];
    }
  }
  return out;
}

// 1. The register says where the package is, how big it is and what its hash is.
const registerPath = allowed(path.join(OLD_PROJECT, REGISTER_FILE));
let pin;
try {
  pin = JSON.parse(fs.readFileSync(registerPath, 'utf8')).pins.source;
} catch (error) {
  stop('cannot read the register: ' + error.message);
}
if (!pin || typeof pin.path !== 'string' || typeof pin.bytes !== 'number' || typeof pin.sha256 !== 'string') {
  stop('the register does not pin the source package');
}

// 2. Read the package once. Check it is the pinned file before using it.
const packagePath = allowed(path.resolve(OLD_PROJECT, pin.path));
if (!packagePath.startsWith(OLD_PROJECT + path.sep)) {
  stop('the register points outside the earlier project folder');
}
let bytes;
try {
  bytes = fs.readFileSync(packagePath);
} catch (error) {
  stop('cannot read the package: ' + error.message);
}
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== pin.bytes || sha256 !== pin.sha256.toLowerCase()) {
  stop('the package does not match the size and hash in the register. Nothing was written.');
}
let cards;
try {
  cards = JSON.parse(bytes.toString('utf8')).cards;
} catch (error) {
  stop('the package is not valid JSON: ' + error.message);
}
if (!Array.isArray(cards)) stop('the package has no list of cards');

// With --all the pool becomes every card in the package. The new id is the old id without "LX-".
if (ALL) {
  POOL.length = 0;
  for (const card of cards) {
    if (card && typeof card.card_id === 'string' && /^LX-[A-Za-z0-9-]+$/.test(card.card_id)) {
      POOL.push([card.card_id.slice(3).toUpperCase(), card.card_id]);
    }
  }
}

// 3. Find the wanted cards by their exact identifier.
const wanted = new Set(POOL.map(([, oldId]) => oldId));
const hits = new Map();
for (const card of cards) {
  if (card && wanted.has(card.card_id)) {
    if (!hits.has(card.card_id)) hits.set(card.card_id, []);
    hits.get(card.card_id).push(card);
  }
}

const packageFacts = {
  note: "Paths are inside the earlier project's folder.",
  register: REGISTER_FILE,
  package_file: pin.path,
  package_bytes: bytes.length,
  package_sha256: sha256,
};

const FIELD_ORIGINS = {
  label: "The card's item label, unchanged.",
  family: "The card's source family, unchanged.",
  statement: "The card's text_verbatim, unchanged.",
  'source.document': "The card's source document, unchanged.",
  'source.edition': "The card's edition_version, unchanged.",
  'source.citation': 'The same text as the credit line. The package has no separate citation field.',
  'source.doi': "The card's DOI, unchanged. null means the package records none.",
  'source.url': 'Built from the DOI as a doi.org link. The package records no article address. null when there is no DOI.',
  'source.licence': "The rights block's licence, unchanged.",
  'source.credit': "The rights block's credit line, unchanged.",
  'source.modification_notice': "The rights block's modification notice, unchanged.",
  rights_block_as_recorded: "The card's whole rights block, unchanged.",
  context_as_recorded:
    'Text the earlier project recorded beside the statement: section, locator, preambles, footnotes, extra table columns, the source rows by identifier, and related documents. Row text other than the statement is not copied.',
};

function notFound(newId, oldId, reason) {
  return {
    id: newId,
    old_id: oldId,
    found: false,
    reason,
    label: null,
    family: null,
    statement: null,
    statement_chars: 0,
    source: null,
    extraction: { ...packageFacts },
  };
}

// Plain facts a reader should see before using the text. Each one is worked out from the card.
function cautionsFor(src, rights, label, doi, statement) {
  const out = [];
  out.push("The licence is a proposal by the earlier project. It is not confirmed. The founder should check it on the publisher's page.");
  const status = text(rights.status_proposed);
  if (status) {
    let line = `The earlier project recorded the rights status "${status}". That is its own self-check.`;
    if ((text(rights.per_card_check) || '').includes('review pending')) {
      line += ' Its note says an independent rights review is pending.';
    }
    out.push(line);
  }
  const open = textList(rights.field_dependencies).length;
  if (open > 0) {
    out.push(`The earlier project lists ${open} open ${open === 1 ? 'point' : 'points'} for this card. See rights_block_as_recorded.field_dependencies.`);
  }
  out.push("The statement is the wording the earlier project recorded as verbatim. This extraction did not compare it with the publisher's page.");
  out.push('The modification notice describes changes made by the earlier project. Check that it fits this prototype before it is shown.');
  if (list(src.preambles).length > 0) {
    out.push("The source's framing text is in context_as_recorded.preambles. It can set limits the statement does not repeat, such as the age group.");
  }
  if (!doi) out.push('The package records no DOI for this source. None was filled in.');
  if (label && label.includes('(')) {
    out.push('The label carries a remark by the earlier project. A plain display label still has to be chosen.');
  }
  const rows = list(src.members);
  if (statement.includes(' || ')) {
    const names = rows.map((row) => text(row && row.name_as_printed)).filter(Boolean);
    let line = `The statement holds ${statement.split(' || ').length} rows of the source table. The earlier project joined them with " || ".`;
    if (names.length > 0) line += ` Rows: ${names.join(', ')}.`;
    out.push(line);
  }
  const others = rows.filter((row) => row && text(row.role) && row.role !== 'Canonical criterion');
  if (others.length > 0) {
    const named = others.map((row) => `${text(row.source_row_id) || 'unnamed row'} (${row.role})`).join(', ');
    out.push(`The card also lists other source rows: ${named}. Their text is not copied here.`);
  }
  return out;
}

function build(newId, oldId) {
  const found = hits.get(oldId) || [];
  if (found.length === 0) return notFound(newId, oldId, 'No card with this identifier is in the package.');
  if (found.length > 1) return notFound(newId, oldId, 'More than one card has this identifier. None was chosen.');
  const card = found[0];
  const src = card.source && typeof card.source === 'object' ? card.source : {};
  const rights = card.rights && typeof card.rights === 'object' ? card.rights : {};
  const statement = text(src.text_verbatim);
  if (statement === null) return notFound(newId, oldId, 'The card has no statement text.');

  const label = text(src.item_label);
  const rawDoi = text(src.doi);
  const doi = rawDoi && /^10\.\d{4,9}\/\S+$/.test(rawDoi) ? rawDoi : null;

  return {
    id: newId,
    old_id: oldId,
    found: true,
    label,
    family: text(card.source_family),
    statement,
    statement_chars: Array.from(statement).length,
    source: {
      document: text(src.document),
      edition: text(src.edition_version),
      citation: text(rights.credit),
      doi: rawDoi,
      url: doi ? 'https://doi.org/' + doi : null,
      licence: text(rights.licence),
      credit: text(rights.credit),
      modification_notice: text(rights.modification_notice),
    },
    rights_block_as_recorded: {
      licence: text(rights.licence),
      licence_url: text(rights.licence_url),
      credit: text(rights.credit),
      basis: text(rights.basis),
      modification_notice: text(rights.modification_notice),
      field_dependencies: textList(rights.field_dependencies),
      status_proposed: text(rights.status_proposed),
      per_card_check: text(rights.per_card_check),
    },
    context_as_recorded: {
      section: text(src.section),
      locator: text(src.locator),
      preambles: list(src.preambles).map((item) => pick(item, ['scope', 'text'])),
      footnotes_and_definitions: list(src.footnotes_and_definitions).map((item) => pick(item, ['marker', 'text', 'source'])),
      extra_columns: textList(src.extra_columns),
      source_rows: list(src.members).map((item) => pick(item, ['source_row_id', 'role', 'source', 'name_as_printed'])),
      related_documents: list(src.related_documents).map((item) => pick(item, ['document', 'url', 'role'])),
    },
    extraction: {
      ...packageFacts,
      card_version: text(card.card_version),
      taken: 'Only the statement text, the item label, the source document fields and the rights block.',
      field_origins: FIELD_ORIGINS,
      cautions: cautionsFor(src, rights, label, rawDoi, statement),
    },
  };
}

// 4. Build every record first. Then write. Then read each file back and compare.
const records = POOL.map(([newId, oldId]) => {
  if (!/^[A-Z0-9-]+$/.test(newId)) stop('bad identifier in the pool: ' + newId);
  return build(newId, oldId);
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const lines = [];
for (const record of records) {
  const file = path.join(OUT_DIR, record.id + '.json');
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.found) {
    const original = hits.get(record.old_id)[0].source.text_verbatim;
    if (back.statement !== original) stop('the statement written for ' + record.id + ' differs from the package');
  }
  lines.push(record.id + '\t' + (record.found ? record.statement_chars : 'not found'));
}
process.stdout.write(lines.join('\n') + '\n');
