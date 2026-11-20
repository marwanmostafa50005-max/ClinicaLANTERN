// Records that also carry conditions and results (docs/SPEC.md section 6a): the words the page
// says about them. Which line is a fact, whether a finding is a possible finding and which fact
// the record does not show are decided by the one rule in shared/facts.ts, the same rule the
// server and the letter use. This file only chooses the words.
// Pure code: no browser and no server.
import { listFacts, missingFactsOf, tidyFact } from '../../shared/facts.ts';
import type { FactKind, Finding, NeededFact } from '../../shared/types.ts';

/** What each kind of fact is, in plain words. Said when the pointer rests on the mark of a fact line. */
export const FACT_KIND_WORDS: Record<FactKind, string> = {
  condition: 'A condition from the record. It is not a supply.',
  result: 'A test result from the record. It is not a supply.',
  observation: 'A measurement from the record. It is not a supply.',
};

/**
 * What the record does not show, for the line "Possible finding. The record does not show: (fact).
 * The letter asks the doctor to confirm."
 * The words of Model 1 come first. When it named nothing and the criterion needs one fact only,
 * that fact is named. Otherwise the line says that a fact is missing, without guessing which.
 */
export function notShownWords(finding: Finding, needed: ReadonlyArray<Pick<NeededFact, 'what'>> = []): string {
  const named = missingFactsOf(finding);
  if (named.length > 0) return listFacts(named);
  const only = needed.length === 1 ? tidyFact(needed[0].what) : '';
  return only !== '' ? only : 'a fact this criterion needs';
}
