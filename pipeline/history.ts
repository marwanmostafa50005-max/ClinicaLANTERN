// Helpers shared by the three jobs: the numbered history text, the line-ID guard,
// splitting a long history into overlapping parts, and the import check for printed rows.
import type { HistoryLine, PatientHeader } from '../shared/types.ts';
import { isFactLine } from '../shared/facts.ts';
import { lineId, MAX_LINE_CHARS } from './csv.ts';
import { findDates, parseDateField } from './dates.ts';

/**
 * A date of birth is used only to work out the age. It is taken out of a label, a sex note,
 * a free-text field and a letter. A supply date at the start of a line is left, even when
 * that day is also the birthday.
 */
const BIRTH_LABEL = String.raw`d\.?\s*o\.?\s*b\.?|date\s+of\s+birth|birth\s*date|birthdate|birthday|born`;
const BIRTH_VALUE = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`;

function labelledBirth(): RegExp {
  return new RegExp(String.raw`\b(?:${BIRTH_LABEL})\b\s*:?\s*(?:on\s+)?(?:${BIRTH_VALUE})`, 'gi');
}

function tidyBirthGap(line: string): string {
  return line
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/(?:\s*\|\s*){2,}/g, ' | ')
    .replace(/\s+\|\s*$/g, '')
    .replace(/^\s*\|\s*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,\s*$/g, '')
    .trim();
}

function omitBirthDateLine(line: string, dateOfBirth: string | undefined): string {
  let out = line.replace(labelledBirth(), ' ');
  if (dateOfBirth) {
    const found = findDates(out);
    const leading = found.dates.find(d => d.kind === 'full' && out.slice(0, d.index).trim() === '');
    let cursor = 0;
    let built = '';
    let removed = false;
    for (const date of found.dates) {
      if (date.kind !== 'full' || date.iso !== dateOfBirth) continue;
      if (leading && date.index === leading.index) continue;
      built += out.slice(cursor, date.index);
      cursor = date.index + date.raw.length;
      removed = true;
    }
    if (removed) out = built + out.slice(cursor);
  }
  if (out === line) return line;
  return tidyBirthGap(out);
}

/** The text with a birth date taken out. Unchanged, character for character, when it holds none. */
export function omitBirthDate(text: string, dateOfBirth?: string): string {
  if (!text) return text;
  const dob = typeof dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? dateOfBirth : undefined;
  let changed = false;
  const next = text.split('\n').map(line => {
    const cleaned = omitBirthDateLine(line, dob);
    if (cleaned !== line) changed = true;
    return cleaned;
  });
  return changed ? next.join('\n') : text;
}

/** "Fictional patient F-001, female, 72 years" */
export function patientText(patient: PatientHeader): string {
  const label = omitBirthDate(patient.label, patient.dateOfBirth).trim() || 'Fictional patient';
  const bits = [label];
  const sex = omitBirthDate((patient.sex ?? '').trim(), patient.dateOfBirth).replace(/[,:;.\s]+$/g, '').trim();
  if (sex) {
    const low = sex.toLowerCase();
    bits.push(low === 'f' || low === 'female' ? 'female' : low === 'm' || low === 'male' ? 'male' : sex);
  }
  if (typeof patient.age === 'number' && Number.isFinite(patient.age)) bits.push(`${patient.age} years`);
  return bits.join(', ');
}

/** The history as the models see it: one supply per line, each line starting with its ID. */
export function numberedHistory(lines: HistoryLine[], dateOfBirth?: string): string {
  return lines.map(l => `${l.id} | ${omitBirthDate(l.text, dateOfBirth)}`).join('\n');
}

export const HISTORY_HEAD = 'DISPENSING HISTORY (one supply per line, each line starts with its ID)';
/** The heading when the record also carries conditions and results (docs/SPEC.md section 6a). */
export const HISTORY_HEAD_WITH_FACTS =
  'DISPENSING HISTORY WITH RECORDED FACTS (one supply or one fact per line, each line starts with its ID; ' +
  'a fact line says CONDITION, RESULT or OBSERVATION after its date)';

/**
 * The opening of every screen and check prompt. It is the same for all criteria of one case, so the model's reading of it is reused.
 * A history with no fact line reads exactly as before. When a line is a fact, the heading says so.
 */
export function historyBlock(patient: PatientHeader, lines: HistoryLine[], partNote = ''): string {
  const head = lines.some(l => isFactLine(l.text)) ? HISTORY_HEAD_WITH_FACTS : HISTORY_HEAD;
  return `PATIENT (fictional)\n${patientText(patient)}\n\n` +
    head + '\n' +
    (partNote ? partNote + '\n' : '') +
    numberedHistory(lines, patient.dateOfBirth);
}

export interface GuardedIds {
  kept: string[];                     // IDs that exist, in history order, each once
  dropped: string[];                  // what the model wrote that is not a line of this history
}

/** The line-ID guard: keeps only IDs that exist in the history. */
export function keepKnownLineIds(ids: unknown, lines: HistoryLine[]): GuardedIds {
  const known = new Set(lines.map(l => l.id));
  const wanted = new Set<string>();
  const dropped: string[] = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (id && known.has(id)) wanted.add(id);
    else dropped.push(typeof raw === 'string' ? raw : JSON.stringify(raw));
  }
  return { kept: lines.filter(l => wanted.has(l.id)).map(l => l.id), dropped };
}

/** How many overlapping parts a history of this length is read in. */
export function countParts(lineCount: number, maxLines: number, overlap: number): number {
  if (lineCount <= maxLines) return 1;
  const step = Math.max(1, maxLines - sharedLines(overlap, maxLines));
  return Math.ceil((lineCount - maxLines) / step) + 1;
}

/** How many lines two neighbouring parts share: the overlap asked for, but never more than a third of a part. */
function sharedLines(overlap: number, partLength: number): number {
  return Math.max(0, Math.min(overlap, Math.floor(partLength / 3)));
}

function lineSize(line: HistoryLine): number {
  return line.id.length + line.text.length + 4;        // "L001 | text" and the line break
}

/**
 * Splits a long history into overlapping parts. A history that fits is returned as one part.
 * A part holds at most maxLines lines and at most maxChars characters, so that it fits in the
 * model's reading window however long the lines are.
 */
export function splitIntoParts(lines: HistoryLine[], maxLines: number, overlap: number, maxChars = Infinity): HistoryLine[][] {
  const total = lines.reduce((sum, l) => sum + lineSize(l), 0);
  if (lines.length <= maxLines && total <= maxChars) return [lines];
  const parts: HistoryLine[][] = [];
  let start = 0;
  for (;;) {
    let end = start;
    let chars = 0;
    while (end < lines.length && end - start < maxLines && (end === start || chars + lineSize(lines[end]) <= maxChars)) {
      chars += lineSize(lines[end]);
      end++;
    }
    parts.push(lines.slice(start, end));
    if (end >= lines.length) break;
    start = end - sharedLines(overlap, end - start);    // a part of 3 lines or more always moves on
  }
  return parts;
}

// About 2.6 characters make one token in these histories. Measured on this PC on 18 November:
// 150 demo lines are 8,214 tokens for the screen model and 8,397 for the check model.
// 2.0 is used for the budget so the estimate errs on the safe side.
const CHARS_PER_TOKEN_FOR_BUDGET = 2.0;
const TOKENS_FOR_THE_REST_OF_THE_PROMPT = 1500;       // system role, patient, criterion block, task
// When a prompt is larger than the window, Ollama keeps about half of it and drops the start without
// an error (seen in a test: 389 lines went in, 8,195 tokens were read and a planted finding was missed).
// A cut prompt shows as far more characters per token than text can have.
const CUT_PROMPT_CHARS_PER_TOKEN = 3.8;
const SMALLEST_PROMPT_THAT_CAN_BE_CUT = 20000;        // characters

/** How many characters of history fit in one call, leaving room for the rest of the prompt and the answer. */
export function historyCharBudget(numCtx: number, numPredict: number): number {
  return Math.max(4000, Math.floor((numCtx - numPredict - TOKENS_FOR_THE_REST_OF_THE_PROMPT) * CHARS_PER_TOKEN_FOR_BUDGET));
}

/**
 * True when the prompt and the room kept for the answer fit in the model's reading window, and the
 * model read all of the prompt. When it is false the start of the history may not have been read,
 * so the answer must not be trusted.
 * promptTokens is what Ollama says it read; promptChars is the length of what was sent.
 */
export function promptFits(numCtx: number, promptTokens: number, numPredict: number, promptChars = 0): boolean {
  if (promptTokens <= 0) return true;                  // no count reported: nothing to judge
  if (promptTokens + numPredict + 64 > numCtx) return false;
  if (promptChars >= SMALLEST_PROMPT_THAT_CAN_BE_CUT && promptChars / promptTokens > CUT_PROMPT_CHARS_PER_TOKEN) return false;
  return true;
}

/** The length of a prompt in characters. */
export function promptLength(messages: { content: string }[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

export const TOO_LONG_FOR_THE_MODEL = 'This part of the history is too long for the model to read in one go.';

/**
 * The note that heads the lines of a long history when only the lines that matter are shown together.
 * It tells the model that the lines come from every part, and that what is not shown holds other medicines.
 */
export function joinedNote(totalLines: number, shownLines: number, withFacts = false): string {
  if (!withFacts) {
    return `This history is long: ${totalLines} lines. Only the ${shownLines} ${shownLines === 1 ? 'line that holds' : 'lines that hold'} ` +
      'a medicine listed for this criterion are shown here. They come from every part of the history. ' +
      'The lines that are not shown hold other medicines.';
  }
  // A criterion that needs facts: the lines about those facts are shown with the medicine lines.
  if (shownLines === 0) {
    return `This history is long: ${totalLines} lines. No line of it holds a medicine listed for this criterion or a fact this criterion needs, ` +
      'so no line is shown here. The lines that are not shown hold other medicines and other facts.';
  }
  if (shownLines === 1) {
    return `This history is long: ${totalLines} lines. Only the 1 line that holds a medicine listed for this criterion, or a fact this criterion needs, ` +
      'is shown here. The lines that are not shown hold other medicines and other facts.';
  }
  return `This history is long: ${totalLines} lines. Only the ${shownLines} lines that hold ` +
    'a medicine listed for this criterion, or a fact this criterion needs, are shown here. They come from every part of the history. ' +
    'The lines that are not shown hold other medicines and other facts.';
}

/** True when these lines can be read in one call: not more than maxLines, and within the size the model can read. */
export function fitsInOneCall(lines: HistoryLine[], maxLines: number, maxChars: number): boolean {
  return lines.length <= maxLines && lines.reduce((sum, l) => sum + lineSize(l), 0) <= maxChars;
}

/**
 * Keeps a text the model wrote to a sensible length. A text that reached the limit is cut back to
 * its last whole sentence (or word) and says that more was written.
 */
export function clipText(text: string, max: number, cutNote: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length < max) return one;
  const head = one.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  let kept: string;
  if (sentenceEnd >= max * 0.4) kept = head.slice(0, sentenceEnd + 1);
  else {
    const space = head.lastIndexOf(' ');
    kept = (space > 0 ? head.slice(0, space) : head).replace(/[,;:(\s]+$/, '') + ' ...';
  }
  return `${kept} ${cutNote}`.trim();
}

/**
 * Picks the fewest parts that together hold all the given lines.
 * With no lines to look for, every part is returned.
 */
export function partsHolding(parts: HistoryLine[][], lineIds: string[]): number[] {
  const all = parts.map((_, i) => i);
  if (parts.length <= 1) return all;
  const present = new Set(parts.flat().map(l => l.id));
  const todo = new Set(lineIds.filter(id => present.has(id)));
  if (todo.size === 0) return all;
  const chosen: number[] = [];
  while (todo.size > 0) {
    let best = -1;
    let bestCover = 0;
    parts.forEach((part, i) => {
      if (chosen.includes(i)) return;
      const cover = part.filter(l => todo.has(l.id)).length;
      if (cover > bestCover) {
        best = i;
        bestCover = cover;
      }
    });
    if (best === -1) break;
    chosen.push(best);
    for (const l of parts[best]) todo.delete(l.id);
  }
  return chosen.sort((a, b) => a - b);
}

/** Joins texts, dropping empty ones and exact repeats. */
export function joinDistinct(texts: string[], separator = ' '): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const one = t.trim();
    if (one && !seen.has(one.toLowerCase())) {
      seen.add(one.toLowerCase());
      out.push(one);
    }
  }
  return out.join(separator);
}

/** Merges name lists without repeats, ignoring upper and lower case. */
export function mergeNames(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        out.push(name);
      }
    }
  }
  return out;
}

/**
 * Turns printed rows (from a PDF with text, or read from a page image) into numbered lines,
 * and checks that the history can be assessed: at least one dated row, dates readable.
 */
export function linesFromRows(
  rows: unknown, pages?: number[], options: { everyRowDated?: boolean } = {}
): { lines: HistoryLine[]; problems: string[] } {
  const lines: HistoryLine[] = [];
  const problems: string[] = [];
  const badDates: string[] = [];
  let datedRows = 0;
  const list = Array.isArray(rows) ? rows : [];
  const tooLong: string[] = [];
  list.forEach((raw, index) => {
    const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!text) return;
    const id = lineId(lines.length + 1);
    // A row is never cut short without saying so: a row that is too long stops the history from being assessed.
    const line: HistoryLine = { id, text: text.slice(0, MAX_LINE_CHARS) };
    if (text.length > MAX_LINE_CHARS) tooLong.push(id);
    const page = pages?.[index];
    if (typeof page === 'number') line.page = page;
    lines.push(line);
    if (options.everyRowDated) {
      // A row read from a scan is one supply. Its first field is the date, as in a CSV file.
      const field = line.text.split(' | ')[0].trim();
      if (parseDateField(field)) datedRows++;
      else if (/^\d{1,4}\s*[/.-]/.test(field) || /^\d{1,2}\s+[A-Za-z]{3,9}\b/.test(field)) badDates.push(`Line ${id}: the date "${field.slice(0, 30)}" cannot be read.`);
      else badDates.push(`Line ${id} has no date.`);
      return;
    }
    const first = findDates(line.text).dates.find(d => d.kind === 'full');
    if (first?.iso) datedRows++;
    else if (first) badDates.push(`Line ${id}: the date "${first.raw}" cannot be read.`);
  });
  if (lines.length === 0) {
    problems.push('No rows could be read from the file.');
  } else if (datedRows === 0) {
    problems.push('No row has a date that can be read.');
  } else if (badDates.length > 0) {
    problems.push(...badDates.slice(0, 5));
    if (badDates.length > 5) problems.push(`There are ${badDates.length - 5} more rows like this.`);
  }
  if (tooLong.length > 0) {
    problems.push(`${tooLong.length === 1 ? 'Line' : 'Lines'} ${tooLong.slice(0, 5).join(', ')} ${tooLong.length === 1 ? 'is' : 'are'} too long to read (over ${MAX_LINE_CHARS} characters).`);
  }
  return { lines, problems };
}

/** The lines with the given IDs, in history order. */
export function linesById(lines: HistoryLine[], ids: string[]): HistoryLine[] {
  const wanted = new Set(ids);
  return lines.filter(l => wanted.has(l.id));
}
