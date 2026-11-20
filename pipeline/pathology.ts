// pipeline/pathology.ts
// READING ONE RESULT FROM AN UPLOADED PATHOLOGY TEST.
//
// The clinical reviewer's wireframe (20 November 2026): whenever a pathology result is needed, the pharmacist
// chooses to type the number or to upload the pathology test that holds it. This module is the reading half,
// and it is pure: text in, readings out. It calls no model and reads no file.
//
// The rules are those of path-O-finder, the reviewer's pathology safety net for general practice:
//   - It READS. It never interprets. A value is given as the report writes it, with the line it stands on.
//   - It ABSTAINS WHEN UNSURE, and says why. Nothing is guessed and no value is ever corrected.
//   - Every value passes coherence checks: the unit must fit the test, the number must lie inside wide
//     physiological hard bounds (these are not reference ranges: they catch a slipped decimal or a misread),
//     and the laboratory's own flag must agree with its own range.
//   - The pharmacist confirms what was read before anything is written into the record.

/** What the reader knows about one test: its names on a report, the units it comes in, and its hard bounds. */
interface Analyte {
  /** The plain name shown to the pharmacist. */
  name: string;
  /** Names a report uses for it, lower case. A short one ("k", "na") counts only as a whole word at the start of a line. */
  aliases: string[];
  /** Each unit the test is reported in, with the hard bounds for that unit. An empty unit means the value has none (INR). */
  units: { unit: string; min: number; max: number }[];
}

