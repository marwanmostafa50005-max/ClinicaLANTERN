// The scorer. It runs the fictional test histories through the real pipeline and writes the results.
//
//   npm run eval -- [options]      or      node eval/run.ts [options]
//
// It works in three stages so each model is loaded once: every screen call for every history
// first (Model 1), then every double-check (Model 2), then the letters (Model 3).
// A full run that has criteria in use after the ten does this twice: the ten, in full, are
// written at once, then the further criteria in quick mode, 20 at a time.
// A failed call never stops the run. It is recorded, and it is never counted as a clean result.
//
// Three kinds of run (docs/SCORING.md):
//   full   every criterion on every history;
//   quick  --quick: a history against its own criterion only, plus a sample to estimate false flags;
//   wave   --wave <folder>: the criteria of a wave folder, scored in place, own criterion only.
//
// main() takes the pipeline as a parameter, so the unit tests can pass a fake one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Criterion, ExpectedCase, ExpectedSheet, Finding, LanternConfig } from '../shared/types.ts';
import type {
  CaseRun,
  CheckCall,
  EvalResults,
  LetterCall,
  PairRecord,
  Pipeline,
  QuickInfo,
  RunMode,
  RunOptions,
  RunScore,
  ScreenCall,
  WaveNote,
} from './types.ts';
import {
  caseSheetWarnings,
  checkCallFrom,
  checkSheet,
  countPlanted,
  criterionText,
  factsText,
  judgePlanted,
  letterCallFrom,
  linesCited,
  missingFactsOf,
  normaliseLineId,
  oneLine,
  passingLists,
  scoreRun,
  screenCallFrom,
  stringList,
} from './score.ts';
import type { NotScored, PlantedGroup } from './score.ts';
import { duration, lettersCell, percentText, resultLabel, resultSentence, stampOf, waveSummaries, waveSummaryLine, writeRaw, writeReport } from './report.ts';
import type { RawStage } from './report.ts';
import { errorText, folderOf, isInside, loadOneCriterionFrom, readCase, withoutFolder, withoutMark } from './files.ts';
import { inCallOrder, planFullRun, planOwnCriterion, planSample } from './plan.ts';
import type { OwnPlan, PlanCase, PlannedPair } from './plan.ts';
import { findWaveFolders, readWaveFolder } from './wave.ts';
import type { WaveItem } from './wave.ts';

export { folderOf, readCase };

export const USAGE = [
  'ClinicaLANTERN scorer.',
  'It runs the fictional test histories through the three local models and writes a results table.',
  '',
  'Use:  npm run eval -- [options]',
  '  or  node eval/run.ts [options]',
  '',
  'Options:',
  '  --only <criterion>   Run one criterion only, for example STOPP-C10. Use commas for more than one.',
  '  --cases <folder>     Run only the histories in a folder of the cases folder, for example STOPP-C10 or _clean.',
  '                       Part of a name works too. Use commas for more than one.',
  '  --limit <n>          Run only the first n histories.',
  '  --no-letters         Skip the letters (Model 3).',
  '  --sheet <path>       Use another answer sheet. The default is cases/expected.json.',
  '  --out <folder>       Write the results into this new folder. The default is eval/results/<date and time>.',
  '                       Earlier results are never written over.',
  '  --check              Read the answer sheet and the histories, list what needs a look, and stop.',
  '                       No model is called and nothing is written.',
  '  --quick              A quick run. Each history is screened against its own criterion only: the criteria',
  '                       its answer entry expects, or for a near miss the criterion its folder is named after.',
  '                       Clean histories are screened against the first ten. One history in ten, chosen by a',
  '                       fixed seed, is also screened against up to thirty other criteria, to estimate false flags.',
  '                       That sample costs about three more screen calls for each history in the run.',
  '  --no-sample          With --quick: leave the false-flag sample out. False flags are then counted only on the',
  '                       histories written for each criterion and on the clean histories.',
  '  --wave <folder>      Score a wave folder in place, before its criteria are in the repository. Each history',
  '                       is screened against its own criterion only. Give the option again, or use commas, to',
  '                       score several wave folders in one run. A folder that holds wave folders stands for all of them.',
  '                       Add --quick to take the false-flag sample too.',
  '  --help               Show this text.',
  '',
  'To test one criterion on its own histories only: --only STOPP-C10 --cases STOPP-C10',
  '',
  'The Ollama server must be running. One call runs at a time.',
  'A part run, or a run without letters, is for development. It is not a sign-off run.',
  'The run ends with code 0 when nothing failed, 1 when a criterion failed, 2 when it could not run or stopped early.',
  'It also ends with code 1 when the files of a criterion could not be used.',
  'With --check it ends with code 0 when nothing needs a look, 1 when something does.',
  'More: docs/SCORING.md',
].join('\n');

// ---------- options ----------

export interface ParsedArgs {
  options: RunOptions;
  help: boolean;
  errors: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const options: RunOptions = { only: [], cases: [], limit: null, letters: true, sheet: null, out: null, check: false };
  const errors: string[] = [];
  let help = false;
  const list = (value: string): string[] =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let name = arg;
    let inline: string | null = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      name = arg.slice(0, eq);
      inline = arg.slice(eq + 1);
    }
    const value = (): string | null => {
      if (inline !== null) return inline.trim() === '' ? null : inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i++;
      return next;
    };

    switch (name) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--no-letters':
        if (inline !== null) errors.push('Option --no-letters takes no value.');
        else options.letters = false;
        break;
      case '--check':
        if (inline !== null) errors.push('Option --check takes no value.');
        else options.check = true;
        break;
      case '--quick':
        if (inline !== null) errors.push('Option --quick takes no value.');
        else options.quick = true;
        break;
      case '--no-sample':
        if (inline !== null) errors.push('Option --no-sample takes no value.');
        else options.noSample = true;
        break;
      case '--wave': {
        const v = value();
        if (v === null || list(v).length === 0) errors.push('Option --wave needs a wave folder, for example --wave C:\\waves\\W101.');
        else options.waves = [...(options.waves ?? []), ...list(v)];
        break;
      }
      case '--only': {
        const v = value();
        if (v === null || list(v).length === 0) errors.push('Option --only needs a criterion ID, for example --only STOPP-C10.');
        else options.only.push(...list(v));
        break;
      }
      case '--cases': {
        const v = value();
        if (v === null || list(v).length === 0) errors.push('Option --cases needs a folder name, for example --cases STOPP-C10.');
        else options.cases.push(...list(v));
        break;
      }
      case '--limit': {
        const v = value();
        const n = v === null ? Number.NaN : Number(v);
        if (!Number.isInteger(n) || n < 1) errors.push('Option --limit needs a whole number, 1 or more.');
        else options.limit = n;
        break;
      }
      case '--sheet': {
        const v = value();
        if (v === null) errors.push('Option --sheet needs the path of an answer sheet.');
        else options.sheet = v;
        break;
      }
      case '--out': {
        const v = value();
        if (v === null) errors.push('Option --out needs a folder.');
        else options.out = v;
        break;
      }
      default:
        errors.push(`Unknown option: ${arg}`);
    }
  }
  if (options.waves !== undefined && options.sheet !== null) {
    errors.push('Option --sheet cannot be used with --wave. A wave folder brings its own answer parts.');
  }
  if (options.noSample && !options.quick) errors.push('Option --no-sample goes with --quick. No other run takes the false-flag sample.');
  return { options, help, errors };
}

// ---------- choosing what to run ----------

function plainId(text: string): string {
  return text.trim().toUpperCase().replace(/[\s_]+/g, '-');
}

