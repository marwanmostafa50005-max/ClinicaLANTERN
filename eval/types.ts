// Types used by the scorer (eval/). Erasable TypeScript only: Node runs this file directly.
// The contract types come from shared/types.ts. This file adds what one test run records.

import type {
  CheckResult,
  Criterion,
  ExpectedCase,
  ExpectedFinding,
  Finding,
  HistoryLine,
  LanternConfig,
  LetterDraft,
  PatientHeader,
  ScreenResult,
} from '../shared/types.ts';

// ---------- the pipeline, as the scorer sees it ----------
// pipeline/index.ts exports these functions. eval/run.ts takes them as a parameter,
// so a unit test can pass a fake pipeline and no model is needed.

export type ScreenAnswer =
  | { ok: true; suspected: boolean; result: ScreenResult }
  | { ok: false; error: string };

export type TranscribeAnswer = { ok: true; rows: string[] } | { ok: false; error: string };

export interface ParsedCsv {
  patient: PatientHeader;
  lines: HistoryLine[];
  problems: string[];
}

export interface Pipeline {
  loadConfig(repoRoot: string): LanternConfig;
  loadCriteria(repoRoot: string): Promise<Criterion[]>;   // the criteria in use, in order: the first ten first
  // Criteria from a folder that holds one folder for each criterion: <folder>/<ID>/criterion.json.
  // The scorer needs it for a wave folder (--wave) and for a "further" list. A plain run does not.
  loadCriteriaFrom?(folder: string, ids: string[]): Promise<Criterion[]>;
  parseCsv(csvText: string): ParsedCsv;                   // supplies, and fact rows when the file has them (docs/SPEC.md section 6a)
  screenCriterion(
    cfg: LanternConfig,
    patient: PatientHeader,
    lines: HistoryLine[],
    criterion: Criterion,
  ): Promise<ScreenAnswer>;
  checkFinding(
    cfg: LanternConfig,
    patient: PatientHeader,
    lines: HistoryLine[],
    criterion: Criterion,
    screen: ScreenResult,
  ): Promise<CheckResult>;                                // completed:false when the call failed twice
  draftLetter(
    cfg: LanternConfig,
    patient: PatientHeader,
    lines: HistoryLine[],
    criterion: Criterion,
    finding: Finding,
  ): Promise<LetterDraft>;                                // never throws; template fallback
  // The two below are part of the pipeline. The scorer does not call them.
  transcribePageImage(cfg: LanternConfig, base64Png: string): Promise<TranscribeAnswer>;
  checkLetterFacts(paragraphs: string[], allowedText: string): string[];
}

// ---------- what one run records ----------

// clear: Model 1 answered and suspected nothing.
// suspected: Model 1 answered and suspected a finding.
// failed: the call was made and could not be completed (it failed twice, or it threw).
// not_read: the history could not be read, so no call was made.
// not_run: the run stopped before this call.
export type ScreenStatus = 'clear' | 'suspected' | 'failed' | 'not_read' | 'not_run';

export interface ScreenCall {
  status: ScreenStatus;
  seconds: number;              // wall-clock seconds, measured by the scorer
  result?: ScreenResult;        // what the pipeline returned (clear and suspected only)
  error?: string;               // why there is no result
}

// not_completed: the check call failed twice. In the app the finding still goes to the bell,
// marked "second check not completed". The scorer never counts it as confirmed.
// unclear: Model 2 answered "not confirmed" but named lines as proof. In the app the finding still
// goes to the bell, marked "second check unclear", so the scorer counts it as reaching the bell.
export type CheckStatus = 'confirmed' | 'unclear' | 'not_confirmed' | 'not_completed' | 'not_run';

export interface CheckCall {
  status: CheckStatus;
  seconds: number;
  findingId?: string;           // "F0001", given by the scorer
  result?: CheckResult;         // what the pipeline returned
  error?: string;
}

