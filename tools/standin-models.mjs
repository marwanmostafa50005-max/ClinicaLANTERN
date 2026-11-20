#!/usr/bin/env node
/**
 * Stand-in Ollama server for ClinicaLANTERN rehearsals (no GPU).
 *
 * NOT SETTLED
 * - TypeScript mega-fakes.ts is not imported: plain Node cannot load .ts without a loader;
 *   screen/check/letter answer logic is ported inline from server/mega-fakes.ts and fixtures.
 * - Criterion labels that are long descriptive phrases (not normalisable to a single criterion id)
 *   may not resolve unless the label matches exactly one id via alphanumeric folding; the log
 *   shows criterionId "?" when that happens. For M01, folding matches the usual STOPP-/START-/EU7-
 *   style labels.
 * - Letter drafts are simplified paragraphs from the expected pack; a strict fact check may request
 *   a second /api/chat and still fall back to the template (real app behaviour).
 *
 * APPLICATION MODEL HTTP (ollamaBase); every call the repo makes:
 *
 *   GET  /api/version   server/engine.ts:121 probeModelServer (warm-up / models-up probe)
 *   GET  /api/version   server/api.ts:97 getHealth
 *   GET  /api/tags      server/api.ts:100 getHealth (lists cfg.models.screen|check|letter)
 *   POST /api/chat      pipeline/ollama.ts:159 chat (screen, check, letter, transcribe, warm-up)
 *
 * No other paths under ollamaBase are used by the application (tools/smoke.mjs uses /api/ps but
 * that is a maintainer tool, not the app). Unimplemented paths → HTTP 404 + one console line.
 *
 * CRITERION IN THE REQUEST
 * - Screen / screen-part / warm-up on history: line "CRITERION <label>" in a user message
 *   (pipeline/criteria.ts criterionBlock, pipeline/screen.ts screenMessages).
 * - Check: same CRITERION block; JSON under "SUSPECTED FINDING FROM THE FIRST STEP" has
 *   "criterion": <label> (pipeline/check.ts checkMessages).
 * - Letter: JSON under "FINDING ACCEPTED BY THE PHARMACIST" has "criterion_label" (pipeline/letter.ts).
 * The stand-in maps <label> → criterion id (folder name) by: exact id match, then unique
 * alphanumeric fold against the built-in active+further id list, then expected-finding id match.
 *
 * ANSWERS (ported from server/mega-fakes.ts)
 * - Screen: expected finding → suspected per facts/missing facts; else touched_no_finding why; else clear.
 * - Check: confirms with line ids from suspected JSON or expected lines; text from expected why.
 * - Letter: four JSON fields; subject/body style from expected pack.
 * - Warm-up: { "ok": true }.
 * - Transcribe (if called): empty rows, empty patient strings (csv import does not use this in M01).
 *
 * COORDINATOR USE
 * 1) Start stand-in:
 *      node tools/standin-models.mjs --port 27999 ^
 *        --expected server/fixtures/mega/M01_EXPECTED.json ^
 *        --history server/fixtures/mega/M01-dispense-history.csv
 * 2) In a copy of the repo, point the app at the stand-in:
 *      lantern.config.json → "ollamaBase": "http://127.0.0.1:27999"
 *      (read in pipeline/config.ts loadConfig/normalizeConfig, field ollamaBase, default line 7)
 * 3) Start app server (from that copy). LANTERN_NO_WARMUP may be unset: warm-up POST /api/chat
 *    is answered with { ok: true }. Set LANTERN_NO_WARMUP=1 to skip that call (server/index.ts:85).
 * 4) Import test history through the real page; everything else is the real application.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 27999;
const DEFAULT_EXPECTED = path.join(__dirname, '..', 'server', 'fixtures', 'mega', 'M01_EXPECTED.json');
const DEFAULT_HISTORY = path.join(__dirname, '..', 'server', 'fixtures', 'mega', 'M01-dispense-history.csv');

/** Every criterion id in criteria/active.json (active + further) on 20 Nov 2026 — for label folding. */
const ALL_CRITERION_IDS = (
  'STOPP-C10 STOPP-B3 STOPP-B13 STOPP-C14 STOPP-D18 STOPP-L2 STOPP-D8 STOPP-A3 STOPP-B11 PINCER-9 ' +
  'EU7-F01 EU7-F02 EU7-F03 EU7-F04 EU7-F05 EU7-F06 EU7-F07 EU7-F08 EU7-F09 EU7-F10 EU7-F11 EU7-F12 ' +
  'EU7-F13 EU7-F15 EU7-F16 EU7-F17 EU7-F18 EU7-F19 EU7-F21 EU7-F22 EU7-F23 EU7-F24 EU7-F25 EU7-F26 ' +
  'EU7-F27 EU7-F28 EU7-F29 EU7-F30 EU7-F31 EU7-F32 EU7-F33 EU7-F34 EU7-F35 EU7-F36 EU7-F37 EU7-F38 ' +
  'EU7-F39 EU7-F40 EU7-F41 EU7-F42 EU7-F43 EU7-F44 EU7-F45 EU7-F46 EU7-F47 EU7-F48 EU7-F49 EU7-F50 ' +
  'EU7-F51 EU7-F52 EU7-F53 EU7-F54 EU7-F55 EU7-F56 EU7-F57 EU7-F58 EU7-F59 EU7-F60 EU7-F61 EU7-F62 ' +
  'EU7-F63 EU7-F64 EU7-F65 EU7-F66 EU7-F67 EU7-F68 EU7-F69 EU7-F70 EU7-F71 EU7-F72 EU7-F73 EU7-F74 ' +
  'EU7-F75 EU7-F76 EU7-F77 EU7-F79 BRISNIK-HR-F2 STOPP-M1 EU7-F14 PINCER-10 PROMPT-CN-4 STOPP-C13 ' +
  'STOPP-C1 PROMPT-RS-3 BRISNIK-HR-A3 EU7-F80 EU7-F81 EU7-F82 PROMPT-CN-1 PROMPT-CN-2 PROMPT-CN-3 ' +
  'PROMPT-CN-5 PROMPT-CN-6 PROMPT-CV-1 PROMPT-CV-2 PROMPT-CV-3 PROMPT-CV-4 PROMPT-DU-1 PROMPT-EN-1 ' +
  'PROMPT-GI-1 PROMPT-GI-2 PINCER-1 PROMPT-GI-3 PROMPT-IN-1 PROMPT-MS-1 PROMPT-MS-2 PROMPT-RS-1 ' +
  'PROMPT-RS-2 PROMPT-RS-4 PINCER-2 PINCER-3 PINCER-4 PINCER-5A PINCER-5B PINCER-6 PINCER-7 PINCER-8 ' +
  'OPTIMISE-T2-02 OPTIMISE-T2-03 OPTIMISE-T2-04 OPTIMISE-T2-06 OPTIMISE-T2-07 OPTIMISE-T2-08 OPTIMISE-T2-12 ' +
  'OPTIMISE-T2-19 OPTIMISE-T2-20 OPTIMISE-T2-22 OPTIMISE-T2-24 OPTIMISE-T2-25 OPTIMISE-T2-27 OPTIMISE-T2-29 ' +
  'OPTIMISE-T2-30 OPTIMISE-T2-32 OPTIMISE-T2-33 OPTIMISE-T2-34 OPTIMISE-T2-35 OPTIMISE-T2-37 OPTIMISE-T2-42 ' +
  'OPTIMISE-T2-43 OPTIMISE-T2-49 OPTIMISE-T3-01 OPTIMISE-T3-02 OPTIMISE-T3-04 BANSAL-S01 BANSAL-S02 ' +
  'BANSAL-S04 BANSAL-S05 OPTIMISE-T3-06 OPTIMISE-T3-07 BANSAL-S08 BANSAL-S10 BANSAL-S13 BANSAL-S14 BANSAL-S15 ' +
  'BANSAL-S16 BANSAL-S17 BANSAL-S18 BANSAL-S19 BANSAL-S20 BRISNIK-HR-A1 BRISNIK-HR-A2 BRISNIK-HR-A4 ' +
  'BRISNIK-HR-A5 BRISNIK-HR-A6 BRISNIK-HR-A7 BRISNIK-HR-A8 BRISNIK-HR-A9 BRISNIK-HR-B1 BRISNIK-HR-B2 ' +
  'BRISNIK-HR-B3 BRISNIK-HR-B4 BRISNIK-HR-C1 BRISNIK-HR-C2 BRISNIK-HR-C3 BRISNIK-HR-C4 BRISNIK-HR-D1 ' +
  'BRISNIK-HR-D2 BRISNIK-HR-E1 BRISNIK-HR-E2 BRISNIK-HR-F1 BRISNIK-HR-F3 BRISNIK-HR-G1 BRISNIK-HR-G2 ' +
  'BRISNIK-HR-H1 BRISNIK-HR-H2 BRISNIK-HR-I1 BRISNIK-HR-I2 BRISNIK-HR-J1 BRISNIK-HR-J2 BRISNIK-HR-K1 ' +
  'BRISNIK-HR-L1 BRISNIK-HR-M1 BRISNIK-HR-N1 BRISNIK-OP-ANXI1 BRISNIK-OP-ANXI2 BRISNIK-OP-ANXI3 ' +
  'BRISNIK-OP-ANXI4 BRISNIK-OP-DEPR1 BRISNIK-OP-DEPR2 BRISNIK-OP-DEPR3 BRISNIK-OP-DEPR4 BRISNIK-OP-DEPR5 ' +
  'BRISNIK-OP-DEPR6 BRISNIK-OP-DEPR7 BRISNIK-OP-DEPR8 BRISNIK-OP-DEPR9 BRISNIK-OP-INSO1 BRISNIK-OP-INSO2 ' +
  'BRISNIK-OP-INSO3 BRISNIK-OP-INSO4 BRISNIK-OP-MISC1 BRISNIK-OP-MISC2 BRISNIK-OP-MISC3 BRISNIK-OP-PAIN1 ' +
  'BRISNIK-OP-PAIN2 BRISNIK-OP-PAIN3 BRISNIK-OP-PAIN4 BRISNIK-OP-PAIN5 STOPP-B1 STOPP-B10 STOPP-B12 ' +
  'STOPP-B14 STOPP-B2 STOPP-B15 STOPP-B16 STOPP-B17 STOPP-B18 STOPP-B19 STOPP-B20 STOPP-B21 STOPP-B4 ' +
  'STOPP-B5 STOPP-B6 STOPP-B7 STOPP-B8 STOPP-B9 STOPP-C11 STOPP-C12 STOPP-C2 STOPP-C3 STOPP-C4 STOPP-C5 ' +
  'STOPP-C6 STOPP-C7 STOPP-C15 STOPP-C16 STOPP-C8 STOPP-C9 STOPP-D1 STOPP-D10 STOPP-D11 STOPP-D12 ' +
  'STOPP-D13 STOPP-D14 OPTIMISE-T3-05 STOPP-D2 STOPP-D15 STOPP-D16 STOPP-D17 STOPP-D19 STOPP-D20 STOPP-D21 ' +
  'STOPP-D3 STOPP-D4 STOPP-D5 STOPP-D6 STOPP-D7 STOPP-D23 STOPP-D24 STOPP-D25 STOPP-D9 STOPP-E1 STOPP-E2 ' +
  'STOPP-E3 STOPP-E4 STOPP-E5 STOPP-E6 STOPP-E10 STOPP-E7 STOPP-E8 STOPP-E9 STOPP-F1 STOPP-F2 STOPP-F3 ' +
  'STOPP-F4 STOPP-F5 STOPP-F6 STOPP-F7 STOPP-F8 STOPP-G1 STOPP-G2 STOPP-G3 STOPP-G4 STOPP-H1 STOPP-H2 ' +
  'STOPP-H3 STOPP-H4 STOPP-H5 STOPP-H6 STOPP-H7 STOPP-H8 STOPP-H9 STOPP-I1 STOPP-I2 STOPP-I3 STOPP-I4 ' +
  'STOPP-I5 STOPP-I6 STOPP-I7 STOPP-I8 STOPP-J1 STOPP-J2 STOPP-J3 STOPP-J4 STOPP-J5 STOPP-J7 STOPP-J8 ' +
  'STOPP-J10 STOPP-J9 STOPP-K1 STOPP-K2 STOPP-K3 STOPP-K4 STOPP-K5 STOPP-K10 STOPP-K12 STOPP-K6 STOPP-K7 ' +
  'STOPP-K8 STOPP-K9 STOPP-L1 STOPP-L3 STOPP-L4 STOPP-L5 BANSAL-S07 START-B1 START-B2 START-B3 START-B4 ' +
  'START-B5 START-B10 START-B11 STOPP-L6 START-B6 START-B7 START-B8 START-B9 START-C1 START-C2 START-D1 ' +
  'START-D2 START-D3 START-D4 START-D5 START-D6 START-D7 START-E1 START-E2 START-E3 START-E4 START-F1 ' +
  'START-F2 START-F3 START-F4 START-F5 START-F7 BRISNIK-HR-D3 START-G1 START-G2 START-G3 START-H1 START-H2 ' +
  'START-H3 START-H4 START-H5 START-H6 START-H8 START-H9 START-I1 START-I2 START-I3 START-I4 START-I5 ' +
  'START-J1 START-K1 START-K2 START-K3 START-L2 START-L3 START-L4 DREISCHULTE-16 DREISCHULTE-17 ' +
  'DREISCHULTE-18 DREISCHULTE-19 DREISCHULTE-20 DREISCHULTE-35 DREISCHULTE-36 DREISCHULTE-37 DREISCHULTE-38 ' +
  'DREISCHULTE-40 DREISCHULTE-44 DREISCHULTE-41 DREISCHULTE-42 DREISCHULTE-43 DREISCHULTE-69 DREISCHULTE-70 ' +
  'DREISCHULTE-72 DREISCHULTE-73 DREISCHULTE-74 DREISCHULTE-75 DREISCHULTE-76 DREISCHULTE-77 SCOTRESP-05 ' +
  'SCOTRESP-06 SCOTRESP-13 POPI-04 POPI-07 POPI-17 POPI-22 POPI-23 POPI-24 POPI-27 POPI-39 POPI-44 POPI-45 ' +
  'POPI-48 POPI-59 POPI-61 POPI-62 POPI-64 POPI-65 POPI-66 POPI-67 VTE-6-1 VTE-6-2 POISONSTD-D2-1 ' +
  'POISONSTD-D2-4 GERARD-11 GERARD-12 GERARD-15 GERARD-30 GERARD-33 GERARD-7 GERARD-24 GERARD-26 GERARD-32 ' +
  'GERARD-37 GERARD-38 GERARD-23 USMEC-D1-BP-B-II USMEC-D1-MIGRAINE-B-II USMEC-D1-POSTPARTUM-A ' +
  'CARETRACK-BRON25 CARETRACK-CROU16 CARETRACK-ECZE07 KHAWAGI-G141 KHAWAGI-G002 KHAWAGI-G003 KHAWAGI-G016 ' +
  'KHAWAGI-G028 KHAWAGI-G031 KHAWAGI-G064 KHAWAGI-G033 KHAWAGI-G043 KHAWAGI-G049 KHAWAGI-G051 KHAWAGI-G083 ' +
  'KHAWAGI-G084 CKD-C03A CKD-C07A CKD-C09D CKD-C10A CKD-C10B CKD-N03A CKD-N04B CKD-N05A CKD-N06A CKD-N06D ' +
  'CKD-N07B START-L1 CDCOPIOID-3 UKKA-NODM-1A UKKA-T2D-1B CKD-B01A CKD-C01A KHAWAGI-G007 KHAWAGI-G010 ' +
  'KHAWAGI-G027 CKD-A02B CKD-H05A CKD-J01X KHAWAGI-G092 KHAWAGI-G101 KHAWAGI-G109 KHAWAGI-G116 KHAWAGI-G117 ' +
  'KHAWAGI-G119 KHAWAGI-G123 KHAWAGI-G124 KHAWAGI-G135 KHAWAGI-G149 KHAWAGI-G151 KHAWAGI-G155 KHAWAGI-G156 ' +
  'KHAWAGI-G170 KHAWAGI-G122 KHAWAGI-G161 KHAWAGI-G162 KHAWAGI-G172 KHAWAGI-G173 KHAWAGI-G047 KHAWAGI-G121 ' +
  'KHAWAGI-G127 CKD-A10B CKD-M01A START-H7 CKD-C09B KHAWAGI-G130 KHAWAGI-G153 GERARD-39 GERARD-40 SCOTRESP-01 ' +
  'SCOTRESP-09 FDADSC-1 FDADSC-2 FDADSC-4 FDADSC-5 FDADSC-8 FDADSC-9 MHRA-13 MHRA-18 MHRA-3 MHRA-4 MHRA-6 ' +
  'MHRA-8-1 MHRA-9 NHSBSA-GIB02 NHSBSA-GIB03 NHSBSA-PAIN01-2 NHSBSA-PAIN03 NHSNPSA-2010-RRR013-1 ' +
  'NHSNPSA-2021-006-1 QLDCOAG-14-1 QLDCOAG-29-3 QLDCOAG-6-1 QLDCOAG-86-1 SCOTNTI-AKI-MET SCOTNTI-BZ-LT8 ' +
  'SCOTNTI-CNS-3 SCOTNTI-GI-NSAID-AP SCOTNTI-RESP-06 SCOTNTI-VAL-F54 SCOTPOLY-CF-1 SCOTPOLY-CT-3 FDADSC-3 ' +
  'FDADSC-7 MHRA-16 NHSBSA-GIB04 NHSBSA-PAIN02 QLDCOAG-29-2 SCOTPOLY-SD-1 SCOTPOLY-SD-2 SCOTPOLY-SD-3 ' +
  'SCOTPOLY-SD-4 SCOTPOLY-SD-5 SCOTPOLY-SD-6 SCOTNTI-OPI-50 SCOTNTI-OPI-90 SCOTNTI-GABA-HD FDADSC-10 ' +
  'NHSNPSA-2016-011-1 MHRA-12'
).trim().split(/\s+/);