// --only: a criterion is named by its ID or its label. Upper and lower case do not matter.
export function selectCriteria(active: Criterion[], only: string[]): { selected: Criterion[]; unknown: string[] } {
  if (only.length === 0) return { selected: active, unknown: [] };
  const wanted = new Set<string>();
  const unknown: string[] = [];
  for (const name of only) {
    const hit = active.find((c) => plainId(c.id) === plainId(name) || plainId(c.label ?? '') === plainId(name));
    if (hit) wanted.add(hit.id);
    else unknown.push(name);
  }
  return { selected: active.filter((c) => wanted.has(c.id)), unknown };
}

// --cases: a filter that is the full name of a folder picks that folder only.
// Any other filter picks every folder whose name holds the text. Then --limit keeps the first n.
export function selectCases(cases: ExpectedCase[], filters: string[], limit: number | null): ExpectedCase[] {
  let chosen = cases;
  if (filters.length > 0) {
    const folders = cases.map((c) => folderOf(c.file).toLowerCase());
    const tests = filters.map((f) => {
      const want = f.trim().toLowerCase();
      const exact = folders.includes(want);
      return (folder: string): boolean => (exact ? folder === want : folder.includes(want));
    });
    chosen = cases.filter((_, i) => tests.some((test) => test(folders[i])));
  }
  return limit === null ? chosen : chosen.slice(0, limit);
}

// ---------- getting ready ----------

class CannotRun extends Error {}

// How a file is named in the results: by its path inside the repository. A file from somewhere
// else is named by its file name only, so no folder of this computer ends up in the results.
function shownPath(repoRoot: string, full: string): string {
  return isInside(repoRoot, full)
    ? path.relative(repoRoot, full).split(path.sep).join('/')
    : `${path.basename(full)} (a file outside the repository)`;
}

const USED_BY_THE_SCORER = ['loadConfig', 'loadCriteria', 'parseCsv', 'screenCriterion', 'checkFinding', 'draftLetter'] as const;

export function missingPipelineParts(pipeline: unknown): string[] {
  const record = (typeof pipeline === 'object' && pipeline !== null ? pipeline : {}) as Record<string, unknown>;
  return USED_BY_THE_SCORER.filter((name) => typeof record[name] !== 'function');
}

// The list file of the criteria in use, as far as the scorer needs it: the first ten (active) and
// the criteria in use after them (further). null when the file is not there or cannot be read.
export function readCriteriaList(repoRoot: string): { active: string[]; further: string[] } | null {
  try {
    const raw: unknown = JSON.parse(withoutMark(fs.readFileSync(path.join(repoRoot, 'criteria', 'active.json'), 'utf8')));
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record.active)) return null;
    return { active: stringList(record.active), further: stringList(record.further) };
  } catch {
    return null;
  }
}

interface Plan {
  mode: RunMode;
  cfg: LanternConfig;
  active: Criterion[];          // every criterion that could be in this run
  criteria: Criterion[];        // the criteria in this run
  sheet: ExpectedSheet;
  sheetPath: string;            // as shown in the results
  sheetWarnings: string[];
  expected: ExpectedCase[];     // the histories in this run
  cases: CaseRun[];             // the same histories, as read
  planned: PlannedPair[];       // which criterion is screened on which history, in call order
  quick: QuickInfo | null;      // set in a quick run and a wave run
  waveNames: string[];          // the wave folders, by their own names (a wave run only)
  waveItems: WaveItem[];        // every criterion folder of the wave folders (a wave run only)
  notScored: NotScored[];       // criteria that are not scored: not drafted, or their files could not be used
  furtherFrom?: number;         // index in `planned` where further-criterion pairs start. Set only for a two-phase full run.
  furtherIds: string[];         // further criteria in this run. Empty when the run is not two-phase.
}

