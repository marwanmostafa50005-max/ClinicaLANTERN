// A fake pipeline and made-up folders for the unit tests of quick runs, wave runs and the adoption
// helper. No model, no server. Fictional data only: every name here is invented.
//
// Two kinds of history file are read by the fake CSV reader:
//   the short kind: "patient,<ref>" on the first line, then one line of text for each row;
//   the real kind:  the 12 or the 15 columns of docs/SPEC.md sections 6 and 6a.
// Marks inside a line tell the fake models what to answer. In a real CSV they sit in the
// "directions" column of a supply and in the "detail" column of a fact row.
//   {screen:ID}        Model 1 suspects criterion ID and cites this line
//   {missing:ID=Fact}  Model 1 says the record does not show this fact (a possible finding)
//   {screen-fail:ID}   the screen call fails twice
//   {check-no:ID}      Model 2 does not confirm          {check-fail:ID}  the check call fails twice
//   {check-cite:ID}    Model 2 cites this line too
//   {letter-empty:ID}  Model 3 gives no letter text      {letter-template:ID}  the letter is the template

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Criterion, ExpectedCase, Finding, HistoryLine, LanternConfig } from '../shared/types.ts';
import type { EvalResults, Pipeline } from './types.ts';
import { main } from './run.ts';
import type { StopSwitch } from './run.ts';
import { AT, letterBody, makeCriterion } from './testkit.ts';

