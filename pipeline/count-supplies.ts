// Counts supply lines when a criterion carries count_supplies. The screen, the check and the
// letter add the note. A criterion without the field gets an empty note, so its prompts stay as they were.
// This file does not import the screen: the screen imports this file.
import type { Criterion, HistoryLine, MedicineGroup, SupplyCount, SupplyPack } from '../shared/types.ts';
import { enteredAtTheCounter, isFactLine } from '../shared/facts.ts';
import { monthsBefore } from './dates.ts';

const TAKEN_BACK = 'Taken back by the pharmacist at the counter.';
// A quantity that names one of these is not a number of packs or devices. It is left unread.
// Capsules are not in this list: a pack rule may divide a number of its own unit.
const UNREAD_UNIT = /^(?:puffs?|doses?|actuations?|mls?|ml)$/i;
const CAPSULE_UNIT = /^capsules?$/i;
// The last word of an ingredient, dropped when a product names the ingredient without its salt.
const SALT_WORD = /^(?:acetate|citrate|dipropionate|fumarate|furoate|hydrobromide|hydrochloride|maleate|propionate|sodium|sulfate|sulphate|tartrate)$/;
const SETTLED = 'Do not count again: use these numbers.';
const UNSETTLED = 'The application could not settle the lines named above. Count the listed lines as given, look at the lines named above yourself, and say in your answer what you did.';

export interface SupplyTally {
  note: string;
  total: number;
  lines: number;
  unread: string[];
  /** The end date of the window that was used. Null when the record gives no window. */
  windowEnd: string | null;
}

interface Hit {
  id: string;
  date: string;
  /** Null when the quantity was not read. The line is listed and left out of the total. */
  amount: number | null;
  /** How the line is written in the block. The number alone when no pack rule matched. */
  shown: string;
}

const EMPTY: SupplyTally = { note: '', total: 0, lines: 0, unread: [], windowEnd: null };

/** The note for the prompts. Empty when the criterion does not ask for a count. */
export function supplyCountNote(criterion: Criterion, lines: HistoryLine[]): string {
  return supplyCount(criterion, lines).note;
}

/** The count for one criterion and one history. An absent field counts nothing and writes nothing. */
export function supplyCount(criterion: Criterion, lines: HistoryLine[]): SupplyTally {
  const spec = criterion.count_supplies;
  if (!spec) return EMPTY;
  if (!Number.isInteger(spec.months) || spec.months < 1 || spec.months > 120 || (spec.window !== 'any' && spec.window !== 'last')) {
    return told(spec, 'supplies could not be counted: the count was not read', null, [], []);
  }
  const group = criterion.medicine_groups.find(item => item.key === spec.group);
  if (!group) return told(spec, 'is not a medicine group of this criterion', null, [], []);
  const names = namesOfGroup(group);
  const hits: Hit[] = [];
  const near: Hit[] = [];
  for (const line of lines) {
    const text = line.text;
    if (isFactLine(text) || text.includes(TAKEN_BACK)) continue;
    if (!formMatches(text, spec.form_has)) continue;
    const date = lineDate(text);
    if (!date) continue;
    const product = productField(text);
    if (!groupMatches(product, names)) {
      if (possibleGroup(product, group, names)) near.push({ id: line.id, date, amount: null, shown: '' });
      continue;
    }
    const read = readQuantity(text);
    const packed = packAmount(text, read, spec.packs);
    hits.push({ id: line.id, date, amount: packed ? packed.amount : null, shown: packed ? packed.shown : '' });
  }
  const recordEnd = spec.window === 'last' ? newestDate(lines) : null;
  const end = chooseEnd(hits, spec, recordEnd);
  const chosen = end ? hits.filter(hit => inWindow(hit.date, end, spec.months)) : [];
  const counted = chosen.filter((hit): hit is Hit & { amount: number } => hit.amount !== null);
  // Window "any": an unread line counts for nothing, and every unread line of the group is named,
  // not only the lines of the one window that won. Window "last" names the unread lines inside it.
  const unread = (spec.window === 'any' ? hits : chosen).filter(hit => hit.amount === null).map(hit => hit.id);
  const possible = (spec.window === 'last' && end ? near.filter(hit => inWindow(hit.date, end, spec.months)) : near)
    .map(hit => hit.id);
  return told(spec, '', end, counted, unread, possible);
}

function namesOfGroup(group: MedicineGroup): string[] {
  const names: string[] = [];
  for (const name of [...group.ingredients, ...Object.values(group.brands).flat()]) {
    const bare = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
    if (bare.length >= 3 && !names.includes(bare)) names.push(bare);
  }
  return names;
}

