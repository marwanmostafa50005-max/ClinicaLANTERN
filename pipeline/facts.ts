// The letter fact check (docs/SPEC.md section 7.3).
// Every date, every number with a unit and every medicine name in the model's paragraphs must
// appear in the allowed text: the finding's cited lines and the criterion.
// Plain code, no model. It returns one plain sentence per mismatch; an empty list means clean.
import { findDates } from './dates.ts';
import { MEDICINE_NAMES, looksLikeMedicineName } from './medicine-names.ts';

// ---------- amounts: a number with a unit ----------

const UNIT_NAMES: Record<string, string> = {
  microgram: 'mcg', micrograms: 'mcg', mcg: 'mcg', '\u00b5g': 'mcg', '\u03bcg': 'mcg',
  milligram: 'mg', milligrams: 'mg', mg: 'mg',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  gram: 'g', grams: 'g', g: 'g',
  millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  iu: 'iu', unit: 'unit', units: 'unit', mmol: 'mmol', '%': '%', percent: '%',
  // Units of results and observations a record may carry (docs/SPEC.md section 6a).
  mmhg: 'mmhg', umol: 'umol', 'µmol': 'umol', 'μmol': 'umol', micromol: 'umol', nmol: 'nmol', pmol: 'pmol',
  miu: 'miu', mu: 'mu', ng: 'ng', kpa: 'kpa', bpm: 'bpm',
  tablet: 'tablet', tablets: 'tablet', tab: 'tablet', tabs: 'tablet',
  capsule: 'capsule', capsules: 'capsule', cap: 'capsule', caps: 'capsule',
  dose: 'dose', doses: 'dose', puff: 'puff', puffs: 'puff', patch: 'patch', patches: 'patch',
  sachet: 'sachet', sachets: 'sachet', drop: 'drop', drops: 'drop', spray: 'spray', sprays: 'spray',
  ampoule: 'ampoule', ampoules: 'ampoule', vial: 'vial', vials: 'vial',
  repeat: 'repeat', repeats: 'repeat',
  day: 'day', days: 'day', week: 'week', weeks: 'week', month: 'month', months: 'month',
  year: 'year', years: 'year', yr: 'year', yrs: 'year',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour', minute: 'minute', minutes: 'minute'
};

// Units that count items. "30 capsules" is accepted when the lines say "qty 30".
const COUNT_UNITS = new Set(['tablet', 'capsule', 'dose', 'puff', 'patch', 'sachet', 'drop', 'spray', 'ampoule', 'vial', 'qty']);

const UNIT_WORDS = Object.keys(UNIT_NAMES)
  .sort((a, b) => b.length - a.length)
  .map(u => u.replace(/[%]/g, '\\$&'))
  .join('|');
const NUMBER = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const AMOUNT = new RegExp(`(?<![\\w.,/])(${NUMBER})\\s*-?\\s*(${UNIT_WORDS})(?![A-Za-z])`, 'gi');
const QUANTITY = /\b(qty|quantity|quantities|repeats?|rpts?)\b\.?\s*(?:of|:|=|left|remaining)?\s*(\d+)(?![\d.,]*\d)/gi;
// A blood pressure as it is written: "168/94 mmHg".
const PRESSURE = /(?<![\w.,/])(\d{2,3})\s*\/\s*(\d{2,3})\s*mm\s?hg(?![A-Za-z])/gi;
// Any pair such as "150/90". In a record a pair is often a blood pressure with its unit written once
// at the end of the line ("lying 150/90, standing 128/78 mmHg").
const PAIR = /(?<![\w.,/])(\d{2,3})\s*\/\s*(\d{2,3})(?![\d/.]*\d)/g;

export interface Amount { raw: string; value: string; unit: string }

function plainNumber(text: string): string {
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : text;
}

/** Finds numbers with a unit ("200 mg", "72-year", "qty 30", "168/94 mmHg"). Pass text with the dates already blanked out. */
export function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const unit = UNIT_NAMES[m[2].toLowerCase()];
    if (unit) out.push({ raw: m[0].trim(), value: plainNumber(m[1]), unit });
  }
  for (const m of text.matchAll(QUANTITY)) {
    const word = m[1].toLowerCase();
    out.push({ raw: m[0].trim(), value: plainNumber(m[2]), unit: word.startsWith('q') ? 'qty' : 'repeat' });
  }
  for (const m of text.matchAll(PRESSURE)) {
    out.push({ raw: m[0].trim(), value: `${plainNumber(m[1])}/${plainNumber(m[2])}`, unit: 'mmhg' });
  }
  return out;
}

/**
 * The amounts a letter may quote from the allowed text, as "value unit". It is findAmounts, read
 * generously for blood pressures: every pair "150/90" counts as a pressure, whole and in its two
 * parts, because a record line may give the unit once for two readings, and a letter may write
 * "a systolic pressure of 150 mmHg".
 */
