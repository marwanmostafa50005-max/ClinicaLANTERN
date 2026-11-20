// Hand-made inputs for the scorer's unit tests. No model, no real case file, fictional data only.

import type {
  CheckResult,
  Criterion,
  ExpectedCase,
  ExpectedFinding,
  HistoryLine,
  LetterDraft,
  ScreenResult,
} from '../shared/types.ts';
import type { CaseRun, CheckCall, EvalResults, LetterCall, PairRecord, ScreenCall } from './types.ts';
import { passingLists, scoreRun } from './score.ts';
import type { NotScored } from './score.ts';

export const AT = '2026-11-18T03:00:00.000Z';

export function makeCriterion(id: string, over: Partial<Criterion> = {}): Criterion {
  return {
    id,
    label: id.replace(/-/g, ' '),
    family: 'TEST',
    title: `Test criterion ${id}`,
    statement: `Statement text for ${id}.`,
    statement_origin: 'entrant',
    source: {
      document: 'Test document',
      citation: 'Test citation',
      licence: 'Test licence',
      licence_status: 'proposed',
      credit: `Credit line for ${id}.`,
    },
    plain_summary: 'A made-up criterion for the tests.',
    medicine_groups: [],
    rule_for_models: 'Suspect a finding when the test says so.',
    cannot_be_seen: 'A dispensing history cannot show why a medicine was prescribed.',
    ask_the_gp: 'a review of this medicine',
    urgency: 'routine',
    draft: true,
    signed_by_clinical_reviewer: null,
    ...over,
  };
}

export function expectedCase(
  file: string,
  kind: ExpectedCase['kind'],
  findings: ExpectedFinding[] = [],
  about = 'A made-up history for the tests.',
): ExpectedCase {
  return { file, kind, about, findings };
}

export function planted(criterion: string, ...mustCite: string[][]): ExpectedFinding {
  return { criterion, must_cite: mustCite };
}

// ---------- calls ----------

export function screenResult(lineIds: string[], reason = 'Model 1 reason.', missingFacts: string[] = []): ScreenResult {
  return { lineIds, medicines: [], reason, linesVerified: lineIds.length > 0, missingFacts, model: 'fake-screen', at: AT, seconds: 5 };
}

export function screenClear(seconds = 5): ScreenCall {
  return { status: 'clear', seconds, result: screenResult([], 'Nothing matches.') };
}

export function screenSuspected(lineIds: string[], seconds = 5, reason = 'Model 1 reason.'): ScreenCall {
  return { status: 'suspected', seconds, result: screenResult(lineIds, reason) };
}

export function screenFailed(error = 'Tried twice. The local model server did not answer.', seconds = 4): ScreenCall {
  return { status: 'failed', seconds, error };
}

export function checkResult(confirmed: boolean, lineIds: string[], completed = true): CheckResult {
  let whatMatches = confirmed ? 'Model 2 says these lines match.' : 'Model 2 says the lines do not match.';
  if (!completed) whatMatches = 'The second check did not finish, so this finding is shown without it. Tried twice. The local model server did not answer.';
  return {
    confirmed,
    lineIds,
    whatMatches,
    whatCannotBeSeen: 'Why it was prescribed.',
    completed,
    model: 'fake-check',
    at: AT,
    seconds: 9,
  };
}

export function checkConfirmed(lineIds: string[], seconds = 9): CheckCall {
  return { status: 'confirmed', seconds, findingId: 'F0001', result: checkResult(true, lineIds) };
}

export function checkNotConfirmed(seconds = 9): CheckCall {
  return { status: 'not_confirmed', seconds, findingId: 'F0001', result: checkResult(false, []) };
}

// A check that failed twice. The real pipeline sets "confirmed" to false here. This record says true
// on purpose: the scorer must go by "completed" and never count such a check as confirmed.
export function checkNotCompleted(seconds = 30): CheckCall {
  return {
    status: 'not_completed',
    seconds,
    findingId: 'F0001',
    result: checkResult(true, [], false),
    error: 'The check call failed twice.',
  };
}

// A letter text in the shape the pipeline builds: the fictional line, the criterion text, its credit
// line and the dispensing lines.
export function letterBody(criterion: Criterion, dispensingLines: string[] = []): string {
  return [
    'Example Community Pharmacy (fictional)',
    '',
    'Patient: Fictional patient T-1',
    'Fictional patient. No real person.',
    '',
    'Re: Request for a medicines review',
    '',
    'Dear Doctor,',
    '',
    'Please review this medicine.',
    '',
    'The criterion this is based on',
    `${criterion.label}: ${criterion.statement}`,
    `Source: ${criterion.source.credit}`,
    '',
    'Dispensing lines from our records',
    ...dispensingLines,
    '',
    'Yours sincerely,',
  ].join('\n');
}