/** The name stands as whole words. "iron" does not match inside "spironolactone". */
function wholePhrase(haystack: string, phrase: string): boolean {
  const body = phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!body) return false;
  return new RegExp(`(?:^|[^a-z0-9])${body}(?![a-z0-9])`, 'i').test(haystack);
}

/** A listed name matches the product field only, as whole words. Directions and the prescriber do not count. */
function groupMatches(product: string, names: string[]): boolean {
  return names.some(name => wholePhrase(product, name));
}

function firstWord(name: string): string | null {
  const words = name.trim().toLowerCase().split(/\s+/);
  if (words.length < 2 || words[0].length < 3) return null;
  return words[0];
}

/** "fluticasone propionate" yields "fluticasone". A one-word ingredient has no salt to drop. */
function saltStem(name: string): string | null {
  const words = name.trim().toLowerCase().split(/\s+/);
  if (words.length < 2 || !SALT_WORD.test(words[words.length - 1])) return null;
  const stem = words.slice(0, -1).join(' ');
  return stem.length >= 3 ? stem : null;
}

/**
 * The product passed the form check and holds the first word of a listed brand, or a listed
 * ingredient without its salt, but not the whole listed name. It is not counted.
 */
function possibleGroup(product: string, group: MedicineGroup, exact: string[]): boolean {
  if (groupMatches(product, exact)) return false;
  for (const brand of Object.values(group.brands).flat()) {
    const head = firstWord(brand);
    if (head && wholePhrase(product, head)) return true;
  }
  for (const ingredient of group.ingredients) {
    const stem = saltStem(ingredient);
    if (stem && !exact.includes(stem) && wholePhrase(product, stem)) return true;
  }
  return false;
}

/** The form check looks at the product, the second field, so a direction that says "inhaler" does not qualify a tablet. */
function formMatches(text: string, words: string[] | undefined): boolean {
  if (!words || words.length === 0) return true;
  const product = productField(text);
  return words.some(word => word.trim() !== '' && product.includes(word.trim().toLowerCase()));
}

function lineDate(text: string): string | null {
  const found = /^(\d{4}-\d{2}-\d{2})(?= \||$)/.exec(text);
  return found ? found[1] : null;
}

/**
 * The whole number at the start of "qty ...". "1", "1 inhaler" and "2 inhalers" count.
 * A decimal, a fraction, a range, a unit in brackets, a unit of several words, or a named
 * unit (puffs, doses, actuations, mL) is not guessed and is not cut down to a whole number.
 * A number of capsules is returned so a pack rule can divide its own unit. With no pack rule it stays unread.
 */
function readQuantity(text: string): { amount: number; unit: string } | null {
  const found = /\bqty\s+([^|]+)/i.exec(text);
  if (!found) return null;
  const raw = found[1].trim();
  if (/\d\s*\.\s*\d/.test(raw) || /\d\s*\/\s*\d/.test(raw) || /\d\s*-\s*\d/.test(raw) || /\d\s*-\s*[A-Za-z]/.test(raw)) return null;
  const amount = /^(\d+)(?:\s+(.*))?$/.exec(raw);
  if (!amount) return null;
  const unit = (amount[2] ?? '').trim();
  if (unit === '') return { amount: Number(amount[1]), unit: '' };
  if (/[()]/.test(unit) || /\s/.test(unit) || UNREAD_UNIT.test(unit)) return null;
  return { amount: Number(amount[1]), unit };
}

/** The product field, the same field form_has looks at. */
function productField(text: string): string {
  const parts = text.split('|');
  return (parts.length >= 2 ? parts[1] : text).toLowerCase();
}

/** "capsules" and "capsule" are the same unit. Used only to see whether the quantity already names the pack. */
function unitStem(word: string): string {
  const bare = word.trim().toLowerCase();
  return bare.endsWith('s') ? bare.slice(0, -1) : bare;
}

/**
 * A matching pack rule divides a bare number, or a number of the pack's own unit, rounded up.
 * A quantity that already names inhalers or devices is kept as that number.
 * No rule, or no match: the number is written as it is, except a capsule count with nothing to divide it by, which stays unread.
 */
