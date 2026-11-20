// Job 2: the second model double-checks one suspected finding (docs/SPEC.md section 7.2).
// The check is lopsided on purpose: it may reject only when the cited lines clearly do not hold the
// listed medicines or the rule is clearly not met. When unsure it confirms.
// A check that fails twice does not hide the finding: it comes back with completed: false.
// A "no" that names lines as proof does not hide it either: it comes back with unclear: true.
//
// A criterion that needs facts (docs/SPEC.md section 6a): the second model is told what the first
// model says the record does not show. It confirms a possible finding as possible when the
// medicines meet the rule and the record truly holds no line about the fact. It turns a finding
// back when the record holds the fact and it does not meet the criterion. The answer form is the
// same four fields for every criterion.
import type { CheckResult, Criterion, HistoryLine, LanternConfig, PatientHeader, ScreenResult } from '../shared/types.ts';
import { missingFactsOf } from '../shared/facts.ts';
import { chat, type ChatMessage, type JsonSchema } from './ollama.ts';
import { criterionBlock, needsFacts } from './criteria.ts';
import { supplyCountNote } from './count-supplies.ts';
import {
  clipText, fitsInOneCall, historyBlock, historyCharBudget, joinDistinct, joinedNote, keepKnownLineIds, linesById, partsHolding,
  promptFits, promptLength, splitIntoParts, TOO_LONG_FOR_THE_MODEL
} from './history.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { datesNote, latestDate, type JobDeps } from './screen.ts';

export const CHECK_NUM_PREDICT = 1200;
export const CHECK_NUM_PREDICT_THINKING = 4000;
/** The most Model 2 may write under "what matches". It once wrote 2,640 characters of working-out there. */
export const WHAT_MATCHES_MAX = 700;
const CANNOT_BE_SEEN_MAX = 500;
/** Said when the second model's words are cut short. The name is the one in the settings. */
export function checkCutNote(who?: string): string {
  const name = who && who.trim() ? who.trim() : DEFAULT_CONFIG.modelNames.check;
  return `(${name} wrote more. The rest was left out.)`;
}

// The explanation comes first and the yes or no comes last, so what the model works out can still
// change its answer. (Until 18 November "confirmed" came first and the reasoning after it could not.)
//
// The field names are numbered on purpose. Measured on this PC on 18 November: the second model
// writes the fields of an answer form in alphabetical order, whatever order the form gives them in
// ("confirmed" before "line_ids" before "what_..."). The first model follows the order of the form.
// With numbered names both orders are the same, so the yes or no is always written last.
export const CHECK_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    step1_what_matches: { type: 'string', maxLength: WHAT_MATCHES_MAX },
    step2_line_ids: { type: 'array', items: { type: 'string' } },
    step3_what_cannot_be_seen: { type: 'string', maxLength: CANNOT_BE_SEEN_MAX },
    step4_confirmed: { type: 'boolean' }
  },
  required: ['step1_what_matches', 'step2_line_ids', 'step3_what_cannot_be_seen', 'step4_confirmed']
};

export const CHECK_SYSTEM =
  'You are the second, independent check in a medicines review tool used by a community pharmacist. ' +
  'Another model has reported a suspected finding. Re-read the fictional dispensing history yourself and check it against the criterion. ' +
  'Confirm the finding unless the cited lines clearly do not contain the listed medicines or the rule is clearly not met; ' +
  'if you are unsure, confirm it and say what cannot be seen in a dispensing history. ' +
  'Brand names count as their ingredient. Use only lines that exist in the history and quote their IDs exactly. Reply with JSON only.';

const CHECK_TASK =
  'Return, in this order: ' +
  'step1_what_matches (one or two short sentences naming the medicines and their dates, or saying what is missing), ' +
  'step2_line_ids (the lines that prove the finding; an empty list when you do not confirm it), ' +
  'step3_what_cannot_be_seen (one sentence: what a dispensing history cannot show, for the doctor to check), ' +
  'step4_confirmed (true or false).';

/** The task for a criterion that needs facts: the three cases in plain words, then the same four fields. */
const CHECK_FACTS_TASK =
  'This criterion needs facts that a dispensing history does not hold. They are listed under FACTS THIS CRITERION NEEDS.\n' +
  'The record holds a fact only when one of its lines says CONDITION, RESULT or OBSERVATION and that line is about the fact. ' +
  'A supply line is never a fact line.\n' +
  'The first step wrote in missing_facts the facts it found no line about. Look for a line about each fact yourself. Then there are three cases:\n' +
  '1. The medicines meet the rule, and a fact line of the record meets the criterion. Confirm. Give the supply lines and the fact line.\n' +
  '2. The medicines meet the rule, and the record holds no line about a fact that the finding needs. This is a possible finding. Confirm it. ' +
  'The letter will ask the doctor to confirm the fact. Do not turn it back because the fact is not on the record.\n' +
  '3. The record holds a line about the fact, and that line shows that the fact does not meet the criterion. Do not confirm.\n' +
  'When the medicines do not meet the rule, do not confirm.\n' +
  'Return, in this order: ' +
  'step1_what_matches (one or two short sentences naming the medicines and their dates and what the record holds about the facts, or saying what is missing), ' +
  'step2_line_ids (the lines that prove the finding; an empty list when you do not confirm it), ' +
  'step3_what_cannot_be_seen (one sentence: what the record cannot show, for the doctor to check), ' +
  'step4_confirmed (true or false).';