// model_clean: written by the model, no check notes (the first draft passed the letter checks).
// model_with_notes: written by the model, with check notes (the pipeline drafts once more when
//                   the first draft fails its checks, and says so in the notes).
// template: built from the template. The model's drafts failed the checks twice, or the model
//           did not answer. It counts as a letter and is counted on its own.
// not_produced: no usable letter came back (no text, or a text without the criterion text).
export type LetterResult = 'model_clean' | 'model_with_notes' | 'template' | 'not_produced' | 'not_run';

export interface LetterCall {
  status: LetterResult;
  seconds: number;
  findingId?: string;
  draft?: LetterDraft;          // what the pipeline returned
  error?: string;
  observations?: string[];      // other things seen in the letter; never part of the pass rule
  plantedNotShown?: string[][]; // planted must_cite groups of which the letter shows no line; part of the pass rule
  modelDidNotAnswer?: boolean;  // true when the letter is the template because the model call failed, not because a draft failed its checks
}

// ---------- facts and possible findings (docs/SPEC.md section 6a) ----------

// supplies_only: the criterion is decided from the supplies alone.
// needs_a_fact: the criterion file lists at least one fact under needs_facts.
export type CriterionClass = 'supplies_only' | 'needs_a_fact';

// Why a criterion was screened on a history, in a run that does not screen everything on everything.
// own: the history was written for the criterion (a planted finding, or its near miss).
// clean: a clean history, screened against the first ten.
// sample: one history in ten is also screened against other criteria, to estimate false flags.
// A full run screens every criterion on every history, and its records carry no role.
export type PairRole = 'own' | 'clean' | 'sample';

// One criterion on one history.
export interface PairRecord {
  caseFile: string;             // as written in the answer sheet, e.g. "STOPP-C10/pos-brand.csv"
  criterionId: string;
  role?: PairRole;              // set in a quick run and a wave run only
  screen: ScreenCall;
  check?: CheckCall;            // present when Model 1 suspected a finding
  letter?: LetterCall;          // present when a letter was asked for
}

// One history in the run.
export interface CaseRun {
  caseId: string;               // "C0001", given by the scorer
  file: string;
  folder: string;
  kind: ExpectedCase['kind'];
  about: string;
  findings: ExpectedFinding[];
  patient: PatientHeader | null;
  lines: HistoryLine[];
  problems: string[];           // what the CSV reader reported
  cannotAssess: string | null;  // reason; when set the history was not screened
  wave?: string;                // the name of the wave folder the history came from (a wave run only)
  factLineIds?: string[];       // the lines that are a condition, a result or an observation (set when there is one)
}

// ---------- the score ----------

// PASS: the founder's full rule was met on every planted finding in the answer sheet.
// PASS_PART: nothing failed, but the run did not cover everything (letters skipped, or not
//            every planted finding for the criterion was in the run). Not a sign-off result.
// FAIL: a planted finding was missed, the criterion text is missing, a letter is missing, or a
//       letter does not show the planted lines.
// NOT_TESTED: no planted finding for the criterion was in the run.
export type Verdict = 'PASS' | 'PASS_PART' | 'FAIL' | 'NOT_TESTED';

export type MissWhy =
  | 'history_not_read'
  | 'not_run'
  | 'could_not_be_screened'
  | 'not_suspected'
  | 'check_not_completed'
  | 'not_confirmed'
  | 'planted_lines_not_cited';

export interface PlantedOutcome {
  caught: boolean;
  disputed?: boolean;           // Model 1 suspected it and Model 2 turned it back. Not a miss.
  unclear?: boolean;            // caught, with an unclear second check
  possible?: boolean;           // caught, and reported as a possible finding (the record does not show a fact)
  missingFacts?: string[];      // the facts Model 1 said the record does not show
  why?: MissWhy;                // set when not caught
  detail: string;               // one or two plain sentences
  missingGroups: string[][];    // must_cite groups with no cited line
  citedByScreen: string[];
  citedByCheck: string[];
}