/** Labels that do not fold to a single id (M01 pack). */
const LABEL_OVERRIDES = new Map([
  ['UKKA 1(b) with type 2 diabetes', 'UKKA-T2D-1B'],
  ['UKKA 1(a) without diabetes', 'UKKA-NODM-1A'],
  ['START K1', 'START-K1'],
  ['START-K1', 'START-K1']
]);

function parseArgs(argv) {
  const out = {
    port: DEFAULT_PORT,
    expected: DEFAULT_EXPECTED,
    history: null,
    delayMs: 0,
    log: null
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === '--expected' && argv[i + 1]) out.expected = argv[++i];
    else if (a === '--history' && argv[i + 1]) out.history = argv[++i];
    else if (a === '--delay-ms' && argv[i + 1]) out.delayMs = Number(argv[++i]);
    else if (a === '--log' && argv[i + 1]) out.log = argv[++i];
    else if (a === '--criteria-dir' && argv[i + 1]) out.criteriaDir = argv[++i];
  }
  if (out.criteriaDir) console.log(`labels read from ${out.criteriaDir}: ${loadLabels(out.criteriaDir)}`);
  return out;
}

function compactKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function enteredAtTheCounter(text) {
  return /entered at the counter/i.test(text);
}

const TAKEN_BACK_MARK = '(taken back)';

