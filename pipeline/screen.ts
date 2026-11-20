// Job 1: the first model screens one history against one criterion (docs/SPEC.md section 7.1).
// The screening is done by the model. There is no medicine-name match in code on this path.
//
// A history that fits is read in one call. A long history is read in overlapping parts. A finding
// that needs two lines must never be lost because the two lines fall in different parts, so in
// every part the model also lists each line that holds a medicine on the criterion's list, and
// then reads all the listed lines together in one more call. "No part suspected" alone is never
// a clear result.
//
// A criterion that needs a fact a dispensing history does not hold (docs/SPEC.md section 6a) has
// its own answer form and task: the form also asks which fact the record does not show. A finding
// with a missing fact is a possible finding. A criterion without such facts keeps the exact form
// and words it had before, so its results do not change.
import type { Criterion, HistoryLine, LanternConfig, PatientHeader, ScreenResult } from '../shared/types.ts';
import { enteredAtTheCounter, isFactLine, tidyFact, tidyFacts } from '../shared/facts.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { chat, type ChatFn, type ChatMessage, type JsonSchema } from './ollama.ts';
import { criterionBlock, needsFacts } from './criteria.ts';
import { supplyCountNote } from './count-supplies.ts';
import { monthsBefore } from './dates.ts';
import {
  clipText, fitsInOneCall, historyBlock, historyCharBudget, joinDistinct, joinedNote, keepKnownLineIds, linesById, mergeNames,
  promptFits, promptLength, splitIntoParts, TOO_LONG_FOR_THE_MODEL
} from './history.ts';

export const SCREEN_NUM_PREDICT = 1200;
/** A part of a long history: the answer also lists every line with a listed medicine, so it needs more room. */
export const SCREEN_PART_NUM_PREDICT = 2000;
const REASON_MAX = 600;
function shownName(who: string | undefined, fallback: string): string {
  return who && who.trim() ? who.trim() : fallback;
}

/** Said when a reason is cut short. The name is the one in the settings. */
export function screenCutNote(who?: string): string {
  return `(${shownName(who, DEFAULT_CONFIG.modelNames.screen)} wrote more. The rest was left out.)`;
}
/** The most facts a finding names as missing, and the longest name kept. */
const MAX_MISSING_FACTS = 8;
const MISSING_FACT_MAX = 200;

// The explanation comes first and the yes or no comes last, so the model has written down what it
// saw before it decides. (Until 18 November the yes or no came first and nothing after it could change it.)
export const SCREEN_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', maxLength: REASON_MAX },
    medicines: { type: 'array', items: { type: 'string' } },
    line_ids: { type: 'array', items: { type: 'string' } },
    suspected: { type: 'boolean' }
  },
  required: ['reason', 'medicines', 'line_ids', 'suspected']
};

/**
 * The answer form for a criterion that needs facts: the same, and before the yes or no the facts
 * the record does not show. The list is always asked for. It may be empty.
 */
export const SCREEN_FACTS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    reason: { type: 'string', maxLength: REASON_MAX },
    medicines: { type: 'array', items: { type: 'string' } },
    line_ids: { type: 'array', items: { type: 'string' } },
    missing_facts: { type: 'array', items: { type: 'string' } },
    suspected: { type: 'boolean' }
  },
  required: ['reason', 'medicines', 'line_ids', 'missing_facts', 'suspected']
};

/** The answer form for one part of a long history: the same, and first the lines that hold a listed medicine. */
export const SCREEN_PART_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    listed_line_ids: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string', maxLength: REASON_MAX },
    medicines: { type: 'array', items: { type: 'string' } },
    line_ids: { type: 'array', items: { type: 'string' } },
    suspected: { type: 'boolean' }
  },
  required: ['listed_line_ids', 'reason', 'medicines', 'line_ids', 'suspected']
};

