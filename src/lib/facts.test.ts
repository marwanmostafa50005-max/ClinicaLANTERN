// The words the page says about a record that also carries conditions and results
// (docs/SPEC.md section 6a). Which line is a fact and which finding is a possible finding is the
// one rule of shared/facts.ts. Here: what the bell says the record does not show.
import { describe, expect, it } from 'vitest';
import { FACT_WORDS, factLineKind, isPossible } from '../../shared/facts.ts';
import type { Finding } from '../../shared/types.ts';
import { FACT_KIND_WORDS, notShownWords } from './facts.ts';

function finding(missingFacts: string[], possible = missingFacts.length > 0): Finding {
  return {
    id: 'F0001', caseId: 'C0001', criterionId: 'X', state: 'confirmed', possible, seenByPharmacist: false,
    screen: { lineIds: ['L001'], medicines: [], reason: '', linesVerified: true, missingFacts, model: 'm', at: '', seconds: 1 },
  };
}

describe('what the record does not show', () => {
  it('uses the words of Model 1, without the full stop at their end', () => {
    expect(notShownWords(finding(['an eGFR result.']))).toBe('an eGFR result');
    expect(notShownWords(finding(['  a diagnosis of   heart failure ']))).toBe('a diagnosis of heart failure');
  });

  it('writes two or three facts as one plain list, each of them once', () => {
    expect(notShownWords(finding(['eGFR', 'heart failure']))).toBe('eGFR and heart failure');
    expect(notShownWords(finding(['eGFR', 'blood pressure', 'heart failure', 'eGFR']))).toBe('eGFR, blood pressure and heart failure');
  });

  it('names the one fact the criterion needs when Model 1 named none', () => {
    expect(notShownWords(finding([], true), [{ what: 'eGFR' }])).toBe('eGFR');
    // The words of Model 1 come first when there are any.
    expect(notShownWords(finding(['an eGFR result']), [{ what: 'eGFR' }])).toBe('an eGFR result');
  });

  it('never guesses which fact is missing when the criterion needs more than one, or names none', () => {
    expect(notShownWords(finding([], true), [{ what: 'eGFR' }, { what: 'Heart failure' }])).toBe('a fact this criterion needs');
    expect(notShownWords(finding([], true))).toBe('a fact this criterion needs');
    expect(notShownWords(finding([], true), [{ what: '  ' }])).toBe('a fact this criterion needs');
  });

  it('reads a finding recorded before records could carry facts', () => {
    // The recorded run of the judges' view was saved without the two fields.
    const old = { id: 'F0001', caseId: 'C0001', criterionId: 'X', state: 'confirmed', seenByPharmacist: false, screen: { lineIds: ['L001'] } } as unknown as Finding;
    expect(isPossible(old)).toBe(false);
    expect(notShownWords(old)).toBe('a fact this criterion needs');
  });
});

describe('the mark of a fact line', () => {
  it('has plain words for each kind the record can carry', () => {
    for (const kind of ['condition', 'result', 'observation'] as const) {
      expect(factLineKind(`2026-08-03 | ${FACT_WORDS[kind]} | a fact`)).toBe(kind);
      expect(FACT_KIND_WORDS[kind]).toMatch(/from the record\. It is not a supply\.$/);
    }
    // A supply is not a fact, whatever its words.
    expect(factLineKind('2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30')).toBeNull();
  });
});