export const FAKE_CONFIG: LanternConfig = {
  ollamaBase: 'http://127.0.0.1:27435',
  port: 8787,
  models: { screen: 'fake-screen', check: 'fake-check', letter: 'fake-letter' },
  think: { screen: false, check: false, letter: false },
  numCtx: 16384,
  keepAlive: '20m',
  maxLinesPerCall: 150,
  overlapLines: 30,
  overdueDays: 7,
  pharmacy: {
    name: 'Example Community Pharmacy (fictional)', address: '1 Example Street', phone: '(00) 0000 0000',
    pharmacist: 'Marwan Morsy', pharmacistTitle: 'Pharmacy Manager', registration: 'PHA0002761764'
  },
  modelNames: { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' },
  modelsBehind: { screen: 'Gemma 4 31B', check: 'Qwen 3.8 27B', letter: 'Gemma 4 26B' },
  doctor: { name: 'Dr F. Example (fictional)', practice: 'Example Family Practice' },
};

export const COLUMNS_12 = 'patient_ref,patient_age,patient_sex,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber';
export const COLUMNS_15 = 'patient_ref,patient_age,patient_sex,record_type,dispense_date,medicine,brand,strength,form,quantity,repeats_left,directions,prescriber,detail,value';

// One supply row of a real CSV with the 15 columns. marks go into the directions column.
export function supplyRow(ref: string, date: string, medicine: string, brand: string, marks = ''): string {
  return `${ref},72,F,,${date},${medicine},${brand},10 mg,tablet,30,2,Take ONE tablet daily${marks === '' ? '' : ` ${marks}`},Dr A. Example,,`;
}

// One fact row of a real CSV with the 15 columns. marks go into the detail column.
export function factRow(ref: string, date: string, type: 'condition' | 'result' | 'observation', detail: string, value = '', marks = ''): string {
  return `${ref},72,F,${type},${date},,,,,,,,,${detail}${marks === '' ? '' : ` ${marks}`},${value}`;
}

export function csv15(...rows: string[]): string {
  return `${[COLUMNS_15, ...rows].join('\n')}\n`;
}

// The short kind of history file.
export function shortHistory(ref: string, ...lines: string[]): string {
  return `${[`patient,${ref}`, ...lines].join('\n')}\n`;
}

export const plainLine = (n: number): string => `2026-01-${String(n).padStart(2, '0')} | Otherol 5 mg tablet | qty 30`;

function lineNumber(n: number): string {
  return `L${String(n).padStart(3, '0')}`;
}

// Reads the short kind and, in a simple way, the real kind. Line IDs run over all rows, facts included.
export function fakeParseCsv(csvText: string): ReturnType<Pipeline['parseCsv']> {
  const rows = (csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText).split(/\r?\n/).filter((r) => r.trim() !== '');
  const first = rows[0] ?? '';
  const problems: string[] = [];
  if (first.startsWith('patient,')) {
    const lines = rows.slice(1).map((text, i) => ({ id: lineNumber(i + 1), text }));
    if (lines.length === 0) problems.push('The file has no supply rows.');
    if (csvText.includes('BROKEN')) problems.push('No row has a date that can be read.');
    return { patient: { label: `Fictional patient ${first.slice('patient,'.length).trim()}` }, lines, problems };
  }
  const header = first.split(',').map((h) => h.trim().toLowerCase());
  const at = (name: string): number => header.indexOf(name);
  if (at('dispense_date') === -1) return { patient: { label: 'Fictional patient' }, lines: [], problems: ['The file has no "dispense_date" column.'] };
  const lines: HistoryLine[] = [];
  let ref = '';
  rows.slice(1).forEach((row, i) => {
    const cells = row.split(',');
    const get = (name: string): string => (at(name) === -1 ? '' : (cells[at(name)] ?? '').trim());
    ref = ref || get('patient_ref');
    const type = get('record_type').toLowerCase();
    const date = get('dispense_date');
    if (type === 'condition' || type === 'result' || type === 'observation') {
      lines.push({ id: lineNumber(i + 1), text: `${date} | ${type.toUpperCase()} | ${[get('detail'), get('value')].filter(Boolean).join(' ')}` });
    } else {
      if (!get('medicine') && !get('brand')) problems.push(`Row ${i + 2} has no medicine name.`);
      lines.push({ id: lineNumber(i + 1), text: `${date} | ${get('brand')} (${get('medicine')}) ${get('strength')} ${get('form')} | qty ${get('quantity')} | ${get('directions')}` });
    }
  });
  if (lines.length === 0) problems.push('The file has no supply rows.');
  return { patient: { label: `Fictional patient ${ref}`.trim() }, lines, problems };
}

export interface Fake {
  pipeline: Pipeline;
  calls: string[];              // "screen:<patient ref>:<criterion>", in the order the calls were made
  findings: Finding[];          // what draftLetter was given
  loaded: string[];             // "<folder name>/<ID>" for each criterion asked for through loadCriteriaFrom
  afterCall: (() => void) | null;
}

// criteria: what loadCriteria gives (the criteria in use in the repository).
export function fakePipeline(criteria: Criterion[] = []): Fake {
  const fake: Fake = { pipeline: undefined as unknown as Pipeline, calls: [], findings: [], loaded: [], afterCall: null };
  const marked = (lines: HistoryLine[], mark: string, id: string): string[] =>
    lines.filter((l) => l.text.includes(`{${mark}:${id}}`)).map((l) => l.id);
  const has = (lines: HistoryLine[], mark: string, id: string): boolean => marked(lines, mark, id).length > 0;
  const valuesOf = (lines: HistoryLine[], mark: string, id: string): string[] => {
    const out: string[] = [];
    const pattern = new RegExp(`\\{${mark}:${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^}]*)\\}`, 'g');
    for (const line of lines) for (const found of line.text.matchAll(pattern)) out.push(found[1].trim());
    return out;
  };
  const ref = (label: string): string => label.replace('Fictional patient ', '');
  const note = (stage: string, label: string, id: string): void => {
    fake.calls.push(`${stage}:${ref(label)}:${id}`);
    fake.afterCall?.();
  };

  fake.pipeline = {
    loadConfig: () => FAKE_CONFIG,
    loadCriteria: async () => criteria,
    // As the real loader: <folder>/<ID>/criterion.json, and it throws when the file does not load.
    async loadCriteriaFrom(folder, ids) {
      const out: Criterion[] = [];
      for (const id of ids) {
        fake.loaded.push(`${path.basename(path.dirname(folder))}/${id}`);
        const file = path.join(folder, id, 'criterion.json');
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        } catch (err) {
          throw new Error(`Criterion ${id} could not be read (${file}): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (typeof raw.label !== 'string' || raw.label.trim() === '') throw new Error(`Criterion ${id}: "label" is missing.`);
        out.push({ ...(raw as unknown as Criterion), id });
      }
      return out;
    },
    parseCsv: fakeParseCsv,
    async screenCriterion(_cfg, patient, lines, criterion) {
      note('screen', patient.label, criterion.id);
      if (has(lines, 'screen-fail', criterion.id)) return { ok: false, error: 'Tried twice. The local model server did not answer.' };
      const lineIds = marked(lines, 'screen', criterion.id);
      const missingFacts = valuesOf(lines, 'missing', criterion.id);
      return {
        ok: true,
        suspected: lineIds.length > 0,
        result: {
          lineIds,
          medicines: lineIds.length > 0 ? ['examplex'] : [],
          reason: lineIds.length > 0 ? 'A medicine that counts was found.' : 'Nothing matches.',
          linesVerified: lineIds.length > 0,
          missingFacts: lineIds.length > 0 ? missingFacts : [],
          model: 'fake-screen',
          at: AT,
          seconds: 0.01,
        },
      };
    },
    async checkFinding(_cfg, patient, lines, criterion, screen) {
      note('check', patient.label, criterion.id);
      const completed = !has(lines, 'check-fail', criterion.id);
      const confirmed = completed && !has(lines, 'check-no', criterion.id);
      return {
        confirmed,
        lineIds: confirmed ? [...screen.lineIds, ...marked(lines, 'check-cite', criterion.id)] : [],
        whatMatches: completed ? (confirmed ? 'The lines match.' : 'The lines do not match.') : 'The second check did not finish, so this finding is shown without it. Tried twice.',
        whatCannotBeSeen: 'Why it was prescribed.',
        completed,
        model: 'fake-check',
        at: AT,
        seconds: 0.01,
      };
    },
    async draftLetter(_cfg, patient, lines, criterion, finding) {
      note('letter', patient.label, criterion.id);
      fake.findings.push(finding);
      const cited = finding.check && finding.check.lineIds.length > 0 ? finding.check.lineIds : finding.screen.lineIds;
      const shown = lines.filter((l) => cited.includes(l.id)).map((l) => l.text);
      const template = has(lines, 'letter-template', criterion.id);
      let body = letterBody(criterion, shown);
      // As the app does for a possible finding: the letter says what the record does not show and asks the doctor to confirm it.
      if (finding.possible) body = `The record we hold does not show: ${finding.screen.missingFacts.join(', ')}.\nCould you please confirm whether this applies to the patient?\n\n${body}`;
      if (has(lines, 'letter-empty', criterion.id)) body = '';
      return {
        subject: `${finding.possible ? 'Possible finding, request' : 'Request'} for a medicines review: ${criterion.title}`,
        body,
        origin: template ? 'template' : 'model',
        checkNotes: template ? ['Both drafts failed the checks.'] : [],
        model: 'fake-letter',
        at: AT,
        seconds: 0.01,
      };
    },
    transcribePageImage: async () => ({ ok: false, error: 'The scorer does not read page images.' }),
    checkLetterFacts: () => [],
  };
  return fake;
}

// ---------- made-up folders in the temp folder ----------

const tempDirs: string[] = [];

export function tempDir(prefix = 'lantern-eval-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// A made-up repository: cases/<file> for each history, cases/expected.json, and criteria/active.json when a list is given.
export function makeRepo(files: Record<string, string>, sheet: unknown, list?: { active: string[]; reserves?: string[]; further?: string[] }): string {
  const root = tempDir('lantern-eval-repo-');
  for (const [file, text] of Object.entries(files)) writeFile(path.join(root, 'cases', file), text);
  writeFile(path.join(root, 'cases', 'expected.json'), JSON.stringify(sheet, null, 2));
  if (list) writeFile(path.join(root, 'criteria', 'active.json'), JSON.stringify({ reserves: [], ...list }, null, 2));
  return root;
}

export interface WaveCriterionFiles {
  criterion?: Criterion | string | null;        // an object, raw text for the file, or null for "no criterion.json"
  notDrafted?: string;                          // the text of NOT_DRAFTED.md
  histories?: Record<string, string>;           // file name -> CSV text
  part?: ExpectedCase[] | string | null;        // the answer part, raw text, or null for "no expected.part.json"
}

// A made-up wave folder: <root>/<name>/criteria/<ID>/... and <root>/<name>/cases/<ID>/...
export function makeWave(root: string, name: string, criteria: Record<string, WaveCriterionFiles>): string {
  const wave = path.join(root, name);
  fs.mkdirSync(path.join(wave, 'criteria'), { recursive: true });
  fs.mkdirSync(path.join(wave, 'cases'), { recursive: true });
  for (const [id, files] of Object.entries(criteria)) {
    const folder = path.join(wave, 'criteria', id);
    fs.mkdirSync(folder, { recursive: true });
    if (files.notDrafted !== undefined) writeFile(path.join(folder, 'NOT_DRAFTED.md'), files.notDrafted);
    if (files.criterion !== null && (files.criterion !== undefined || files.notDrafted === undefined)) {
      const criterion = files.criterion ?? makeCriterion(id);
      writeFile(path.join(folder, 'criterion.json'), typeof criterion === 'string' ? criterion : JSON.stringify(criterion, null, 2));
    }
    for (const [file, text] of Object.entries(files.histories ?? {})) writeFile(path.join(wave, 'cases', id, file), text);
    if (files.part !== null && files.part !== undefined) {
      writeFile(path.join(wave, 'cases', id, 'expected.part.json'), typeof files.part === 'string' ? files.part : JSON.stringify(files.part, null, 2));
    }
  }
  return wave;
}

// ---------- a wave folder with real CSV files, for the case check and the adoption helper ----------

// A criterion file as a drafter writes it: one medicine group, and a fact when it needs one.
export function draftedCriterion(id: string, needsFact = false): Criterion {
  return makeCriterion(id, {
    medicine_groups: [{ key: 'A', name: 'Made-up medicines', ingredients: ['examplol'], brands: { examplol: ['Examplex', 'Slowex (examplol, slow release)'] } }],
    rule_for_models: needsFact
      ? 'Suspect a finding when a Group A medicine is supplied and the record shows heart failure. Cite the condition line as well as the supplies.'
      : 'Suspect a finding when a Group A medicine is supplied twice or more.',
    ...(needsFact ? { needs_facts: [{ kind: 'condition' as const, what: 'Heart failure', meets: 'Heart failure is recorded as a condition' }] } : {}),
  });
}

function partEntry(id: string, name: string, kind: ExpectedCase['kind'], mustCite?: string[][]): ExpectedCase {
  return { file: `${id}/${name}`, kind, about: `A made-up history for ${id}.`, findings: mustCite ? [{ criterion: id, must_cite: mustCite }] : [] };
}

// A supplies-only criterion with real CSV files. The marks make the fake models catch both planted
// findings, unless caught is false.
export function draftedSupplies(id: string, caught = true): WaveCriterionFiles {
  const ref = `F-${id}`;
  const mark = caught ? `{screen:${id}}` : '';
  return {
    criterion: draftedCriterion(id),
    histories: {
      'pos-brand.csv': csv15(
        supplyRow(ref, '2026-01-05', 'otherol', 'Othex'),
        supplyRow(ref, '2026-02-05', '', 'Examplex', mark),
        supplyRow(ref, '2026-03-05', '', 'Slowex', mark),
      ),
      'pos-buried.csv': csv15(
        supplyRow(ref, '2026-01-05', 'otherol', 'Othex'),
        supplyRow(ref, '2026-02-05', 'examplol', 'Examplex', mark),
        supplyRow(ref, '2026-03-05', 'otherol', 'Othex'),
        supplyRow(ref, '2026-04-05', 'examplol', 'Examplex', mark),
      ),
      'near-miss.csv': csv15(supplyRow(ref, '2026-01-05', 'otherol', 'Othex'), supplyRow(ref, '2026-02-05', 'examplol', 'Examplex')),
    },
    part: [
      partEntry(id, 'pos-brand.csv', 'positive', [['L002', 'L003']]),
      partEntry(id, 'pos-buried.csv', 'positive', [['L002', 'L004']]),
      partEntry(id, 'near-miss.csv', 'near_miss'),
    ],
  };
}

// A criterion that needs a fact, with real CSV files: the record holds the fact, the record holds
// no line about it, and a near miss where the record holds another condition.
export function draftedFact(id: string): WaveCriterionFiles {
  const ref = `F-${id}`;
  const mark = `{screen:${id}}`;
  return {
    criterion: draftedCriterion(id, true),
    histories: {
      'pos-fact.csv': csv15(
        factRow(ref, '2025-12-01', 'condition', 'Heart failure', '', mark),
        factRow(ref, '2025-12-02', 'result', 'eGFR', '64 mL/min/1.73 m2'),
        supplyRow(ref, '2026-01-05', 'examplol', 'Examplex', mark),
        supplyRow(ref, '2026-02-05', 'examplol', 'Examplex', mark),
      ),
      'pos-nofact.csv': csv15(
        supplyRow(ref, '2026-01-05', 'examplol', 'Examplex', `${mark} {missing:${id}=Heart failure}`),
        supplyRow(ref, '2026-02-05', 'examplol', 'Examplex', mark),
      ),
      'near-miss.csv': csv15(factRow(ref, '2025-12-01', 'condition', 'Asthma'), supplyRow(ref, '2026-01-05', 'examplol', 'Examplex')),
    },
    part: [
      partEntry(id, 'pos-fact.csv', 'positive', [['L003', 'L004'], ['L001']]),
      partEntry(id, 'pos-nofact.csv', 'positive', [['L001', 'L002']]),
      partEntry(id, 'near-miss.csv', 'near_miss'),
    ],
  };
}

// ---------- one run ----------

export interface Ran {
  code: number;
  log: string[];
  out: string;
  fake: Fake;
  results: () => EvalResults;
  table: () => string;
}

export async function runScorer(
  root: string,
  argv: string[],
  criteria: Criterion[] = [],
  setup?: (fake: Fake, stop: StopSwitch) => void,
): Promise<Ran> {
  const fake = fakePipeline(criteria);
  const stop: StopSwitch = { requested: false };
  setup?.(fake, stop);
  const log: string[] = [];
  const out = path.join(tempDir('lantern-eval-out-'), 'out');
  let ms = 0;
  const code = await main(fake.pipeline, ['--out', out, ...argv], {
    repoRoot: root,
    cwd: root,
    log: (line) => log.push(line),
    now: () => new Date(2026, 10, 18, 14, 5, 10),
    timer: () => (ms += 500),   // a made-up timer: every call takes half a second
    stop,
  });
  return {
    code,
    log,
    out,
    fake,
    results: () => JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) as EvalResults,
    table: () => fs.readFileSync(path.join(out, 'table.md'), 'utf8'),
  };
}

export function verdicts(results: EvalResults): Record<string, string> {
  return Object.fromEntries(results.score.criteria.map((s) => [s.criterionId, s.verdict]));
}
