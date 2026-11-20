import { describe, expect, it } from 'vitest';
import type { Finding } from './types.ts';
import { FACT_WORDS, enteredAtTheCounter, factLineKind, isFactLine, isPossible, listFacts, missingFactsOf, tidyFact, tidyFacts } from './facts.ts';

function finding(missingFacts: string[], possible?: boolean): Finding {
  const f: Finding = {
    id: 'F0001', caseId: 'C0001', criterionId: 'STOPP-E1', state: 'suspected',
    possible: possible ?? missingFacts.length > 0,
    screen: { lineIds: ['L002'], medicines: ['digoxin'], reason: 'x', linesVerified: true, missingFacts, model: 'lantern-screen', at: '', seconds: 1 },
    seenByPharmacist: false
  };
  return f;
}

describe('a fact line and a supply line (docs/SPEC.md section 6a)', () => {
  it('knows the three kinds of fact line by their shape', () => {
    expect(factLineKind('2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2')).toBe('result');
    expect(factLineKind('2026-07-10 | CONDITION | Heart failure')).toBe('condition');
    expect(factLineKind('2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg')).toBe('observation');
    expect(factLineKind('no date | CONDITION | Heart failure')).toBe('condition');
    expect(factLineKind('2026-08-03 | RESULT')).toBe('result');
  });

  it('never takes a supply line for a fact line', () => {
    const supplies = [
      '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample',
      '2026-08-21 | Celebrex 200 mg capsule',
      '2026-08-21 | Result Plus 10 mg tablet | qty 30',
      '2026-08-21 | CONDITIONER 200 mL | qty 1',
      '2026-08-21 Celebrex 200 mg, RESULT pending',
      'RESULT | eGFR 28',
      ''
    ];
    for (const text of supplies) expect(isFactLine(text), text).toBe(false);
  });
});

