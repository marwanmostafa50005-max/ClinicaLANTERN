// The scoring rules for a test run. Pure functions only: no files, no clock, no model.
//
// The founder's rule (docs/SPEC.md section 2). A criterion passes when, on the test histories:
//   1. no planted finding is missed (it reaches the bell),
//   2. the finding is shown with its criterion's source text, and
//   3. a GP letter is produced for it.
// A false flag is counted and listed. It is never a failure.
// A call that could not be completed is never a clean result.

import type {
  CheckResult,
  Criterion,
  ExpectedCase,
  ExpectedFinding,
  ExpectedSheet,
  LetterDraft,
  NeededFact,
} from '../shared/types.ts';
import { findingLines } from '../shared/lines.ts';
import { listFacts, tidyFacts } from '../shared/facts.ts';
import type {
  CallCounts,
  Catch,
  CheckCall,
  Dispute,
  CriterionClass,
  CriterionScore,
  FactHistoryCounts,
  FailStep,
  FailureNote,
  FalseFlag,
  LetterCall,
  LetterCounts,
  LetterLine,
  LetterResult,
  Miss,
  NotCompleted,
  NotPassing,
  PairRecord,
  PassingLists,
  PlantedOutcome,
  RunScore,
  SampleCounts,
  ScoreInput,
  ScoreTotals,
  ScreenCall,
  Unscored,
  Verdict,
} from './types.ts';