function someNames(names: string[], max: number): string {
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

async function prepare(pipeline: Pipeline, options: RunOptions, repoRoot: string, cwd: string): Promise<Plan> {
  let cfg: LanternConfig;
  try {
    cfg = pipeline.loadConfig(repoRoot);
  } catch (err) {
    throw new CannotRun(`The settings could not be read. ${errorText(err)}`);
  }

  const waveRun = options.waves !== undefined && options.waves.length > 0;
  const mode: RunMode = waveRun ? 'wave' : options.quick ? 'quick' : 'full';
  const ownOnly = mode !== 'full';

  let active: Criterion[];
  let firstTen: string[] = [];
  let listedFurther: string[] = [];   // further criteria named in the list whose files loaded. Empty when the list has none.
  let sheet: ExpectedSheet;
  let sheetPath: string;
  const sheetWarnings: string[] = [];
  let waveNames: string[] = [];
  const waveItems: WaveItem[] = [];
  const notScored: NotScored[] = [];                // criteria that cannot be scored: not drafted, or files not usable
  const alreadyRead = new Map<string, CaseRun>();   // a wave run reads its histories while it reads the wave folders

  if (waveRun) {
    // ----- the criteria and the answer parts of the wave folders -----
    if (typeof pipeline.loadCriteriaFrom !== 'function') {
      throw new CannotRun('A wave folder cannot be scored. The pipeline does not have: loadCriteriaFrom.');
    }
    const found = findWaveFolders(options.waves ?? [], cwd);
    if (found.errors.length > 0) throw new CannotRun(found.errors.join('\n'));
    waveNames = found.waves.map((w) => w.name);
    const taken = new Map<string, string>();
    let caseIndex = 0;
    for (const wave of found.waves) {
      const items = await readWaveFolder(pipeline, wave, caseIndex, taken);
      for (const item of items) {
        if (item.status !== 'ready') continue;
        caseIndex += item.cases.length;
        for (const c of item.cases) alreadyRead.set(c.file, c);
      }
      waveItems.push(...items);
    }
    const ready = waveItems.filter((item) => item.status === 'ready' && item.criterion !== null);
    active = ready.map((item) => item.criterion as Criterion);
    sheet = { signed_by_clinical_reviewer: null, cases: ready.flatMap((item) => item.entries) };
    sheetPath = 'the answer parts (expected.part.json) in the wave folders';
    for (const item of ready) sheetWarnings.push(...item.warnings);
    for (const item of waveItems) {
      if (item.status === 'not_drafted') notScored.push({ id: item.id, result: 'NOT_DRAFTED', reason: 'not drafted', wave: item.wave });
      else if (item.status === 'not_usable') notScored.push({ id: item.id, result: 'FILES_NOT_USABLE', reason: `files not usable: ${item.reason}`, wave: item.wave });
    }
  } else {
    // ----- the criteria in use and the answer sheet of the repository -----
    try {
      active = await pipeline.loadCriteria(repoRoot);
    } catch (err) {
      throw new CannotRun(`The criteria could not be read. ${errorText(err)}`);
    }
    if (!Array.isArray(active) || active.length === 0) throw new CannotRun('No active criteria were found.');
    active = [...active];

    // The first ten are always first. The criteria in use after them are in the "further" list.
    // The pipeline's loader leaves out a criterion whose file does not load. Such a criterion is
    // never left out without a word here: it is asked for by name, and when it still does not
    // load it is listed as "files not usable", with the reason.
    const list = readCriteriaList(repoRoot);
    if (list !== null) {
      const byId = new Map(active.map((c) => [c.id, c]));
      const listed = [...new Set([...list.active, ...list.further])];
      for (const id of listed) {
        if (byId.has(id)) continue;
        try {
          const criterion = await loadOneCriterionFrom(pipeline, path.join(repoRoot, 'criteria'), id);
          if (criterion.id === id) byId.set(id, criterion);
          else notScored.push({ id, result: 'FILES_NOT_USABLE', reason: `files not usable: criterion.json gives the ID "${String(criterion.id)}", but its folder is named ${id}`, wave: null });
        } catch (err) {
          const why = withoutFolder(withoutFolder(errorText(err), repoRoot + path.sep, ''), repoRoot, 'the repository folder');
          notScored.push({ id, result: 'FILES_NOT_USABLE', reason: `files not usable: ${why}`, wave: null });
        }
      }
      const inListOrder = listed.map((id) => byId.get(id)).filter((c): c is Criterion => c !== undefined);
      const unlisted = active.filter((c) => !listed.includes(c.id));
      active = [...inListOrder, ...unlisted];
      firstTen = list.active.filter((id) => byId.has(id));
      const tenSet = new Set(firstTen);
      listedFurther = list.further.filter((id) => byId.has(id) && !tenSet.has(id));
    }
    if (firstTen.length === 0) firstTen = active.slice(0, 10).map((c) => c.id);

    const typed = options.sheet ?? 'cases/expected.json';
    let sheetFile = options.sheet === null ? path.join(repoRoot, 'cases', 'expected.json') : path.resolve(cwd, options.sheet);
    if (options.sheet !== null && !fs.existsSync(sheetFile) && !path.isAbsolute(options.sheet)) {
      sheetFile = path.resolve(repoRoot, options.sheet);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(withoutMark(fs.readFileSync(sheetFile, 'utf8')));
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      throw new CannotRun(
        code === 'ENOENT'
          ? `The answer sheet was not found: ${typed}`
          : `The answer sheet could not be read: ${typed}. ${errorText(err)}`,
      );
    }
    const checked = checkSheet(raw);
    if (checked.sheet === null) {
      throw new CannotRun(['The answer sheet has a mistake. Fix it first.', ...checked.fatal.map((f) => `  ${f}`)].join('\n'));
    }
    sheet = checked.sheet;
    sheetPath = shownPath(repoRoot, sheetFile);
    sheetWarnings.push(...checked.warnings);
    // No --sheet: also read the further criteria's sheet. A missing file is not an error.
    // The sheet of the ten is never changed by a further history. A history named in both keeps the ten's row.
    if (options.sheet === null) {
      const furtherPath = path.join(repoRoot, 'cases', 'expected.further.json');
      if (fs.existsSync(furtherPath)) {
        let rawFurther: unknown;
        try {
          rawFurther = JSON.parse(withoutMark(fs.readFileSync(furtherPath, 'utf8')));
        } catch (err) {
          throw new CannotRun(`The answer sheet could not be read: cases/expected.further.json. ${errorText(err)}`);
        }
        const extra = checkSheet(rawFurther);
        if (extra.sheet === null) {
          throw new CannotRun(['The further answer sheet has a mistake. Fix it first.', ...extra.fatal.map((f) => `  ${f}`)].join('\n'));
        }
        const seen = new Set(sheet.cases.map((c) => c.file));
        const added = extra.sheet.cases.filter((c) => {
          if (seen.has(c.file)) {
            sheetWarnings.push(`${c.file}: it is in both answer sheets. The row in cases/expected.json is kept.`);
            return false;
          }
          seen.add(c.file);
          return true;
        });
        sheet = { ...sheet, cases: [...sheet.cases, ...added] };
        sheetWarnings.push(...extra.warnings);
        sheetPath = 'cases/expected.json and cases/expected.further.json';
      }
    }
  }

  const { selected: criteria, unknown } = selectCriteria(active, options.only);
  if (unknown.length > 0) {
    throw new CannotRun(
      waveRun
        ? `Not in the wave folders: ${unknown.join(', ')}. The criteria that could be read there are: ${someNames(active.map((c) => c.id), 40)}.`
        : `Not in the active list: ${unknown.join(', ')}. The active criteria are: ${someNames(active.map((c) => c.id), 40)}.`,
    );
  }
  const criterionIds = criteria.map((c) => c.id);
  const activeIds = active.map((c) => c.id);
  // Every criterion the run knows by name, also one whose file did not load: a history written
  // for such a criterion is left out with a note, and is not mistaken for a clean history.
  const knownIds = [...activeIds, ...notScored.map((n) => n.id)];

  // A wave run with --only keeps the histories of the chosen criteria. The whole sheet is still
  // counted, so the table says that the run covered a part of it.
  const chosen = new Set(criterionIds);
  const candidates = waveRun && options.only.length > 0 ? sheet.cases.filter((c) => chosen.has(folderOf(c.file))) : sheet.cases;
  let expected = selectCases(candidates, options.cases, options.limit);
  if (expected.length === 0 && !(waveRun && sheet.cases.length === 0)) {
    const folders = [...new Set(sheet.cases.map((c) => folderOf(c.file)))];
    throw new CannotRun(`No history matched. The folders in the answer sheet are: ${someNames(folders, 40)}.`);
  }

  // In a quick run and a wave run a history is screened against its own criterion only. A history
  // that no criterion of this run is planned for is left out of the run, and the run says so.
  let leftOut: string[] = [];
  let screenedAsClean: string[] = [];
  if (ownOnly) {
    const asPlanCase = (e: ExpectedCase): PlanCase => ({ file: e.file, kind: e.kind, findings: e.findings, readable: true });
    const mapped = expected.map(asPlanCase);
    const first = adjustOwn(planOwnCriterion(mapped, criterionIds, knownIds, firstTen), mapped, criterionIds, knownIds, waveRun);
    leftOut = first.notScreened;
    screenedAsClean = first.screenedAsClean;
    if (leftOut.length > 0) {
      const drop = new Set(leftOut);
      expected = expected.filter((e) => !drop.has(e.file));
    }
    if (expected.length === 0 && !(waveRun && sheet.cases.length === 0)) {
      throw new CannotRun('No history is left to screen. No criterion in this run is planned for any of the histories that were picked.');
    }
  }

  const casesDir = path.join(repoRoot, 'cases');
  const cases = expected.map((e, i) => {
    const run = alreadyRead.get(e.file) ?? readCase(pipeline, casesDir, e, i);
    sheetWarnings.push(...caseSheetWarnings(e, run.cannotAssess === null ? run.lines.map((l) => l.id) : null, activeIds));
    return run;
  });

  let planned: PlannedPair[];
  let quick: QuickInfo | null = null;
  let furtherFrom: number | undefined;
  const furtherIds = criterionIds.filter((id) => listedFurther.includes(id));
  if (!ownOnly && furtherIds.length === 0) {
    planned = planFullRun(cases.length, criterionIds);
  } else if (!ownOnly) {
    // Two phases. The ten, on the histories of their folders and of _clean, in full.
    // A history of a further criterion is not screened against the ten, unless it plants
    // a finding of one of the ten: then only that criterion is added in phase one.
    // A history of the ten that plants a further finding is screened against that further
    // criterion after the ten. Then the further criteria, in quick mode.
    const furtherSet = new Set(furtherIds);
    const tenIds = criterionIds.filter((id) => !furtherSet.has(id));
    const phase1: PlannedPair[] = [];
    const phase2Indexes: number[] = [];
    const extraFurther: PlannedPair[] = [];
    let furtherFolders = 0;
    let notAgainstTen = 0;
    cases.forEach((c, caseIndex) => {
      const parts = folderOf(c.file).split('/').filter((p) => p !== '');
      const demo = parts.includes('_demo');
      const clean = c.kind === 'clean' || parts.includes('_clean');
      const inFurtherFolder = !demo && !clean && parts.some((p) => furtherSet.has(p));
      const planted = new Set(c.findings.map((f) => f.criterion));
      const plantedTen = tenIds.filter((id) => planted.has(id));
      const plantedFurther = furtherIds.filter((id) => planted.has(id));
      if (demo) return;
      if (!inFurtherFolder) {
        for (const criterionId of tenIds) phase1.push({ caseIndex, criterionId });
      } else if (plantedTen.length > 0) {
        for (const criterionId of plantedTen) phase1.push({ caseIndex, criterionId });
      }
      if (inFurtherFolder) {
        furtherFolders++;
        phase2Indexes.push(caseIndex);
        if (plantedTen.length === 0) notAgainstTen++;
      }
      if (!inFurtherFolder && plantedFurther.length > 0) {
        for (const criterionId of plantedFurther) extraFurther.push({ caseIndex, criterionId });
      }
    });
    const subCases: PlanCase[] = phase2Indexes.map((i) => ({
      file: cases[i].file, kind: cases[i].kind, findings: cases[i].findings, readable: cases[i].cannotAssess === null,
    }));
    const sub = adjustOwn(planOwnCriterion(subCases, furtherIds, [...furtherIds, ...tenIds], firstTen), subCases, furtherIds, [...furtherIds, ...tenIds], false);
    const sample = planSample(subCases, furtherIds, sub.pairs);
    const phase2 = inCallOrder([sub.pairs, sample.pairs], furtherIds).map((p) => ({ ...p, caseIndex: phase2Indexes[p.caseIndex] }));
    planned = [...phase1, ...phase2, ...extraFurther];
    furtherFrom = phase1.length;
    if (furtherFolders === 0) {
      sheetWarnings.push('Histories of further criteria were not run against the ten.');
    } else if (notAgainstTen > 0) {
      sheetWarnings.push(notAgainstTen === 1
        ? '1 history of further criteria was not run against the ten.'
        : `${notAgainstTen} histories of further criteria were not run against the ten.`);
    }
  } else {
    const planCases: PlanCase[] = cases.map((c) => ({ file: c.file, kind: c.kind, findings: c.findings, readable: c.cannotAssess === null }));
    const own = adjustOwn(planOwnCriterion(planCases, criterionIds, knownIds, firstTen), planCases, criterionIds, knownIds, waveRun);
    const sample = options.quick && !options.noSample ? planSample(planCases, criterionIds, own.pairs) : null;
    planned = inCallOrder(sample ? [own.pairs, sample.pairs] : [own.pairs], criterionIds);
    const byRole = { own: 0, clean: 0, sample: 0 };
    for (const pair of planned) if (pair.role) byRole[pair.role]++;
    quick = {
      ownCriterionOnly: true,
      firstTen: waveRun ? [] : firstTen.filter((id) => chosen.has(id)),
      planned: byRole,
      sample: sample ? sample.info : null,
      notScreened: leftOut,
    };
    for (const file of screenedAsClean) {
      sheetWarnings.push(`${file}: it lists no finding, and its folder names no criterion. It was screened like a clean history, against the first ten.`);
    }
    if (leftOut.length > 0) {
      sheetWarnings.push(
        `${leftOut.length === 1 ? '1 history was' : `${leftOut.length} histories were`} left out of this run, because no criterion in the run is planned for ${leftOut.length === 1 ? 'it' : 'them'}: ${someNames(leftOut, 5)}.`,
      );
    }
  }

  return {
    mode,
    cfg,
    active,
    criteria,
    sheet,
    sheetPath,
    sheetWarnings: [...new Set(sheetWarnings)],
    expected,
    cases,
    planned,
    quick,
    waveNames,
    waveItems,
    notScored,
    furtherFrom,
    furtherIds: furtherFrom === undefined ? [] : furtherIds,
  };
}

// A history in _demo is left out of a quick run. A nested folder belongs to the criterion
// named by its last matching part: _fresh/STOPP-C10/pos.csv belongs to STOPP-C10.
function adjustOwn(plan: OwnPlan, cases: PlanCase[], criterionIds: string[], knownIds: string[], wave: boolean): OwnPlan {
  if (wave) return plan;
  const runSet = new Set(criterionIds);
  const idSet = new Set([...criterionIds, ...knownIds]);
  let pairs = plan.pairs.slice();
  let notScreened = plan.notScreened.slice();
  let screenedAsClean = plan.screenedAsClean.slice();
  const addLeft = (file: string): void => {
    if (!notScreened.includes(file)) notScreened.push(file);
  };
  cases.forEach((c, caseIndex) => {
    const parts = folderOf(c.file).split('/').filter((p) => p !== '');
    if (parts.includes('_demo')) {
      pairs = pairs.filter((p) => p.caseIndex !== caseIndex);
      screenedAsClean = screenedAsClean.filter((f) => f !== c.file);
      addLeft(c.file);
      return;
    }
    if (c.findings.length > 0 || c.kind === 'clean') return;
    const id = [...parts].reverse().find((p) => idSet.has(p));
    if (!id) return;
    // Already left out by the planner: keep that list in its order.
    if (!runSet.has(id)) return;
    pairs = pairs.filter((p) => p.caseIndex !== caseIndex);
    screenedAsClean = screenedAsClean.filter((f) => f !== c.file);
    notScreened = notScreened.filter((f) => f !== c.file);
    pairs.push({ caseIndex, criterionId: id, role: 'own' });
  });
  return { pairs, notScreened, screenedAsClean };
}

function screeningsWords(plan: Plan): string {
  const p = plan.quick?.planned ?? { own: 0, clean: 0, sample: 0 };
  return `own criterion ${p.own}, clean histories against the first ten ${p.clean}, false-flag sample ${p.sample}`;
}

// --check: say what the answer sheet and the histories look like, and what needs a look.
// No model is called and nothing is written.
function printCheck(plan: Plan, log: (line: string) => void): number {
  const signed = plan.sheet.signed_by_clinical_reviewer;
  log('ClinicaLANTERN scorer. Check only. No model is called and nothing is written.');
  if (plan.mode === 'wave') {
    log(`Wave folders: ${plan.waveNames.join(', ')}. Answer sheet: ${plan.sheetPath}. Not signed by the clinical reviewer yet.`);
  } else {
    log(`Answer sheet: ${plan.sheetPath}. ${signed ? `Signed by ${signed.name} on ${signed.date}.` : 'Not signed by the clinical reviewer yet.'}`);
  }
  log(`Histories: ${plan.cases.length} of ${plan.sheet.cases.length}. Criteria: ${plan.criteria.length} of ${plan.active.length}.`);

  let toLookAt = 0;
  for (const item of plan.notScored) {
    if (item.result === 'FILES_NOT_USABLE') toLookAt++;
    log(`${item.wave ?? ''} ${item.id}: ${oneLine(item.reason, 300)}`.trim());
  }
  const unread = plan.cases.filter((c) => c.cannotAssess !== null);
  for (const c of unread) {
    toLookAt++;
    log(`Cannot be screened: ${c.file}. ${oneLine(c.cannotAssess ?? '', 300)}`);
  }
  for (const warning of plan.sheetWarnings) {
    toLookAt++;
    log(`Answer sheet: ${oneLine(warning, 300)}`);
  }
  log('Planted findings for each criterion, in this run and in the whole answer sheet:');
  for (const criterion of plan.criteria) {
    const inRun = countPlanted(plan.expected, criterion.id);
    const inSheet = countPlanted(plan.sheet.cases, criterion.id);
    const notes: string[] = [];
    if (inSheet === 0) {
      toLookAt++;
      notes.push('The answer sheet has no planted finding for it. It cannot pass.');
    }
    const text = criterionText(criterion);
    if (!text.attached) {
      toLookAt++;
      notes.push(...text.problems);
    }
    log(`  ${criterion.id}: ${inRun} of ${inSheet}.${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`);
  }
  const readable = new Set(plan.cases.map((c, i) => (c.cannotAssess === null ? i : -1)).filter((i) => i >= 0));
  const calls = plan.planned.filter((p) => readable.has(p.caseIndex)).length;
  if (plan.mode === 'full') {
    log(`A run would make ${calls} screen calls, then one check for each suspected finding.`);
    if (plan.furtherFrom !== undefined) {
      log('Phase one scores the first ten in full. Phase two scores the further criteria in quick mode.');
    }
    if (plan.criteria.length > 10 && calls > 2000) {
      log(`That is a full run: every criterion on every history. With ${plan.criteria.length} criteria it is very long. A quick run (--quick) screens each history against its own criterion only.`);
    }
  } else {
    log(`A ${plan.mode} run would make ${calls} screen calls (${screeningsWords(plan)}), then one check for each suspected finding.`);
  }
  log(toLookAt === 0 ? 'Nothing needs a look.' : `Things that need a look: ${toLookAt}.`);
  return toLookAt === 0 ? 0 : 1;
}

// Makes a new folder for one run: <base>/<stamp>, or <stamp>-2, <stamp>-3 when that name is taken.
// The folder is made here, in one step, so two runs started in the same second never share one.
function makeFreshFolder(base: string, stamp: string): string {
  fs.mkdirSync(base, { recursive: true });
  for (let n = 1; ; n++) {
    const folder = path.join(base, n === 1 ? stamp : `${stamp}-${n}`);
    try {
      fs.mkdirSync(folder);
      return folder;
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== 'EEXIST' || n > 99) throw err;
    }
  }
}