// Seeded from path-O-finder (resources/spia_aliases.yaml and plausibility_bounds.yaml: RCPA SPIA preferred terms and
// harmonised intervals), with the tests the criteria of the LANTERN ask for added (lithium, medicine concentrations,
// vitamin B12, folate, prolactin, free T4, urine albumin to creatinine ratio, transferrin saturation).
const ANALYTES: Record<string, Analyte> = {
  sodium: { name: 'Sodium', aliases: ['sodium', 'serum sodium', 'plasma sodium', 'na', 'na+'], units: [{ unit: 'mmol/L', min: 80, max: 200 }] },
  potassium: { name: 'Potassium', aliases: ['potassium', 'serum potassium', 'plasma potassium', 'potassium level', 'k', 'k+'], units: [{ unit: 'mmol/L', min: 0.5, max: 12 }] },
  urea: { name: 'Urea', aliases: ['urea', 'blood urea'], units: [{ unit: 'mmol/L', min: 0.1, max: 100 }] },
  creatinine: { name: 'Creatinine', aliases: ['creatinine', 'serum creatinine', 'plasma creatinine', 'creat'], units: [{ unit: 'umol/L', min: 5, max: 4000 }] },
  egfr: { name: 'eGFR', aliases: ['egfr', 'e-gfr', 'estimated gfr', 'gfr estimated', 'egfr (ckd-epi)', 'egfr ckd-epi', 'estimated glomerular filtration rate'], units: [{ unit: 'mL/min/1.73m2', min: 0, max: 200 }] },
  haemoglobin: { name: 'Haemoglobin', aliases: ['haemoglobin', 'hemoglobin', 'hb', 'hgb'], units: [{ unit: 'g/L', min: 20, max: 250 }] },
  platelets: { name: 'Platelets', aliases: ['platelets', 'platelet count', 'plt'], units: [{ unit: 'x10^9/L', min: 1, max: 3000 }] },
  wcc: { name: 'White cell count', aliases: ['white cell count', 'wcc', 'wbc', 'leucocytes', 'leukocytes'], units: [{ unit: 'x10^9/L', min: 0.05, max: 500 }] },
  neutrophils: { name: 'Neutrophils', aliases: ['neutrophils', 'neutrophil count', 'neut'], units: [{ unit: 'x10^9/L', min: 0, max: 200 }] },
  ferritin: { name: 'Ferritin', aliases: ['ferritin', 'serum ferritin'], units: [{ unit: 'ug/L', min: 0.5, max: 50000 }, { unit: 'ng/mL', min: 0.5, max: 50000 }] },
  transferrin_saturation: { name: 'Transferrin saturation', aliases: ['transferrin saturation', 'transferrin sat', 'iron saturation', 'tsat'], units: [{ unit: '%', min: 0, max: 100 }] },
  tsh: { name: 'TSH', aliases: ['tsh', 'thyroid stimulating hormone', 'thyrotropin'], units: [{ unit: 'mIU/L', min: 0.005, max: 500 }, { unit: 'mU/L', min: 0.005, max: 500 }] },
  free_t4: { name: 'Free T4', aliases: ['free t4', 'ft4', 'free thyroxine', 't4 free'], units: [{ unit: 'pmol/L', min: 1, max: 100 }] },
  hba1c: { name: 'HbA1c', aliases: ['hba1c', 'hb a1c', 'haemoglobin a1c', 'glycated haemoglobin', 'glycated hb'], units: [{ unit: 'mmol/mol', min: 15, max: 200 }, { unit: '%', min: 3, max: 25 }] },
  glucose: { name: 'Glucose', aliases: ['glucose', 'plasma glucose', 'blood glucose', 'glucose fasting', 'fasting glucose', 'glucose random', 'random glucose', 'bgl'], units: [{ unit: 'mmol/L', min: 0.3, max: 100 }] },
  corrected_calcium: { name: 'Corrected calcium', aliases: ['corrected calcium', 'calcium corrected', 'calcium (corrected)', 'calcium (corr)', 'corr calcium', 'adjusted calcium', 'calcium adjusted'], units: [{ unit: 'mmol/L', min: 0.5, max: 5 }] },
  calcium: { name: 'Calcium', aliases: ['calcium', 'serum calcium', 'ca'], units: [{ unit: 'mmol/L', min: 0.5, max: 5 }] },
  magnesium: { name: 'Magnesium', aliases: ['magnesium', 'serum magnesium'], units: [{ unit: 'mmol/L', min: 0.1, max: 5 }] },
  phosphate: { name: 'Phosphate', aliases: ['phosphate', 'serum phosphate', 'po4'], units: [{ unit: 'mmol/L', min: 0.1, max: 10 }] },
  alt: { name: 'ALT', aliases: ['alt', 'alanine aminotransferase', 'alanine transaminase', 'sgpt'], units: [{ unit: 'U/L', min: 0, max: 20000 }, { unit: 'IU/L', min: 0, max: 20000 }] },
  ast: { name: 'AST', aliases: ['ast', 'aspartate aminotransferase', 'aspartate transaminase', 'sgot'], units: [{ unit: 'U/L', min: 0, max: 20000 }, { unit: 'IU/L', min: 0, max: 20000 }] },
  vitamin_d: { name: 'Vitamin D (25-hydroxy)', aliases: ['25-hydroxyvitamin d', '25-oh vitamin d', '25 oh vitamin d', '25-hydroxy vitamin d', '25 hydroxy vitamin d', 'vitamin d 25-oh', 'vitamin d (25-oh)', 'vitamin d'], units: [{ unit: 'nmol/L', min: 1, max: 700 }] },
  inr: { name: 'INR', aliases: ['inr', 'international normalised ratio', 'international normalized ratio'], units: [{ unit: '', min: 0.5, max: 30 }] },
  lithium: { name: 'Lithium', aliases: ['lithium', 'serum lithium', 'lithium level'], units: [{ unit: 'mmol/L', min: 0, max: 5 }] },
  carbamazepine: { name: 'Carbamazepine', aliases: ['carbamazepine', 'carbamazepine level', 'tegretol level'], units: [{ unit: 'umol/L', min: 0, max: 200 }, { unit: 'mg/L', min: 0, max: 50 }] },
  vitamin_b12: { name: 'Vitamin B12', aliases: ['vitamin b12', 'b12', 'serum b12', 'active b12', 'holotranscobalamin', 'cobalamin'], units: [{ unit: 'pmol/L', min: 5, max: 5000 }] },
  red_cell_folate: { name: 'Red cell folate', aliases: ['red cell folate', 'rbc folate', 'red blood cell folate'], units: [{ unit: 'nmol/L', min: 50, max: 5000 }] },
  folate: { name: 'Folate', aliases: ['folate', 'serum folate', 'folic acid'], units: [{ unit: 'nmol/L', min: 0.5, max: 150 }] },
  prolactin: { name: 'Prolactin', aliases: ['prolactin', 'serum prolactin'], units: [{ unit: 'mIU/L', min: 1, max: 200000 }, { unit: 'mU/L', min: 1, max: 200000 }] },
  uacr: { name: 'Urine albumin to creatinine ratio', aliases: ['albumin/creatinine ratio', 'albumin creatinine ratio', 'albumin:creatinine ratio', 'urine albumin/creatinine ratio', 'urine acr', 'uacr', 'acr'], units: [{ unit: 'mg/mmol', min: 0, max: 3000 }] }
};