describe('a possible finding and the facts the record does not show', () => {
  it('reads the missing facts the first model named, tidied and each once', () => {
    expect(missingFactsOf(finding(['eGFR.', ' Heart  failure ', 'egfr', '']))).toEqual(['eGFR', 'Heart failure']);
    expect(missingFactsOf(finding([]))).toEqual([]);
  });

  it('gives an empty list and "not possible" for a finding recorded before 18 November, which has neither field', () => {
    const old = { id: 'F0001', caseId: 'C0001', criterionId: 'DEMO', state: 'confirmed', screen: { lineIds: ['L001'], medicines: [], reason: '' } } as unknown as Finding;
    expect(missingFactsOf(old)).toEqual([]);
    expect(isPossible(old)).toBe(false);
    expect(missingFactsOf({} as unknown as Finding)).toEqual([]);
  });

  it('is possible when the finding says so, and by its missing facts when the mark is not there', () => {
    expect(isPossible(finding(['eGFR']))).toBe(true);
    expect(isPossible(finding([]))).toBe(false);
    const noMark = { screen: { missingFacts: ['eGFR'] } } as unknown as Finding;
    expect(isPossible(noMark)).toBe(true);
    // The mark on the finding is the answer when it is there.
    expect(isPossible(finding(['eGFR'], false))).toBe(false);
    expect(isPossible(finding([], true))).toBe(true);
  });

  it('treats a value that is not text as no fact, and strips the marks at the end of a fact', () => {
    expect(factLineKind(undefined as unknown as string)).toBeNull();
    expect(isFactLine(12 as unknown as string)).toBe(false);
    expect(tidyFact(12)).toBe('');
    expect(tidyFact('eGFR...')).toBe('eGFR');
    expect(tidyFact('heart failure;')).toBe('heart failure');
    const markIsNotABoolean = { possible: 'yes', screen: { missingFacts: [] } } as unknown as Finding;
    expect(isPossible(markIsNotABoolean)).toBe(false);
  });

  it('reads a kind with no space beside the bars, and a mark that is not yes or no falls through', () => {
    expect(factLineKind('2026-08-03 |RESULT| eGFR 28')).toBe('result');
    expect(factLineKind('2026-08-03 | OBSERVATION   ')).toBe('observation');
    expect(factLineKind('2026-08-03 | result | eGFR')).toBeNull();
    expect(isPossible({ possible: null, screen: { missingFacts: ['eGFR'] } } as unknown as Finding)).toBe(true);
    expect(isPossible({ screen: null } as unknown as Finding)).toBe(false);
    expect(listFacts(['eGFR', 'blood pressure', 'pulse', 'heart failure'])).toBe('eGFR, blood pressure, pulse and heart failure');
    expect(tidyFact('   ')).toBe('');
    expect(tidyFact('a; b.')).toBe('a; b');
  });

  it('writes a list of facts in plain words', () => {
    expect(listFacts([])).toBe('');
    expect(listFacts(['eGFR'])).toBe('eGFR');
    expect(listFacts(['eGFR', 'heart failure'])).toBe('eGFR and heart failure');
    expect(listFacts(['eGFR', 'blood pressure', 'heart failure'])).toBe('eGFR, blood pressure and heart failure');
    expect(tidyFact('  eGFR (kidney function), the most recent result. ')).toBe('eGFR (kidney function), the most recent result');
    expect(tidyFacts('eGFR')).toEqual([]);
    expect(tidyFacts([7, null, 'eGFR'])).toEqual(['eGFR']);
  });

  it('builds a fact line from the three words, and a mark that is a number falls through', () => {
    for (const kind of ['condition', 'result', 'observation'] as const) {
      expect(factLineKind(`2026-08-03 | ${FACT_WORDS[kind]} | detail`)).toBe(kind);
    }
    expect(factLineKind('2026-08-03 |   RESULT | CONDITION noted')).toBe('result');
    expect(factLineKind(null as unknown as string)).toBeNull();
    expect(tidyFact('...')).toBe('');
    expect(tidyFact('eGFR,')).toBe('eGFR');
    expect(missingFactsOf({ screen: { missingFacts: 'eGFR' } } as unknown as Finding)).toEqual([]);
    expect(isPossible({ possible: 1, screen: { missingFacts: [] } } as unknown as Finding)).toBe(false);
    expect(isPossible({ possible: 1, screen: { missingFacts: ['eGFR'] } } as unknown as Finding)).toBe(true);
    expect(tidyFacts(['Heart failure', 'heart failure', 'eGFR'])).toEqual(['Heart failure', 'eGFR']);
  });

  it('does not take a later column as the kind of fact, and a tab still marks a result', () => {
    expect(factLineKind('2026-08-21 | Celebrex 200 mg | RESULT | extra')).toBeNull();
    expect(isFactLine('2026-08-21 | Celebrex 200 mg | RESULT | extra')).toBe(false);
    expect(factLineKind('2026-08-03 |\tRESULT\t|\teGFR 28')).toBe('result');
    expect(tidyFacts(['.', 'eGFR.', 'eGFR'])).toEqual(['eGFR']);
    expect(listFacts([''])).toBe('');
  });

  it('knows a line the pharmacist entered at the counter, and nothing else', () => {
    expect(enteredAtTheCounter('no date | CONDITION | Heart failure. Confirmed by the pharmacist at the counter on 19 November 2026.')).toBe(true);
    expect(enteredAtTheCounter('2026-11-19 | RESULT | eGFR 28. Entered by the pharmacist at the counter.')).toBe(true);
    expect(enteredAtTheCounter('no date | CONDITION | Heart failure. Taken back by the pharmacist at the counter.')).toBe(true);
    expect(enteredAtTheCounter('2026-08-08 | Xarelto 20 mg tablet | qty 28')).toBe(false);
    expect(enteredAtTheCounter('pharmacist at the pharmacy counter')).toBe(false);
    expect(enteredAtTheCounter('Pharmacist at the counter')).toBe(false);
    expect(enteredAtTheCounter('')).toBe(false);
    expect(enteredAtTheCounter(undefined as unknown as string)).toBe(false);
    expect(enteredAtTheCounter(12 as unknown as string)).toBe(false);
  });

  it('does not take a longer word for the kind, and a colon at the end is not part of the fact', () => {
    expect(factLineKind('| CONDITION | Heart failure')).toBe('condition');
    expect(factLineKind('2026-08-03 | RESULTS | eGFR 28')).toBeNull();
    expect(isFactLine('2026-08-03 | OBSERVATIONS')).toBe(false);
    expect(tidyFact('potassium:\n')).toBe('potassium');
    expect(tidyFact('ratio: 1.2:')).toBe('ratio: 1.2');
    expect(listFacts(['eGFR', ''])).toBe('eGFR and ');
    expect(tidyFacts(['potassium:', 'Potassium', 'ratio: 1.2:'])).toEqual(['potassium', 'ratio: 1.2']);
  });
});