function packAmount(
  text: string, read: { amount: number; unit: string } | null, packs: SupplyPack[] | undefined
): { amount: number; shown: string } | null {
  if (!read) return null;
  const plain = { amount: read.amount, shown: String(read.amount) };
  const capsules = CAPSULE_UNIT.test(read.unit);
  const product = productField(text);
  const rule = (packs ?? []).find(pack => {
    const word = pack.form_has.trim().toLowerCase();
    return word !== '' && product.includes(word);
  });
  if (!rule) return capsules ? null : plain;
  const bare = read.unit === '';
  const ownUnit = read.unit !== '' && unitStem(read.unit) === unitStem(rule.form_has);
  if (!bare && !ownUnit) return capsules ? null : plain;
  const amount = Math.ceil(read.amount / rule.per);
  return { amount, shown: `${amount} (${read.amount} ${packWord(rule.form_has, read.amount)}, one pack of ${rule.per})` };
}

/** "capsule" with 30 is "capsules". A word that already ends in s is left as it is. */
function packWord(word: string, n: number): string {
  const bare = word.trim();
  if (n === 1 || /s$/i.test(bare)) return bare;
  return `${bare}s`;
}

/** The newest dated line that is not a line entered at the counter. The same rule as the dates note. */
function newestDate(lines: HistoryLine[]): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    if (enteredAtTheCounter(line.text)) continue;
    const date = lineDate(line.text);
    if (date && (latest === null || date > latest)) latest = date;
  }
  return latest;
}

function inWindow(date: string, end: string, months: number): boolean {
  const cut = monthsBefore(end, months);
  if (!cut) return false;
  return date >= cut && date <= end;
}

function chooseEnd(hits: Hit[], spec: SupplyCount, recordEnd: string | null): string | null {
  if (spec.window === 'last') return recordEnd;
  const ends = [...new Set(hits.map(hit => hit.date))].sort();
  let best: string | null = null;
  let bestTotal = -1;
  for (const end of ends) {
    let total = 0;
    for (const hit of hits) {
      if (hit.amount !== null && inWindow(hit.date, end, spec.months)) total += hit.amount;
    }
    if (best === null || total > bestTotal || (total === bestTotal && end > best)) {
      best = end;
      bestTotal = total;
    }
  }
  return best;
}

function told(
  spec: SupplyCount, problem: string, end: string | null,
  counted: Array<Hit & { amount: number }>, unread: string[], possible: string[] = []
): SupplyTally {
  const total = counted.reduce((sum, hit) => sum + hit.amount, 0);
  const head = `COUNTED BY THE APPLICATION. Group ${spec.group}`;
  // The count was not read. Saying "Total supplied: 0" there would be a confident wrong total.
  if (problem) return { note: `${head} ${problem}.`, total: 0, lines: 0, unread: [], windowEnd: null };
  const open = unread.length > 0 || possible.length > 0;
  const closing = open ? UNSETTLED : SETTLED;
  const parts: string[] = [];
  if (counted.length === 0 && open) {
    const span = spanWords(spec, end);
    const where = span ? ` supplies ${span}` : ' supplies';
    if (unread.length > 0) {
      const named = unread.join(', ');
      parts.push(`${head}${where}: the application could not read the quantities of ${named}.`);
      parts.push(`Quantity not read: ${named}.`);
    } else {
      parts.push(`${head}${where}: no line was counted.`);
    }
  } else if (counted.length === 0) {
    const span = spanWords(spec, end);
    const middle = span ? `${head} supplies ${span}: none.` : `${head} supplies: none.`;
    parts.push(middle);
    parts.push('Lines: 0. Total supplied: 0. Quantity not read: none.');
  } else {
    const dates = counted.map(hit => hit.date).sort();
    const list = counted.map(hit => `${hit.id} ${hit.shown}`).join(', ');
    parts.push(`${head} supplies from ${dates[0]} to ${dates[dates.length - 1]} ${spanWords(spec, end)}: ${list}.`);
    const unreadText = unread.length === 0 ? 'none' : unread.join(', ');
    parts.push(`Lines: ${counted.length}. Total supplied: ${total}. Quantity not read: ${unreadText}.`);
  }
  if (possible.length > 0) parts.push(`Possibly of this group, not counted: ${possible.join(', ')}.`);
  const note = `${parts.join(' ')} ${closing}`;
  return { note, total, lines: counted.length, unread, windowEnd: end };
}

function spanWords(spec: SupplyCount, end: string | null): string {
  if (!end) return '';
  const length = spec.months === 1 ? '1 month' : `${spec.months} months`;
  const on = spec.window === 'last' ? 'the newest date of the record' : end;
  return `(the ${length} ending on ${on})`;
}