function liveFact(lines, what) {
  const needle = what.trim().toLowerCase();
  return lines.some(line =>
    enteredAtTheCounter(line.text) &&
    !line.text.includes(TAKEN_BACK_MARK) &&
    line.text.toLowerCase().includes(needle.slice(0, Math.min(needle.length, 24)))
  );
}

function factsReady(exp, lines) {
  for (const need of exp.questions ?? []) {
    if (liveFact(lines, need.what)) continue;
    return false;
  }
  return true;
}

function parseHistoryLines(text) {
  const lines = [];
  const re = /^(L\d+)\s*\|\s*(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    lines.push({ id: m[1], text: m[2] });
  }
  return lines;
}

function loadCsvHistory(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const rows = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const out = [];
  let i = 0;
  for (const row of rows.slice(1)) {
    i++;
    const id = `L${String(i).padStart(3, '0')}`;
    out.push({ id, text: row });
  }
  return out;
}

function extractCriterionLabel(messages) {
  const text = messages.map(m => m.content ?? '').join('\n');
  const crit = text.match(/^CRITERION (.+)$/m);
  if (crit) return crit[1].trim();
  const suspected = text.match(/SUSPECTED FINDING FROM THE FIRST STEP\n(\{[\s\S]*?\})\n\n/m);
  if (suspected) {
    try {
      const o = JSON.parse(suspected[1]);
      if (typeof o.criterion === 'string') return o.criterion.trim();
    } catch { /* ignore */ }
  }
  const finding = text.match(/FINDING ACCEPTED BY THE PHARMACIST\n(\{[\s\S]*?\})\n\n/m);
  if (finding) {
    try {
      const o = JSON.parse(finding[1]);
      if (typeof o.criterion_label === 'string') return o.criterion_label.trim();
    } catch { /* ignore */ }
  }
  return null;
}