export interface Miss {
  criterionId: string;
  caseFile: string;
  why: MissWhy;
  detail: string;
  mustCite: string[][];
  missingGroups: string[][];
  citedByScreen: string[];
  citedByCheck: string[];
}

export interface Catch {
  criterionId: string;
  caseFile: string;
  mustCite: string[][];
  citedByScreen: string[];
  citedByCheck: string[];
  unclear: boolean;             // true when the second check said "not confirmed" but named lines as proof
  possible: boolean;            // true when the finding was reported as a possible finding
  missingFacts: string[];       // the facts the record does not show, as Model 1 named them
}

// Model 1 suspected a planted finding and Model 2 turned it back. The pharmacist sees it.
// It is not a miss and it is not a failure.
export interface Dispute {
  criterionId: string;
  caseFile: string;
  detail: string;
  citedByScreen: string[];
  citedByCheck: string[];
}

export interface FalseFlag {
  criterionId: string;
  caseFile: string;
  caseKind: ExpectedCase['kind'];
  unclear: boolean;             // true when the second check said "not confirmed" but named lines as proof
  ownFolder: boolean;           // the history sits in this criterion's own folder (its near miss)
  citedByScreen: string[];
  citedByCheck: string[];
  screenReason: string;         // what Model 1 said
  checkWhatMatches: string;     // what Model 2 said matches
  possible: boolean;            // true when it was reported as a possible finding
  role?: PairRole;              // why the criterion was screened on this history (a quick run and a wave run only)
}

export interface NotCompleted {
  criterionId: string;
  caseFile: string;
  stage: 'import' | 'screen' | 'check' | 'letter';
  planted: boolean;             // true when the criterion was planted on this history
  detail: string;
  role?: PairRole;              // set in a quick run and a wave run only
}

// Why a criterion failed, one entry for each history (or for the criterion file), in plain words.
// not_suspected: Model 1 did not suspect the planted finding.
// turned_back: Model 1 suspected it and Model 2 did not confirm it.
// call_not_completed: a model call could not be completed.
// letter_missing: the finding was caught and no letter came back.
// lines_not_cited: a finding reached the bell, but without the planted lines.
// letter_without_lines: a letter came back, but it does not show the planted lines.
// history_not_read: the history could not be read.
// not_run: the run stopped first.
// criterion_text: the criterion file has no statement or no credit line.
export type FailStep =
  | 'not_suspected'
  | 'turned_back'
  | 'call_not_completed'
  | 'letter_missing'
  | 'lines_not_cited'
  | 'letter_without_lines'
  | 'history_not_read'
  | 'not_run'
  | 'criterion_text';

export interface FailureNote {
  caseFile: string | null;      // null when the reason is the criterion file itself
  step: FailStep;
  text: string;                 // "pos-fact.csv: turned back by Model 2."
}

// How the histories of a criterion that needs a fact came out.
// withFact: histories named pos-fact (the record holds the fact). noFact: histories named pos-nofact (no line about it).
export interface FactHistoryCounts {
  withFactPlanted: number;
  withFactCaught: number;
  withFactPossible: number;     // caught, and still reported as a possible finding
  noFactPlanted: number;
  noFactCaught: number;         // caught counts whether it was reported as possible or not
  noFactPossible: number;       // caught, and reported as a possible finding
}

// What the false-flag sample of a quick run found (zero everywhere in any other run).
export interface SampleCounts {
  screenings: number;           // sampled screenings that were planned
  answered: number;             // of these, the ones that got a full answer
  falseFlags: number;           // of these, the ones that ended as a confirmed finding
  turnedBack: number;           // suspected by Model 1 and not confirmed by Model 2
  notCompleted: number;         // a call could not be completed, or the run stopped first
}

export interface LetterLine {
  criterionId: string;
  caseFile: string;
  result: LetterResult;
  checkNotes: string[];
  observations: string[];
  detail: string;
}

export interface LetterCounts {
  needed: number;               // one for each history where a planted finding was caught
  produced: number;
  modelClean: number;
  modelWithNotes: number;
  template: number;
  notProduced: number;
  withoutPlanted: number;       // letters that were produced but show none of the planted lines of a group
}