export interface PathologyReading {
  /** The key of the test, for example "sodium". */
  analyte: string;
  /** Its plain name, for example "Sodium". */
  name: string;
  /** The number. For "<5" this is 5, and valueWords keeps the sign. */
  value: number;
  /** The value exactly as the report writes it, for example "128" or "<5". */
  valueWords: string;
  /** The unit as the report writes it. Empty when the line holds none. */
  unit: string;
  /** The laboratory's own reference range, when the line holds it. */
  refLow?: number;
  refHigh?: number;
  /** The laboratory's own flag, when the line holds it. */
  flag?: 'H' | 'L';
  /** The date the sample was collected (YYYY-MM-DD), when the document states one such date. */
  date?: string;
  /** The value as a multiple of the laboratory's upper limit, to one decimal place, when an upper limit is on the line. */
  multipleOfUpper?: number;
  /** The line of the report, word for word. */
  line: string;
  /** The page it stands on, counted from 1. */
  page: number;
  /** False when the pharmacist must check the report before using the value. The reason is in why. */
  sure: boolean;
  why?: string;
}

export interface PathologyReadResult {
  /** Readings of the tests that were asked for. Lines that failed a coherence check are not in here. */
  readings: PathologyReading[];
  /** One sentence for each line that looked like a wanted result and was not used, and why. */
  abstained: string[];
  /** The collection date found in the document, and the line it stands on. */
  collected?: { date: string; line: string };
  /** Why no collection date is given, when none is. */
  dateNote?: string;
}

const normUnit = (unit: string): string => unit
  .replace(/[µμ]/g, 'u').replace(/\s+/g, '').replace(/²/g, '2').replace(/\^2/g, '2')
  .replace(/[×*]/g, 'x').replace(/x?10(?:\^|x|e)?9\/l/i, 'x10^9/l').toLowerCase();

const UNIT = /(mmol\/mol|mg\/mmol|[numµμp]?mol\/L|mIU\/L|mU\/L|IU\/L|U\/L|g\/L|mg\/L|[uµμn]g\/L|ng\/mL|mL\/min(?:\/1\.73\s?m(?:2|\^2|²))?|x?\s?10\s?(?:\^|\*|x|e)?\s?9\s?\/\s?L|%)/i;
const NUMBER = /([<>]\s?=?\s?)?(\d{1,6}(?:\.\d{1,4})?)/;