// Added by the coordinator (20 November 14:55): the exact label of every criterion in a folder, read from the
// criterion files themselves (--criteria-dir <a copy of the repository>\criteria). A label that is a phrase
// ("FDADSC: febuxostat without an allopurinol reason") cannot be folded to an id; the file knows it.
const LABEL_TO_ID = new Map();
function loadLabels(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'criterion.json');
    if (!fs.existsSync(file)) continue;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); if (typeof j.label === 'string' && typeof j.id === 'string') LABEL_TO_ID.set(j.label.trim(), j.id); } catch { /* not a criterion */ }
  }
  return LABEL_TO_ID.size;
}

function resolveCriterionId(label, byCriterion, byTouched) {
  if (!label) return null;
  if (LABEL_TO_ID.has(label)) return LABEL_TO_ID.get(label);
  if (byCriterion.has(label)) return label;
  if (byTouched.has(label)) return label;
  if (LABEL_OVERRIDES.has(label)) return LABEL_OVERRIDES.get(label);
  const k = compactKey(label);
  const hits = ALL_CRITERION_IDS.filter(id => compactKey(id) === k);
  if (hits.length === 1) return hits[0];
  const preferred = hits.find(id => byCriterion.has(id) || byTouched.has(id));
  if (preferred) return preferred;
  return null;
}