// ---------- progress words ----------

function ids(list: string[]): string {
  return list.length === 0 ? 'no valid line cited' : `lines ${list.join(' ')}`;
}

function screenWords(pair: PairRecord): string {
  const call = pair.screen;
  if (call.status === 'clear') return 'nothing suspected';
  if (call.status === 'suspected') {
    // A possible finding: the medicines match and the record holds no line about a fact the criterion needs.
    const missing = missingFactsOf(call.result);
    const possible = missing.length > 0 ? `. Possible finding: the record does not show ${oneLine(factsText(missing), 120)}` : '';
    return `suspected, ${ids(linesCited(pair).byScreen)}${possible}`;
  }
  return `COULD NOT BE SCREENED. ${oneLine(call.error ?? '', 160)}`;
}

function checkWords(pair: PairRecord): string {
  const call = pair.check;
  if (call?.status === 'confirmed') return `confirmed, ${ids(linesCited(pair).byCheck)}`;
  if (call?.status === 'unclear') return `UNCLEAR: it said "not confirmed" but named ${ids(linesCited(pair).byCheck)}. The app shows the finding under the bell`;
  if (call?.status === 'not_confirmed') return 'not confirmed';
  return `SECOND CHECK NOT COMPLETED. ${oneLine(call?.error ?? '', 160)}`;
}

