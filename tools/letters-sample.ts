// Asks the letter model for one letter per active criterion. No screen call and no check call.
// For each criterion it takes the first history in cases/expected.json where that criterion is
// planted, and builds the accepted finding from the lines the answer sheet names.
//
// node tools/letters-sample.ts [--only <criterion ID>]
// Writes each letter to data/letters/<criterion ID>.txt and prints one summary line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { draftLetter, loadConfig, parseCsv } from '../pipeline/index.ts';
import { loadActiveList, loadCriteriaFromReport } from '../pipeline/criteria.ts';
import type { Criterion, ExpectedCase, ExpectedFinding, ExpectedSheet, Finding, LanternConfig } from '../shared/types.ts';

export function firstPlantedCase(sheet: ExpectedSheet, criterionId: string): ExpectedCase | undefined {
  return sheet.cases.find(row => row.findings.some(f => f.criterion === criterionId && f.must_cite.some(group => group.length > 0)));
}

/** Every line id the answer sheet names for this finding, in the order of the groups, with no id twice. */
export function citedIds(finding: ExpectedFinding): string[] {
  const ids: string[] = [];
  for (const group of finding.must_cite) {
    for (const raw of group) {
      const id = raw.trim().toUpperCase();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** An accepted finding built from the lines the answer sheet names. No model has been called. */
export function acceptedFinding(criterion: Criterion, lineIds: string[], pharmacist: string, at: string): Finding {
  return {
    id: 'F0001',
    caseId: 'sample',
    criterionId: criterion.id,
    state: 'accepted',
    possible: false,
    seenByPharmacist: true,
    screen: {
      lineIds,
      medicines: [],
      reason: 'The answer sheet names these lines.',
      linesVerified: lineIds.length > 0,
      missingFacts: [],
      model: 'lantern-screen',
      at,
      seconds: 0
    },
    check: {
      confirmed: true,
      lineIds,
      whatMatches: 'Accepted for this sample letter.',
      whatCannotBeSeen: criterion.cannot_be_seen,
      completed: true,
      model: 'lantern-check',
      at,
      seconds: 0
    },
    decision: { action: 'accept', by: pharmacist, at }
  };
}

function readSheet(file: string): ExpectedSheet {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text) as ExpectedSheet;
}

export async function sampleOne(
  repo: string, cfg: LanternConfig, criterion: Criterion, sheet: ExpectedSheet, outDir: string
): Promise<string> {
  const row = firstPlantedCase(sheet, criterion.id);
  if (!row) return `${criterion.id} origin=none notes=No planted history in cases/expected.json.`;
  const planted = row.findings.find(f => f.criterion === criterion.id);
  const lineIds = planted ? citedIds(planted) : [];
  if (lineIds.length === 0) return `${criterion.id} origin=none notes=The answer sheet names no lines.`;
  const csvPath = path.join(repo, 'cases', row.file);
  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (parsed.problems.length > 0) {
    return `${criterion.id} origin=none notes=Cannot assess: ${parsed.problems.join(' ')}`;
  }
  const at = new Date().toISOString();
  const finding = acceptedFinding(criterion, lineIds, cfg.pharmacy.pharmacist, at);
  const draft = await draftLetter(cfg, parsed.patient, parsed.lines, criterion, finding);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${criterion.id}.txt`), draft.body, 'utf8');
  const notes = draft.checkNotes.length === 0 ? 'none' : draft.checkNotes.join(' | ');
  return `${criterion.id} origin=${draft.origin} notes=${notes}`;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export async function main(argv: string[], repo = repoRoot()): Promise<void> {
  let only: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only') {
      only = argv[++i];
      if (!only) throw new Error('Say the criterion id after --only.');
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else throw new Error(`Unexpected argument ${arg}. Usage: node tools/letters-sample.ts [--only <criterion ID>]`);
  }
  const list = await loadActiveList(repo);
  const ids = only ? [only] : list.active;
  const loaded = await loadCriteriaFromReport(path.join(repo, 'criteria'), ids);
  const byId = new Map(loaded.criteria.map(c => [c.id, c]));
  const cfg = loadConfig(repo);
  const sheet = readSheet(path.join(repo, 'cases', 'expected.json'));
  const outDir = path.join(repo, 'data', 'letters');
  for (const id of ids) {
    const criterion = byId.get(id);
    if (!criterion) {
      console.log(`${id} origin=none notes=The criterion file could not be read.`);
      continue;
    }
    console.log(await sampleOne(repo, cfg, criterion, sheet, outDir));
  }
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