export const CHECK_NOT_COMPLETED = 'The second check did not finish, so this finding is shown without it.';
export function checkUnclearNote(who?: string): string {
  const name = who && who.trim() ? who.trim() : DEFAULT_CONFIG.modelNames.check;
  return `The second check is unclear: ${name} answered "not confirmed" but named lines as proof. The finding is shown so that it is not missed.`;
}
export const CHECK_UNCLEAR = checkUnclearNote();

/** The answer of the second model, by plain names. */
export interface CheckAnswer {
  confirmed: boolean;
  line_ids: string[];
  what_matches: string;
  what_cannot_be_seen: string;
}

/** The answer as the model writes it: the same four fields under their numbered names. */
export interface CheckForm {
  step1_what_matches: string;
  step2_line_ids: string[];
  step3_what_cannot_be_seen: string;
  step4_confirmed: boolean;
}

export function toCheckForm(answer: CheckAnswer): CheckForm {
  return {
    step1_what_matches: answer.what_matches,
    step2_line_ids: answer.line_ids,
    step3_what_cannot_be_seen: answer.what_cannot_be_seen,
    step4_confirmed: answer.confirmed
  };
}

export function fromCheckForm(form: CheckForm): CheckAnswer {
  return {
    confirmed: form.step4_confirmed,
    line_ids: form.step2_line_ids,
    what_matches: form.step1_what_matches,
    what_cannot_be_seen: form.step3_what_cannot_be_seen
  };
}

/** The prompt: system role, the numbered history, the same criterion block as the screen, then the suspected finding. */
export function checkMessages(
  patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, screen: ScreenResult, partNote = '',
  latest: string | null = latestDate(lines),
  countFrom: HistoryLine[] = lines
): ChatMessage[] {
  const inThisPart = keepKnownLineIds(screen.lineIds, lines).kept;
  const withFacts = needsFacts(criterion);
  // The same note "DATES" the first model gets, for a criterion that needs facts and counts months back. Empty otherwise.
  const dates = datesNote(lines, criterion, latest);
  // The count is added only when the criterion asks for one. An empty note leaves the prompt as it was.
  const block = criterionBlock(criterion);
  const counted = supplyCountNote(criterion, countFrom);
  const words = counted ? `${block}\n\n${counted}` : block;
  const suspected: Record<string, unknown> = {
    criterion: criterion.label,
    suspected_lines: inThisPart,
    medicines: screen.medicines,
    reason: screen.reason
  };
  // Only for a criterion that needs facts: what the first step says the record does not show.
  // An empty list means the first step reported a finding with its fact line, not a possible finding.
  if (withFacts) suspected.missing_facts = missingFactsOf({ screen });
  if (inThisPart.length === 0) {
    suspected.note = 'The first step gave no line IDs that can be used here. Look through the whole history.';
  }
  return [
    { role: 'system', content: CHECK_SYSTEM },
    {
      role: 'user',
      content: `${historyBlock(patient, lines, partNote)}\n\n${words}\n\n` +
        (dates ? `${dates}\n\n` : '') +
        `SUSPECTED FINDING FROM THE FIRST STEP\n${JSON.stringify(suspected)}\n\n${withFacts ? CHECK_FACTS_TASK : CHECK_TASK}`
    }
  ];
}