export interface CallCounts { screen: number; check: number; letter: number }

export interface CriterionScore {
  criterionId: string;
  label: string;
  verdict: Verdict;
  reasons: string[];            // why it failed; empty unless FAIL
  caveats: string[];            // what the run did not cover; set for PASS_PART and NOT_TESTED
  planted: number;              // planted findings in this run
  plantedInSheet: number;       // planted findings in the whole answer sheet
  caught: number;
  catches: Catch[];
  disputed: number;             // planted findings Model 1 suspected and Model 2 turned back
  disputes: Dispute[];          // those findings, each with its history
  misses: Miss[];
  textAttached: boolean;
  textProblems: string[];
  falseFlags: FalseFlag[];      // counted and listed; never a failure
  turnedBack: number;           // suspected by Model 1 where nothing was planted, not confirmed by Model 2
  notCompleted: NotCompleted[];
  notCompletedOnPlanted: number;
  letters: LetterCounts;
  letterLines: LetterLine[];
  calls: CallCounts;            // calls that were made
  seconds: number;
  secondsByStage: CallCounts;
  class: CriterionClass;        // supplies only, or needs a fact
  failures: FailureNote[];      // for a FAIL: which history failed and at which step; empty otherwise
  whyFailed: string;            // the failures in one line of plain words; empty unless FAIL
  factHistories: FactHistoryCounts;
  possibleCaught: number;       // caught findings that were reported as a possible finding
  sample: SampleCounts;         // what the false-flag sample found for this criterion
}

export interface ScoreTotals {
  criteria: number;
  pass: number;
  passPart: number;
  fail: number;
  notTested: number;
  planted: number;
  caught: number;
  disputed: number;             // planted findings Model 1 suspected and Model 2 turned back
  falseFlags: number;
  turnedBack: number;
  notCompleted: number;
  letters: LetterCounts;
  calls: CallCounts;
  seconds: number;
  needsAFact: number;           // criteria in the run that need a fact
  suppliesOnly: number;         // criteria in the run that are decided from the supplies alone
  factHistories: FactHistoryCounts;
  possibleCaught: number;
  falseFlagsByRole: { own: number; clean: number; sample: number; full: number };   // where the false flags were found
  sample: SampleCounts;
}

export interface Unscored { caseFile: string; criterionId: string }

export interface RunScore {
  lettersRun: boolean;
  criteria: CriterionScore[];
  totals: ScoreTotals;
  unscored: Unscored[];         // planted findings whose criterion was not in this run
  ownCriterionOnly: boolean;    // true in a quick run and a wave run: a history was screened against its own criterion only
}

export interface ScoreInput {
  criteria: Criterion[];        // the criteria in this run, in order
  cases: ExpectedCase[];        // the histories in this run, in order
  pairs: PairRecord[];
  lettersRun: boolean;
  sheetCases?: ExpectedCase[];  // every history in the answer sheet; leave out when the run covers it all
  ownCriterionOnly?: boolean;   // true when only the planned criteria were screened on each history (quick run, wave run)
  factLines?: Record<string, string[]>;   // history file -> the IDs of its fact lines, so a reason can say "a fact line"
}

// ---------- the lists a script reads (results.json: passing, not_passing) ----------

// PASS is the only result that passes. Every other criterion is listed as not passing, with its reason.
export type NotPassingResult = 'FAIL' | 'PASS_PART' | 'NOT_TESTED' | 'NOT_DRAFTED' | 'FILES_NOT_USABLE';

export interface NotPassing {
  id: string;
  result: NotPassingResult;
  reason: string;               // every reason in one line
  reasons: string[];            // the same reasons, one by one
  class: CriterionClass | null; // null when the criterion file was not read
  wave: string | null;          // the wave folder it came from; null outside a wave run
}

export interface PassingLists {
  passing: string[];            // criterion IDs
  not_passing: NotPassing[];
}