export const SCREEN_SYSTEM =
  'You are the first screening step of a medicines review tool used by a community pharmacist. ' +
  'You read one fictional patient\'s dispensing history and decide whether ONE criterion may apply. ' +
  'You never decide the outcome: a second check and then the pharmacist come after you. ' +
  'Brand names count as their ingredient. If you are in doubt, report a suspected finding. ' +
  'Use only lines that exist in the history and quote their IDs exactly. Reply with JSON only.';

const ANSWER_FIELDS =
  'reason (one or two short sentences: which of the listed medicines are in the history, and whether the rule is met), ' +
  'medicines (the ingredient names found), ' +
  'line_ids (the ID of every line that holds a medicine that counts and is part of the finding; an empty list when the rule is not met), ' +
  'suspected (true or false).';

const SCREEN_TASK =
  'TASK\n' +
  'Decide whether this criterion may apply to this patient. Use only the dispensing history above.\n' +
  'Return, in this order: ' + ANSWER_FIELDS;

// ---------- a criterion that needs facts (docs/SPEC.md section 6a) ----------

/** The three cases, in plain words. The criterion's own RULE says which lines to give. */
const FACTS_HOW =
  'This criterion needs facts that a dispensing history does not hold. They are listed under FACTS THIS CRITERION NEEDS.\n' +
  'The record holds a fact only when one of its lines says CONDITION, RESULT or OBSERVATION and that line is about the fact. ' +
  'A supply line is never a fact line.\n' +
  'Follow the RULE. There are three cases:\n' +
  '1. A finding. The medicines meet the rule, and a fact line of the record meets the criterion. ' +
  'Answer suspected true. Give the supply lines and the fact line in line_ids. Leave missing_facts empty.\n' +
  '2. A possible finding. The medicines meet the rule, but the record holds no line about a fact that the finding needs. ' +
  'Answer suspected true. Give in line_ids the lines the rule names. Name each such fact in missing_facts.\n' +
  '3. No finding. The medicines do not meet the rule, or a fact line of the record shows that the fact does not meet the criterion. ' +
  'Answer suspected false. Leave line_ids and missing_facts empty.\n' +
  'When the criterion is about a medicine that should be supplied and is not, "the medicines meet the rule" means that the medicine is missing in the way the RULE says.';

const FACTS_ANSWER_FIELDS =
  'reason (one or two short sentences: which of the listed medicines are in the record, what the record holds about the facts, and which of the three cases this is), ' +
  'medicines (the ingredient names found), ' +
  'line_ids (the ID of every line that is part of the finding: the supply lines that count, and the fact line when the record holds it; an empty list when there is no finding), ' +
  'missing_facts (only for a possible finding: the name of each fact the finding needs that the record holds no line about, written as it is written under FACTS THIS CRITERION NEEDS; an empty list in every other case), ' +
  'suspected (true or false).';

const SCREEN_FACTS_TASK =
  'TASK\n' +
  'Decide whether this criterion may apply to this patient. Use only the record above.\n' +
  FACTS_HOW + '\n' +
  'Return, in this order: ' + FACTS_ANSWER_FIELDS;

// ---------- a criterion that needs facts and counts months back from the end of the record ----------
// Measured on 18 November: the first model found the right two dates (a result of 2025-06-04, a
// latest date of 2026-09-19) and still wrote that the result lay "within 15 months". The months it
// has to count back are therefore worked out here, as plain dates it can compare. This is calendar
// arithmetic only. The model still decides. A criterion that needs no facts never gets this note.

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, eighteen: 18
};
const COUNT = `(\\d{1,2}|${Object.keys(COUNT_WORDS).join('|')})`;

/**
 * The numbers of months a criterion counts back from the end of the record, as its rule and its
 * facts say them: "in the last six months", "15 months before the latest date". Smallest first.
 * A length of treatment ("for more than 3 months") is not counted back from the end and is left out.
 */