interface PartCheck {
  completed: boolean;
  confirmed: boolean;
  unclear: boolean;
  lineIds: string[];
  whatMatches: string;
  whatCannotBeSeen: string;
  error?: string;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function lineNumber(id: string): number {
  const n = Number(id.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reads one answer of the second model. Line IDs that do not exist are dropped.
 * The guard is lopsided on purpose: a "no" that names lines of the history as proof is not a plain
 * no. It is marked unclear and the finding still goes to the pharmacist.
 */
export function readCheckAnswer(answer: CheckAnswer, shown: HistoryLine[], screen: ScreenResult, who?: string): PartCheck {
  const confirmed = answer.confirmed === true;
  let lineIds = keepKnownLineIds(answer.line_ids, shown).kept;
  const unclear = !confirmed && lineIds.length > 0;
  // A confirmed finding with no usable line keeps the lines from the first step, so there is something to show.
  if (confirmed && lineIds.length === 0) lineIds = keepKnownLineIds(screen.lineIds, shown).kept;
  return {
    completed: true,
    confirmed,
    unclear,
    lineIds,
    whatMatches: clipText(answer.what_matches, WHAT_MATCHES_MAX, checkCutNote(who)),
    whatCannotBeSeen: clipText(answer.what_cannot_be_seen, CANNOT_BE_SEEN_MAX, checkCutNote(who))
  };
}

/** Merges the checks of the parts of a long history. Confirmed in any part means confirmed. */
export function mergeCheckParts(parts: PartCheck[]): PartCheck {
  if (parts.length === 1) return parts[0];
  const done = parts.filter(p => p.completed);
  const confirmed = done.filter(p => p.confirmed);
  const unclear = done.filter(p => p.unclear);
  const failed = parts.find(p => !p.completed);
  const from = confirmed.length > 0 ? confirmed : unclear.length > 0 ? unclear : done;
  const merged: PartCheck = {
    completed: confirmed.length > 0 || unclear.length > 0 || !failed,
    confirmed: confirmed.length > 0,
    unclear: confirmed.length === 0 && unclear.length > 0,
    lineIds: [...new Set(from.flatMap(p => p.lineIds))].sort((a, b) => lineNumber(a) - lineNumber(b)),
    whatMatches: joinDistinct(from.map(p => p.whatMatches)),
    whatCannotBeSeen: joinDistinct(from.map(p => p.whatCannotBeSeen))
  };
  if (failed?.error) merged.error = failed.error;
  return merged;
}

/**
 * Double-checks one suspected finding. Never throws.
 * completed is false when the call failed twice: the finding must still be shown to the pharmacist.
 * For a long history the second model is given the same lines the first model read together:
 * every line that holds a listed medicine, from all parts, in one call.
 */
export async function checkFinding(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, screen: ScreenResult,
  deps: JobDeps = {}
): Promise<CheckResult> {
  const call = deps.chat ?? chat;
  const started = performance.now();
  const at = (deps.now?.() ?? new Date()).toISOString();
  const model = cfg.models.check;
  const elapsed = (): number => Math.round((performance.now() - started) / 10) / 100;
  const notCompleted = (why: string): CheckResult => ({
    confirmed: false,
    lineIds: keepKnownLineIds(screen.lineIds, lines).kept,
    whatMatches: tidy(`${CHECK_NOT_COMPLETED} ${why}`),
    whatCannotBeSeen: criterion.cannot_be_seen,
    completed: false,
    model, at, seconds: elapsed()
  });

  try {
    if (lines.length === 0) return notCompleted('The history has no lines.');
    const numPredict = cfg.think.check ? CHECK_NUM_PREDICT_THINKING : CHECK_NUM_PREDICT;
    const budget = historyCharBudget(cfg.numCtx, numPredict);
    const parts = splitIntoParts(lines, cfg.maxLinesPerCall, cfg.overlapLines, budget);
    const wholeRecordLatest = latestDate(lines);
    const ask = async (shown: HistoryLine[], note: string): Promise<PartCheck> => {
      const messages = checkMessages(patient, shown, criterion, screen, note, wholeRecordLatest, lines);
      const answer = await call<CheckForm>(cfg, {
        model, think: cfg.think.check, schema: CHECK_SCHEMA, messages, numPredict, signal: deps.signal
      });
      // A prompt that did not fit may have lost the start of the history: that check does not count.
      const error = !answer.ok ? answer.error
        : promptFits(cfg.numCtx, answer.timings.promptTokens, numPredict, promptLength(messages)) ? null : TOO_LONG_FOR_THE_MODEL;
      if (!answer.ok || error !== null) {
        return { completed: false, confirmed: false, unclear: false, lineIds: [], whatMatches: '', whatCannotBeSeen: '', error: error ?? '' };
      }
      return readCheckAnswer(fromCheckForm(answer.value), shown, screen, cfg.modelNames.check);
    };

    const results: PartCheck[] = [];
    const together = parts.length > 1
      ? keepKnownLineIds([...(screen.listedLineIds ?? []), ...screen.lineIds], lines).kept
      : [];
    if (together.length > 0) {
      // A long history: the lines that matter are read together, never one part at a time.
      const shown = linesById(lines, together);
      if (!fitsInOneCall(shown, cfg.maxLinesPerCall, budget)) {
        return notCompleted(`${shown.length} lines of this long history hold a listed medicine. That is too many to check together in one go.`);
      }
      results.push(await ask(shown, joinedNote(lines.length, shown.length, needsFacts(criterion))));
    } else {
      // A history that fits, or a long one for which the first step named no line at all.
      for (const index of partsHolding(parts, screen.lineIds)) {
        const part = parts[index];
        const note = parts.length > 1
          ? `This is part ${index + 1} of ${parts.length} of a long history: lines ${part[0].id} to ${part[part.length - 1].id}.`
          : '';
        results.push(await ask(part, note));
      }
    }
    if (results.length === 0) return notCompleted('No part of the history was checked.');
    const merged = mergeCheckParts(results);
    if (!merged.completed) return notCompleted(merged.error ?? '');
    const result: CheckResult = {
      confirmed: merged.confirmed,
      lineIds: merged.lineIds,
      whatMatches: merged.whatMatches,
      whatCannotBeSeen: merged.whatCannotBeSeen || criterion.cannot_be_seen,
      completed: true,
      model, at, seconds: elapsed()
    };
    if (merged.unclear) result.unclear = true;
    return result;
  } catch (e) {
    return notCompleted(`The check step failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