/** Which tests a needed fact of the kind "result" asks for. Empty when it is not a pathology result the reader knows. */
export function analytesForFact(what: string): string[] {
  const w = what.toLowerCase();
  // not pathology, or worked out and not printed on a report: these are typed
  if (/creatinine clearance|\bcrcl\b|blood pressure|t-score|weight|qtc|fev1|ejection fraction|cardiovascular risk|daily dose|dose per|doses\/day|age in|response|dates of|post-void|blood gas|oxygen|helicobacter/.test(w)) return [];
  const out: string[] = [];
  const add = (...keys: string[]): void => { for (const k of keys) if (!out.includes(k)) out.push(k); };
  if (/\begfr\b|glomerular|kidney function/.test(w)) add('egfr');
  if (/creatinine/.test(w) && !/albumin|protein/.test(w)) add('creatinine');
  if (/albumin.{0,4}creatinine|\buacr\b|urine albumin/.test(w)) add('uacr');
  if (/electrolytes/.test(w)) add('sodium', 'potassium');
  if (/sodium/.test(w)) add('sodium');
  if (/potassium/.test(w)) add('potassium');
  if (/lithium/.test(w)) add('lithium');
  if (/hba1c|glycated/.test(w)) add('hba1c');
  if (/glucose/.test(w)) add('glucose');
  if (/corrected (serum )?calcium/.test(w)) add('corrected_calcium');
  else if (/calcium/.test(w)) add('calcium', 'corrected_calcium');
  if (/phosphate/.test(w)) add('phosphate');
  if (/magnesium/.test(w)) add('magnesium');
  if (/haemoglobin|hemoglobin/.test(w) && !/hba1c|glycated/.test(w)) add('haemoglobin');
  if (/platelet/.test(w)) add('platelets');
  if (/free t4|thyroxine/.test(w)) add('free_t4');
  if (/\btsh\b|thyroid/.test(w)) add('tsh');
  if (/thyroid function/.test(w)) add('free_t4');
  if (/prolactin/.test(w)) add('prolactin');
  if (/b12/.test(w)) add('vitamin_b12');
  if (/folate/.test(w)) add('folate', 'red_cell_folate');
  if (/ferritin|iron (studies|assessment)/.test(w)) add('ferritin');
  if (/transferrin saturation|iron (studies|assessment)/.test(w)) add('transferrin_saturation');
  if (/vitamin d|25-hydroxy/.test(w)) add('vitamin_d');
  if (/\binr\b/.test(w)) add('inr');
  if (/carbamazepine/.test(w)) add('carbamazepine');
  if (/\balt\b|\bast\b|transaminase|liver function/.test(w)) add('alt', 'ast');
  return out;
}