function letterWords(call: LetterCall): string {
  const notes = stringList(call.draft?.checkNotes).length;
  if (call.status === 'model_clean') return 'written by the model, the letter checks found nothing';
  if (call.status === 'model_with_notes') return `written by the model, ${notes} check ${notes === 1 ? 'note' : 'notes'}`;
  if (call.status === 'template') return call.modelDidNotAnswer ? 'built from the template: MODEL 3 DID NOT ANSWER' : 'built from the template';
  return `NO LETTER. ${oneLine(call.error ?? '', 160)}`;
}

// ---------- the run ----------

// How the run is told to stop. Set requested to true and it stops after the current call, then
// writes its results. While the run is going, main() fills in writeNow: call it to write the
// results at once, without waiting for the call that is running (for a second Ctrl+C).
export interface StopSwitch {
  requested: boolean;
  writeNow?: () => void;
  /** Called once the first ten have been written, before any further criterion is screened. */
  beforeFurther?: () => void;
}

export interface RunEnv {
  repoRoot?: string;                  // default: the folder above eval/
  cwd?: string;                       // --out and --sheet are read from here; default: the current folder
  log?: (line: string) => void;       // default: the console
  now?: () => Date;                   // the clock, for the folder name and the times in the results
  timer?: () => number;               // milliseconds, for the seconds each call took; default: performance.now
  stop?: StopSwitch;
}

const STOPPED = 'The run stopped before this call.';

const FIRST_TEN_HEADING = '## THE FIRST TEN: FULL RUN';
const FURTHER_NOT_YET = '## FURTHER CRITERIA: NOT RUN YET';
const FURTHER_QUICK = '## FURTHER CRITERIA: QUICK MODE (each history against its own criterion only)';
const FURTHER_CHUNK = 20;

function plantedPassCount(rows: RunScore['criteria']): number {
  return rows.filter((row) => row.verdict === 'PASS' || row.verdict === 'PASS_PART').length;
}

function signedCount(criteria: Criterion[], ids: Set<string>): number {
  return criteria.filter((c) => ids.has(c.id) && c.signed_by_clinical_reviewer !== null && c.signed_by_clinical_reviewer !== undefined).length;
}

function countLine(pass: number, signed: number, total: number): string {
  return `Count: ${pass} of ${total} pass the planted-finding test. Signed by the clinical reviewer: ${signed} of ${total}.`;
}

// Headings and the count at the end of each part. eval/report.ts writes one table. This adds the
// two headings after it, and does nothing once the first heading is already there.
function stampTwoPhaseTable(tablePath: string, score: RunScore, scored: Criterion[], furtherIds: string[]): void {
  if (furtherIds.length === 0) return;
  const text = fs.readFileSync(tablePath, 'utf8');
  if (text.includes(FIRST_TEN_HEADING)) return;
  const furtherSet = new Set(furtherIds);
  const tenRows = score.criteria.filter((row) => !furtherSet.has(row.criterionId));
  const furtherRows = score.criteria.filter((row) => furtherSet.has(row.criterionId));
  const lineFor = (rows: RunScore['criteria'], total: number): string => {
    const ids = new Set(rows.map((row) => row.criterionId));
    return countLine(plantedPassCount(rows), signedCount(scored, ids), total);
  };
  const parts = [FIRST_TEN_HEADING, '', text.trimEnd(), '', lineFor(tenRows, tenRows.length), ''];
  if (furtherRows.length === 0) {
    parts.push(FURTHER_NOT_YET, '');
  } else {
    const left = furtherIds.length - furtherRows.length;
    parts.push(FURTHER_QUICK, '');
    parts.push(`${furtherRows.length} of ${furtherIds.length} further criteria were scored. ${left} were not reached.`, '');
    parts.push(lineFor(furtherRows, furtherIds.length), '');
  }
  fs.writeFileSync(tablePath, `${parts.join('\n')}\n`, 'utf8');
}