function schemaKind(format) {
  if (!format || typeof format !== 'object') return 'unknown';
  const props = format.properties ?? {};
  if ('ok' in props && format.required?.length === 1 && format.required[0] === 'ok') return 'warm';
  if ('rows' in props) return 'transcribe';
  if ('finding_paragraph' in props) return 'letter';
  if ('step4_confirmed' in props) return 'check';
  if ('listed_line_ids' in props) return 'screen-part';
  if ('missing_facts' in props) return 'screen-facts';
  if ('suspected' in props) return 'screen';
  return 'unknown';
}

// Mended by the coordinator (20 November 15:00): the count of prompt tokens must follow the length of the request.
// The application compares the two (pipeline/history.ts promptFits): a fixed 100 made it judge every long request
// as cut off ("This part of the history is too long for the model to read in one go") once the answers had added
// lines to the record, and ten criteria failed their screening in the first rehearsal.
let lastPromptChars = 0;
function ollamaChatReply(model, contentObj) {
  const content = JSON.stringify(contentObj);
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    load_duration: 1_000_000,
    prompt_eval_count: Math.max(100, Math.ceil(lastPromptChars / 3.6)),
    prompt_eval_duration: 2_000_000,
    eval_count: Math.max(20, Math.ceil(content.length / 8)),
    eval_duration: 3_000_000
  };
}