export function letterDraft(origin: LetterDraft['origin'], checkNotes: string[] = [], body?: string): LetterDraft {
  return {
    subject: 'Request for a medicine review',
    body: body ?? 'Dear Doctor,\n\nFictional patient. No real person.\n\nPlease review this medicine.\n',
    origin,
    checkNotes,
    model: origin === 'model' ? 'fake-letter' : '',
    at: AT,
    seconds: 2,
  };
}

export function letterByModel(checkNotes: string[] = [], seconds = 2): LetterCall {
  return {
    status: checkNotes.length === 0 ? 'model_clean' : 'model_with_notes',
    seconds,
    findingId: 'F0001',
    draft: letterDraft('model', checkNotes),
    observations: [],
  };
}

export function letterFromTemplate(checkNotes: string[] = ['The date 2026-01-01 is not in the finding.'], seconds = 6): LetterCall {
  return { status: 'template', seconds, findingId: 'F0001', draft: letterDraft('template', checkNotes), observations: [] };
}

export function letterNotProduced(error = 'The letter call gave no letter text.', seconds = 1): LetterCall {
  return { status: 'not_produced', seconds, findingId: 'F0001', error };
}

export function pair(
  caseFile: string,
  criterionId: string,
  screen: ScreenCall,
  check?: CheckCall,
  letter?: LetterCall,
): PairRecord {
  const record: PairRecord = { caseFile, criterionId, screen };
  if (check) record.check = check;
  if (letter) record.letter = letter;
  return record;
}

// ---------- one hand-made run, used by the score tests and the report tests ----------
//   STOPP-A1: both planted findings caught (one letter by the model, one from the template),
//             one false flag on its own near miss, one suspected finding turned back by Model 2.
//   STOPP-B2: one catch, one miss, and one failed call on a clean history.
export const SCENARIO_CASES: ExpectedCase[] = [
  expectedCase('STOPP-A1/pos-brand.csv', 'positive', [planted('STOPP-A1', ['L003'], ['L007', 'L008'])], 'Brand name only: Examplex with Samplol.'),
  expectedCase('STOPP-A1/pos-buried.csv', 'positive', [planted('STOPP-A1', ['L010'])], 'The pair is buried in the middle.'),
  expectedCase('STOPP-A1/near-miss.csv', 'near_miss', [], 'The second medicine stopped a year before.'),
  expectedCase('STOPP-B2/pos-brand.csv', 'positive', [planted('STOPP-B2', ['L002'])], 'Brand name only: Testazol.'),
  expectedCase('STOPP-B2/pos-buried.csv', 'positive', [planted('STOPP-B2', ['L011'])], 'Buried at line 11.'),
  expectedCase('_clean/clean-1.csv', 'clean', [], 'Nothing to find.'),
];

export const SCENARIO_PAIRS: PairRecord[] = [
  // STOPP-A1
  pair('STOPP-A1/pos-brand.csv', 'STOPP-A1', screenSuspected(['L003', 'L007'], 12), checkConfirmed(['L003', 'L007'], 17), letterByModel([], 2)),
  pair('STOPP-A1/pos-buried.csv', 'STOPP-A1', screenSuspected(['L010'], 6), checkConfirmed(['L010'], 9), letterFromTemplate(undefined, 6)),
  pair('STOPP-A1/near-miss.csv', 'STOPP-A1', screenSuspected(['L004', 'L009'], 6, 'Both medicines appear.'), checkConfirmed(['L004'], 9)),
  pair('STOPP-B2/pos-brand.csv', 'STOPP-A1', screenClear(5)),
  pair('STOPP-B2/pos-buried.csv', 'STOPP-A1', screenClear(5)),
  pair('_clean/clean-1.csv', 'STOPP-A1', screenSuspected(['L001'], 5), checkNotConfirmed(9)),
  // STOPP-B2
  pair('STOPP-A1/pos-brand.csv', 'STOPP-B2', screenClear(5)),
  pair('STOPP-A1/pos-buried.csv', 'STOPP-B2', screenClear(5)),
  pair('STOPP-A1/near-miss.csv', 'STOPP-B2', screenClear(5)),
  pair('STOPP-B2/pos-brand.csv', 'STOPP-B2', screenSuspected(['L002'], 5), checkConfirmed(['L002'], 9), letterByModel([], 2)),
  pair('STOPP-B2/pos-buried.csv', 'STOPP-B2', screenClear(5)),
  pair('_clean/clean-1.csv', 'STOPP-B2', screenFailed('Tried twice. The local model server answered with error 500.', 21)),
];