export async function main(pipeline: Pipeline, argv: string[], env: RunEnv = {}): Promise<number> {
  const log = env.log ?? ((line: string): void => console.log(line));
  const args = parseArgs(argv);
  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (args.errors.length > 0) {
    for (const e of args.errors) log(e);
    log('');
    log(USAGE);
    return 2;
  }
  const missing = missingPipelineParts(pipeline);
  if (missing.length > 0) {
    log(`The scorer cannot run. The pipeline does not have: ${missing.join(', ')}.`);
    return 2;
  }

  const options = args.options;
  const repoRoot = path.resolve(env.repoRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const cwd = path.resolve(env.cwd ?? process.cwd());
  const now = env.now ?? ((): Date => new Date());
  const timer = env.timer ?? ((): number => performance.now());
  const stop: StopSwitch = env.stop ?? { requested: false };

  let plan: Plan;
  try {
    plan = await prepare(pipeline, options, repoRoot, cwd);
  } catch (err) {
    log(err instanceof CannotRun ? err.message : `The scorer could not start. ${errorText(err)}`);
    return 2;
  }
  const { cfg, criteria, cases } = plan;
  if (options.check) return printCheck(plan, log);

  const started = now();
  const startedAtMs = timer();
  const stamp = stampOf(started);
  let outDir: string;
  try {
    if (options.out === null) {
      outDir = makeFreshFolder(path.join(repoRoot, 'eval', 'results'), stamp);
    } else {
      outDir = path.resolve(cwd, options.out);
      // Earlier results are evidence. They are never written over.
      if (['table.md', 'results.json', 'raw'].some((name) => fs.existsSync(path.join(outDir, name)))) {
        log(`The folder already holds results: ${options.out}. Give --out a new folder.`);
        return 2;
      }
      fs.mkdirSync(outDir, { recursive: true });
    }
  } catch (err) {
    log(`The results folder could not be made. ${errorText(err)}`);
    return 2;
  }

  // One record for each planned screening, in the order the calls are made: history by history.
  // A full run plans every criterion on every history. A quick run and a wave run plan fewer.
  const pairs: PairRecord[] = [];
  const place: { c: CaseRun; criterion: Criterion }[] = [];
  const criterionById = new Map(criteria.map((c) => [c.id, c]));
  for (const planned of plan.planned) {
    const c = cases[planned.caseIndex];
    const criterion = criterionById.get(planned.criterionId);
    if (!c || !criterion) continue;
    const record: PairRecord = {
      caseFile: c.file,
      criterionId: criterion.id,
      screen:
        c.cannotAssess !== null
          ? { status: 'not_read', seconds: 0, error: c.cannotAssess }
          : { status: 'not_run', seconds: 0, error: STOPPED },
    };
    if (planned.role) record.role = planned.role;
    pairs.push(record);
    place.push({ c, criterion });
  }

  const signed = plan.sheet.signed_by_clinical_reviewer;
  const notScored = plan.notScored;
  log('ClinicaLANTERN scorer. Fictional patients only.');
  if (plan.mode === 'wave') log(`Wave run. Wave folders: ${plan.waveNames.join(', ')}. Each history is screened against its own criterion only.`);
  if (plan.mode === 'quick') log('Quick run. Each history is screened against its own criterion only. Clean histories are screened against the first ten.');
  if (plan.furtherFrom !== undefined) log('Phase one scores the first ten in full. Phase two scores the further criteria in quick mode.');
  log(`Answer sheet: ${plan.sheetPath}. ${signed ? `Signed by ${signed.name} on ${signed.date}.` : 'Not signed by the clinical reviewer yet.'}`);
  log(`Histories: ${cases.length} of ${plan.sheet.cases.length}. Criteria: ${criteria.length} of ${plan.active.length}.`);
  if (plan.quick) log(`Screenings planned: ${pairs.length} (${screeningsWords(plan)}).`);
  if (plan.mode === 'full' && criteria.length > 10 && pairs.length > 2000) {
    // After the first ten a full run grows very large. The run still goes on: the person decides.
    log(`This is a full run: every criterion on every history. With ${criteria.length} criteria that is ${pairs.length} screen calls. A quick run (--quick) screens each history against its own criterion only.`);
  }
  for (const item of notScored) log(`Not scored: ${item.wave ?? ''} ${item.id}: ${oneLine(item.reason, 300)}`.replace(/\s+/g, ' '));
  log(`Results folder: ${outDir}`);
  for (const c of cases) {
    if (c.cannotAssess !== null) log(`Not screened: ${c.file}. ${oneLine(c.cannotAssess, 200)}`);
  }
  if (plan.sheetWarnings.length > 0) {
    log(`Things to look at in the answer sheet: ${plan.sheetWarnings.length}. They are listed in the table.`);
  }

  let rawProblem = false;
  const saveRaw = (stage: RawStage, pair: PairRecord): void => {
    try {
      writeRaw(outDir, stage, pair);
    } catch (err) {
      if (!rawProblem) log(`A raw answer file could not be written. ${errorText(err)} The run goes on.`);
      rawProblem = true;
    }
  };

  let failuresInARow = 0;
  let hinted = false;
  const watch = (failed: boolean): void => {
    failuresInARow = failed ? failuresInARow + 1 : 0;
    if (failuresInARow === 3 && !hinted) {
      hinted = true;
      log('Three calls in a row could not be completed. Is the Ollama server running? See docs/SPEC.md section 3. The run goes on.');
    }
  };
  const secondsSince = (t0: number): number => Math.round((timer() - t0) / 100) / 10;

  // Every 25 calls: how long the rest of the stage may take, going by the calls made so far.
  const timeLeft = (done: number, total: number, stageStart: number): void => {
    if (done === 0 || done % 25 !== 0 || done >= total) return;
    const perCall = (timer() - stageStart) / done;
    log(`  ${done} of ${total} done. About ${duration((perCall * (total - done)) / 1000)} left in this stage.`);
  };

  // early is set when the run does not make every call. code is set once the results are written.
  const ended: { early: string | null; code: number | null } = { early: null, code: null };
  const stopNow = (): boolean => {
    if (stop.requested && ended.early === null) ended.early = 'It was stopped before every call was made.';
    return stop.requested;
  };

  // A further criterion is scored once every one of its screen calls, and its check when Model 1
  // suspected a finding, has been made. One with no history is scored only when the run finishes.
  const furtherDone = (finalPublish: boolean): Set<string> => {
    const pending = new Map<string, { total: number; open: number }>();
    for (const id of plan.furtherIds) pending.set(id, { total: 0, open: 0 });
    for (const pair of pairs) {
      const row = pending.get(pair.criterionId);
      if (!row) continue;
      row.total++;
      const checkOpen = pair.screen.status === 'suspected' && (pair.check === undefined || pair.check.status === 'not_run');
      if (pair.screen.status === 'not_run' || checkOpen) row.open++;
    }
    const done = new Set<string>();
    const stopped = ended.early !== null || stop.requested;
    for (const id of plan.furtherIds) {
      const row = pending.get(id);
      if (!row || row.open > 0) continue;
      if (row.total > 0 || (finalPublish && !stopped)) done.add(id);
    }
    return done;
  };

  // The ten are written before any further criterion is screened, and again after each block.
  // A non-final write does not set the exit code, so a later write can still finish the run.
  const finish = (final: boolean): number => {
    if (ended.code !== null) return ended.code;
    if (final && stop.requested && ended.early === null) ended.early = 'It was stopped before every call was made.';
    const twoPhase = plan.furtherFrom !== undefined;
    const done = twoPhase ? furtherDone(final) : new Set<string>();
    const furtherSet = new Set(plan.furtherIds);
    const scoredCriteria = twoPhase ? criteria.filter((c) => !furtherSet.has(c.id) || done.has(c.id)) : criteria;
    const scoredIds = new Set(scoredCriteria.map((c) => c.id));
    const scoredPairs = twoPhase ? pairs.filter((p) => scoredIds.has(p.criterionId)) : pairs;
    const factLines: Record<string, string[]> = {};
    for (const c of cases) if (c.factLineIds && c.factLineIds.length > 0) factLines[c.file] = c.factLineIds;
    const score = scoreRun({
      criteria: scoredCriteria,
      cases: plan.expected,
      pairs: scoredPairs,
      lettersRun: options.letters,
      sheetCases: plan.sheet.cases,
      ownCriterionOnly: plan.mode !== 'full' || twoPhase,
      factLines,
    });

    // The lists a script reads: what passes, and what does not, with the reason.
    const waveOfCriterion = new Map(plan.waveItems.map((item) => [item.id, item.wave]));
    const lists = passingLists(score, notScored, (id) => waveOfCriterion.get(id) ?? null);
    const inRun = new Set(criteria.map((c) => c.id));
    const waves: WaveNote[] | null =
      plan.mode !== 'wave'
        ? null
        : plan.waveNames.map((name) => ({
            name,
            criteria: plan.waveItems
              .filter((item) => item.wave === name)
              .map((item) => ({
                id: item.id,
                status: item.status === 'ready' ? (inRun.has(item.id) ? ('in_run' as const) : ('left_out' as const)) : item.status,
                reason: item.status === 'not_usable' ? `files not usable: ${item.reason}` : item.reason,
                files: item.files,
              })),
          }));
    const recorded: EvalResults['options'] = {
      only: options.only.length > 0 ? criteria.map((c) => c.id) : [],
      cases: options.cases,
      limit: options.limit,
      letters: options.letters,
      sheet: options.sheet === null ? null : plan.sheetPath,
    };
    if (options.quick) recorded.quick = true;
    if (options.noSample) recorded.noSample = true;
    if (plan.mode === 'wave') recorded.waves = plan.waveNames;   // by name: no folder of this computer in the results

    const results: EvalResults = {
      format: 'clinicalantern-eval-1',
      stage: 'Prototype',
      note: 'Fictional patients only. No real person is in these histories. One measured run on one computer. It is not a validation.',
      stamp,
      startedAt: started.toISOString(),
      finishedAt: now().toISOString(),
      seconds: secondsSince(startedAtMs),
      stoppedEarly: ended.early,
      partRun:
        !final ||
        plan.furtherIds.some((id) => !done.has(id)) ||
        criteria.length < plan.active.length ||
        cases.length < plan.sheet.cases.length ||
        !options.letters,
      options: recorded,
      settings: {
        ollamaBase: cfg.ollamaBase,
        models: cfg.models,
        think: cfg.think,
        numCtx: cfg.numCtx,
        keepAlive: cfg.keepAlive,
        maxLinesPerCall: cfg.maxLinesPerCall,
        overlapLines: cfg.overlapLines,
      },
      sheet: {
        path: plan.sheetPath,
        signed_by_clinical_reviewer: signed,
        caseCount: plan.sheet.cases.length,
        warnings: plan.sheetWarnings,
      },
      activeCriteria: plan.active.map((c) => c.id),
      criteria: scoredCriteria,
      cases,
      pairs: scoredPairs,
      score,
      mode: plan.mode,
      quick: plan.quick,
      ...(plan.furtherIds.length > 0 ? { furtherIds: plan.furtherIds } : {}),
      waves,
      passing: lists.passing,
      not_passing: lists.not_passing,
    };

    let tablePath: string;
    try {
      tablePath = writeReport(outDir, results).table;
    } catch (err) {
      log(`The results could not be written. ${errorText(err)}`);
      ended.code = 2;
      return ended.code;
    }
    const tenReady =
      twoPhase &&
      pairs.every((pair) => {
        if (furtherSet.has(pair.criterionId)) return true;
        if (pair.screen.status === 'not_run') return false;
        if (pair.screen.status === 'suspected' && (pair.check === undefined || pair.check.status === 'not_run')) return false;
        return true;
      });
    if (tenReady) stampTwoPhaseTable(tablePath, score, scoredCriteria, plan.furtherIds);

    if (!final) {
      log('');
      if (done.size === 0) log('The first ten are written. FURTHER CRITERIA: NOT RUN YET.');
      else log(`Written again. ${done.size} of ${plan.furtherIds.length} further criteria are scored.`);
      return 0;
    }

    const t = score.totals;
    log('');
    log(ended.early === null ? `Finished in ${duration(results.seconds)}.` : `Stopped early after ${duration(results.seconds)}. ${ended.early}`);
    if (results.partRun) log('This was a part run. It is not a sign-off run.');
    log(resultSentence(score));
    for (const s of score.criteria) {
      log(
        `  ${resultLabel(s.verdict)}  ${s.criterionId}: caught ${s.caught} of ${s.planted}, false flags ${s.falseFlags.length}, failed calls ${s.notCompleted.length}, letters ${lettersCell(s, score.lettersRun)}.${
          s.verdict === 'FAIL' ? ` ${s.reasons.join(' ')}` : ''
        }`,
      );
      // For a FAIL: which history failed, and at which step.
      for (const failure of s.failures) log(`        ${oneLine(failure.text, 300)}`);
    }
    log(`Planted findings caught: ${t.caught} of ${t.planted}. False flags: ${t.falseFlags} (counted, not failures). Calls not completed: ${t.notCompleted}.`);
    const fh = t.factHistories;
    if (fh.noFactPlanted > 0) {
      log(`Histories with no line about the fact: caught ${fh.noFactCaught} of ${fh.noFactPlanted}. Reported as a possible finding: ${fh.noFactPossible}.`);
    }
    if (plan.quick?.sample) {
      log(`Sampled false-flag estimate: ${t.sample.falseFlags} in ${t.sample.answered} sampled screenings that got an answer (${percentText(t.sample.falseFlags, t.sample.answered)}).`);
    }
    const unusable = notScored.filter((n) => n.result === 'FILES_NOT_USABLE').length;
    if (plan.mode === 'wave' || notScored.length > 0) log(`Not drafted: ${notScored.length - unusable}. Files not usable: ${unusable}.`);
    if (plan.mode !== 'full') log(`Passing: ${lists.passing.length}. Not passing: ${lists.not_passing.length}. Both lists are in results.json.`);
    // A wave run: each wave folder on its own, with the time its model calls took.
    if (waves !== null) for (const w of waveSummaries(waves, score)) log(`  ${waveSummaryLine(w)}`);
    log(`Table: ${tablePath}`);

    if (ended.early !== null) ended.code = 2;
    else ended.code = t.fail > 0 || unusable > 0 ? 1 : 0;
    return ended.code;
  };

  // For a second Ctrl+C: write what there is now. The call that is running is left as not run.
  stop.writeNow = (): void => {
    if (ended.code !== null) return;
    ended.early = 'It was stopped while a call was running. That call and the calls after it were not recorded.';
    finish(true);
  };

  // One block, through all three stages, so one model stays loaded for that block.
  // findingSeq runs for the whole run: the first check is still F0001.
  let findingSeq = 0;
  const runStages = async (indexes: number[]): Promise<void> => {
    const wanted = new Set(indexes);
    // ----- Stage 1: Model 1 screens -----
    const toScreen = indexes.filter((i) => pairs[i].screen.status === 'not_run');
    log('');
    log(`Stage 1 of 3. Model 1 screens. Calls to make: ${toScreen.length}.`);
    let n = 0;
    let stageStart = timer();
    for (const i of toScreen) {
      if (stopNow()) break;
      const pair = pairs[i];
      const { c, criterion } = place[i];
      if (c.patient === null) continue;
      n++;
      const t0 = timer();
      let call: ScreenCall;
      try {
        const answer = await pipeline.screenCriterion(cfg, c.patient, c.lines, criterion);
        call = screenCallFrom(answer, secondsSince(t0));
      } catch (err) {
        call = { status: 'failed', seconds: secondsSince(t0), error: `The screen call stopped with an error. ${errorText(err)}` };
      }
      pair.screen = call;
      saveRaw('screen', pair);
      watch(call.status === 'failed');
      log(`[screen ${n}/${toScreen.length}] ${c.file} | ${criterion.id}: ${screenWords(pair)} (${call.seconds.toFixed(1)} s)`);
      timeLeft(n, toScreen.length, stageStart);
    }

    // ----- Stage 2: Model 2 double-checks every suspected finding of this block -----
    const toCheck = indexes.filter((i) => pairs[i].screen.status === 'suspected');
    for (const i of toCheck) pairs[i].check = { status: 'not_run', seconds: 0, error: STOPPED };
    log('');
    log(`Stage 2 of 3. Model 2 double-checks. Suspected findings: ${toCheck.length}.`);
    n = 0;
    failuresInARow = 0;
    stageStart = timer();
    for (const i of toCheck) {
      if (stopNow()) break;
      const pair = pairs[i];
      const { c, criterion } = place[i];
      const screen = pair.screen.result;
      if (c.patient === null || screen === undefined) continue;
      n++;
      const t0 = timer();
      let call: CheckCall;
      try {
        const answer = await pipeline.checkFinding(cfg, c.patient, c.lines, criterion, screen);
        call = checkCallFrom(answer, secondsSince(t0));
      } catch (err) {
        call = { status: 'not_completed', seconds: secondsSince(t0), error: `The check call stopped with an error. ${errorText(err)}` };
      }
      findingSeq++;
      call.findingId = `F${String(findingSeq).padStart(4, '0')}`;
      pair.check = call;
      saveRaw('check', pair);
      watch(call.status === 'not_completed');
      log(`[check ${n}/${toCheck.length}] ${c.file} | ${criterion.id}: ${checkWords(pair)} (${call.seconds.toFixed(1)} s)`);
      timeLeft(n, toCheck.length, stageStart);
    }

    // ----- Stage 3: Model 3 writes a letter for every caught planted finding -----
    log('');
    if (!options.letters) {
      log('Stage 3 of 3. Letters were skipped (--no-letters).');
    } else {
      const toWrite = indexes.filter((i) =>
        wanted.has(i) && place[i].c.findings.some((f) => f.criterion === pairs[i].criterionId && judgePlanted(f, pairs[i]).caught),
      );
      for (const i of toWrite) pairs[i].letter = { status: 'not_run', seconds: 0, error: STOPPED };
      log(`Stage 3 of 3. Model 3 writes letters. Caught planted findings: ${toWrite.length}.`);
      n = 0;
      failuresInARow = 0;
      for (const i of toWrite) {
        if (stopNow()) break;
        const pair = pairs[i];
        const { c, criterion } = place[i];
        const screen = pair.screen.result;
        const check = pair.check?.result;
        if (c.patient === null || screen === undefined || check === undefined) continue;
        n++;
        // In the app the pharmacist accepts a finding before a letter is written.
        // Here the scorer stands in for that step. No pharmacist took part in a test run.
        // "possible" is set the way the app sets it (server/engine.ts): the first model named a fact
        // the record does not show (docs/SPEC.md section 6a). The letter then asks the doctor to
        // confirm that fact.
        const missing = missingFactsOf(screen);
        const finding: Finding = {
          id: pair.check?.findingId ?? `F${String(i + 1).padStart(4, '0')}`,
          caseId: c.caseId,
          criterionId: criterion.id,
          state: 'accepted',
          possible: missing.length > 0,
          screen: { ...screen, missingFacts: missing },
          check,
          decision: { action: 'accept', by: cfg.pharmacy?.pharmacist ?? 'pharmacist', at: now().toISOString() },
          seenByPharmacist: true,
        };
        // The planted lines, so the scorer can note a letter that does not show them.
        const textOf = new Map(c.lines.map((l) => [normaliseLineId(l.id), l.text]));
        const plantedGroups: PlantedGroup[] = c.findings
          .filter((f) => f.criterion === criterion.id)
          .flatMap((f) => f.must_cite)
          .map((group) => ({
            ids: group,
            texts: group.map((id) => textOf.get(normaliseLineId(id)) ?? '').filter((text) => text !== ''),
          }));
        const t0 = timer();
        let call: LetterCall;
        try {
          const answer = await pipeline.draftLetter(cfg, c.patient, c.lines, criterion, finding);
          call = letterCallFrom(answer, secondsSince(t0), criterion, plantedGroups, finding.possible);
        } catch (err) {
          call = { status: 'not_produced', seconds: secondsSince(t0), error: `The letter call stopped with an error. ${errorText(err)}` };
        }
        call.findingId = finding.id;
        pair.letter = call;
        saveRaw('letter', pair);
        watch(call.status === 'not_produced');
        log(`[letter ${n}/${toWrite.length}] ${c.file} | ${criterion.id}: ${letterWords(call)} (${call.seconds.toFixed(1)} s)`);
      }
    }
  };

  try {
    if (plan.furtherFrom === undefined) {
      await runStages(pairs.map((_, i) => i));
    } else {
      const furtherSet = new Set(plan.furtherIds);
      const phase1 = pairs.map((_, i) => i).filter((i) => !furtherSet.has(pairs[i].criterionId));
      if (phase1.length > 0) await runStages(phase1);
      if (ended.early === null && !stop.requested && ended.code === null) {
        finish(false);
        if (ended.code === null) {
          stop.beforeFurther?.();
          if (!stop.requested && ended.early === null) {
            for (let start = 0; start < plan.furtherIds.length; start += FURTHER_CHUNK) {
              if (stopNow()) break;
              const chunk = new Set(plan.furtherIds.slice(start, start + FURTHER_CHUNK));
              const indexes = pairs.map((_, i) => i).filter((i) => chunk.has(pairs[i].criterionId));
              if (indexes.length > 0) await runStages(indexes);
              if (stop.requested || ended.early !== null || ended.code !== null) break;
              if (start + FURTHER_CHUNK < plan.furtherIds.length) finish(false);
            }
          }
        }
      }
    }
  } catch (err) {
    ended.early = `An unexpected error stopped the run. ${errorText(err)}`;
    log(ended.early);
  }

  stop.writeNow = undefined;
  return finish(true);
}

// ---------- started from the command line ----------

function startedDirectly(): boolean {
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

// The real pipeline. The path is written out in full so the type checker compares what
// pipeline/index.ts exports with the Pipeline type the scorer was written against.
async function loadRealPipeline(): Promise<Pipeline> {
  const real: Pipeline = await import('../pipeline/index.ts');
  return real;
}

if (startedDirectly()) {
  const argv = process.argv.slice(2);
  const stop: StopSwitch = { requested: false };
  process.on('SIGINT', () => {
    if (stop.requested) {
      // The second Ctrl+C: write what there is and end now. The call that is running is given up.
      try {
        stop.writeNow?.();
      } catch {
        // Nothing more can be done here.
      }
      process.stdout.write('', () => process.exit(2));
      return;
    }
    stop.requested = true;
    console.log('Stopping after the current call. Then the results are written. Press Ctrl+C again to write them now and stop at once.');
  });

  let code = 2;
  const early = parseArgs(argv);
  if (early.help) {
    console.log(USAGE);
    code = 0;
  } else if (early.errors.length > 0) {
    for (const e of early.errors) console.log(e);
    console.log('');
    console.log(USAGE);
  } else {
    try {
      const pipeline = await loadRealPipeline();
      code = await main(pipeline, argv, { stop });
    } catch (err) {
      console.log(`The scorer stopped with an error. ${errorText(err)}`);
    }
  }
  // Let the last lines reach the screen, then end. An open connection must not keep the run alive.
  process.stdout.write('', () => process.exit(code));
}