function screenAnswer(ctx, criterionId, format, messages, historyLines) {
  const exp = criterionId !== '?' ? ctx.byCriterion.get(criterionId) : undefined;
  const touched = criterionId !== '?' ? ctx.byTouched.get(criterionId) : undefined;
  const kind = schemaKind(format);
  const part = kind === 'screen-part';
  const withFacts = kind === 'screen-facts';

  if (!exp) {
    const reason = touched?.why ?? 'Clear.';
    return {
      suspected: false,
      reason,
      medicines: [],
      line_ids: [],
      ...(withFacts ? { missing_facts: [] } : {}),
      ...(part ? { listed_line_ids: [] } : {})
    };
  }

  if (exp.kind === 'R') {
    const base = {
      suspected: true,
      reason: exp.why,
      medicines: [],
      line_ids: [...exp.lines]
    };
    if (withFacts) base.missing_facts = [];
    if (part) base.listed_line_ids = [...exp.lines];
    return base;
  }

  const ready = factsReady(exp, historyLines);
  if (ready) {
    const base = {
      suspected: true,
      reason: exp.why,
      medicines: [],
      line_ids: exp.lines.length > 0 ? [...exp.lines] : ['L001']
    };
    if (withFacts) base.missing_facts = [];
    if (part) base.listed_line_ids = exp.lines.length > 0 ? [...exp.lines] : ['L001'];
    return base;
  }

  const missing = (exp.questions ?? [])
    .filter(q => !liveFact(historyLines, q.what))
    .map(q => q.what);
  const anchor = exp.lines.length > 0 ? [...exp.lines] : ['L001'];
  const base = {
    suspected: true,
    reason: exp.why,
    medicines: [],
    line_ids: anchor
  };
  if (withFacts) base.missing_facts = missing;
  if (part) base.listed_line_ids = anchor;
  return base;
}