/** The plain name of a test, for the page. */
export function analyteName(key: string): string {
  return ANALYTES[key]?.name ?? key;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A date in a line, Australian order (day first). Returns YYYY-MM-DD, or nothing when it is not a real date. */
export function dateIn(text: string): string | undefined {
  const make = (y: number, m: number, d: number): string | undefined => {
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) return make(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(text);
  if (m) return make(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /\b(\d{1,2})[ -](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[ ,-]+(\d{4})\b/i.exec(text);
  if (m) return make(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return undefined;
}

/**
 * The date the sample was collected. Only a line that says so counts ("Collected", "Collection date",
 * "Date of collection", "Specimen collected", "Sample date"). A date the report was printed or reported is not
 * the date of the sample. Two different collection dates in one document give no date: the pharmacist types it.
 */
export function collectionDate(pages: string[][]): { date?: string; line?: string; note?: string } {
  const found = new Map<string, string>();
  const collection = /^(?:date of collection|collection date|collected on|date collected|specimen collected|sample collected|sample date|specimen date|collected)$/i;
  const field = /(date of collection|collection date|collected on|date collected|specimen collected|sample collected|sample date|specimen date|collected|date of birth|dob|request date|requested on|requested|report date|reported on|reported|print date|printed)\b/ig;
  for (const lines of pages) {
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const labels = [...line.matchAll(field)];
      for (let i = 0; i < labels.length; i++) {
        const at = labels[i];
        if (!collection.test(at[1])) continue;
        const before = line.slice(Math.max(0, at.index - 4), at.index);
        if (/\bnot\s+$/i.test(before)) continue;
        const end = labels[i + 1]?.index ?? line.length;
        const words = line.slice(at.index + at[0].length, end);
        if (/^\s*(?:not|no)\b/i.test(words)) continue;
        const date = dateIn(words);
        if (date && !found.has(date)) found.set(date, line);
      }
    }
  }
  if (found.size === 1) { const [date, line] = [...found.entries()][0]; return { date, line }; }
  if (found.size === 0) return { note: 'The document does not say when the sample was collected. Enter the date from the report.' };
  return { note: `The document gives more than one collection date (${[...found.keys()].sort().join(', ')}). Enter the date of the result you use.` };
}

interface Found { key: string; rest: string }

function analyteAtStart(line: string, wanted: string[]): Found | null {
  const lower = line.toLowerCase();
  let best: { key: string; length: number } | null = null;
  for (const key of wanted) {
    const analyte = ANALYTES[key];
    if (!analyte) continue;
    for (const alias of analyte.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      // an optional specimen mark before the name ("S-Sodium", "P Potassium"), the name as whole words, then a gap
      const match = new RegExp(`^(?:[sbpu]-\\s?|serum\\s+|plasma\\s+)?${escaped}(?![a-z0-9+])`, 'i').exec(lower);
      if (match && (!best || match[0].length > best.length)) best = { key, length: match[0].length };
    }
  }
  if (!best) return null;
  // "Calcium corrected" must not be read as "Calcium": a longer name of another test at the same place wins
  for (const [key, analyte] of Object.entries(ANALYTES)) {
    if (key === best.key) continue;
    for (const alias of analyte.aliases) {
      if (alias.length <= best.length) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      if (new RegExp(`^(?:[sbpu]-\\s?|serum\\s+|plasma\\s+)?${escaped}(?![a-z0-9+])`, 'i').test(lower)) {
        return wanted.includes(key) ? { key, rest: line.slice(new RegExp(`^(?:[sbpu]-\\s?|serum\\s+|plasma\\s+)?${escaped}`, 'i').exec(lower)![0].length) } : null;
      }
    }
  }
  return { key: best.key, rest: line.slice(best.length) };
}

function fitsUnit(analyte: Analyte, unit: string): { unit: string; min: number; max: number } | undefined {
  const n = normUnit(unit);
  return analyte.units.find(u => normUnit(u.unit) === n || (u.unit === 'mL/min/1.73m2' && /^ml\/min/.test(n)));
}

/** One line of a report, when it holds a wanted test. Returns a reading, or a sentence that says why it abstained. */
export function readLine(raw: string, wanted: string[], page = 1): PathologyReading | string | null {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line.length < 3 || line.length > 200) return null;
  const found = analyteAtStart(line, wanted);
  if (!found) return null;
  const analyte = ANALYTES[found.key];
  let rest = ` ${found.rest.replace(/^[\s:.,-]+/, '')} `;
  if (!/\d/.test(rest)) return null;                            // a heading, not a result
  // the reading model writes ? where it could not read a character: such a line is never used
  if (rest.includes('?')) return `"${line}": a character on this line could not be read. Read the value from the report yourself.`;
  if (/\d,\d/.test(rest)) return `"${line}": a comma between digits could be a decimal point or a thousands separator. Read the value from the report yourself.`;

  // the laboratory's own reference range: "(135-145)", "135 - 145", "(<5.0)", "> 60"
  let refLow: number | undefined; let refHigh: number | undefined;
  const between = /\(?\s*(\d{1,6}(?:\.\d{1,4})?)\s*(?:-|–|—|to)\s*(\d{1,6}(?:\.\d{1,4})?)\s*\)?/.exec(rest);
  if (between) { refLow = Number(between[1]); refHigh = Number(between[2]); rest = rest.replace(between[0], ' '); }
  else {
    const oneSided = /\(\s*([<>])\s*=?\s*(\d{1,6}(?:\.\d{1,4})?)\s*\)/.exec(rest);
    if (oneSided) { if (oneSided[1] === '<') refHigh = Number(oneSided[2]); else refLow = Number(oneSided[2]); rest = rest.replace(oneSided[0], ' '); }
    else {
      const limits = /([<>])\s*=?\s*(\d{1,6}(?:\.\d{1,4})?)(?=\s|$)/g;
      let candidate: RegExpExecArray | null = null;
      for (let at = limits.exec(rest); at; at = limits.exec(rest)) candidate = at;
      if (candidate && UNIT.test(rest.slice(0, candidate.index)) && /\d/.test(rest.slice(0, candidate.index))) {
        if (candidate[1] === '<') refHigh = Number(candidate[2]); else refLow = Number(candidate[2]);
        rest = `${rest.slice(0, candidate.index)} ${rest.slice(candidate.index + candidate[0].length)}`;
      }
    }
  }
  if (refLow !== undefined && refHigh !== undefined && refLow > refHigh) return `"${line}": the reference range on the line could not be read.`;

  // the laboratory's own flag
  let flag: 'H' | 'L' | undefined;
  let star = false;
  const flagged = /(?:^|\s)(HH|LL|H|L|HIGH|LOW|\*H|\*L|H\*|L\*|\*)(?=\s|$)/.exec(rest);
  if (flagged) {
    if (flagged[1] === '*') star = true;
    else flag = /L/i.test(flagged[1]) && !/H/i.test(flagged[1]) ? 'L' : 'H';
    rest = rest.replace(flagged[0], ' ');
  }

  // numbers, each with the unit that follows it
  const pairs: { words: string; value: number; unit: string }[] = [];
  let scan = rest;
  for (let guard = 0; guard < 6; guard++) {
    const n = NUMBER.exec(scan);
    if (!n) break;
    const after = scan.slice(n.index + n[0].length);
    const u = new RegExp(`^\\s?${UNIT.source}`, 'i').exec(after);
    pairs.push({ words: `${(n[1] ?? '').replace(/\s/g, '')}${n[2]}`, value: Number(n[2]), unit: u ? u[1].replace(/\s/g, '') : '' });
    scan = after.slice(u ? u[0].length : 0);
  }
  if (pairs.length === 0) return null;
  // a unit that stands apart from its number ("128  L  135-145  mmol/L")
  const looseUnit = pairs.every(p => !p.unit) ? UNIT.exec(rest)?.[1].replace(/\s/g, '') ?? '' : '';

  let chosen = pairs[0];
  if (pairs.length > 1) {
    const fitting = pairs.filter(p => p.unit && fitsUnit(analyte, p.unit));
    const dualHba1c = found.key === 'hba1c' && pairs.length === 2 && fitting.length === 2 &&
      new Set(fitting.map(p => normUnit(p.unit))).size === 2;
    if (dualHba1c) chosen = fitting.find(p => normUnit(p.unit) === normUnit(analyte.units[0].unit)) ?? fitting[0];
    else return `"${line}": more than one number stands on this line (a report with results of several dates?). Read the value from the report yourself.`;
  }
  const unit = chosen.unit || looseUnit;
  const unitless = analyte.units.some(u => u.unit === '');

  // coherence, as path-O-finder does it: the first conflict abstains
  let bounds = analyte.units[0];
  if (unit) {
    const fit = fitsUnit(analyte, unit);
    if (!fit) return `"${line}": the unit ${unit} does not fit ${analyte.name} (expected ${analyte.units.map(u => u.unit || 'no unit').join(' or ')}). Read the value from the report yourself.`;
    bounds = fit;
  }
  if (chosen.value < bounds.min || chosen.value > bounds.max) {
    return `"${line}": ${chosen.value} lies outside what ${analyte.name} can be (${bounds.min} to ${bounds.max}${bounds.unit ? ' ' + bounds.unit : ''}): a misread is suspected. Read the value from the report yourself.`;
  }
  const reading: PathologyReading = {
    analyte: found.key, name: analyte.name, value: chosen.value, valueWords: chosen.words, unit, line, page, sure: true
  };
  if (refLow !== undefined) reading.refLow = refLow;
  if (refHigh !== undefined) reading.refHigh = refHigh;
  if (flag) reading.flag = flag;
  if (refHigh !== undefined && refHigh > 0) reading.multipleOfUpper = Math.round((chosen.value / refHigh) * 10) / 10;
  const doubts: string[] = [];
  if (!unit && !unitless) doubts.push('the unit is not on the line');
  if (/[<>]/.test(chosen.words)) doubts.push(`the report gives a limit (${chosen.words}), not a measured number`);
  const below = refLow !== undefined && chosen.value < refLow;
  const above = refHigh !== undefined && chosen.value > refHigh;
  if (star) {
    if (above) { flag = 'H'; reading.flag = 'H'; }
    else if (below) { flag = 'L'; reading.flag = 'L'; }
    else doubts.push("the laboratory's * flag does not say whether the result is high or low");
  }
  if (flag && (refLow !== undefined || refHigh !== undefined) && ((flag === 'H' && !above) || (flag === 'L' && !below))) doubts.push('the laboratory\'s own flag and its own range do not agree on this line');
  if (doubts.length) { reading.sure = false; reading.why = `Check the report: ${doubts.join('; ')}.`; }
  return reading;
}

/**
 * Reads the wanted tests from the text of a document, page by page and line by line.
 * pages: the text lines of each page, as the text layer or the reading model gives them.
 * pageNumbers: optional original 1-based page numbers, validated by the server.
 */
export function readPathology(pages: string[][], wanted: string[], pageNumbers?: number[]): PathologyReadResult {
  const readings: PathologyReading[] = []; const abstained: string[] = [];
  pages.forEach((lines, index) => {
    const page = pageNumbers?.[index] ?? index + 1;
    for (const raw of lines) {
      const got = readLine(raw, wanted, page);
      if (got === null) continue;
      if (typeof got === 'string') { abstained.push(pageNumbers ? `Page ${page}: ${got}` : got); continue; }
      readings.push(got);
    }
  });
  const when = collectionDate(pages);
  const result: PathologyReadResult = { readings, abstained };
  if (when.date && when.line) { result.collected = { date: when.date, line: when.line }; for (const r of readings) r.date = when.date; }
  else if (when.note) result.dateNote = when.note;
  // the same test read twice with different values (a report of several dates printed as separate lines): none is sure
  const byTest = new Map<string, PathologyReading[]>();
  for (const r of readings) byTest.set(r.analyte, [...(byTest.get(r.analyte) ?? []), r]);
  for (const list of byTest.values()) {
    if (new Set(list.map(r => `${r.valueWords}|${r.unit.toLowerCase()}`)).size > 1) {
      for (const r of list) { r.sure = false; r.why = `Check the report: it holds more than one ${r.name} value. Choose the one that belongs to the date you enter.`; delete r.date; }
    }
  }
  return result;
}

/** The words that go into the record for a reading the pharmacist confirmed. Plain, and as the report gave it. */
export function readingWords(reading: PathologyReading): string {
  const range = reading.refLow !== undefined && reading.refHigh !== undefined ? ` (laboratory range ${reading.refLow} to ${reading.refHigh})`
    : reading.refHigh !== undefined ? ` (laboratory upper limit ${reading.refHigh})`
      : reading.refLow !== undefined ? ` (laboratory lower limit ${reading.refLow})` : '';
  return `${reading.name} ${reading.valueWords}${reading.unit ? ' ' + reading.unit : ''}${range}`;
}