// ---------- small helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// One line of text, cut to a sensible length. Model text and error text can be long.
export function oneLine(text: unknown, max = 300): string {
  const flat = (typeof text === 'string' ? text : String(text ?? '')).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

function withError(sentence: string, error: string | undefined): string {
  return hasText(error) ? `${sentence} Error: ${oneLine(error)}` : sentence;
}

// ---------- lines ----------

export function normaliseLineId(id: string): string {
  return String(id).trim().toUpperCase();
}

// True when Model 2 gave an answer of its own (yes, no, or a no that names lines as proof).
function checkAnswered(pair: PairRecord | undefined): boolean {
  const status = pair?.check?.status;
  return status === 'confirmed' || status === 'not_confirmed' || status === 'unclear';
}

// The lines cited by Model 1 and by Model 2 for one criterion on one history.
// A check that was not completed cited nothing: the pipeline fills its record with the lines
// from the first step, and those are not Model 2's own.
// "all" is what the app shows under the bell and prints in the letter. It comes from the one rule
// the page and the letter use too (shared/lines.ts), so the scorer judges what the pharmacist sees.
export function linesCited(pair: PairRecord | undefined): { byScreen: string[]; byCheck: string[]; all: string[] } {
  const byScreen = unique(stringList(pair?.screen.result?.lineIds).map(normaliseLineId));
  const byCheck = checkAnswered(pair) ? unique(stringList(pair?.check?.result?.lineIds).map(normaliseLineId)) : [];
  const shown = findingLines({
    screen: { lineIds: byScreen, medicines: [], reason: '', linesVerified: byScreen.length > 0, missingFacts: [], model: '', at: '', seconds: 0 },
    check: checkAnswered(pair)
      ? { confirmed: true, lineIds: byCheck, whatMatches: '', whatCannotBeSeen: '', completed: true, model: '', at: '', seconds: 0 }
      : undefined,
  });
  return { byScreen, byCheck, all: shown.all };
}

// The must_cite groups that have no cited line. An empty group can never be met.
export function groupsNotCited(mustCite: string[][], cited: string[]): string[][] {
  const have = new Set(cited.map(normaliseLineId));
  return mustCite.filter((group) => !group.some((id) => have.has(normaliseLineId(id))));
}

// ---------- facts and possible findings (docs/SPEC.md section 6a) ----------

// The facts a criterion needs that a dispensing history does not hold, as its file lists them
// under needs_facts. A file without the list is a criterion decided from the supplies alone.
export function factsNeeded(criterion: Criterion): NeededFact[] {
  const raw: unknown = criterion.needs_facts;
  return Array.isArray(raw) ? raw.filter((item): item is NeededFact => isRecord(item)) : [];
}

export function criterionClass(criterion: Criterion): CriterionClass {
  return factsNeeded(criterion).length > 0 ? 'needs_a_fact' : 'supplies_only';
}

export function classLabel(kind: CriterionClass): string {
  return kind === 'needs_a_fact' ? 'needs a fact' : 'supplies only';
}

// The facts Model 1 said the record does not show (ScreenResult.missingFacts). Empty when nothing
// is missing. The list is tidied by the one shared rule, so the scorer and the app read it alike.
export function missingFactsOf(screenResult: unknown): string[] {
  return tidyFacts(isRecord(screenResult) ? screenResult.missingFacts : undefined);
}

// A possible finding: the medicine pattern is there, and the record holds no line about a fact the
// criterion needs. The app shows it under the bell as "Possible finding", and the letter asks the
// doctor to confirm the fact.
export function isPossible(pair: PairRecord | undefined): boolean {
  return pair?.screen.status === 'suspected' && missingFactsOf(pair.screen.result).length > 0;
}

// What a test history is for, going by its name (docs/SPEC.md section 6a).
// with_fact: "pos-fact": the record holds the fact, so the finding must be confirmed and cite the fact line.
// no_fact: "pos-nofact": the record holds no line about the fact, so it must reach the bell as a possible finding.
export type HistoryKind = 'with_fact' | 'no_fact' | 'other';

export function historyKind(file: string): HistoryKind {
  const name = (file.split(/[\\/]+/).pop() ?? '').toLowerCase();
  if (name.startsWith('pos-nofact')) return 'no_fact';
  if (name.startsWith('pos-fact')) return 'with_fact';
  return 'other';
}

// ---------- turning pipeline answers into call records ----------

// A screen answer that cannot be read is a failed call. It is never "nothing suspected".
export function screenCallFrom(answer: unknown, secs: number): ScreenCall {
  if (!isRecord(answer)) {
    return { status: 'failed', seconds: secs, error: 'The screen call gave no answer.' };
  }
  if (answer.ok === false) {
    return { status: 'failed', seconds: secs, error: hasText(answer.error) ? answer.error : 'The screen call failed.' };
  }
  if (answer.ok !== true || typeof answer.suspected !== 'boolean' || !isRecord(answer.result)) {
    return { status: 'failed', seconds: secs, error: 'The screen answer could not be read.' };
  }
  return {
    status: answer.suspected ? 'suspected' : 'clear',
    seconds: secs,
    result: answer.result as unknown as ScreenCall['result'],
  };
}

// completed:false means the check call failed twice. That is never "confirmed" for the score.
export function checkCallFrom(answer: unknown, secs: number): CheckCall {
  if (!isRecord(answer) || typeof answer.confirmed !== 'boolean') {
    return { status: 'not_completed', seconds: secs, error: 'The check answer could not be read.' };
  }
  const result = answer as unknown as CheckResult;
  if (answer.completed !== true) {
    // The pipeline puts the reason in whatMatches when the call failed twice.
    const why = hasText(answer.whatMatches) ? oneLine(answer.whatMatches) : 'The check call failed twice.';
    return { status: 'not_completed', seconds: secs, result, error: why };
  }
  if (!answer.confirmed && answer.unclear === true) return { status: 'unclear', seconds: secs, result };
  return { status: answer.confirmed ? 'confirmed' : 'not_confirmed', seconds: secs, result };
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// One must_cite group of a planted finding, with the text of its lines in the history.
export interface PlantedGroup {
  ids: string[];
  texts: string[];
}

// Every letter is built around the criterion's source text (docs/SPEC.md section 7.3).
// A text without it is not a letter about the finding, so it is not counted as one.
export function letterHasCriterionText(body: string, criterion: Criterion): boolean {
  return !hasText(criterion.statement) || squash(body).includes(squash(criterion.statement));
}

// The planted must_cite groups of which the letter shows no line. A letter shows a line when it
// prints the text of the line. The founder counts "not generating a proper GP letter with the
// finding" as a failure, so a letter that shows none of the planted lines of a group is a FAIL reason.
export function plantedNotShown(draft: LetterDraft, plantedGroups: PlantedGroup[]): PlantedGroup[] {
  const body = squash(typeof draft.body === 'string' ? draft.body : '');
  return plantedGroups.filter((group) => {
    const texts = group.texts.map(squash).filter((t) => t !== '');
    return texts.length > 0 && !texts.some((t) => body.includes(t));
  });
}

export function plantedNotShownWords(ids: string[]): string {
  return ids.length === 1
    ? `The letter does not show planted line ${ids[0]}.`
    : `The letter shows none of these planted lines: ${ids.join(', ')}.`;
}

// Other things seen in a letter. These are notes for the reader. They never change PASS or FAIL.
// possible: the letter is for a possible finding, so it should ask the doctor to confirm the fact
// the record does not show (docs/SPEC.md section 6a).
export function letterObservations(draft: LetterDraft, criterion: Criterion, possible = false): string[] {
  const notes: string[] = [];
  const body = squash(typeof draft.body === 'string' ? draft.body : '');
  if (!hasText(draft.subject)) notes.push('The letter has no subject line.');
  if (!/fictional/i.test(body)) notes.push('The letter does not say the patient is fictional.');
  if (hasText(criterion.source?.credit) && !body.includes(squash(criterion.source.credit))) {
    notes.push('The letter does not include the credit line word for word.');
  }
  if (possible && !/\bconfirm/i.test(body)) {
    notes.push('The letter is for a possible finding, but it does not ask the doctor to confirm the fact.');
  }
  return notes;
}

export function letterCallFrom(
  answer: unknown,
  secs: number,
  criterion: Criterion,
  plantedGroups: PlantedGroup[] = [],
  possible = false,
): LetterCall {
  if (!isRecord(answer) || !hasText(answer.body)) {
    return { status: 'not_produced', seconds: secs, error: 'The letter call gave no letter text.' };
  }
  const draft = answer as unknown as LetterDraft;
  if (draft.origin !== 'model' && draft.origin !== 'template') {
    return {
      status: 'not_produced',
      seconds: secs,
      draft,
      error: 'The letter does not say whether the model or the template wrote it.',
    };
  }
  if (!letterHasCriterionText(draft.body, criterion)) {
    return {
      status: 'not_produced',
      seconds: secs,
      draft,
      error: 'The text that came back does not include the criterion text, so it is not counted as a letter.',
    };
  }
  let status: LetterResult = 'template';
  if (draft.origin === 'model') status = stringList(draft.checkNotes).length === 0 ? 'model_clean' : 'model_with_notes';
  const call: LetterCall = {
    status,
    seconds: secs,
    draft,
    observations: letterObservations(draft, criterion, possible),
    plantedNotShown: plantedNotShown(draft, plantedGroups).map((group) => group.ids),
  };
  // The template because the model call failed is not the same as the template because a draft failed its checks.
  if (draft.origin === 'template' && (draft.templateReason === 'no_answer' || draft.templateReason === 'error')) {
    call.modelDidNotAnswer = true;
  }
  return call;
}

// ---------- the three parts of the rule ----------

// Part 2: the criterion file has a statement and a credit line to show with the finding.
export function criterionText(criterion: Criterion): { attached: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!hasText(criterion.statement)) problems.push('The criterion file has no statement text.');
  if (!hasText(criterion.source?.credit)) problems.push('The criterion file has no credit line.');
  return { attached: problems.length === 0, problems };
}

// True when the finding reaches the bell with an answer from Model 2: it confirmed, or its "no" named lines as proof.
export function isConfirmed(pair: PairRecord | undefined): boolean {
  return pair?.screen.status === 'suspected' && (pair.check?.status === 'confirmed' || pair.check?.status === 'unclear');
}

// Part 1: was this planted finding caught?
// Caught means Model 2 confirmed a finding for the criterion on the history (or gave an unclear
// answer, which the app also shows under the bell), and for each must_cite group at least one of
// its lines is among the lines the app shows for the finding: those of Model 2 and those of Model 1.
export function judgePlanted(expected: ExpectedFinding, pair: PairRecord | undefined): PlantedOutcome {
  const cited = linesCited(pair);
  const missingGroups = groupsNotCited(expected.must_cite, cited.all);
  const miss = (why: PlantedOutcome['why'], detail: string): PlantedOutcome => ({
    caught: false,
    why,
    detail,
    missingGroups,
    citedByScreen: cited.byScreen,
    citedByCheck: cited.byCheck,
  });

  if (!pair) return miss('not_run', 'This criterion was not run on this history.');

  switch (pair.screen.status) {
    case 'not_read':
      return miss('history_not_read', withError('The history could not be read, so it was not screened.', pair.screen.error));
    case 'not_run':
      return miss('not_run', 'The run stopped before Model 1 screened it.');
    case 'failed':
      return miss('could_not_be_screened', withError('Model 1 could not screen it.', pair.screen.error));
    case 'clear':
      return miss('not_suspected', 'Model 1 did not suspect it.');
    case 'suspected':
      break;
    default:
      return miss('not_run', 'The screen record could not be read.');
  }

  const check = pair.check;
  if (!check) return miss('not_run', 'Model 1 suspected it. No second check was recorded.');
  switch (check.status) {
    case 'not_run':
      return miss('not_run', 'Model 1 suspected it. The run stopped before Model 2 checked it.');
    case 'not_completed':
      return miss('check_not_completed', withError('Model 1 suspected it. The second check was not completed.', check.error));
    case 'not_confirmed':
      return {
        caught: false,
        disputed: true,
        why: 'not_confirmed',
        detail: 'Disputed. Model 1 suspected it and Model 2 turned it back. It is shown to the pharmacist. It is not a failure.',
        missingGroups,
        citedByScreen: cited.byScreen,
        citedByCheck: cited.byCheck,
      };
    case 'confirmed':
    case 'unclear':
      break;
    default:
      return miss('not_run', 'The check record could not be read.');
  }

  const unclear = check.status === 'unclear';
  if (missingGroups.length > 0) {
    return miss(
      'planted_lines_not_cited',
      unclear
        ? 'The finding reached the bell with an unclear second check, but the planted lines were not cited.'
        : 'Model 2 confirmed a finding, but the planted lines were not cited.',
    );
  }
  const caught: PlantedOutcome = {
    caught: true,
    unclear,
    detail: unclear
      ? 'Caught. Model 2 answered "not confirmed" but named lines as proof, so the app shows the finding marked "second check unclear". The planted lines were cited.'
      : 'Caught. Model 2 confirmed it and the planted lines were cited.',
    missingGroups: [],
    citedByScreen: cited.byScreen,
    citedByCheck: cited.byCheck,
  };
  // A possible finding that reaches the bell is caught. The score records that it was a possible one.
  const missingFacts = missingFactsOf(pair.screen.result);
  if (missingFacts.length > 0) {
    caught.possible = true;
    caught.missingFacts = missingFacts;
    caught.detail += ` It was reported as a possible finding. The record does not show: ${factsText(missingFacts)}.`;
  }
  return caught;
}

// Several facts in one line, without a full stop at the end (the sentence around it adds one).
// Written the way the app writes them: "eGFR", "eGFR and heart failure".
export function factsText(facts: string[]): string {
  return oneLine(listFacts(tidyFacts(facts)), 240);
}

export function countPlanted(cases: ExpectedCase[], criterionId: string): number {
  let n = 0;
  for (const c of cases) for (const f of c.findings) if (f.criterion === criterionId) n++;
  return n;
}

function folderOf(file: string): string {
  const parts = file.split(/[\\/]+/).filter((p) => p !== '');
  return parts.slice(0, -1).join('/');
}

// ---------- why a criterion failed, in plain words ----------

// The name a history goes by in a reason: its file name inside the criterion's own folder, its
// path when it sits in another folder.
function shortName(caseFile: string, criterionId: string): string {
  const parts = caseFile.split(/[\\/]+/).filter((p) => p !== '');
  return parts.length === 2 && parts[0] === criterionId ? parts[1] : caseFile;
}

function someIds(ids: string[], max = 6): string {
  return ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`;
}

// "the fact line L001 was not cited", "none of the planted lines L004, L008 was cited".
function notCitedWords(groups: string[][], factLines: Set<string>): string {
  const parts = groups.map((group) => {
    const ids = group.map(normaliseLineId);
    if (ids.length === 0) return 'the answer sheet names no line for one group';
    const kind = ids.every((id) => factLines.has(id)) ? 'fact' : 'planted';
    return ids.length === 1 ? `the ${kind} line ${ids[0]} was not cited` : `none of the ${kind} lines ${someIds(ids)} was cited`;
  });
  return parts.length > 0 ? parts.join(', and ') : 'the planted lines were not cited';
}

// The step at which a planted finding was lost.
export function missFailure(name: string, caseFile: string, outcome: PlantedOutcome, factLines: Set<string> = new Set()): FailureNote {
  const note = (step: FailStep, words: string): FailureNote => ({ caseFile, step, text: `${name}: ${words}.` });
  switch (outcome.why) {
    case 'not_suspected':
      return note('not_suspected', 'not suspected by Model 1');
    case 'not_confirmed':
      return note('turned_back', 'turned back by Model 2');
    case 'could_not_be_screened':
      return note('call_not_completed', 'call could not be completed (Model 1, screen)');
    case 'check_not_completed':
      return note('call_not_completed', 'call could not be completed (Model 2, double-check)');
    case 'history_not_read':
      return note('history_not_read', 'the history could not be read');
    case 'planted_lines_not_cited':
      return note('lines_not_cited', `it reached the bell, but ${notCitedWords(outcome.missingGroups, factLines)}`);
    default:
      return note('not_run', 'not run. The run stopped first, or the criterion was not screened on this history');
  }
}

export interface ScoreOptions {
  ownCriterionOnly?: boolean;                     // a quick run or a wave run: only the planned criteria were screened on a history
  factLines?: (caseFile: string) => string[];     // the fact lines of a history, so a reason can say "the fact line"
}

function emptyFactCounts(): FactHistoryCounts {
  return { withFactPlanted: 0, withFactCaught: 0, withFactPossible: 0, noFactPlanted: 0, noFactCaught: 0, noFactPossible: 0 };
}

function emptySample(): SampleCounts {
  return { screenings: 0, answered: 0, falseFlags: 0, turnedBack: 0, notCompleted: 0 };
}

// ---------- one criterion ----------

export function scoreCriterion(
  criterion: Criterion,
  cases: ExpectedCase[],
  pairFor: (caseFile: string) => PairRecord | undefined,
  lettersRun: boolean,
  plantedInSheet?: number,
  options: ScoreOptions = {},
): CriterionScore {
  const id = criterion.id;
  const text = criterionText(criterion);
  const catches: Catch[] = [];
  const disputes: Dispute[] = [];
  const misses: Miss[] = [];
  const falseFlags: FalseFlag[] = [];
  const notCompleted: NotCompleted[] = [];
  const letterLines: LetterLine[] = [];
  const failures: FailureNote[] = [];
  const letters: LetterCounts = { needed: 0, produced: 0, modelClean: 0, modelWithNotes: 0, template: 0, notProduced: 0, withoutPlanted: 0 };
  const calls: CallCounts = { screen: 0, check: 0, letter: 0 };
  const secs: CallCounts = { screen: 0, check: 0, letter: 0 };
  const factHistories = emptyFactCounts();
  const sample = emptySample();
  let planted = 0;
  let turnedBack = 0;

  for (const c of cases) {
    const pair = pairFor(c.file);
    const expected = c.findings.filter((f) => f.criterion === id);
    const isPlanted = expected.length > 0;
    // A quick run and a wave run screen a history against the criteria planned for it. A history
    // this criterion was never meant to be screened on is not a call that failed.
    if (!pair && !isPlanted && options.ownCriterionOnly) continue;
    const cited = linesCited(pair);
    const name = shortName(c.file, id);
    const incomplete = (stage: NotCompleted['stage'], detail: string): void => {
      const item: NotCompleted = { criterionId: id, caseFile: c.file, stage, planted: isPlanted, detail };
      if (pair?.role) item.role = pair.role;
      notCompleted.push(item);
    };

    // Calls made, seconds spent, and calls that could not be completed.
    if (!pair) {
      incomplete('screen', 'This criterion was not run on this history.');
    } else {
      secs.screen += seconds(pair.screen.seconds);
      switch (pair.screen.status) {
        case 'clear':
          calls.screen++;
          break;
        case 'failed':
          calls.screen++;
          incomplete('screen', withError('Model 1 could not screen it.', pair.screen.error));
          break;
        case 'not_read':
          incomplete('import', withError('The history could not be read, so it was not screened.', pair.screen.error));
          break;
        case 'not_run':
          incomplete('screen', 'The run stopped before Model 1 screened it.');
          break;
        case 'suspected': {
          calls.screen++;
          const check = pair.check;
          if (!check) {
            incomplete('check', 'Model 1 suspected a finding. No second check was recorded.');
          } else {
            secs.check += seconds(check.seconds);
            if (check.status === 'not_run') {
              incomplete('check', 'The run stopped before Model 2 checked it.');
            } else {
              calls.check++;
              if (check.status === 'not_completed') {
                incomplete(
                  'check',
                  withError('The second check was not completed. In the app this finding would still be shown under the bell.', check.error),
                );
              }
            }
          }
          break;
        }
        default:
          incomplete('screen', 'The screen record could not be read.');
      }
      if (pair.letter) {
        secs.letter += seconds(pair.letter.seconds);
        if (pair.letter.status !== 'not_run') calls.letter++;
      }
    }

    // The false-flag sample of a quick run: what came of the screenings that were only made to look for false flags.
    if (pair?.role === 'sample' && !isPlanted) {
      sample.screenings++;
      const checked = pair.check?.status;
      if (pair.screen.status === 'clear') sample.answered++;
      else if (pair.screen.status === 'suspected' && (checked === 'confirmed' || checked === 'unclear')) {
        sample.answered++;
        sample.falseFlags++;
      } else if (pair.screen.status === 'suspected' && checked === 'not_confirmed') {
        sample.answered++;
        sample.turnedBack++;
      } else sample.notCompleted++;
    }

    if (isPlanted) {
      let caughtHere = false;
      const kind = historyKind(c.file);
      const factLines = new Set((options.factLines?.(c.file) ?? []).map(normaliseLineId));
      for (const e of expected) {
        planted++;
        if (kind === 'with_fact') factHistories.withFactPlanted++;
        if (kind === 'no_fact') factHistories.noFactPlanted++;
        const outcome = judgePlanted(e, pair);
        if (outcome.caught) {
          caughtHere = true;
          const possible = outcome.possible === true;
          // A history with no line about the fact is caught when the finding is confirmed, possible or not.
          if (kind === 'with_fact') {
            factHistories.withFactCaught++;
            if (possible) factHistories.withFactPossible++;
          }
          if (kind === 'no_fact') {
            factHistories.noFactCaught++;
            if (possible) factHistories.noFactPossible++;
          }
          catches.push({
            criterionId: id,
            caseFile: c.file,
            mustCite: e.must_cite,
            citedByScreen: outcome.citedByScreen,
            citedByCheck: outcome.citedByCheck,
            unclear: outcome.unclear === true,
            possible,
            missingFacts: outcome.missingFacts ?? [],
          });
        } else if (outcome.disputed) {
          disputes.push({
            criterionId: id,
            caseFile: c.file,
            detail: outcome.detail,
            citedByScreen: outcome.citedByScreen,
            citedByCheck: outcome.citedByCheck,
          });
        } else {
          misses.push({
            criterionId: id,
            caseFile: c.file,
            why: outcome.why ?? 'not_run',
            detail: outcome.detail,
            mustCite: e.must_cite,
            missingGroups: outcome.missingGroups,
            citedByScreen: outcome.citedByScreen,
            citedByCheck: outcome.citedByCheck,
          });
          failures.push(missFailure(name, c.file, outcome, factLines));
        }
      }

      // Part 3: one letter for each history where a planted finding was caught.
      if (caughtHere) {
        letters.needed++;
        if (lettersRun) {
          const letter = pair?.letter;
          const result: LetterResult = letter?.status ?? 'not_run';
          let detail: string;
          switch (result) {
            case 'model_clean':
              letters.produced++;
              letters.modelClean++;
              detail = 'Written by the model. The letter checks found nothing.';
              break;
            case 'model_with_notes':
              letters.produced++;
              letters.modelWithNotes++;
              detail = 'Written by the model. The letter checks left notes, shown below.';
              break;
            case 'template':
              letters.produced++;
              letters.template++;
              if (letter?.modelDidNotAnswer) {
                // A letter is there, but the model call failed. That is a call that could not be completed.
                detail = 'Built from the template because Model 3 did not answer. No draft was written or checked.';
                incomplete('letter', 'Model 3 did not answer, so the letter was built from the template.');
                failures.push({
                  caseFile: c.file,
                  step: 'call_not_completed',
                  text: `${name}: call could not be completed (Model 3, letter). The letter was built from the template.`,
                });
              } else {
                detail = 'Built from the template, not written by the model. The check notes say why.';
              }
              break;
            case 'not_produced':
              letters.notProduced++;
              detail = withError('No letter was produced.', letter?.error);
              incomplete('letter', detail);
              failures.push({ caseFile: c.file, step: 'letter_missing', text: `${name}: letter missing.` });
              break;
            default:
              letters.notProduced++;
              detail = letter ? 'The run stopped before Model 3 wrote the letter.' : 'No letter was recorded for this caught finding.';
              incomplete('letter', detail);
              failures.push({
                caseFile: c.file,
                step: 'letter_missing',
                text: letter ? `${name}: letter missing. The run stopped before Model 3 wrote it.` : `${name}: letter missing.`,
              });
          }
          // A letter that was produced must show the planted lines. If it shows none of a group, the
          // doctor is not shown the finding, and that is a failure.
          const notShown = result === 'not_produced' || result === 'not_run' ? [] : (letter?.plantedNotShown ?? []);
          if (notShown.length > 0) {
            letters.withoutPlanted++;
            detail += ` ${notShown.map(plantedNotShownWords).join(' ')}`;
            failures.push({
              caseFile: c.file,
              step: 'letter_without_lines',
              text: `${name}: the letter does not show the planted lines (${someIds([...new Set(notShown.flat())])}).`,
            });
          }
          letterLines.push({
            criterionId: id,
            caseFile: c.file,
            result,
            checkNotes: stringList(letter?.draft?.checkNotes),
            observations: stringList(letter?.observations),
            detail,
          });
        }
      }
    } else if (pair) {
      // Nothing was planted for this criterion on this history.
      if (isConfirmed(pair)) {
        // A confirmed finding where nothing was planted, a near miss included, is a false flag.
        // It is counted and listed. It is never a failure.
        const flag: FalseFlag = {
          criterionId: id,
          caseFile: c.file,
          caseKind: c.kind,
          unclear: pair.check?.status === 'unclear',
          ownFolder: folderOf(c.file) === id,
          citedByScreen: cited.byScreen,
          citedByCheck: cited.byCheck,
          screenReason: oneLine(pair.screen.result?.reason ?? ''),
          checkWhatMatches: oneLine(pair.check?.result?.whatMatches ?? ''),
          possible: isPossible(pair),
        };
        if (pair.role) flag.role = pair.role;
        falseFlags.push(flag);
      } else if (pair.screen.status === 'suspected' && pair.check?.status === 'not_confirmed') {
        turnedBack++;
      }
    }
  }

  const caught = catches.length;
  const inSheet = Math.max(planted, plantedInSheet ?? planted);
  const notCompletedOnPlanted = notCompleted.filter((n) => n.planted).length;

  const reasons: string[] = [];
  if (misses.length > 0) {
    reasons.push(`Missed ${misses.length} of ${count(planted, 'planted finding', 'planted findings')}.`);
  }
  if (!text.attached) {
    reasons.push(...text.problems);
    for (const problem of text.problems) failures.push({ caseFile: null, step: 'criterion_text', text: problem });
  }
  if (notCompletedOnPlanted > 0) {
    reasons.push(
      `${count(notCompletedOnPlanted, 'call', 'calls')} could not be completed on a history with a planted finding. A failed call is never a clean result.`,
    );
  }
  if (lettersRun && letters.notProduced > 0) {
    reasons.push(`No letter was produced for ${count(letters.notProduced, 'caught finding', 'caught findings')}.`);
  }
  if (lettersRun && letters.withoutPlanted > 0) {
    reasons.push(
      `${count(letters.withoutPlanted, 'letter does', 'letters do')} not show the planted lines. A letter that does not show the finding is not a proper letter.`,
    );
  }

  const caveats: string[] = [];
  if (planted === 0) {
    caveats.push('No planted finding for this criterion was in this run.');
  } else {
    // A disputed finding has no letter in a scored run: no pharmacist has accepted it.
    // That is not a part run. Letters were skipped only when a caught finding needed one.
    if (!lettersRun && catches.length > 0) caveats.push('Letters were not run.');
    if (planted < inSheet) {
      caveats.push(`Only ${planted} of the ${inSheet} planted findings in the answer sheet were in this run.`);
    }
  }

  let verdict: Verdict;
  if (reasons.length > 0) verdict = 'FAIL';
  else if (planted === 0) verdict = 'NOT_TESTED';
  else verdict = caveats.length > 0 ? 'PASS_PART' : 'PASS';

  return {
    criterionId: id,
    label: hasText(criterion.label) ? criterion.label : id,
    verdict,
    reasons,
    caveats,
    planted,
    plantedInSheet: inSheet,
    caught,
    catches,
    disputed: disputes.length,
    disputes,
    misses,
    textAttached: text.attached,
    textProblems: text.problems,
    falseFlags,
    turnedBack,
    notCompleted,
    notCompletedOnPlanted,
    letters,
    letterLines,
    calls,
    seconds: round1(secs.screen + secs.check + secs.letter),
    secondsByStage: { screen: round1(secs.screen), check: round1(secs.check), letter: round1(secs.letter) },
    class: criterionClass(criterion),
    failures: verdict === 'FAIL' ? failures : [],
    whyFailed: verdict === 'FAIL' ? failures.map((f) => f.text).join(' ') : '',
    factHistories,
    possibleCaught: catches.filter((c) => c.possible).length,
    sample,
  };
}

// ---------- the whole run ----------

export function scoreRun(input: ScoreInput): RunScore {
  const byCase = new Map<string, Map<string, PairRecord>>();
  for (const pair of input.pairs) {
    let row = byCase.get(pair.caseFile);
    if (!row) {
      row = new Map<string, PairRecord>();
      byCase.set(pair.caseFile, row);
    }
    row.set(pair.criterionId, pair);
  }

  const sheetCases = input.sheetCases ?? input.cases;
  const ownCriterionOnly = input.ownCriterionOnly === true;
  const factLines = input.factLines;
  const options: ScoreOptions = { ownCriterionOnly, factLines: factLines ? (caseFile) => factLines[caseFile] ?? [] : undefined };
  // In a quick run or a wave run a criterion is looked at on a few histories only. The planted
  // findings are counted once here, so that hundreds of criteria do not each read the whole sheet.
  const plantedBy = new Map<string, number>();
  for (const c of sheetCases) for (const f of c.findings) plantedBy.set(f.criterion, (plantedBy.get(f.criterion) ?? 0) + 1);
  const pairedCases = new Map<string, Set<string>>();     // criterion -> the histories it has a record or a planted finding on
  if (ownCriterionOnly) {
    const note = (criterionId: string, caseFile: string): void => {
      let set = pairedCases.get(criterionId);
      if (!set) {
        set = new Set<string>();
        pairedCases.set(criterionId, set);
      }
      set.add(caseFile);
    };
    for (const pair of input.pairs) note(pair.criterionId, pair.caseFile);
    for (const c of input.cases) for (const f of c.findings) note(f.criterion, c.file);
  }
  const criteria = input.criteria.map((criterion) =>
    scoreCriterion(
      criterion,
      ownCriterionOnly ? input.cases.filter((c) => pairedCases.get(criterion.id)?.has(c.file)) : input.cases,
      (caseFile) => byCase.get(caseFile)?.get(criterion.id),
      input.lettersRun,
      plantedBy.get(criterion.id) ?? 0,
      options,
    ),
  );

  const inRun = new Set(input.criteria.map((c) => c.id));
  const unscored: Unscored[] = [];
  for (const c of input.cases) {
    for (const f of c.findings) {
      if (!inRun.has(f.criterion)) unscored.push({ caseFile: c.file, criterionId: f.criterion });
    }
  }

  const totals: ScoreTotals = {
    criteria: criteria.length,
    pass: 0,
    passPart: 0,
    fail: 0,
    notTested: 0,
    planted: 0,
    caught: 0,
    disputed: 0,
    falseFlags: 0,
    turnedBack: 0,
    notCompleted: 0,
    letters: { needed: 0, produced: 0, modelClean: 0, modelWithNotes: 0, template: 0, notProduced: 0, withoutPlanted: 0 },
    calls: { screen: 0, check: 0, letter: 0 },
    seconds: 0,
    needsAFact: 0,
    suppliesOnly: 0,
    factHistories: emptyFactCounts(),
    possibleCaught: 0,
    falseFlagsByRole: { own: 0, clean: 0, sample: 0, full: 0 },
    sample: emptySample(),
  };
  for (const s of criteria) {
    if (s.class === 'needs_a_fact') totals.needsAFact++;
    else totals.suppliesOnly++;
    totals.possibleCaught += s.possibleCaught;
    for (const key of Object.keys(totals.factHistories) as (keyof FactHistoryCounts)[]) totals.factHistories[key] += s.factHistories[key];
    for (const key of Object.keys(totals.sample) as (keyof SampleCounts)[]) totals.sample[key] += s.sample[key];
    for (const flag of s.falseFlags) totals.falseFlagsByRole[flag.role ?? 'full']++;
    if (s.verdict === 'PASS') totals.pass++;
    else if (s.verdict === 'PASS_PART') totals.passPart++;
    else if (s.verdict === 'FAIL') totals.fail++;
    else totals.notTested++;
    totals.planted += s.planted;
    totals.caught += s.caught;
    totals.disputed += s.disputed;
    totals.falseFlags += s.falseFlags.length;
    totals.turnedBack += s.turnedBack;
    totals.notCompleted += s.notCompleted.length;
    totals.letters.needed += s.letters.needed;
    totals.letters.produced += s.letters.produced;
    totals.letters.modelClean += s.letters.modelClean;
    totals.letters.modelWithNotes += s.letters.modelWithNotes;
    totals.letters.template += s.letters.template;
    totals.letters.notProduced += s.letters.notProduced;
    totals.letters.withoutPlanted += s.letters.withoutPlanted;
    totals.calls.screen += s.calls.screen;
    totals.calls.check += s.calls.check;
    totals.calls.letter += s.calls.letter;
    totals.seconds += s.seconds;
  }
  totals.seconds = round1(totals.seconds);

  return { lettersRun: input.lettersRun, criteria, totals, unscored, ownCriterionOnly };
}

// ---------- the lists a script reads ----------

// A criterion that was not scored at all: it was not drafted, or its files could not be used.
export interface NotScored {
  id: string;
  result: 'NOT_DRAFTED' | 'FILES_NOT_USABLE';
  reason: string;               // "not drafted", or "files not usable: (reason)"
  wave: string | null;
}

// passing: the criteria whose result is PASS. Nothing else passes: a part run, a criterion with no
// planted finding in the run, one that was not drafted and one whose files could not be used are
// all listed under not_passing, each with its reason.
export function passingLists(
  score: RunScore,
  notScored: NotScored[] = [],
  waveOf: (criterionId: string) => string | null = () => null,
): PassingLists {
  const passing: string[] = [];
  const not_passing: NotPassing[] = [];
  for (const s of score.criteria) {
    if (s.verdict === 'PASS') {
      passing.push(s.criterionId);
      continue;
    }
    let reasons: string[];
    if (s.verdict === 'FAIL') reasons = s.failures.length > 0 ? s.failures.map((f) => f.text) : [...s.reasons];
    else if (s.verdict === 'PASS_PART') reasons = [`Nothing failed, but the run did not cover everything. ${s.caveats.join(' ')}`.trim()];
    else reasons = s.caveats.length > 0 ? [...s.caveats] : ['No planted finding for this criterion was in this run.'];
    not_passing.push({
      id: s.criterionId,
      result: s.verdict,
      reason: reasons.join(' '),
      reasons,
      class: s.class,
      wave: waveOf(s.criterionId),
    });
  }
  for (const item of notScored) {
    not_passing.push({ id: item.id, result: item.result, reason: item.reason, reasons: [item.reason], class: null, wave: item.wave });
  }
  return { passing, not_passing };
}

// ---------- the answer sheet ----------

export interface SheetCheck {
  sheet: ExpectedSheet | null;  // null when the sheet cannot be used
  fatal: string[];              // mistakes that stop the run
  warnings: string[];           // things to look at; the run goes on
}

// A history path must stay inside the cases folder.
export function unsafeCasePath(file: string): string | null {
  const flat = file.replace(/\\/g, '/');
  if (flat.startsWith('/') || /^[A-Za-z]:/.test(flat)) return 'it must be a path under the cases folder, not a full path';
  const parts = flat.split('/');
  if (parts.some((p) => p === '..')) return 'it must not use ".."';
  if (parts.some((p) => p.trim() === '')) return 'it has an empty folder or file name';
  return null;
}

export function checkSheet(raw: unknown): SheetCheck {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) return { sheet: null, fatal: ['The answer sheet is not a JSON object.'], warnings };
  if (!Array.isArray(raw.cases)) return { sheet: null, fatal: ['The answer sheet has no "cases" list.'], warnings };
  if (raw.cases.length === 0) fatal.push('The answer sheet lists no histories.');

  let signed: ExpectedSheet['signed_by_clinical_reviewer'] = null;
  const sign = raw.signed_by_clinical_reviewer;
  if (isRecord(sign) && hasText(sign.name) && hasText(sign.date)) {
    signed = { name: sign.name, date: sign.date };
  } else if (sign !== null && sign !== undefined) {
    warnings.push('The sign-off field of the answer sheet could not be read. The sheet is treated as not signed.');
  }

  const cases: ExpectedCase[] = [];
  const seen = new Set<string>();
  raw.cases.forEach((entry: unknown, i: number) => {
    const where = `Entry ${i + 1}`;
    if (!isRecord(entry)) {
      fatal.push(`${where} is not an object.`);
      return;
    }
    if (!hasText(entry.file)) {
      fatal.push(`${where} has no "file".`);
      return;
    }
    const file = entry.file.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    const unsafe = unsafeCasePath(file);
    if (unsafe) {
      fatal.push(`${file}: ${unsafe}.`);
      return;
    }
    if (seen.has(file.toLowerCase())) {
      fatal.push(`${file}: it is listed twice.`);
      return;
    }
    seen.add(file.toLowerCase());
    const kind = entry.kind;
    if (kind !== 'positive' && kind !== 'near_miss' && kind !== 'clean') {
      fatal.push(`${file}: "kind" must be positive, near_miss or clean.`);
      return;
    }
    if (!Array.isArray(entry.findings)) {
      fatal.push(`${file}: "findings" must be a list.`);
      return;
    }

    const findings: ExpectedFinding[] = [];
    let broken = false;
    entry.findings.forEach((f: unknown, j: number) => {
      if (!isRecord(f) || !hasText(f.criterion)) {
        fatal.push(`${file}: finding ${j + 1} has no "criterion".`);
        broken = true;
        return;
      }
      const groups = f.must_cite;
      const wellFormed =
        Array.isArray(groups) && groups.every((g) => Array.isArray(g) && g.every((x) => typeof x === 'string'));
      if (!wellFormed) {
        fatal.push(`${file}: finding ${j + 1} needs "must_cite" as a list of lists of line IDs.`);
        broken = true;
        return;
      }
      const criterion = f.criterion.trim();
      const mustCite = (groups as string[][]).map((g) => g.map((x) => x.trim()));
      if (mustCite.length === 0) {
        warnings.push(`${file}: ${criterion} names no line that must be cited. Any confirmed finding will count as caught.`);
      }
      if (mustCite.some((g) => g.length === 0)) {
        warnings.push(`${file}: ${criterion} has an empty group in "must_cite". It can never be caught.`);
      }
      if (findings.some((x) => x.criterion === criterion)) {
        warnings.push(`${file}: ${criterion} is listed twice for this history.`);
      }
      findings.push({ criterion, must_cite: mustCite });
    });
    if (broken) return;

    if (kind === 'positive' && findings.length === 0) {
      warnings.push(`${file}: it is marked positive but lists no finding.`);
    }
    if (kind !== 'positive' && findings.length > 0) {
      warnings.push(`${file}: it is marked ${kind} but lists a finding. The finding is scored as planted.`);
    }
    // A history named pos-fact or pos-nofact is a planted one (docs/SPEC.md section 6a). If the sheet
    // lists no finding for it, nothing is scored as planted, and that must not pass unseen.
    if (kind !== 'positive' && findings.length === 0 && historyKind(file) !== 'other') {
      warnings.push(`${file}: its name says a finding is planted, but it is marked ${kind} and lists no finding. Nothing is scored as planted for it.`);
    }
    if (!hasText(entry.about)) warnings.push(`${file}: it has no "about" sentence.`);

    cases.push({ file, kind, about: hasText(entry.about) ? entry.about.trim() : '', findings });
  });

  if (fatal.length > 0) return { sheet: null, fatal, warnings };
  return { sheet: { signed_by_clinical_reviewer: signed, cases }, fatal, warnings };
}

// Checks one history's expected findings against the active criteria and against the lines
// that were really read from its file. Pass null for lineIds when the history could not be read.
export function caseSheetWarnings(
  expected: ExpectedCase,
  lineIds: string[] | null,
  activeCriterionIds: string[],
): string[] {
  const warnings: string[] = [];
  const have = lineIds === null ? null : new Set(lineIds.map(normaliseLineId));
  const active = new Set(activeCriterionIds);
  for (const f of expected.findings) {
    if (!active.has(f.criterion)) {
      warnings.push(`${expected.file}: the sheet expects ${f.criterion}, but that criterion is not in the active list. It is not scored.`);
    }
    if (have === null) continue;
    for (const id of unique(f.must_cite.flat())) {
      if (!have.has(normaliseLineId(id))) {
        warnings.push(`${expected.file}: the sheet names line ${id} for ${f.criterion}, but the history has no such line.`);
      }
    }
  }
  return warnings;
}
