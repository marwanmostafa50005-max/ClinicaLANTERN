// The pharmacist's questions. One fact is asked once. An answer is a fact line on the history.
// Nothing here calls a model. The engine screens again, through the queue it already has.
import fs from 'node:fs';
import type {
  CaseRecord, Criterion, FactEffect, FactKind, FactOption, Finding, HistoryLine, Letter,
  MedicineGroup, NeededFact, PharmacistQuestion
} from '../shared/types.ts';
import { FACT_WORDS, criterionWaitsOnAnswer, enteredAtTheCounter, isFactLine, isPossible, linkWhy, missingFactsOf, tidyFact } from '../shared/facts.ts';
import { letterFindingIds } from '../shared/patient-letter.ts';
import { lineId } from '../pipeline/csv.ts';
import { longDate, monthsBefore } from '../pipeline/dates.ts';
import { analyteName, analytesForFact } from '../pipeline/pathology.ts';
import { nextId } from './store.ts';

export const PHARMACIST_MARK = 'Entered by the pharmacist at the counter.';
export const TAKEN_BACK_MARK = 'Taken back by the pharmacist at the counter.';

export interface ConditionMarkerMedicine {
  ingredient: string;
  brands: string[];
  forms: string[];
}

export interface ConditionMarker {
  condition: string;
  question: string;
  fact_names: string[];
  points_to_it: ConditionMarkerMedicine[];
  also_used_for_it: ConditionMarkerMedicine[];
  recent_days?: number;
}

export interface ConditionInPlay {
  groups: string[];
  all_of: boolean;
}

export interface ConditionMarkerData {
  markers: ConditionMarker[];
  inPlay: Record<string, ConditionInPlay>;
}

const unreadableMarkerFiles = new Set<string>();

function markerMedicine(raw: unknown): ConditionMarkerMedicine {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const ingredient = typeof value.ingredient === 'string' ? value.ingredient.trim() : '';
  if (!ingredient) throw new Error('A marker medicine has no ingredient.');
  const names = (input: unknown): string[] => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : [];
  return { ingredient, brands: names(value.brands), forms: names(value.forms) };
}

function markerInPlay(raw: unknown): ConditionInPlay {
  const value = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  if (!Array.isArray(value.groups) || value.groups.length === 0 ||
      value.groups.some(group => typeof group !== 'string' || group.trim() === '') ||
      typeof value.all_of !== 'boolean') {
    throw new Error('needs a non-empty "groups" list of group keys and boolean "all_of"');
  }
  return { groups: value.groups.map(group => group.trim()), all_of: value.all_of };
}

