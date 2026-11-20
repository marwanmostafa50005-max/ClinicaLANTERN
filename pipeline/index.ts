// The pipeline as other parts of the program use it: the server and the scorer import from here.
// Nine functions. The models are reached only through these.
//
// How the pieces fit:
//   const cfg = loadConfig(repoRoot);
//   const criteria = await loadCriteria(repoRoot);              // the first ten, then the further ones
//   const { patient, lines, problems } = parseCsv(csvText);     // problems not empty: do not screen
//   const s = await screenCriterion(cfg, patient, lines, criterion);
//     s.ok false           -> "could not be screened" (never "no finding")
//     s.ok and s.suspected -> go on to checkFinding
//     s.result.missingFacts not empty -> a possible finding (docs/SPEC.md section 6a)
//   const c = await checkFinding(cfg, patient, lines, criterion, s.result);
//     the finding reaches the pharmacist when  c.confirmed || !c.completed
//   const letter = await draftLetter(cfg, patient, lines, criterion, finding);
//     letter.origin "model"    -> a model draft passed the checks (checkNotes tells if it took a second draft)
//     letter.origin "template" -> both drafts failed, or the model did not answer
import type {
  CheckResult, Criterion, Finding, HistoryLine, LanternConfig, LetterDraft, PatientHeader, ScreenResult
} from '../shared/types.ts';
import { loadConfig as loadConfigFile } from './config.ts';
import { loadCriteria as loadActiveCriteria, loadCriteriaFrom as loadFromFolder, type CriterionProblem } from './criteria.ts';
import { parseCsv as parseCsvText } from './csv.ts';
import { screenCriterion as screen } from './screen.ts';
import { checkFinding as check } from './check.ts';
import { draftLetter as draft } from './letter.ts';
import { transcribePageImage as transcribe, type TranscribeOutcome } from './transcribe.ts';
import { checkLetterFacts as checkFacts } from './facts.ts';

/** Reads lantern.config.json in the repository root. Missing values fall back to defaults. */
export function loadConfig(repoRoot: string): LanternConfig {
  return loadConfigFile(repoRoot);
}

/** A further criterion that did not load is named on the error output. The others still load. */
function sayProblem(problem: CriterionProblem): void {
  console.error(`Criterion ${problem.id} was not loaded. ${problem.error}`);
}

/**
 * The criteria in use from criteria/active.json, in order: the first ten (active), then the further
 * ones when the file lists them. No name comes twice. A missing or broken file among the ten throws
 * a plain message and nothing starts. A further criterion whose file does not load is named on the
 * error output and left out. Throws when the list cannot be read, or when no criterion loads.
 */
export function loadCriteria(repoRoot: string): Promise<Criterion[]> {
  return loadActiveCriteria(repoRoot, undefined, sayProblem);
}

/**
 * Criteria from any folder that holds <ID>/criterion.json, for example the "criteria" folder of a
 * drafted wave. In the order given, no name twice. A file that does not load is named on the error
 * output and the others still load. Throws when none loads.
 */
export function loadCriteriaFrom(folder: string, ids: string[]): Promise<Criterion[]> {
  return loadFromFolder(folder, ids, sayProblem);
}

/**
 * Reads a CSV history. Lines are numbered in file order: L001 is the first row. A row is a supply,
 * or a fact when the file has the three optional columns (docs/SPEC.md section 6a).
 * problems is empty when the history can be screened. When it is not empty the case must be shown
 * as "Cannot assess" and must not be screened.
 */
export function parseCsv(csvText: string): { patient: PatientHeader; lines: HistoryLine[]; problems: string[] } {
  return parseCsvText(csvText);
}

/** Job 1. One criterion on one history, with the first model. Never throws. */
export function screenCriterion(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion
): Promise<{ ok: true; suspected: boolean; result: ScreenResult } | { ok: false; error: string }> {
  return screen(cfg, patient, lines, criterion);
}

/** Job 2. The second model double-checks one suspected finding. Never throws. completed is false when the call failed twice. */
export function checkFinding(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, screen: ScreenResult
): Promise<CheckResult> {
  return check(cfg, patient, lines, criterion, screen);
}

/** Job 3. The third model drafts the GP letter for one accepted finding. Never throws; falls back to the template. */
export function draftLetter(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, finding: Finding
): Promise<LetterDraft> {
  return draft(cfg, patient, lines, criterion, finding);
}

/** The first model reads the rows and patient header printed on one page image. */
export function transcribePageImage(
  cfg: LanternConfig, base64Png: string
): Promise<TranscribeOutcome> {
  return transcribe(cfg, base64Png);
}

/**
 * The letter fact check. Returns one sentence per mismatch; an empty list means clean.
 * paragraphs: the subject and paragraphs the model wrote. Do not pass the whole letter: its head
 *   carries today's date and the pharmacy phone number, which are not facts of the finding.
 * allowedText: the finding's cited lines plus the criterion wording (and the patient label, so
 *   that an age such as "72-year-old" is accepted).
 */
export function checkLetterFacts(paragraphs: string[], allowedText: string): string[] {
  return checkFacts(paragraphs, allowedText);
}