export function monthsCountedBack(criterion: Criterion): number[] {
  if (!needsFacts(criterion)) return [];
  const text = [criterion.rule_for_models, ...(criterion.needs_facts ?? []).map(f => f.meets)].join(' ').toLowerCase();
  const found = new Set<number>();
  const add = (word: string): void => {
    const n = COUNT_WORDS[word] ?? Number(word);
    if (Number.isInteger(n) && n >= 1 && n <= 60) found.add(n);
  };
  for (const m of text.matchAll(new RegExp(`\\b(?:last|past|previous|preceding)\\s+${COUNT}\\s+months?\\b`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b${COUNT}\\s+months?\\s+(?:before|prior to)\\s+(?:the\\s+)?(?:latest|last|end)\\b`, 'g'))) add(m[1]);
  // "(12 months if aged 65 to 74, 6 months if aged 75 or over, counted back from the end of the record)"
  if (/counted back from the (?:end|latest date|last date)/.test(text)) {
    for (const m of text.matchAll(new RegExp(`\\b${COUNT}\\s+months?\\b`, 'g'))) add(m[1]);
  }
  return [...found].sort((a, b) => a - b);
}

/** The latest date written at the start of a line of the record, as yyyy-mm-dd. Null when no line has one. A line entered at the counter is not an event of the history, so it never moves this date. */
export function latestDate(lines: HistoryLine[]): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    if (enteredAtTheCounter(line.text)) continue;
    const m = /^(\d{4}-\d{2}-\d{2})(?= \||$)/.exec(line.text);
    if (m && (latest === null || m[1] > latest)) latest = m[1];
  }
  return latest;
}

/**
 * The note "DATES" for a criterion that needs facts and counts months back from the end of the
 * record: the latest date, and the date each count of months before it. Empty for every other
 * criterion, and when the record shows no date.
 * latest: the latest date of the whole record, when the lines given are only a part of it.
 */
export function datesNote(lines: HistoryLine[], criterion: Criterion, latest: string | null = latestDate(lines)): string {
  const counts = monthsCountedBack(criterion);
  if (counts.length === 0 || latest === null) return '';
  const cuts = counts
    .map(n => ({ n, date: monthsBefore(latest, n) }))
    .filter((c): c is { n: number; date: string } => c.date !== null)
    .map(c => `${c.n} ${c.n === 1 ? 'month' : 'months'} before it is ${c.date}`);
  if (cuts.length === 0) return '';
  return 'DATES\n' +
    `The latest date in this record is ${latest}. ${cuts.join('. ')}. ` +
    'Compare dates with these. A date earlier than one of them is more than that many months before the latest date. ' +
    'A date on or after it is within that many months.';
}

/**
 * The task for one criterion on a history that is read in one call.
 * A criterion that needs no facts gets the task it always had, whatever the lines are.
 */
function taskFor(criterion: Criterion, lines: HistoryLine[] = [], latest?: string | null): string {
  if (!needsFacts(criterion)) return SCREEN_TASK;
  const dates = datesNote(lines, criterion, latest === undefined ? latestDate(lines) : latest);
  return dates ? `${dates}\n\n${SCREEN_FACTS_TASK}` : SCREEN_FACTS_TASK;
}

function partTask(criterion: Criterion): string {
  const which = criterion.medicine_groups.length > 0
    ? 'a medicine named under MEDICINES THAT COUNT, from any group'
    : 'a medicine that matters for this criterion';
  if (needsFacts(criterion)) {
    // A part cannot tell that a fact is missing: its line may be in another part. So a part lists
    // the fact lines with the medicine lines, and the three cases are decided when all the listed
    // lines are read together.
    return 'TASK\n' +
      'This is one part of a long history. The other parts hold other lines of the same patient.\n' +
      'This criterion needs facts that a dispensing history does not hold. They are listed under FACTS THIS CRITERION NEEDS. ' +
      'A fact line says CONDITION, RESULT or OBSERVATION after its date.\n' +
      `First list every line of THIS part that holds ${which}, and every fact line of THIS part that is about a fact this criterion needs, ` +
      'whether or not the rule is met in this part. ' +
      'These lines are read again later, together with the lines from the other parts.\n' +
      'Then decide whether this part alone shows a finding: the medicines meet the rule and a fact line of this part meets the criterion. ' +
      'A fact with no line in this part may have a line in another part, so do not report a finding only because a fact is not in this part.\n' +
      'Return, in this order: ' +
      'listed_line_ids (the ID of every line of this part that holds such a medicine or is about such a fact; an empty list when there is none), ' +
      ANSWER_FIELDS;
  }
  return 'TASK\n' +
    'This is one part of a long history. The other parts hold other lines of the same patient.\n' +
    `First list every line of THIS part that holds ${which}, whether or not the rule is met in this part. ` +
    'These lines are read again later, together with the lines from the other parts.\n' +
    'Then decide whether the rule is met inside this part alone.\n' +
    'Return, in this order: ' +
    'listed_line_ids (the ID of every line of this part that holds such a medicine; an empty list when there is none), ' +
    ANSWER_FIELDS;
}

export function contradictionNote(who?: string): string {
  const name = shownName(who, DEFAULT_CONFIG.modelNames.screen);
  return `${name} answered "not suspected" but named these lines. To be safe the finding was passed on to the second check.`;
}
export const CONTRADICTION_NOTE = contradictionNote();

/** Said when a suspected finding of a criterion that needs facts names no fact line and no missing fact. */
export function noFactLineNote(who?: string): string {
  const name = shownName(who, DEFAULT_CONFIG.modelNames.screen);
  return `${name} named no line that holds a fact this criterion needs, and no missing fact. To be safe the finding is shown as a possible finding.`;
}
export const NO_FACT_LINE_NOTE = noFactLineNote();

export interface ScreenAnswer {
  suspected: boolean;
  line_ids: string[];
  medicines: string[];
  reason: string;
  missing_facts?: string[];           // only in the answer form of a criterion that needs facts
}

export interface ScreenPartAnswer extends ScreenAnswer {
  listed_line_ids: string[];
}

export type ScreenOutcome =
  | { ok: true; suspected: boolean; result: ScreenResult }
  | { ok: false; error: string };

/** What one part of a long history gave: the answer for the part alone, and the lines that hold a listed medicine. */
export type PartOutcome =
  | { ok: true; suspected: boolean; result: ScreenResult; listed: string[] }
  | { ok: false; error: string };

export interface JobDeps {
  chat?: ChatFn;
  now?: () => Date;
  signal?: AbortSignal;               // stops the model call that is running
}

/**
 * The prompt: system role, then the numbered history, then the criterion, then the task.
 * A criterion that needs facts gets the task that explains the three cases. Every other criterion
 * gets the task it always had.
 */
export function screenMessages(
  patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, partNote = '', task = taskFor(criterion, lines),
  countFrom: HistoryLine[] = lines
): ChatMessage[] {
  // The count is added only when the criterion asks for one. An empty note leaves the prompt as it was.
  const block = criterionBlock(criterion);
  const counted = supplyCountNote(criterion, countFrom);
  const words = counted ? `${block}\n\n${counted}` : block;
  return [
    { role: 'system', content: SCREEN_SYSTEM },
    { role: 'user', content: `${historyBlock(patient, lines, partNote)}\n\n${words}\n\n${task}` }
  ];
}

/** The answer form for one criterion on a history that is read in one call. */
export function screenSchemaFor(criterion: Criterion): JsonSchema {
  return needsFacts(criterion) ? SCREEN_FACTS_SCHEMA : SCREEN_SCHEMA;
}

const SMALL_WORDS = new Set(`
a an and any are as at for from has have in is it its line lines missing no not of on or record recorded records result
results that the there this to was with value values level levels latest recent most
`.split(/\s+/).filter(Boolean));

function factWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word !== '' && !SMALL_WORDS.has(word));
}

/** True when the two names say the same fact: every telling word of one is a word of the other. */
function sameFact(name: string, listed: string): boolean {
  const a = factWords(name);
  const b = factWords(listed);
  if (a.length === 0 || b.length === 0) return false;
  return a.every(word => b.includes(word)) || b.every(word => a.includes(word));
}

/**
 * The facts a model named as missing, tidied. A name that fits exactly one fact of the criterion
 * is written the way the criterion writes it, so the bell and the letter use the signed wording.
 * A name that fits none, or more than one, is kept as the model wrote it: it is never dropped.
 */
export function readMissingFacts(raw: unknown, criterion: Criterion): string[] {
  const listed = (criterion.needs_facts ?? []).map(f => tidyFact(f.what)).filter(what => what !== '');
  const out: string[] = [];
  for (const name of tidyFacts(raw)) {
    const fits = listed.filter(what => sameFact(name, what));
    const fact = fits.length === 1 ? fits[0] : tidyFact(name.slice(0, MISSING_FACT_MAX));
    if (fact !== '' && !out.some(known => known.toLowerCase() === fact.toLowerCase())) out.push(fact);
    if (out.length >= MAX_MISSING_FACTS) break;
  }
  return out;
}

/** The prompt for one part of a long history. It opens the same way for every criterion, so the reading of the part is reused. */
export function screenPartMessages(
  patient: PatientHeader, part: HistoryLine[], criterion: Criterion, index: number, total: number,
  history?: HistoryLine[]
): ChatMessage[] {
  // history is the whole record, so a part is not counted on its own. When it is left out, the part is what is counted.
  return screenMessages(patient, part, criterion, partNoteFor(index, total, part), partTask(criterion), history ?? part);
}

/**
 * Turns the model's answer into a result. Line IDs that do not exist are dropped.
 * A suspected finding is never dropped: when no valid line is left it goes on, marked "lines not verified".
 * The guard is lopsided on purpose: a "no" that names lines of the history is not taken as a plain no.
 * It goes on to the second check and says so.
 *
 * When the criterion needs facts (pass it as the last argument), a suspected finding also carries
 * the facts the record does not show: then it is a possible finding. This guard is lopsided too.
 * A finding that names no missing fact must point to a fact line. When it points to none, it is
 * shown as a possible finding and says so: a fact is never taken as recorded without its line.
 */
export function readScreenAnswer(
  answer: ScreenAnswer, lines: HistoryLine[], model: string, at: string, seconds: number, criterion?: Criterion, who?: string
): { suspected: boolean; result: ScreenResult } {
  const guard = keepKnownLineIds(answer.line_ids, lines);
  const contradiction = answer.suspected !== true && guard.kept.length > 0;
  const suspected = answer.suspected === true || contradiction;
  let reason = clipText(answer.reason, REASON_MAX, screenCutNote(who));
  if (contradiction) reason = `${reason} ${contradictionNote(who)}`.trim();
  let missingFacts: string[] = [];
  if (criterion && needsFacts(criterion) && suspected) {
    missingFacts = readMissingFacts(answer.missing_facts, criterion);
    const namesAFactLine = linesById(lines, guard.kept).some(l => isFactLine(l.text));
    if (missingFacts.length === 0 && !namesAFactLine) {
      missingFacts = readMissingFacts((criterion.needs_facts ?? []).map(f => f.what), criterion);
      reason = `${reason} ${noFactLineNote(who)}`.trim();
    }
  }
  return {
    suspected,
    result: {
      lineIds: guard.kept,
      medicines: mergeNames([answer.medicines]),
      reason,
      linesVerified: guard.kept.length > 0,
      missingFacts,
      model,
      at,
      seconds
    }
  };
}

function lineNumber(id: string): number {
  const n = Number(id.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function inOrder(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => lineNumber(a) - lineNumber(b));
}

function partNoteFor(index: number, total: number, part: HistoryLine[]): string {
  if (total <= 1 || part.length === 0) return '';
  return `This is part ${index + 1} of ${total} of a long history: lines ${part[0].id} to ${part[part.length - 1].id}.`;
}

/** One call to the first model for a history that fits, or for the listed lines of a long history read together. */
export async function screenOnce(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion,
  deps: JobDeps = {}, note = '', latest?: string | null, countFrom?: HistoryLine[]
): Promise<ScreenOutcome> {
  const call = deps.chat ?? chat;
  const at = (deps.now?.() ?? new Date()).toISOString();
  // latest: the latest date of the whole record, given when the lines are only the listed lines of a long history.
  // countFrom: the whole record, so the count is not limited to the lines shown in this call.
  const messages = screenMessages(patient, lines, criterion, note, taskFor(criterion, lines, latest), countFrom ?? lines);
  const answer = await call<ScreenAnswer>(cfg, {
    model: cfg.models.screen,
    think: cfg.think.screen,
    schema: screenSchemaFor(criterion),
    messages,
    numPredict: SCREEN_NUM_PREDICT,
    signal: deps.signal
  });
  if (!answer.ok) return { ok: false, error: answer.error };
  // If the prompt did not fit, the model may not have seen the start of the history. That is never a clear result.
  if (!promptFits(cfg.numCtx, answer.timings.promptTokens, SCREEN_NUM_PREDICT, promptLength(messages))) {
    return { ok: false, error: TOO_LONG_FOR_THE_MODEL };
  }
  return { ok: true, ...readScreenAnswer(answer.value, lines, cfg.models.screen, at, answer.timings.wallSeconds, criterion, cfg.modelNames.screen) };
}

/** One call to the first model for one part of a long history. Never throws. */
export async function screenPart(
  cfg: LanternConfig, patient: PatientHeader, part: HistoryLine[], criterion: Criterion,
  deps: JobDeps, index: number, total: number, history?: HistoryLine[]
): Promise<PartOutcome> {
  try {
    const call = deps.chat ?? chat;
    const at = (deps.now?.() ?? new Date()).toISOString();
    const messages = screenPartMessages(patient, part, criterion, index, total, history);
    const answer = await call<ScreenPartAnswer>(cfg, {
      model: cfg.models.screen,
      think: cfg.think.screen,
      schema: SCREEN_PART_SCHEMA,
      messages,
      numPredict: SCREEN_PART_NUM_PREDICT,
      signal: deps.signal
    });
    if (!answer.ok) return { ok: false, error: answer.error };
    if (!promptFits(cfg.numCtx, answer.timings.promptTokens, SCREEN_PART_NUM_PREDICT, promptLength(messages))) {
      return { ok: false, error: TOO_LONG_FOR_THE_MODEL };
    }
    const read = readScreenAnswer(answer.value, part, cfg.models.screen, at, answer.timings.wallSeconds, undefined, cfg.modelNames.screen);
    return { ok: true, ...read, listed: keepKnownLineIds(answer.value.listed_line_ids, part).kept };
  } catch (e) {
    return { ok: false, error: `The screening step failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The parts a history is screened in: one part when it fits, overlapping parts when it is long. */
export function screenParts(cfg: LanternConfig, lines: HistoryLine[]): HistoryLine[][] {
  return splitIntoParts(lines, cfg.maxLinesPerCall, cfg.overlapLines, historyCharBudget(cfg.numCtx, SCREEN_PART_NUM_PREDICT));
}

function partsSaid(numbers: number[]): string {
  return numbers.length <= 1 ? String(numbers[0] ?? '') : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

/**
 * The end of a long history: Model 1 reads every listed line together, in one more call, and that
 * answer is used. A finding suspected inside one part stays suspected whatever the joined reading says.
 * A part that could not be read is never counted as clear, and neither are listed lines that could
 * not be read together: then the criterion is "could not be screened".
 */
export async function joinParts(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion,
  parts: PartOutcome[], deps: JobDeps = {}, seconds: () => number = () => 0
): Promise<ScreenOutcome> {
  const model = cfg.models.screen;
  const at = (deps.now?.() ?? new Date()).toISOString();
  const read = parts.filter((p): p is Extract<PartOutcome, { ok: true }> => p.ok);
  const failedAt = parts.map((p, i) => (p.ok ? 0 : i + 1)).filter(n => n > 0);
  const firstFailure = parts.find((p): p is Extract<PartOutcome, { ok: false }> => !p.ok);
  const suspected = read.filter(p => p.suspected);
  const gap = failedAt.length > 0
    ? ` Part ${partsSaid(failedAt)} of ${parts.length} of this long history could not be read by the first model.`
    : '';
  const notScreened: ScreenOutcome = {
    ok: false,
    error: `Part ${partsSaid(failedAt)} of ${parts.length} of this long history could not be screened. ${firstFailure?.error ?? ''}`.trim()
  };

  // Every line a part listed or cited, from all parts, in history order.
  // For a criterion that needs facts these are the medicine lines and the fact lines.
  const listed = keepKnownLineIds(read.flatMap(p => [...p.listed, ...p.result.lineIds]), lines).kept;
  const withFacts = needsFacts(criterion);
  // A part suspects a finding only with a fact line in that part, so what the parts give names no missing fact.
  const fromParts = (more = ''): ScreenOutcome => {
    const lineIds = inOrder(suspected.flatMap(p => p.result.lineIds));
    const result: ScreenResult = {
      lineIds,
      medicines: mergeNames(suspected.map(p => p.result.medicines)),
      reason: `${joinDistinct(suspected.map(p => p.result.reason))}${gap}${more ? ' ' + more : ''}`.trim(),
      linesVerified: lineIds.length > 0,
      missingFacts: [],
      model, at, seconds: seconds()
    };
    if (listed.length > 0) result.listedLineIds = listed;
    return { ok: true, suspected: true, result };
  };

  if (listed.length === 0) {
    if (suspected.length > 0) return fromParts();
    if (failedAt.length > 0) return notScreened;
    // A criterion that needs facts is not called clear here: with no medicine line and no fact line
    // the answer still depends on its rule (a medicine that should be there, a fact that is missing).
    // Model 1 is asked once more, below, and told that no line is listed.
    if (!withFacts) {
      return {
        ok: true,
        suspected: false,
        result: {
          lineIds: [], medicines: [],
          reason: `${cfg.modelNames.screen} found no line with a medicine listed for this criterion in any of the ${parts.length} parts of this long history.`,
          linesVerified: false, missingFacts: [], model, at, seconds: seconds()
        }
      };
    }
  }

  const together = linesById(lines, listed);
  if (!fitsInOneCall(together, cfg.maxLinesPerCall, historyCharBudget(cfg.numCtx, SCREEN_NUM_PREDICT))) {
    const why = `${together.length} lines of this long history hold a listed medicine. That is too many to read together in one go.`;
    return suspected.length > 0 ? fromParts(why) : { ok: false, error: why };
  }

  let joined: ScreenOutcome;
  try {
    joined = await screenOnce(cfg, patient, together, criterion, deps, joinedNote(lines.length, together.length, withFacts), latestDate(lines), lines);
  } catch (e) {
    joined = { ok: false, error: `The screening step failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!joined.ok) {
    const why = `The listed lines of this long history could not be read together. ${joined.error}`;
    return suspected.length > 0 ? fromParts(why) : { ok: false, error: why };
  }
  if (joined.suspected) {
    const lineIds = inOrder([...joined.result.lineIds, ...suspected.flatMap(p => p.result.lineIds)]);
    const result: ScreenResult = {
      lineIds,
      medicines: mergeNames([joined.result.medicines, ...suspected.map(p => p.result.medicines)]),
      reason: `${joined.result.reason}${gap}`.trim(),
      linesVerified: lineIds.length > 0,
      // The lines read together are the whole of what the record holds for this criterion,
      // so a fact that has no line among them is missing from the record.
      missingFacts: joined.result.missingFacts,
      model, at, seconds: seconds()
    };
    if (listed.length > 0) result.listedLineIds = listed;
    return { ok: true, suspected: true, result };
  }
  if (suspected.length > 0) return fromParts(`Read together, the listed lines did not meet the rule for ${cfg.modelNames.screen}.`);
  if (failedAt.length > 0) return notScreened;
  const clear: ScreenResult = {
    lineIds: [],
    medicines: joined.result.medicines,
    reason: joined.result.reason,
    linesVerified: false,
    missingFacts: [],
    model, at, seconds: seconds()
  };
  if (listed.length > 0) clear.listedLineIds = listed;
  return { ok: true, suspected: false, result: clear };
}

/**
 * Screens one history against one criterion. A history longer than maxLinesPerCall is read in
 * overlapping parts, and then the lines that hold a listed medicine are read together.
 * A model failure comes back as { ok: false }: it means "could not be screened", never "no finding".
 */
export async function screenCriterion(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, deps: JobDeps = {}
): Promise<ScreenOutcome> {
  if (lines.length === 0) return { ok: false, error: 'The history has no lines to screen.' };
  const started = performance.now();
  const seconds = (): number => Math.round((performance.now() - started) / 10) / 100;
  const parts = screenParts(cfg, lines);
  if (parts.length === 1) {
    try {
      return await screenOnce(cfg, patient, lines, criterion, deps);
    } catch (e) {
      return { ok: false, error: `The screening step failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const outcomes: PartOutcome[] = [];
  for (let i = 0; i < parts.length; i++) outcomes.push(await screenPart(cfg, patient, parts[i], criterion, deps, i, parts.length, lines));
  return joinParts(cfg, patient, lines, criterion, outcomes, deps, seconds);
}

/** Where a screening of several criteria is up to. */
export interface ScreenStep {
  part: number;                       // 1-based; 0 while the listed lines are read together
  parts: number;
  criterion: number;                  // 1-based place in the list given
  criteria: number;
}

export interface ScreenHooks {
  /** Called before every model call. */
  onStep?(step: ScreenStep): void;
  /** Called once for each criterion, as soon as its result is known. seconds is the time spent in its calls. */
  onResult?(index: number, outcome: ScreenOutcome, seconds: number): void;
}

/**
 * Screens one history against several criteria.
 * A history that fits: one criterion after another, as before.
 * A long history: the parts are the outer loop and the criteria the inner one, so the model reads
 * each part once and reuses that reading for every criterion (docs/SPEC.md section 3). Then, for
 * each criterion, the listed lines are read together. The results are the same as screenCriterion
 * gives one criterion at a time; only the order of the calls differs.
 */
export async function screenHistory(
  cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criteria: Criterion[],
  deps: JobDeps = {}, hooks: ScreenHooks = {}
): Promise<ScreenOutcome[]> {
  const out: ScreenOutcome[] = [];
  const since = (t0: number): number => Math.round((performance.now() - t0) / 10) / 100;
  const parts = lines.length === 0 ? [lines] : screenParts(cfg, lines);
  if (parts.length === 1) {
    for (let c = 0; c < criteria.length; c++) {
      hooks.onStep?.({ part: 1, parts: 1, criterion: c + 1, criteria: criteria.length });
      const t0 = performance.now();
      const outcome = await screenCriterion(cfg, patient, lines, criteria[c], deps);
      out.push(outcome);
      hooks.onResult?.(c, outcome, since(t0));
    }
    return out;
  }

  const perCriterion: PartOutcome[][] = criteria.map(() => []);
  const spent = criteria.map(() => 0);
  for (let p = 0; p < parts.length; p++) {
    for (let c = 0; c < criteria.length; c++) {
      hooks.onStep?.({ part: p + 1, parts: parts.length, criterion: c + 1, criteria: criteria.length });
      const t0 = performance.now();
      perCriterion[c].push(await screenPart(cfg, patient, parts[p], criteria[c], deps, p, parts.length, lines));
      spent[c] += since(t0);
    }
  }
  for (let c = 0; c < criteria.length; c++) {
    hooks.onStep?.({ part: 0, parts: parts.length, criterion: c + 1, criteria: criteria.length });
    const t0 = performance.now();
    const total = (): number => Math.round((spent[c] + since(t0)) * 100) / 100;
    const outcome = await joinParts(cfg, patient, lines, criteria[c], perCriterion[c], deps, total);
    out.push(outcome);
    hooks.onResult?.(c, outcome, total());
  }
  return out;
}