// ---------- quick runs and wave runs ----------

export type RunMode = 'full' | 'quick' | 'wave';

// The false-flag sample of a quick run: which histories, how many other criteria each.
export interface SampleInfo {
  seed: number;
  oneIn: number;                // one history in this many
  perHistory: number;           // at most this many other criteria for a sampled history
  eligible: number;             // histories that could be sampled
  histories: string[];          // the sampled history files, in run order
  screenings: number;           // sampled screenings planned
}

export type WaveCriterionStatus = 'in_run' | 'left_out' | 'not_drafted' | 'not_usable';

export interface WaveCriterionNote {
  id: string;
  status: WaveCriterionStatus;  // left_out: usable, but not picked by --only
  reason: string;               // "not drafted", "files not usable: (reason)" or empty
  files: Record<string, string>;   // path inside the wave folder -> SHA-256 of the file as it was scored
}

export interface WaveNote {
  name: string;                 // the folder's own name, for example "W101". No path of this computer.
  criteria: WaveCriterionNote[];
}

export interface QuickInfo {
  ownCriterionOnly: true;
  firstTen: string[];           // the criteria clean histories were screened against
  planned: { own: number; clean: number; sample: number };   // screenings planned, by role
  sample: SampleInfo | null;    // null when no sample was taken (a wave run without --quick)
  notScreened: string[];        // histories that no criterion in the run was planned for
}

// ---------- the whole result (results.json) ----------

export interface RunOptions {
  only: string[];               // criterion ids; empty means every active criterion
  cases: string[];              // folder name filters; empty means every folder
  limit: number | null;
  letters: boolean;             // false with --no-letters
  sheet: string | null;         // as typed; null means cases/expected.json
  out: string | null;           // as typed; null means eval/results/<yyyyMMdd-HHmmss>
  check: boolean;               // true with --check: read and report, call no model, write nothing
  quick?: boolean;              // true with --quick; left out otherwise
  noSample?: boolean;           // true with --no-sample: a quick run without the false-flag sample; left out otherwise
  waves?: string[];             // the wave folders, as typed, with --wave; left out otherwise
}

// The options kept in results.json. The results folder is left out: it does not change what ran.
// --check is left out too: a check writes no results. Wave folders are kept by their own names only.
export type RecordedOptions = Omit<RunOptions, 'out' | 'check'>;

export interface EvalResults {
  format: 'clinicalantern-eval-1';
  stage: 'Prototype';
  note: string;                 // says the patients are fictional
  stamp: string;                // yyyyMMdd-HHmmss, local time
  startedAt: string;            // ISO time
  finishedAt: string;
  seconds: number;              // whole run, wall clock
  stoppedEarly: string | null;  // reason, when the run did not finish
  partRun: boolean;
  options: RecordedOptions;
  settings: {
    ollamaBase: string;
    models: LanternConfig['models'];
    think: LanternConfig['think'];
    numCtx: number;
    keepAlive: string;
    maxLinesPerCall: number;
    overlapLines: number;
  };
  sheet: {
    path: string;
    signed_by_clinical_reviewer: null | { name: string; date: string };
    caseCount: number;          // histories in the whole sheet
    warnings: string[];
  };
  activeCriteria: string[];     // ids of every criterion in use, in order (in a wave run: every usable criterion of the wave folders)
  furtherIds?: string[];         // a two-phase full run (G06): the further criteria, so the table can hold its two parts
  criteria: Criterion[];        // the criteria in this run, as loaded (the exact text the models were given)
  cases: CaseRun[];
  pairs: PairRecord[];
  score: RunScore;
  mode: RunMode;                // full: every criterion on every history. quick and wave: own criterion only.
  quick: QuickInfo | null;      // set in a quick run and a wave run
  waves: WaveNote[] | null;     // set in a wave run: every criterion folder of every wave folder
  passing: string[];            // the IDs of the criteria whose result is PASS
  not_passing: NotPassing[];    // every other criterion, with its reason
}