export function allowedAmounts(text: string): Set<string> {
  const allowed = new Set(findAmounts(text).map(a => `${a.value} ${a.unit}`));
  for (const m of text.matchAll(PAIR)) {
    const high = plainNumber(m[1]);
    const low = plainNumber(m[2]);
    allowed.add(`${high}/${low} mmhg`);
    allowed.add(`${high} mmhg`);
    allowed.add(`${low} mmhg`);
  }
  return allowed;
}

// ---------- medicine names ----------

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPattern(names: string[]): RegExp | null {
  const list = [...new Set(names.map(n => n.trim().toLowerCase()).filter(n => n.length >= 3))]
    .sort((a, b) => b.length - a.length)
    .map(escapeForPattern);
  if (list.length === 0) return null;
  return new RegExp(`(?<![a-z0-9])(?:${list.join('|')})(?![a-z0-9])`, 'g');
}

const KNOWN_NAMES = wordPattern(MEDICINE_NAMES);

// Words that may sit just before a strength without being a medicine name.
const BEFORE_A_STRENGTH = new Set(`
of to at is was are were be been a an the and or with by as than in for on from per each total only about around
approximately over under above below least most up between dose doses dosage strength daily day taking takes take
taken containing contains contain supplied supply supplies prescribed dispensed tablet tablets capsule capsules
release exceeding exceeds exceed equals equal maximum minimum max min plus another further extra additional
including includes namely both either its their his her this that these those receiving received given use used
using new same higher lower low high increased reduced one two three four five six seven eight nine ten twice
once currently current regular regularly ongoing concurrent concurrently usual usually patient nightly morning
night evening weekly monthly oral orally combined combination standard full half starting initial previous
previously already also still now then just being has have had not but while when after before during
`.split(/\s+/).filter(Boolean));

