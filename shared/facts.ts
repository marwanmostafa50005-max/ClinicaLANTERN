// One rule for the facts a record carries beside its supplies (docs/SPEC.md section 6a).
// The CSV reader, the model jobs, the letter and the server use it, and the page and the scorer
// can use it too, so that all agree on which line is a fact, whether a finding is a possible
// finding, and which fact the record does not show.
// Erasable TypeScript only: Node runs this file directly, and the page can bundle it.
// It reads the shape of a line. It never reads a medicine name.
import type { FactKind, Finding, PharmacistQuestion } from './types.ts';

/** How each kind of fact is written in a line of the record. */
export const FACT_WORDS: Record<FactKind, string> = {
  condition: 'CONDITION',
  result: 'RESULT',
  observation: 'OBSERVATION'
};

const KIND_OF_WORD: Record<string, FactKind> = { CONDITION: 'condition', RESULT: 'result', OBSERVATION: 'observation' };

// "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2": the date, the kind in capitals, the fact.
const FACT_LINE = /^[^|]*\|\s*(CONDITION|RESULT|OBSERVATION)\s*(?:\||$)/;

/** The kind of a fact line, or null for a supply line. */
export function factLineKind(lineText: string): FactKind | null {
  const found = FACT_LINE.exec(typeof lineText === 'string' ? lineText : '');
  return found ? KIND_OF_WORD[found[1]] : null;
}

/** True when the line is a condition, a result or an observation, and not a supply. */
export function isFactLine(lineText: string): boolean {
  return factLineKind(lineText) !== null;
}

/**
 * A line the pharmacist added at the counter. It is a fact about the patient, not an event
 * of the history, so it is left out of the record's start and end.
 */
export function enteredAtTheCounter(lineText: string): boolean {
  return typeof lineText === 'string' && lineText.includes('pharmacist at the counter');
}

/** One fact as a model or a criterion file named it: one line, no full stop at its end. */
export function tidyFact(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '').trim();
}

/** A list of facts without empty entries and repeats (upper and lower case are the same fact). */
export function tidyFacts(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const fact = tidyFact(raw);
    if (fact === '' || seen.has(fact.toLowerCase())) continue;
    seen.add(fact.toLowerCase());
    out.push(fact);
  }
  return out;
}

// Read loosely: a state saved before 18 November, and a finding built by other code, may not have the fields.
interface LooseFinding {
  possible?: unknown;
  screen?: { missingFacts?: unknown } | null;
}

/**
 * The facts the record does not show, as the first model named them. Empty when nothing is missing,
 * and for a finding recorded before records could carry facts.
 */
export function missingFactsOf(finding: Pick<Finding, 'screen'> | LooseFinding): string[] {
  return tidyFacts((finding as LooseFinding).screen?.missingFacts);
}

/**
 * True for a possible finding: the medicines match, and the record holds no line about a fact the
 * criterion needs. "possible" is used when the finding carries it. A finding without the field
 * (an old record) is possible when its first model named a missing fact.
 */
export function isPossible(finding: Pick<Finding, 'screen'> | LooseFinding): boolean {
  const flag = (finding as LooseFinding).possible;
  return typeof flag === 'boolean' ? flag : missingFactsOf(finding).length > 0;
}

/**
 * Why this criterion is on the question. A saved question with no link list uses the question source
 * for every criterion it names, which is how those questions were gated.
 */
export function linkWhy(q: PharmacistQuestion, criterionId: string): PharmacistQuestion['source'] | undefined {
  const named = q.links?.find(item => item.criterionId === criterionId);
  if (named) return named.why;
  if (q.criterionIds.includes(criterionId)) return q.source;
  return undefined;
}

/** An open standing or supply link holds this criterion. A possible-finding link does not. */
export function criterionWaitsOnAnswer(q: PharmacistQuestion, criterionId: string): boolean {
  if (q.status !== 'open') return false;
  const why = linkWhy(q, criterionId);
  return why === 'patient' || why === 'supply';
}

/** "eGFR", "eGFR and heart failure", "eGFR, blood pressure and heart failure". */
export function listFacts(facts: string[]): string {
  if (facts.length <= 1) return facts[0] ?? '';
  return `${facts.slice(0, -1).join(', ')} and ${facts[facts.length - 1]}`;
}