function checkAnswer(ctx, criterionId, messages) {
  const exp = criterionId !== '?' ? ctx.byCriterion.get(criterionId) : undefined;
  let lineIds = exp?.lines ?? [];
  const text = messages.map(m => m.content ?? '').join('\n');
  const m = text.match(/SUSPECTED FINDING FROM THE FIRST STEP\n(\{[\s\S]*?\})\n\n/);
  if (m) {
    try {
      const s = JSON.parse(m[1]);
      if (Array.isArray(s.suspected_lines) && s.suspected_lines.length) lineIds = s.suspected_lines;
    } catch { /* ignore */ }
  }
  return {
    step1_what_matches: exp?.why ?? 'Matches the expected pack.',
    step2_line_ids: lineIds,
    step3_what_cannot_be_seen: 'Nothing further for this test.',
    step4_confirmed: true
  };
}

function lineTextById(historyLines, id) {
  return historyLines.find(l => l.id === id)?.text ?? id;
}

function letterAnswer(ctx, criterionId, messages, historyLines) {
  const exp = criterionId !== '?' ? ctx.byCriterion.get(criterionId) : undefined;
  const cited = (exp?.lines ?? []).map(id => lineTextById(historyLines, id));
  const bodyHint = cited.join(' ');
  const subject = exp
    ? `Request for review: ${exp.title}`
    : 'Request for medicines review';
  const possible = exp && (exp.kind === 'Q' || exp.kind === 'P') && (exp.questions?.length ?? 0) > 0;
  const finding = exp?.why ?? 'Please review this finding.';
  const evidence = cited.length
    ? `Our dispensing record shows: ${cited.map(t => t.replace(/\s+/g, ' ').trim().slice(0, 120)).join('; ')}.`
    : bodyHint
      ? `Our dispensing record includes relevant supplies.`
      : 'Relevant supplies are listed on the printout.';
  const request = possible
    ? 'Could you confirm the fact named above and review these medicines if it applies? We are happy to help.'
    : 'Could you please review this patient when you have a moment? We are happy to help.';
  const subjectFinal = possible && !subject.toLowerCase().startsWith('possible finding')
    ? `Possible finding: ${exp.title}`
    : subject;
  return {
    subject: subjectFinal,
    finding_paragraph: finding,
    evidence_paragraph: evidence,
    request_paragraph: request
  };
}