const NAME_BEFORE_STRENGTH = /([A-Za-z][A-Za-z'-]{2,})\)?,?\s+\d[\d,.]*\s*(?:mg|mcg|micrograms?|milligrams?|g|ml|iu|units?)(?![A-Za-z])/gi;

/** True when the name stands in the text as a whole word. Both must be lower case. */
export function hasWord(lowerText: string, lowerName: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeForPattern(lowerName)}(?![a-z0-9])`).test(lowerText);
}

/**
 * The medicine names written in a piece of text, lower case.
 * Found three ways: a list of common names (plus any names passed in), word endings that mark a
 * medicine name, and any word written just before a strength ("Zentaprex 200 mg").
 */
export function findMedicineNames(text: string, moreNames: string[] = []): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const pattern of [KNOWN_NAMES, wordPattern(moreNames)]) {
    if (!pattern) continue;
    pattern.lastIndex = 0;
    for (const m of lower.matchAll(pattern)) found.add(m[0]);
  }
  for (const m of lower.matchAll(/[a-z]{7,}/g)) {
    if (looksLikeMedicineName(m[0])) found.add(m[0]);
  }
  for (const m of text.matchAll(NAME_BEFORE_STRENGTH)) {
    const word = m[1].toLowerCase().replace(/'s$/, '').replace(/^['-]+|['-]+$/g, '');
    if (word.length >= 3 && !BEFORE_A_STRENGTH.has(word) && !(word in UNIT_NAMES)) found.add(word);
  }
  return [...found];
}

// ---------- the check ----------

/**
 * Checks the model's paragraphs against the allowed text.
 * paragraphs: the subject and the three paragraphs the model wrote (not the whole letter: the
 *   letter head carries today's date and a phone number, which are not facts of the finding).
 * allowedText: the finding's cited lines, the criterion wording and the patient label.
 * moreMedicineNames: optional. Extra names to look for, for example every medicine in the history.
 * Returns one sentence per mismatch. An empty list means the paragraphs are clean.
 */
export function checkLetterFacts(paragraphs: string[], allowedText: string, moreMedicineNames: string[] = []): string[] {
  const written = findDates(paragraphs.filter(p => typeof p === 'string').join('\n'));
  const allowed = findDates(typeof allowedText === 'string' ? allowedText : '');
  const mismatches = new Set<string>();

  // Dates. Any way of writing a date is compared as year-month-day.
  const allowedDays = new Set<string>();
  const allowedMonths = new Set<string>();
  const allowedMonthDays = new Set<string>();
  for (const d of allowed.dates) {
    if (d.kind === 'full' && d.iso) {
      allowedDays.add(d.iso);
      allowedMonths.add(d.iso.slice(0, 7));
      allowedMonthDays.add(d.iso.slice(5));
    } else if (d.kind === 'month_year' && d.yearMonth) {
      allowedMonths.add(d.yearMonth);
    } else if (d.kind === 'day_month' && d.monthDay) {
      allowedMonthDays.add(d.monthDay);
    }
  }
  for (const d of written.dates) {
    const ok = d.kind === 'full' ? d.iso !== null && allowedDays.has(d.iso)
      : d.kind === 'month_year' ? allowedMonths.has(d.yearMonth ?? '')
        : allowedMonthDays.has(d.monthDay ?? '');
    if (!ok) mismatches.add(`The date "${d.raw.trim()}" is not in the dispensing lines.`);
  }

  // Numbers with a unit.
  const mayQuote = allowedAmounts(allowed.rest);
  for (const a of findAmounts(written.rest)) {
    const same = mayQuote.has(`${a.value} ${a.unit}`);
    const asCount = COUNT_UNITS.has(a.unit) && mayQuote.has(`${a.value} qty`);
    if (!same && !asCount) mismatches.add(`The amount "${a.raw}" is not in the dispensing lines or the criterion.`);
  }

  // Medicine names.
  const allowedLower = allowed.rest.toLowerCase();
  for (const name of findMedicineNames(written.rest, moreMedicineNames)) {
    if (!hasWord(allowedLower, name)) {
      mismatches.add(`The medicine name "${name}" is not in the dispensing lines or the criterion.`);
    }
  }
  return [...mismatches];
}

// ---------- the wording: the letter asks, it never tells ----------

const ACTION_STEMS = '(?:stop|stopp|ceas|discontinu|withdraw|withhold|switch|chang|reduc|increas|decreas|start|commenc|prescrib|deprescrib|replac|substitut)\\w*';
const ACTION_WORDS = 'stop|cease|discontinue|withdraw|withhold|start|commence|initiate|switch|change|reduce|increase|decrease|prescribe|deprescribe|replace|substitute|arrange|avoid';
// After an action word at the start of a sentence, one of these marks an instruction ("Stop the tablet").
// "Start dates overlap" and "Change in dose" are not instructions.
const AFTER_AN_ACTION = new Set(['the', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'its', 'all', 'any', 'both', 'one', 'a', 'an', 'and', 'or', 'it', 'them']);

const TELLING: RegExp[] = [
  // Said to the doctor.
  /\byou (?:should|must|need to|have to|ought to)\b/i,
  new RegExp(`\\bplease\\s+(?:also\\s+)?${ACTION_STEMS}\\b`, 'i'),
  new RegExp(`\\bplease consider\\s+${ACTION_STEMS}\\b`, 'i'),
  /\b(?:please|kindly)\s+(?:arrange|withhold|avoid|ensure|do not)\b/i,
  // What must happen.
  /\bmust\b/i,
  /\bought to\b/i,
  /\bshould\b(?!\s+you\b)/i,
  /\bneeds? to\b/i,
  /\b(?:is|are) to be\b/i,
  /(?<!\byou )\brequires?\b/i,
  // Advice given.
  /\brecommend\w*/i,
  /\b(?:i|we)\s+(?:would\s+|strongly\s+|also\s+|therefore\s+)*(?:advise|suggest)\w*/i,
  /\b(?:it is|is|are)\s+(?:strongly\s+)?(?:advised|advisable|suggested)\b/i,
  /\bmy (?:advice|suggestion)\b/i,
  /\b(?:it )?would be (?:best|better|wise|prudent)\b/i
];

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

/** The words that make one sentence an instruction to the doctor, or null when it is not one. A question never is. */
export function tellsTheDoctor(sentence: string): string | null {
  const s = sentence.trim();
  if (!s || s.endsWith('?')) return null;
  // An action word at the start of the sentence: "Stop the Celebrex.", "Kindly cease the Celebrex.", "Do not continue ...".
  if (/^(?:please\s+|kindly\s+)?(?:do not|don't)\b/i.test(s)) return /^(?:please\s+|kindly\s+)?(?:do not|don't)/i.exec(s)?.[0] ?? null;
  const start = new RegExp(`^((?:please\\s+|kindly\\s+)?(?:${ACTION_WORDS}))\\s+(\\S+)`, 'i').exec(s);
  if (start) {
    const next = start[2];
    if (AFTER_AN_ACTION.has(next.toLowerCase()) || /^[A-Z0-9]/.test(next) || /^(?:please|kindly)\b/i.test(start[1])) return start[1];
  }
  for (const pattern of TELLING) {
    const m = pattern.exec(s);
    if (m) return m[0].trim();
  }
  return null;
}

// How every note of the wording check ends. isWordingNote tells such a note from a note about a fact.
const WORDING_NOTE_END = 'tell the doctor what to do. The letter should ask for a review.';

/**
 * The check on wording: the letter asks the doctor for a review and never tells the doctor what
 * to do (docs/SPEC.md section 7.3). A sentence is a problem when it starts with an action word,
 * or holds must, should, needs to, is to be, requires, recommend, advise or suggest, unless it is
 * a question. Returns one sentence per problem.
 */
export function checkLetterTone(paragraphs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentencesOf(paragraphs.filter(p => typeof p === 'string').join('\n'))) {
    const words = tellsTheDoctor(sentence);
    if (!words || seen.has(words.toLowerCase())) continue;
    seen.add(words.toLowerCase());
    out.push(`The words "${words}" ${WORDING_NOTE_END}`);
  }
  return out;
}

/** True when a note about a draft came from the check on wording (checkLetterTone), not from the check on facts. */
export function isWordingNote(note: string): boolean {
  return typeof note === 'string' && note.endsWith(WORDING_NOTE_END);
}