// ---------- a whole result, for the report tests ----------

export function historyLines(count: number, text: (n: number) => string = (n) => `2026-0${(n % 9) + 1}-15 | Example medicine ${n} 10 mg tablet | qty 30`): HistoryLine[] {
  return Array.from({ length: count }, (_, i) => ({ id: `L${String(i + 1).padStart(3, '0')}`, text: text(i + 1) }));
}

export function caseRun(expected: ExpectedCase, index: number, lines: HistoryLine[] = historyLines(12)): CaseRun {
  const parts = expected.file.split('/');
  return {
    caseId: `C${String(index + 1).padStart(4, '0')}`,
    file: expected.file,
    folder: parts.slice(0, -1).join('/'),
    kind: expected.kind,
    about: expected.about,
    findings: expected.findings,
    patient: { label: 'Fictional patient T-1', age: 80, sex: 'F' },
    lines,
    problems: [],
    cannotAssess: null,
  };
}

export interface ResultParts {
  criteria: Criterion[];
  cases: ExpectedCase[];
  pairs: PairRecord[];
  lettersRun?: boolean;
  sheetCases?: ExpectedCase[];
  ownCriterionOnly?: boolean;                   // a quick run or a wave run
  factLines?: Record<string, string[]>;
  notScored?: NotScored[];                      // a wave run: not drafted, or files not usable
  over?: Partial<EvalResults>;
}

export function makeResults(parts: ResultParts): EvalResults {
  const lettersRun = parts.lettersRun ?? true;
  const sheetCases = parts.sheetCases ?? parts.cases;
  const ownCriterionOnly = parts.ownCriterionOnly ?? false;
  const score = scoreRun({ criteria: parts.criteria, cases: parts.cases, pairs: parts.pairs, lettersRun, sheetCases, ownCriterionOnly, factLines: parts.factLines });
  const lists = passingLists(score, parts.notScored ?? []);
  const base: EvalResults = {
    format: 'clinicalantern-eval-1',
    stage: 'Prototype',
    note: 'Fictional patients only. No real person is in these histories. One measured run on one computer. It is not a validation.',
    stamp: '20261118-140510',
    startedAt: '2026-11-18T03:05:10.000Z',
    finishedAt: '2026-11-18T03:21:44.000Z',
    seconds: 994,
    stoppedEarly: null,
    partRun: false,
    options: { only: [], cases: [], limit: null, letters: lettersRun, sheet: null },
    settings: {
      ollamaBase: 'http://127.0.0.1:27435',
      models: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
      think: { screen: false, check: false, letter: false },
      numCtx: 16384,
      keepAlive: '20m',
      maxLinesPerCall: 150,
      overlapLines: 30,
    },
    sheet: { path: 'cases/expected.json', signed_by_clinical_reviewer: null, caseCount: sheetCases.length, warnings: [] },
    activeCriteria: parts.criteria.map((c) => c.id),
    criteria: parts.criteria,
    cases: parts.cases.map((c, i) => caseRun(c, i)),
    pairs: parts.pairs,
    score,
    mode: 'full',
    quick: null,
    waves: null,
    passing: lists.passing,
    not_passing: lists.not_passing,
  };
  return { ...base, ...parts.over };
}

// ---------- facts and possible findings (docs/SPEC.md section 6a) ----------

// A criterion that needs a fact the supplies do not hold.
export function makeFactCriterion(id: string, what = 'Heart failure', over: Partial<Criterion> = {}): Criterion {
  return makeCriterion(id, { needs_facts: [{ kind: 'condition', what, meets: `${what} is recorded as a condition` }], ...over });
}

// Model 1 suspects a possible finding: the medicines match and the record does not show the fact.
export function screenPossible(lineIds: string[], missingFacts: string[] = ['Heart failure'], seconds = 5): ScreenCall {
  return { status: 'suspected', seconds, result: screenResult(lineIds, 'The medicines match. The record holds no line about the fact.', missingFacts) };
}