/** Reads the shared list. Missing or unreadable leaves behavior unchanged; an unreadable file is logged once. */
export function loadConditionMarkerData(file: string, log: (line: string) => void): ConditionMarkerData {
  if (!fs.existsSync(file)) return { markers: [], inPlay: {} };
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const root = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    if (!Array.isArray(root.conditions)) throw new Error('The "conditions" list is missing.');
    const markers = root.conditions.map((entry: unknown): ConditionMarker => {
      const value = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      const condition = typeof value.condition === 'string' ? value.condition.trim() : '';
      const question = typeof value.question === 'string' ? value.question.trim() : '';
      const factNames = Array.isArray(value.fact_names)
        ? value.fact_names.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
        : [];
      if (!condition || !question || factNames.length === 0) {
        throw new Error('A condition needs "condition", "question" and "fact_names".');
      }
      const recentDays = typeof value.recent_days === 'number' && Number.isInteger(value.recent_days) && value.recent_days >= 1
        ? value.recent_days
        : undefined;
      if (value.recent_days !== undefined && recentDays === undefined) {
        log(`${file} condition "${condition}" recent_days was ignored: needs a whole number of 1 or more`);
      }
      return {
        condition,
        question,
        fact_names: factNames,
        points_to_it: Array.isArray(value.points_to_it) ? value.points_to_it.map(markerMedicine) : [],
        also_used_for_it: Array.isArray(value.also_used_for_it) ? value.also_used_for_it.map(markerMedicine) : [],
        ...(recentDays === undefined ? {} : { recent_days: recentDays })
      };
    });
    const inPlay: Record<string, ConditionInPlay> = {};
    if (root.in_play !== undefined) {
      if (typeof root.in_play !== 'object' || root.in_play === null || Array.isArray(root.in_play)) {
        log(`${file} in_play was left out: needs an object keyed by criterion id`);
      } else {
        for (const [id, entry] of Object.entries(root.in_play)) {
          try {
            if (!id.trim()) throw new Error('needs a criterion id');
            inPlay[id] = markerInPlay(entry);
          } catch (error) {
            log(`${file} in_play entry "${id}" was left out: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    return { markers, inPlay };
  } catch (error) {
    if (!unreadableMarkerFiles.has(file)) {
      unreadableMarkerFiles.add(file);
      log(`${file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { markers: [], inPlay: {} };
  }
}

export function loadConditionMarkers(file: string, log: (line: string) => void): ConditionMarker[] {
  return loadConditionMarkerData(file, log).markers;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function factKey(kind: string, what: string): string {
  return `${kind}\n${what.trim().toLowerCase()}`;
}

export function defaultOptions(kind: NeededFact['kind']): FactOption[] {
  if (kind === 'result') return [{ words: 'Not known', effect: 'unknown' }];
  return [
    { words: 'Yes', effect: 'meets' },
    { words: 'No', effect: 'does_not_meet' },
    { words: 'Not known', effect: 'unknown' }
  ];
}

/** A result, the age, or a daily dose is typed. A fact that already has its own buttons is not. */
export function needsAValue(fact: { kind: NeededFact['kind']; what: string; options?: FactOption[] }): boolean {
  if (fact.options && fact.options.length > 0) return false;
  if (fact.kind === 'result') return true;
  const what = fact.what.trim().toLowerCase();
  return what === 'age' || what.includes('daily dose');
}

interface AgeBound { kind: 'floor' | 'ceiling'; age: number; inclusive: boolean }

const AGE_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', eighteen: '18'
};

/** A number written as a word is read as a digit. "younger than three years" is the same as "younger than 3 years". */
function ageText(raw: string): string {
  const plain = raw.replace(/[\u00a0\u2009\u202f]/g, ' ');
  return plain.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen)\b/gi,
    (word) => AGE_WORDS[word.toLowerCase()] ?? word);
}

function addBound(bounds: AgeBound[], raw: string | undefined, kind: AgeBound['kind'], inclusive: boolean): void {
  const age = Number(raw);
  // 0 is a baby in the first year. "under 12 months" is that ceiling.
  if (Number.isInteger(age) && age >= 0 && age <= 120) bounds.push({ kind, age, inclusive });
}

/** A sentence that says who the criterion is not for. Its ages are not a second limit. */
function negativeSentence(sentence: string): boolean {
  return /not a finding|falls outside|fall outside|exclude|do not apply|does not apply|outside this/i.test(sentence);
}

const ORDINAL_WORD = '(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)';
const ORDINAL_TOKEN = `${ORDINAL_WORD}|\\d{1,3}(?:st|nd|rd|th)`;
const ORDINAL_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90
};
const ORDINAL_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

/** first to twentieth, a ten with or without a unit, or digits with the right st, nd, rd or th. */
function ordinalNumber(raw: string): number | undefined {
  const token = raw.toLowerCase();
  const digit = /^(\d+)(st|nd|rd|th)$/.exec(token);
  if (digit) {
    const age = Number(digit[1]);
    if (!Number.isInteger(age) || age < 1 || age > 120) return undefined;
    const mod100 = age % 100;
    const mod10 = age % 10;
    const expected = (mod100 >= 11 && mod100 <= 13) ? 'th'
      : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
    return digit[2] === expected ? age : undefined;
  }
  const listed = ORDINAL_UNITS[token];
  if (listed !== undefined) return listed;
  const parts = token.split('-');
  const tens = parts.length === 2 ? ORDINAL_TENS[parts[0]] : undefined;
  const unit = parts.length === 2 ? ORDINAL_UNITS[parts[1]] : undefined;
  if (tens !== undefined && unit !== undefined && unit < 10) return tens + unit;
  return undefined;
}

/**
 * A birthday is an age. "before" and "until" leave that birthday out.
 * "on or after", "from" and "has reached" take that birthday in.
 * A "no finding" sentence states the other side of the same cut, so it is not a second limit.
 */
function addBirthdayBounds(bounds: AgeBound[], sentence: string): void {
  if (/\bno finding\b/i.test(sentence)) return;
  const whose = "(?:(?:child|patient|person)['\u2019]s|his|her|their)";
  const ceiling = new RegExp(
    `(?:before\\s+(?:(?:a|the)\\s+${whose}\\s+|(?:his|her|their)\\s+|the\\s+)|until\\s+the\\s+)(${ORDINAL_TOKEN})\\s+birthday`,
    'gi');
  const floor = new RegExp(
    `(?:on\\s+or\\s+after\\s+the\\s+|from\\s+the\\s+|has\\s+reached\\s+the\\s+)(${ORDINAL_TOKEN})\\s+birthday`,
    'gi');
  for (const match of sentence.matchAll(ceiling)) {
    const age = ordinalNumber(match[1] ?? '');
    if (age !== undefined) addBound(bounds, String(age), 'ceiling', false);
  }
  for (const match of sentence.matchAll(floor)) {
    const age = ordinalNumber(match[1] ?? '');
    if (age !== undefined) addBound(bounds, String(age), 'floor', true);
  }
}

/** Ages in one sentence. A dose or a lab value is not an age: "below" and "above" count only with years or the word age. */
function boundsIn(sentence: string): AgeBound[] {
  const bounds: AgeBound[] = [];
  const add = (raw: string | undefined, kind: AgeBound['kind'], inclusive: boolean): void => addBound(bounds, raw, kind, inclusive);
  addBirthdayBounds(bounds, sentence);
  for (const match of sentence.matchAll(/(?:aged|age)\s+over\s+(\d+)|older than\s+(\d+)/gi)) add(match[1] ?? match[2], 'floor', false);
  for (const match of sentence.matchAll(/(?:people|patients|adults|persons|person|patient|those)\s+over\s+(\d+)/gi)) add(match[1], 'floor', false);
  for (const match of sentence.matchAll(/\bover\s+(\d+)\s+years\b/gi)) add(match[1], 'floor', false);
  for (const match of sentence.matchAll(/\b(?:aged|age)\s+above\s+(\d+)|\babove\s+(\d+)\s+years\b/gi)) add(match[1] ?? match[2], 'floor', false);
  for (const match of sentence.matchAll(/(?:aged\s+)?(\d+)\s*(?:years?\s+)?(?:or older|or over|and older|and over)/gi)) add(match[1], 'floor', true);
  for (const match of sentence.matchAll(/aged\s*(?:≥|>=)\s*(\d+)/gi)) add(match[1], 'floor', true);
  for (const match of sentence.matchAll(/\b(?:at least|aged at least)\s+(\d+)\s+years\b/gi)) add(match[1], 'floor', true);
  for (const match of sentence.matchAll(/\bfrom age\s+(\d+)\b/gi)) add(match[1], 'floor', true);
  for (const match of sentence.matchAll(/\b(?:aged|age)\s+under\s+(\d+)|\byounger than\s+(\d+)/gi)) add(match[1] ?? match[2], 'ceiling', false);
  // "life expectancy likely under three years" is a duration, not an age.
  for (const match of sentence.matchAll(/\bunder\s+(\d+)\s+years\b/gi)) {
    const before = sentence.slice(Math.max(0, (match.index ?? 0) - 48), match.index ?? 0);
    if (/expectancy|\blife\b/i.test(before)) continue;
    add(match[1], 'ceiling', false);
  }
  for (const match of sentence.matchAll(/\b(?:aged|age)\s+below\s+(\d+)|\bbelow\s+(\d+)\s+years\b|\bbelow age\s+(\d+)/gi)) add(match[1] ?? match[2] ?? match[3], 'ceiling', false);
  for (const match of sentence.matchAll(/(\d+)\s*(?:years?\s+)?(?:or younger|or under|and younger|and under)/gi)) add(match[1], 'ceiling', true);
  for (const match of sentence.matchAll(/\b(?:aged|age|adults?)\s*<\s*(\d+)\s+years\b/gi)) add(match[1], 'ceiling', false);
  for (const match of sentence.matchAll(/\boutside ages\s+(\d+)\s+to\s+(\d+)\b/gi)) {
    add(match[1], 'floor', true);
    add(match[2], 'ceiling', true);
  }
  for (const match of sentence.matchAll(/\baged\s+(\d+)\s+to\s+under\s+(\d+)\b/gi)) {
    add(match[1], 'floor', true);
    add(match[2], 'ceiling', false);
  }
  for (const match of sentence.matchAll(/\baged\s+(\d+)\s+to\s+(\d+)\b/gi)) {
    add(match[1], 'floor', true);
    add(match[2], 'ceiling', true);
  }
  for (const match of sentence.matchAll(/\b(?:at\s+)?ages\s+(\d+)\s+to\s+(\d+)\s+inclusive\b/gi)) {
    add(match[1], 'floor', true);
    add(match[2], 'ceiling', true);
  }
  for (const match of sentence.matchAll(/\b(?:child|children|infant)\s+under\s+(\d+)\b(?!\s*(?:months|days|kg|mg))/gi)) add(match[1], 'ceiling', false);
  for (const match of sentence.matchAll(/\bthrough age\s+(\d+)\b/gi)) add(match[1], 'ceiling', true);
  for (const match of sentence.matchAll(/\bthrough\s+(\d+)\s+years\b/gi)) add(match[1], 'ceiling', true);
  for (const match of sentence.matchAll(/\bat least\s+(\d+)\s+at supply\b/gi)) add(match[1], 'floor', true);
  // "under 12 months" is the first birthday. A whole-year age of 0 is the only year inside it.
  if (/\b(age|aged|infant|child|children)\b/i.test(sentence)) {
    for (const match of sentence.matchAll(/\b(?:aged|age)\s*<\s*(\d+)\s*months\b|\bunder\s+(\d+)\s+months\b/gi)) {
      const months = Number(match[1] ?? match[2]);
      if (Number.isInteger(months) && months >= 1) add(String(Math.floor((months - 1) / 12)), 'ceiling', true);
    }
  }
  return bounds;
}

/** The sentence says some ages are left out. Those words are not a second, opposite limit. */
function leavesTheseAgesOut(sentence: string): boolean {
  return /\bno finding\b|\bno omission\b|\brules out\b|\bgives? no\b|\bnot a finding\b/i.test(sentence);
}

/**
 * "no finding below age N", "no finding under age N" and "no finding before age N"
 * are the same cut as "from age N": N itself is included.
 * "age N or under" leaves N out, the same cut as "over N".
 * The cut is kept aside and used only when the rest of the text states no floor.
 */
function exclusionFloors(sentence: string): { rest: string; floors: AgeBound[] } {
  const floors: AgeBound[] = [];
  if (!leavesTheseAgesOut(sentence)) return { rest: sentence, floors };
  let rest = sentence;
  const take = (re: RegExp, inclusive: boolean): void => {
    rest = rest.replace(re, (_full, n: string) => {
      addBound(floors, n, 'floor', inclusive);
      return ' ';
    });
  };
  take(/\bno finding\s+(?:below|under|before)\s+age\s+(\d+)\b/gi, true);
  take(/\b(?:below|under|before)\s+(\d+)\s*,?\s+gives? no\b/gi, true);
  take(/\b(?:below|under|before)\s+age\s+(\d+)\b/gi, true);
  take(/\b(?:age|aged)\s+(?:below|under)\s+(\d+)\b/gi, true);
  take(/\b(?:age|aged)\s+(\d+)\s+or\s+(?:younger|under)\b/gi, false);
  return { rest, floors };
}

/**
 * "Age 18 or older ... gives no finding" leaves the older ages out.
 * It is a ceiling. It is not a floor.
 */
function olderAgesLeftOut(sentence: string): { age?: string; rest: string } {
  const forward = /\b(?:age|aged)\s+(?:of\s+)?(\d+)\s+or\s+(?:older|over)\b([^.]{0,60}?)\s+(?:gives|give) no\b/i.exec(sentence);
  const reverse = /\b(?:gives|give) no\b[^.]{0,50}?\b(?:age|aged)\s+(?:of\s+)?(\d+)\s+or\s+(?:older|over)\b/i.exec(sentence);
  const match = forward ?? reverse;
  if (!match || match.index === undefined) return { rest: sentence };
  const age = forward ? forward[1] : reverse?.[1];
  const head = sentence.slice(0, match.index);
  const tail = sentence.slice(match.index).replace(/\b\d+\s+or\s+(?:older|over)\b/i, ' ');
  return { age, rest: head + tail };
}

// "Child-Pugh" is a liver grade. "child-bearing" is an age with no number, and it still matches.
const UNREAD_AGE = /\b(older people|elderly|children|paediatric|pediatric|infant|neonate|adolescent|adults?)\b|\bchild\b(?![\s-]*pugh\b)/i;

/** The loosest floor and the loosest ceiling. A dose such as "CrCl below 30" is not a ceiling. */
function parseAge(raw: string): { floor?: AgeBound; ceiling?: AgeBound; unread: boolean } {
  const text = ageText(raw);
  // "aged 65 or over, or ... at any age (cite that line below age 65)" is not a gate.
  if (/\bat any age\b/i.test(text) && /\bbelow age\s+\d+/i.test(text)) return { unread: false };
  const bounds: AgeBound[] = [];
  const sparedFloors: AgeBound[] = [];
  for (const sentence of text.split(/[.;]/)) {
    // A sentence that starts "From age N" keeps that floor when it also says "no such supply".
    const fromStart = /^\s*from age\s+(\d+)\b/i.exec(sentence);
    if (fromStart) addBound(bounds, fromStart[1], 'floor', true);
    const cut = exclusionFloors(sentence);
    sparedFloors.push(...cut.floors);
    const older = olderAgesLeftOut(cut.rest);
    if (older.age) addBound(bounds, older.age, 'ceiling', false);
    if (negativeSentence(sentence) && !fromStart) continue;
    bounds.push(...boundsIn(older.rest));
  }
  if (!bounds.some(bound => bound.kind === 'floor')) bounds.push(...sparedFloors);
  const floors = bounds.filter(bound => bound.kind === 'floor');
  const ceilings = bounds.filter(bound => bound.kind === 'ceiling');
  const floor = floors.reduce<AgeBound | undefined>((best, item) => {
    if (!best) return item;
    const gate = item.inclusive ? item.age : item.age + 1;
    const bestGate = best.inclusive ? best.age : best.age + 1;
    return gate < bestGate ? item : best;
  }, undefined);
  const ceiling = ceilings.reduce<AgeBound | undefined>((best, item) => {
    if (!best) return item;
    const gate = item.inclusive ? item.age : item.age - 1;
    const bestGate = best.inclusive ? best.age : best.age - 1;
    return gate > bestGate ? item : best;
  }, undefined);
  const min = floor ? (floor.inclusive ? floor.age : floor.age + 1) : 0;
  const max = ceiling ? (ceiling.inclusive ? ceiling.age : ceiling.age - 1) : 200;
  if (floor && ceiling && min > max) return { unread: true };
  if (!floor && !ceiling && UNREAD_AGE.test(text)) return { unread: true };
  return { floor, ceiling, unread: false };
}

/** Said on the question when the criterion names an age and the words could not be read. The question is still asked. */
export const AGE_LIMIT_UNREAD = 'The age limit could not be read.';

function textForAgeLimit(criterion: Criterion): string {
  const factNames = (criterion.needs_facts ?? []).map(fact =>
    fact.what.split(/\s*(?:\(|,)|\s+or\s+/)[0].trim().toLowerCase()
  ).filter(name => name.length >= 4);
  const raw = `${criterion.statement}\n${criterion.rule_for_models}`;
  if (factNames.length === 0) return raw;
  return raw.split(/\n|(?<=[.;])\s+/).filter(sentence => {
    const lower = sentence.toLowerCase();
    const absentFact = factNames.some(name => {
      if (!lower.includes(name)) return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(
        `\\b(?:no|without)\\b[^.;]{0,60}\\b${escaped}\\b[^.;]{0,30}\\b(?:row|line|fact)\\b|` +
        `\\b${escaped}\\b[^.;]{0,60}\\b(?:row|line|fact)\\b[^.;]{0,30}\\b(?:missing|unknown|absent|negative)\\b`,
        'i'
      ).test(sentence);
    });
    const namesFact = factNames.some(name => lower.includes(name));
    const vagueRiskAge = namesFact && /\b(?:elderly|older people|older age)\b/i.test(sentence) && /\brisk\b/i.test(sentence);
    return !absentFact && !vagueRiskAge;
  }).join('\n');
}

/**
 * Whether this patient's age is inside the limit the criterion writes.
 * A floor and a ceiling can both apply. Where more than one floor is written, the lower one is used.
 * A criterion that states no age holds for every patient. An unknown age does not meet a stated limit.
 * When the words look like an age limit and no bound can be read, the question is still asked.
 */
export function readAgeLimit(criterion: Criterion, age: number | undefined): { holds: boolean; note?: string } {
  const parsed = parseAge(textForAgeLimit(criterion));
  if (parsed.unread) return { holds: true, note: AGE_LIMIT_UNREAD };
  if (!parsed.floor && !parsed.ceiling) return { holds: true };
  if (typeof age !== 'number') return { holds: false };
  if (parsed.floor) {
    const ok = parsed.floor.inclusive ? age >= parsed.floor.age : age > parsed.floor.age;
    if (!ok) return { holds: false };
  }
  if (parsed.ceiling) {
    const ok = parsed.ceiling.inclusive ? age <= parsed.ceiling.age : age < parsed.ceiling.age;
    if (!ok) return { holds: false };
  }
  return { holds: true };
}

/** True when the patient's age meets the limit, or the criterion states none that can be read. */
export function ageLimitHolds(criterion: Criterion, age: number | undefined): boolean {
  return readAgeLimit(criterion, age).holds;
}

type NamedSex = 'female' | 'male';

/**
 * The sex named by only_sex. Absent, the standing question is for every sex.
 * The statement and the rule are not read: a warning about one sex is not a limit.
 */
export function sexTheCriterionNames(criterion: Criterion): NamedSex | null {
  if (criterion.only_sex === 'female' || criterion.only_sex === 'male') return criterion.only_sex;
  return null;
}

function readPatientSex(sex: string | undefined): NamedSex | null {
  const value = sex?.trim().toLowerCase();
  if (value === 'f' || value === 'female') return 'female';
  if (value === 'm' || value === 'male') return 'male';
  return null;
}

/**
 * Whether a standing ("always") question is put to this patient.
 * A known age outside the written limit is not asked. A missing age is still asked.
 * only_sex withholds the question from the other sex. Words in the statement are not a sex limit.
 * A missing sex is still asked.
 * A group question does not use this. It still uses readAgeLimit, so a missing age does not ask it.
 */
export function standingQuestionApplies(
  criterion: Criterion, patient: { age?: number; sex?: string }
): { ask: boolean; note?: string } {
  const named = sexTheCriterionNames(criterion);
  const patientSex = readPatientSex(patient.sex);
  if (named && patientSex && named !== patientSex) return { ask: false };
  const limit = readAgeLimit(criterion, patient.age);
  if (typeof patient.age !== 'number') return { ask: true, note: limit.note };
  if (!limit.holds) return { ask: false };
  return { ask: true, note: limit.note };
}

/**
 * The lines a model reads. A taken-back line stays on the case and is left out here.
 * When no line was taken back, the same array is returned.
 */
export function linesForModels(lines: HistoryLine[]): HistoryLine[] {
  if (!lines.some(line => line.text.includes(TAKEN_BACK_MARK))) return lines;
  return lines.filter(line => !line.text.includes(TAKEN_BACK_MARK));
}

/**
 * A standing question the pharmacist may leave unanswered.
 * One a possible finding is waiting on stays on the page, whatever its source.
 */
function dismissableStanding(q: PharmacistQuestion): boolean {
  return q.source === 'patient' && q.status === 'open' && !q.needsValue && q.findingIds.length === 0;
}

/** Leaves every open standing question unanswered. No answer is written, and the question stays open. */
export function leaveStanding(c: CaseRecord): PharmacistQuestion[] {
  const changed: PharmacistQuestion[] = [];
  for (const q of c.questions ?? []) {
    if (!dismissableStanding(q) || q.leftUnanswered) continue;
    q.leftUnanswered = true;
    changed.push(q);
  }
  return changed;
}

/** Shows standing questions that were left unanswered. */
export function showStanding(c: CaseRecord): PharmacistQuestion[] {
  const changed: PharmacistQuestion[] = [];
  for (const q of c.questions ?? []) {
    if (q.source !== 'patient' || !q.leftUnanswered) continue;
    delete q.leftUnanswered;
    changed.push(q);
  }
  return changed;
}

/** A note in brackets at the end of a name is set aside. "Reaptan (with amlodipine)" is compared as "reaptan". */
export function nameForSupplyMatch(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

/** The product field, the second field. Directions and the prescriber are not part of it. */
function productField(text: string): string {
  const parts = text.split('|');
  return (parts.length >= 2 ? parts[1] : text).toLowerCase();
}

/** The name stands as whole words in the product. "iron" does not match inside "spironolactone". */
function wholePhrase(haystack: string, phrase: string): boolean {
  const body = phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!body) return false;
  return new RegExp(`(?:^|[^a-z0-9])${body}(?![a-z0-9])`, 'i').test(haystack);
}

/**
 * A measurement stands in a record as a result or as an observation: a blood pressure taken at a visit is written
 * either way. A needed fact of either kind is held by a line of either kind that names it. A condition is held only
 * by a condition line. (20 November 2026: the final audit made the blood pressure of START-B1 a result, the history
 * records it as an observation, and the pharmacist would have been asked for a reading the record already holds.)
 */
const MEASURED_KINDS: readonly FactKind[] = ['result', 'observation'];

function recordHoldsFact(lines: HistoryLine[], fact: NeededFact): boolean {
  const kinds = (MEASURED_KINDS.includes(fact.kind) ? MEASURED_KINDS : [fact.kind]).map(kind => FACT_WORDS[kind].toLowerCase());
  return lines.some(line => {
    if (line.text.includes(TAKEN_BACK_MARK)) return false;
    const fields = line.text.split('|');
    return kinds.includes(fields[1]?.trim().toLowerCase() ?? '') && wholePhrase(fields.slice(2).join('|'), fact.what);
  });
}

/**
 * True when a supply line holds an ingredient or a brand this criterion lists.
 * A fact line is not a supply. A note in brackets at the end of a listed name is set aside.
 */
export function listedMedicineSupplied(lines: HistoryLine[], criterion: Criterion): boolean {
  const names: string[] = [];
  for (const group of criterion.medicine_groups) {
    for (const name of [...group.ingredients, ...Object.values(group.brands).flat()]) {
      const bare = nameForSupplyMatch(name);
      if (bare.length >= 3 && !names.includes(bare)) names.push(bare);
    }
  }
  if (names.length === 0) return false;
  return lines.some(line => {
    if (isFactLine(line.text) || line.text.includes(TAKEN_BACK_MARK)) return false;
    const text = line.text.toLowerCase();
    return names.some(name => text.includes(name));
  });
}

/** An ask-when question for this criterion has been answered. A possible finding's link does not count. */
export function askWhenAnswered(c: CaseRecord, criterionId: string): boolean {
  return (c.questions ?? []).some(q => {
    if (q.status !== 'answered') return false;
    const why = linkWhy(q, criterionId);
    return why === 'patient' || why === 'supply';
  });
}

export function groupIsSupplied(lines: HistoryLine[], group: MedicineGroup | undefined): boolean {
  if (!group) return false;
  return lines.some(line => supplyLineMatchesGroup(line, group));
}

function supplyLineMatchesGroup(line: HistoryLine, group: MedicineGroup): boolean {
  const names = namesOfGroup(group);
  if (names.length === 0 || isFactLine(line.text) || line.text.includes(TAKEN_BACK_MARK)) return false;
  const text = line.text.toLowerCase();
  return names.some(name => text.includes(name));
}

const KNOWN_FORM_PIECES = [
  'tablet', 'inject', 'infus', 'vial', 'ampoule', 'syringe', 'pen', 'depot',
  'capsule', 'liquid', 'solution', 'suspension', 'syrup', 'mixture', 'elixir',
  'powder', 'sachet', 'granule', 'wafer', 'lozenge', 'chew', 'oral', 'patch',
  'sublingual', 'spray', 'gel', 'dialysis', 'nasal', 'inhal', 'haler', 'puffer',
  'nebul', 'supposit', 'rectal', 'enema', 'foam', 'pastille', 'pessar', 'vaginal',
  'cream', 'eye', 'ointment'
];
const KNOWN_FORM_PATTERNS = KNOWN_FORM_PIECES.map(form =>
  new RegExp(`(^|[^a-z])${form}${form === 'pen' ? '([^a-z]|$)' : ''}`)
);

const SHORT_FORMS = [
  { pattern: /\btabs?\b/i, pieces: ['tablet'] },
  { pattern: /\bcaps?\b/i, pieces: ['capsule'] },
  { pattern: /\binj\b/i, pieces: ['inject', 'infus', 'vial', 'ampoule', 'syringe', 'pen', 'depot'] },
  { pattern: /\binh\b/i, pieces: ['inhal', 'haler', 'puffer', 'nebul'] }
];

function formLimitAllows(product: string, forms: string[]): boolean {
  if (forms.length === 0) return true;
  const allowed = forms.map(form => form.trim().toLowerCase());
  if (allowed.some(form => product.includes(form))) return true;
  const short = SHORT_FORMS.filter(item => item.pattern.test(product));
  if (short.some(item => item.pieces.some(form => allowed.includes(form)))) return true;
  if (short.length > 0) return false;
  return !KNOWN_FORM_PATTERNS.some(pattern => pattern.test(product));
}

interface ConditionMarkerMatch {
  marker: ConditionMarker;
  lines: HistoryLine[];
}

function conditionMarkerMatches(lines: HistoryLine[], markers: ConditionMarker[]): ConditionMarkerMatch[] {
  const matches: ConditionMarkerMatch[] = [];
  const end = markers.some(marker => marker.recent_days !== undefined) ? newestSupplyDate(lines) : null;
  for (const marker of markers) {
    const matched = lines.filter(line => {
      if (marker.recent_days !== undefined) {
        const date = supplyLineDate(line.text);
        if (!date || !end || date > end) return false;
        const elapsed = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
        if (!Number.isFinite(elapsed) || elapsed > marker.recent_days) return false;
      }
      return marker.points_to_it.some(medicine => {
        const group: MedicineGroup = {
          key: 'MARKER', name: marker.condition, ingredients: [medicine.ingredient],
          brands: { [medicine.ingredient]: medicine.brands }
        };
        return supplyLineMatchesGroup(line, group) && formLimitAllows(productField(line.text), medicine.forms);
      });
    });
    if (matched.length > 0) matches.push({ marker, lines: matched });
  }
  return matches;
}

function productAsWritten(text: string): string {
  const parts = text.split('|');
  return (parts.length >= 2 ? parts[1] : text).trim();
}

function conditionMarkerReason(match: ConditionMarkerMatch): string {
  const names = match.lines.slice(0, 2).map(line => productAsWritten(line.text));
  const more = match.lines.length - names.length;
  if (names.length === 1) {
    return `Asked because ${names[0]} is supplied; it points to ${match.marker.condition}.`;
  }
  const listed = more > 0 ? `${names[0]}, ${names[1]} and ${more} more` : `${names[0]} and ${names[1]}`;
  return `Asked because ${listed} are supplied; they point to ${match.marker.condition}.`;
}

/** How many months close_when uses when the criterion does not name its own number. */
const CLOSE_WHEN_MONTHS = 6;

function namesOfGroup(group: MedicineGroup): string[] {
  return [...group.ingredients, ...Object.values(group.brands).flat()]
    .map(name => nameForSupplyMatch(name))
    .filter(name => name.length >= 3);
}

/** The date at the start of a supply line. A fact, a taken-back line and a counter line are not supplies. */
function supplyLineDate(text: string): string | null {
  if (isFactLine(text) || text.includes(TAKEN_BACK_MARK) || enteredAtTheCounter(text)) return null;
  const found = /^(\d{4}-\d{2}-\d{2})(?= \||$)/.exec(text);
  return found ? found[1] : null;
}

function newestSupplyDate(lines: HistoryLine[]): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    const date = supplyLineDate(line.text);
    if (date && (latest === null || date > latest)) latest = date;
  }
  return latest;
}

/**
 * True when a supply of this group falls in the calendar months ending on the newest supply date.
 * A date on the cut is inside. No readable supply date does not count as recent.
 */
export function groupSuppliedRecently(lines: HistoryLine[], group: MedicineGroup | undefined, months: number): boolean {
  if (!group || !Number.isInteger(months) || months < 1) return false;
  const end = newestSupplyDate(lines);
  if (!end) return false;
  const cut = monthsBefore(end, months);
  if (!cut) return false;
  const names = namesOfGroup(group);
  if (names.length === 0) return false;
  return lines.some(line => {
    const date = supplyLineDate(line.text);
    if (!date || date < cut || date > end) return false;
    const product = productField(line.text);
    return names.some(name => wholePhrase(product, name));
  });
}

function nextLineId(lines: HistoryLine[]): string {
  let max = 0;
  for (const line of lines) {
    const n = Number(/^L(\d+)$/.exec(line.id)?.[1] ?? '');
    if (Number.isInteger(n) && n > max) max = n;
  }
  return lineId(max + 1);
}

function liveAnswer(line: HistoryLine | undefined): boolean {
  return !!line && enteredAtTheCounter(line.text) && !line.text.includes(TAKEN_BACK_MARK);
}

const LINK_RANK: Record<PharmacistQuestion['source'], number> = { possible: 1, supply: 2, patient: 3 };

/**
 * Records why this criterion shares the question. A later possible finding does not replace a
 * standing or supply link. A standing or supply link that joins a possible question is shown as
 * that link, so the question is no longer treated as only a possible finding.
 */
function rememberLink(q: PharmacistQuestion, criterionId: string, why: PharmacistQuestion['source']): void {
  if (!q.links) {
    q.links = q.criterionIds
      .filter(id => id !== criterionId)
      .map(id => ({ criterionId: id, why: q.source }));
  }
  const found = q.links.find(item => item.criterionId === criterionId);
  if (!found) q.links.push({ criterionId, why });
  else if (LINK_RANK[why] > LINK_RANK[found.why]) found.why = why;
  if (q.status === 'open' && q.source === 'possible' && why !== 'possible') q.source = why;
}

/**
 * Puts a question on the case for each fact that should be asked, and joins two criteria that
 * name the same fact. A question that already has an answer is left as it is.
 */
export function syncCaseQuestions(
  c: CaseRecord, criteria: Criterion[], findings: Finding[], idSource: { id: string }[], markers: ConditionMarker[] = [],
  inPlay: Record<string, ConditionInPlay> = {}
): void {
  const questions = c.questions ?? [];
  const byKey = new Map(questions.map(q => [q.key, q]));
  const markerByFact = new Map<string, ConditionMarkerMatch[]>();
  for (const match of conditionMarkerMatches(c.lines, markers)) {
    for (const name of match.marker.fact_names) {
      const key = name.trim().toLowerCase();
      const listed = markerByFact.get(key) ?? [];
      if (!listed.includes(match)) listed.push(match);
      markerByFact.set(key, listed);
    }
  }

  const ensure = (
    fact: NeededFact, source: PharmacistQuestion['source'], criterionId: string, findingId?: string, note?: string,
    markerMatch?: ConditionMarkerMatch
  ): void => {
    const key = factKey(fact.kind, fact.what);
    let q = byKey.get(key);
    if (!q) {
      q = {
        id: nextId('Q', idSource),
        key,
        kind: fact.kind,
        what: fact.what,
        meets: fact.meets,
        criterionIds: [],
        findingIds: [],
        source,
        status: 'open',
        options: fact.options && fact.options.length > 0 ? fact.options : defaultOptions(fact.kind),
        needsValue: needsAValue(fact),
        ...pathologyOf(fact),
        ...(markerMatch ? {
          conditionMarker: {
            condition: markerMatch.marker.condition,
            question: markerMatch.marker.question,
            lineIds: markerMatch.lines.map(line => line.id)
          }
        } : {})
      };
      questions.push(q);
      idSource.push(q);
      byKey.set(key, q);
    }
    if (q.status === 'open' && markerMatch && !q.conditionMarker) {
      q.conditionMarker = {
        condition: markerMatch.marker.condition,
        question: markerMatch.marker.question,
        lineIds: markerMatch.lines.map(line => line.id)
      };
    }
    if (!q.criterionIds.includes(criterionId)) q.criterionIds.push(criterionId);
    rememberLink(q, criterionId, source);
    if (findingId && !q.findingIds.includes(findingId)) q.findingIds.push(findingId);
    // A question a possible finding waits on is shown, even if it had been left unanswered.
    if (q.findingIds.length > 0) delete q.leftUnanswered;
    if (note && !q.note) q.note = note;
  };

  for (const criterion of criteria) {
    const limit = readAgeLimit(criterion, c.patient.age);
    const standing = standingQuestionApplies(criterion, c.patient);
    for (const fact of criterion.needs_facts ?? []) {
      const markerMatch = markerByFact.get(fact.what.trim().toLowerCase())?.[0];
      const needsOwnSupply = fact.kind !== 'condition' || criterion.id.startsWith('STOPP-');
      const ownSupply = criterion.medicine_groups.length === 0 ||
        criterion.medicine_groups.some(group => groupIsSupplied(c.lines, group));
      const play = fact.kind === 'condition' ? inPlay[criterion.id] : undefined;
      const named = play?.groups.map(key => criterion.medicine_groups.find(group => group.key === key)) ?? [];
      const criterionInPlay = play
        ? play.all_of
          ? named.every(group => groupIsSupplied(c.lines, group))
          : named.some(group => groupIsSupplied(c.lines, group))
        : !needsOwnSupply || ownSupply;
      const held = (fact.ask_when || markerMatch) ? recordHoldsFact(c.lines, fact) : false;
      if (markerMatch && criterionInPlay && !held && limit.holds && standing.ask) {
        const note = [conditionMarkerReason(markerMatch), limit.note ?? standing.note].filter(Boolean).join(' ');
        ensure(fact, 'supply', criterion.id, undefined, note, markerMatch);
      }
      if (fact.ask_when && held) continue;
      if (fact.ask_when === 'always') {
        // A standing question is asked only where this patient is one the criterion covers.
        // A known age outside the written limit is not asked. A missing age is still asked.
        // only_sex withholds the question from the other sex. The words of the rule do not.
        // close_when names a group. The question is not put when a medicine of that group was
        // supplied in the last months (6 when months is absent) ending on the newest supply date.
        // An older supply does not close it. A fact line and a taken-back line are not a supply.
        const named = fact.close_when
          ? criterion.medicine_groups.find(item => item.key === fact.close_when?.group)
          : undefined;
        const months = fact.close_when?.months ?? CLOSE_WHEN_MONTHS;
        if (standing.ask && !groupSuppliedRecently(c.lines, named, months)) {
          ensure(fact, 'patient', criterion.id, undefined, standing.note);
        }
        continue;
      }
      const ask = fact.ask_when;
      if (ask && typeof ask === 'object') {
        const named = criterion.medicine_groups.find(item => item.key === ask.group);
        if (named && groupIsSupplied(c.lines, named) && limit.holds && standing.ask) {
          ensure(fact, 'supply', criterion.id, undefined, limit.note);
        }
      }
    }
  }

  for (const finding of findings) {
    if (finding.caseId !== c.id || !isPossible(finding) || finding.decision) continue;
    const criterion = criteria.find(item => item.id === finding.criterionId);
    if (criterion && !standingQuestionApplies(criterion, c.patient).ask) continue;
    for (const name of missingFactsOf(finding)) {
      const named = (criterion?.needs_facts ?? []).find(fact => fact.what.trim().toLowerCase() === name.trim().toLowerCase());
      const fact: NeededFact = named ?? { kind: 'condition', what: tidyFact(name) || name, meets: tidyFact(name) || name };
      ensure(fact, 'possible', finding.criterionId, finding.id);
    }
  }

  if (questions.length > 0) c.questions = questions;
}

/** Display-only question words. The stored list wording and fact answer keys are not changed. */
export function casesForQuestionDisplay(cases: CaseRecord[]): CaseRecord[] {
  return cases.map(c => {
    const counts = new Map<string, number>();
    for (const q of c.questions ?? []) {
      if (q.status !== 'open' || !q.conditionMarker) continue;
      const words = q.conditionMarker.question;
      counts.set(words, (counts.get(words) ?? 0) + 1);
    }
    if (![...counts.values()].some(count => count > 1)) return c;
    return {
      ...c,
      questions: (c.questions ?? []).map(q => {
        const marker = q.conditionMarker;
        if (q.status !== 'open' || !marker || (counts.get(marker.question) ?? 0) < 2) return q;
        return { ...q, conditionMarker: { ...marker, question: q.what } };
      })
    };
  });
}

/** Criteria whose own standing or supply link is still open: the check has not run. */
export function checksNotRun(c: CaseRecord): string[] {
  const ids: string[] = [];
  for (const q of c.questions ?? []) {
    for (const id of q.criterionIds) {
      if (!criterionWaitsOnAnswer(q, id) || ids.includes(id)) continue;
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Where a result came from when the pharmacist did not type it: an uploaded pathology test, read by
 * pipeline/pathology.ts and confirmed by the pharmacist. Only the name of the file and the one line used are kept.
 */
export interface AnswerSource {
  kind: 'pathology';
  fileName: string;
  page: number;
  line: string;
  readBy: 'text' | 'model';
}

export interface ChosenAnswer {
  words: string;
  effect: FactEffect;
  /** The day the pharmacist answered, yyyy-mm-dd. */
  date: string;
  /** The date of a typed result, when one was given. Absent when the pharmacist gave none. */
  resultDate?: string;
  /** Present when the value was read from an uploaded pathology test. Absent for a value the pharmacist typed. */
  source?: AnswerSource;
}

/** The tests a typed result can be read for from an uploaded pathology test. Nothing when the reader knows none. */
export function pathologyOf(
  fact: { kind: NeededFact['kind']; what: string; options?: FactOption[] }
): { pathology?: { tests: { key: string; name: string }[] } } {
  if (fact.kind !== 'result' || !needsAValue(fact)) return {};
  const tests = analytesForFact(fact.what).map(key => ({ key, name: analyteName(key) }));
  return tests.length > 0 ? { pathology: { tests } } : {};
}

/** Words copied from an uploaded document go into one field of a line: no field mark, no quote mark, one line, not long. */
function sourceWords(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\|/g, '/').replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Reads the source a page sends with a value. Returns nothing when none was sent, and an error when it is not whole. */
export function sourceFrom(raw: unknown): { source?: AnswerSource; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The source of the result could not be read.' };
  const value = raw as Record<string, unknown>;
  const fileName = sourceWords(value.fileName, 120);
  const line = sourceWords(value.line, 200);
  const page = typeof value.page === 'number' && Number.isInteger(value.page) && value.page >= 1 && value.page <= 999 ? value.page : 0;
  const readBy = value.readBy === 'text' || value.readBy === 'model' ? value.readBy : '';
  if (value.kind !== 'pathology' || !fileName || !line || page === 0 || readBy === '') {
    return { error: 'The source of the result could not be read.' };
  }
  return { source: { kind: 'pathology', fileName, page, line, readBy } };
}

function usesDefaultButtons(q: PharmacistQuestion): boolean {
  const defaults = defaultOptions(q.kind);
  if (q.options.length !== defaults.length) return false;
  return q.options.every((item, i) => item.words === defaults[i].words && item.effect === defaults[i].effect);
}

/**
 * The words after the kind on the fact line. The line names the fact.
 * The button's own word stays on the answer the page shows (q.answer.words).
 */
export function factLineDetail(q: PharmacistQuestion, chosen: ChosenAnswer): string {
  const what = q.what.trim();
  if (q.needsValue) return chosen.effect === 'unknown' ? `${what}: not known` : chosen.words.trim();
  if (usesDefaultButtons(q)) {
    if (chosen.effect === 'meets') return what;
    if (chosen.effect === 'does_not_meet') {
      const lower = what.length > 0 ? what.charAt(0).toLowerCase() + what.slice(1) : what;
      return `No ${lower}: the patient does not have it`;
    }
    return `${what}: not known`;
  }
  return `${what}: ${chosen.words.trim()}`;
}

/** Said on a Yes that names no date of its own. The fact is present for the whole record. */
export const PRESENT_THROUGHOUT =
  'The date it began is not recorded: treat it as present throughout this record.';

/**
 * The words after the date field. A chosen answer is dated "no date", so the day of the answer
 * is not read as the day the fact began. A typed result names its own date in that field, and
 * the day of entry in the sentence. The line still says it was entered at the counter, so the
 * span of the record does not move.
 */
export function answerLineText(q: PharmacistQuestion, chosen: ChosenAnswer): string {
  const kind = FACT_WORDS[q.kind];
  const detail = factLineDetail(q, chosen);
  if (q.needsValue) {
    // A value read from an uploaded pathology test says so, with the line it was read from. The pharmacist confirmed it.
    const entry = chosen.source
      ? `Read from the uploaded pathology test "${chosen.source.fileName}" (page ${chosen.source.page}; the line of the report: "${chosen.source.line}") and confirmed by the pharmacist at the counter on ${longDate(chosen.date)}.`
      : `Entered by the pharmacist at the counter on ${longDate(chosen.date)}.`;
    // Not known means no result was entered. The line does not say that only the date is missing.
    if (chosen.effect === 'unknown') return `${kind} | ${detail}. ${entry}`;
    if (!chosen.resultDate) return `${kind} | ${detail}. The date of the result is not recorded. ${entry}`;
    return `${kind} | ${detail}. ${entry}`;
  }
  if (usesDefaultButtons(q) && chosen.effect === 'meets') {
    return `${kind} | ${detail}. The patient has this. Confirmed by the pharmacist at the counter on ${longDate(chosen.date)}. ${PRESENT_THROUGHOUT}`;
  }
  return `${kind} | ${detail}. ${PHARMACIST_MARK}`;
}

/** Writes the fact line and, unless the answer is Not known, marks those criteria to be screened again. */
export function writeAnswer(
  c: CaseRecord, findings: Finding[], letters: Letter[], q: PharmacistQuestion, chosen: ChosenAnswer, at: string
): boolean {
  delete q.leftUnanswered;
  const head = q.needsValue && chosen.resultDate ? chosen.resultDate : 'no date';
  const text = `${head} | ${answerLineText(q, chosen)}`;
  const line: HistoryLine = { id: nextLineId(c.lines), text };
  c.lines.push(line);
  q.answer = { lineId: line.id, words: chosen.words, effect: chosen.effect, at };
  if (chosen.effect === 'unknown') {
    q.status = 'not_known';
    return false;
  }
  const ids = new Set(q.criterionIds);
  q.heldFindings = findings.filter(f => f.caseId === c.id && ids.has(f.criterionId)).map(f => structuredClone(f));
  q.heldRuns = c.screening.criteria.filter(run => ids.has(run.criterionId)).map(run => ({
    criterionId: run.criterionId,
    status: run.status,
    ...(run.reason ? { reason: run.reason } : {})
  }));
  const gone = new Set(q.heldFindings.map(f => f.id));
  for (let i = findings.length - 1; i >= 0; i--) {
    if (gone.has(findings[i].id)) findings.splice(i, 1);
  }
  for (let i = letters.length - 1; i >= 0; i--) {
    const letter = letters[i];
    const held = letterFindingIds(letter);
    if (!held.some(id => gone.has(id))) continue;
    const alreadyOut = letter.status === 'sent' || letter.status === 'reply_recorded' || letter.status === 'closed' || letter.sentAt !== undefined;
    if (alreadyOut) continue;
    const keep = held.filter(id => !gone.has(id));
    if (keep.length === 0) {
      letters.splice(i, 1);
      continue;
    }
    letter.findingIds = keep;
    letter.findingId = keep[0];
    letter.points = (letter.points ?? []).filter(point => keep.includes(point.findingId));
    delete letter.previewedAt;
    delete letter.previewHash;
    delete letter.patientAgreed;
  }
  for (const run of c.screening.criteria) {
    if (!ids.has(run.criterionId)) continue;
    run.status = 'waiting';
    delete run.error;
    delete run.reason;
    delete run.seconds;
  }
  c.screening.status = 'waiting';
  delete c.screening.finishedAt;
  q.status = 'answered';
  return true;
}

/** An answer that is still in force. A taken-back line is not. */
function answerStillStands(item: PharmacistQuestion): boolean {
  if (!item.answer || item.answer.takenBackAt) return false;
  return item.status === 'answered' || item.status === 'not_known';
}

/**
 * Puts the findings back and leaves the fact line in the history, marked as taken back.
 * Returns true when a criterion still has another answer, so that criterion must be screened again
 * from the answers that remain. Its old snapshot is not put back.
 */
export function takeAnswerBack(c: CaseRecord, findings: Finding[], q: PharmacistQuestion, at: string): boolean {
  const line = c.lines.find(item => item.id === q.answer?.lineId);
  if (line && liveAnswer(line)) line.text = `${line.text} ${TAKEN_BACK_MARK}`;
  if (q.answer) q.answer.takenBackAt = at;
  // Not known stores no held findings. The usual restore would delete the finding it left in place.
  if (q.answer?.effect === 'unknown' || q.status === 'not_known') {
    q.status = 'open';
    return false;
  }
  const ids = new Set(q.criterionIds);
  const still = new Set<string>();
  for (const other of c.questions ?? []) {
    if (other.id === q.id || !answerStillStands(other)) continue;
    for (const id of other.criterionIds) if (ids.has(id)) still.add(id);
  }
  const heldIds = new Set((q.heldFindings ?? []).filter(f => !still.has(f.criterionId)).map(f => f.id));
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (f.caseId !== c.id || !ids.has(f.criterionId)) continue;
    if (still.has(f.criterionId) || !heldIds.has(f.id)) findings.splice(i, 1);
  }
  for (const held of q.heldFindings ?? []) {
    if (still.has(held.criterionId)) continue;
    const copy = structuredClone(held);
    const index = findings.findIndex(f => f.id === held.id);
    if (index >= 0) findings[index] = copy;
    else findings.push(copy);
  }
  let again = false;
  for (const held of q.heldRuns ?? []) {
    const run = c.screening.criteria.find(item => item.criterionId === held.criterionId);
    if (!run) continue;
    if (still.has(held.criterionId)) {
      run.status = 'waiting';
      delete run.error;
      delete run.reason;
      again = true;
      continue;
    }
    run.status = held.status;
    if (held.reason) run.reason = held.reason;
    else delete run.reason;
  }
  for (const id of still) {
    const run = c.screening.criteria.find(item => item.criterionId === id);
    again = true;
    if (!run || run.status === 'waiting') continue;
    run.status = 'waiting';
    delete run.error;
    delete run.reason;
  }
  const pending = again || c.screening.criteria.some(run => run.status === 'waiting' || run.status === 'running');
  if (pending) {
    // A restored waiting run is not a finished history. The count of screened histories reads this status.
    c.screening.status = 'waiting';
    delete c.screening.finishedAt;
  } else if (
    c.screening.status === 'waiting' &&
    c.screening.criteria.length > 0 &&
    c.screening.criteria.every(run => run.status !== 'waiting' && run.status !== 'running' && run.status !== 'failed')
  ) {
    // The other answer was taken back too, before the new screen started. Every run is finished.
    c.screening.status = 'done';
    if (!c.screening.finishedAt) c.screening.finishedAt = at;
  }
  q.status = 'open';
  delete q.heldFindings;
  delete q.heldRuns;
  return again;
}

/** Opens a Not known question again. The old line stays, marked as taken back. */
export function reopenQuestion(c: CaseRecord, q: PharmacistQuestion, at: string): void {
  const line = c.lines.find(item => item.id === q.answer?.lineId);
  if (line && liveAnswer(line)) line.text = `${line.text} ${TAKEN_BACK_MARK}`;
  if (q.answer) q.answer.takenBackAt = at;
  q.status = 'open';
}

export function dayOf(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function chosenFrom(
  q: PharmacistQuestion, body: { option?: unknown; value?: unknown; unit?: unknown; date?: unknown; source?: unknown }, today: string
): { error?: string; chosen?: ChosenAnswer } {
  const optionText = typeof body.option === 'string' ? body.option.trim() : '';
  const option = q.options.find(item => item.words === optionText || item.words.toLowerCase() === optionText.toLowerCase());
  if (option && option.effect === 'unknown') {
    return { chosen: { words: option.words, effect: 'unknown', date: today } };
  }
  if (q.needsValue && !option) {
    const value = typeof body.value === 'string' ? body.value.trim() : '';
    const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
    const resultDate = typeof body.date === 'string' ? body.date.trim() : '';
    if (!value) return { error: 'Enter the value, or choose Not known.' };
    if (resultDate !== '' && !DAY.test(resultDate)) {
      return { error: 'The date is written year-month-day, for example 2026-11-19.' };
    }
    const words = [q.what, value, unit].filter(part => part !== '').join(' ');
    const from = sourceFrom(body.source);
    if (from.error) return { error: from.error };
    const recordMark = /[\u0000-\u001f\u007f\u2028\u2029|"]/;
    if (from.source && (recordMark.test(value) || recordMark.test(unit))) {
      return { error: 'The value and unit cannot contain a line break, field mark or quote mark. Type the result again.' };
    }
    return { chosen: { words, effect: 'meets', date: today, ...(resultDate !== '' ? { resultDate } : {}), ...(from.source ? { source: from.source } : {}) } };
  }
  if (!option) return { error: 'Choose one of the answers.' };
  return { chosen: { words: option.words, effect: option.effect, date: today } };
}

/** The words for the page: how many checks are waiting on an answer. */
export function checksNotRunWords(count: number): string {
  if (count === 1) return '1 check could not run until this question is answered.';
  return `${count} checks could not run until these questions are answered.`;
}