function buildChatAnswer(body, ctx) {
  const { model, messages = [], format } = body;
  lastPromptChars = messages.reduce((sum, m) => sum + String(m.content ?? '').length, 0);
  const histFromMsg = parseHistoryLines(messages.map(m => m.content ?? '').join('\n'));
  const historyLines = histFromMsg.length > 0 ? histFromMsg : ctx.historyLines;

  const sk = schemaKind(format);
  if (sk === 'warm') {
    return { payload: ollamaChatReply(model, { ok: true }), kind: 'warm', criterionId: '-', word: 'warm' };
  }
  if (sk === 'transcribe') {
    const emptyPatient = { date_of_birth: '', age: '', sex: '' };
    return {
      payload: ollamaChatReply(model, { rows: [], patient: emptyPatient }),
      kind: 'transcribe',
      criterionId: '-',
      word: 'transcribe'
    };
  }

  const label = extractCriterionLabel(messages);
  const criterionId = resolveCriterionId(label, ctx.byCriterion, ctx.byTouched) ?? '?';

  if (sk === 'letter') {
    const paragraphs = letterAnswer(ctx, criterionId, messages, historyLines);
    return { payload: ollamaChatReply(model, paragraphs), kind: 'letter', criterionId, word: 'letter' };
  }
  if (sk === 'check') {
    const ans = checkAnswer(ctx, criterionId, messages);
    return { payload: ollamaChatReply(model, ans), kind: 'check', criterionId, word: 'confirm' };
  }
  if (sk === 'screen' || sk === 'screen-facts' || sk === 'screen-part') {
    const ans = screenAnswer(ctx, criterionId, format, messages, historyLines);
    const word = ans.suspected ? 'suspected' : 'clear';
    return { payload: ollamaChatReply(model, ans), kind: 'screen', criterionId, word };
  }

  return { payload: ollamaChatReply(model, { ok: true }), kind: 'other', criterionId, word: 'other' };
}

function appendLog(logPath, entry) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const expectedRaw = fs.readFileSync(opts.expected, 'utf8');
  const expected = JSON.parse(expectedRaw);
  const byCriterion = new Map((expected.expected_findings ?? []).map(f => [f.criterion, f]));
  const byTouched = new Map((expected.touched_no_finding ?? []).map(t => [t.criterion, t]));
  const historyLines = opts.history ? loadCsvHistory(opts.history) : [];
  const ctx = { byCriterion, byTouched, historyLines, expected, opts };

  const modelNames = ['lantern-screen', 'lantern-check', 'lantern-letter'];
  const servePaths = ['GET /api/version', 'GET /api/tags', 'POST /api/chat'];
  const findingCount = (expected.expected_findings ?? []).length;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const { pathname } = url;
    const delay = () => (opts.delayMs > 0
      ? new Promise(r => setTimeout(r, opts.delayMs))
      : Promise.resolve());

    try {
      if (req.method === 'GET' && pathname === '/api/version') {
        await delay();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: 'standin-0.1.0' }));
        return;
      }
      if (req.method === 'GET' && pathname === '/api/tags') {
        await delay();
        const models = modelNames.map(name => ({ name, model: name, size: 1, modified_at: '' }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models }));
        return;
      }
      if (req.method === 'POST' && pathname === '/api/chat') {
        const raw = await readBody(req);
        let body = {};
        try { body = JSON.parse(raw); } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }
        await delay();
        const { payload, kind, criterionId, word } = buildChatAnswer(body, ctx);
        appendLog(opts.log, {
          time: new Date().toISOString(),
          path: '/api/chat',
          model: body.model,
          criterion: criterionId,
          kind,
          answer: word
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      console.log(`standin-models: unimplemented ${req.method} ${pathname}`);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });

  const host = '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, resolve);
  });

  console.log(
    `http://${host}:${opts.port} | ${servePaths.join(' ')} | expected findings ${findingCount}`
  );

  const stop = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});