// Unit tests for the plan of a run: which criterion is screened on which history. No model is used.

import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ONE_IN,
  SAMPLE_PER_HISTORY,
  SAMPLE_SEED,
  inCallOrder,
  planFullRun,
  planOwnCriterion,
  planSample,
  seededRandom,
  shuffled,
} from './plan.ts';
import type { PlanCase, PlannedPair } from './plan.ts';

function history(file: string, kind: PlanCase['kind'], expects: string[] = [], readable = true): PlanCase {
  return { file, kind, findings: expects.map((criterion) => ({ criterion })), readable };
}

function shown(pairs: PlannedPair[], cases: PlanCase[]): string[] {
  return pairs.map((p) => `${cases[p.caseIndex].file} | ${p.criterionId}${p.role ? ` | ${p.role}` : ''}`);
}

const TEN = Array.from({ length: 10 }, (_, i) => `TEN-${i + 1}`);

describe('a full run', () => {
  it('plans every criterion on every history, history by history, with no role', () => {
    expect(planFullRun(2, ['A', 'B'])).toEqual([
      { caseIndex: 0, criterionId: 'A' },
      { caseIndex: 0, criterionId: 'B' },
      { caseIndex: 1, criterionId: 'A' },
      { caseIndex: 1, criterionId: 'B' },
    ]);
    expect(planFullRun(0, ['A'])).toEqual([]);
  });
});

describe('own criterion only', () => {
  const cases = [
    history('A-1/pos-brand.csv', 'positive', ['A-1']),
    history('A-1/near-miss.csv', 'near_miss'),
    history('B-2/pos-fact.csv', 'positive', ['B-2']),
    history('B-2/pos-nofact.csv', 'positive', ['B-2']),
    history('B-2/near-miss.csv', 'near_miss'),
    history('_clean/clean-1.csv', 'clean'),
  ];

  it('screens a planted history against the criteria its answer entry expects', () => {
    const plan = planOwnCriterion(cases, ['A-1', 'B-2'], ['A-1', 'B-2'], ['A-1']);
    expect(shown(plan.pairs, cases)).toEqual([
      'A-1/pos-brand.csv | A-1 | own',
      'A-1/near-miss.csv | A-1 | own',
      'B-2/pos-fact.csv | B-2 | own',
      'B-2/pos-nofact.csv | B-2 | own',
      'B-2/near-miss.csv | B-2 | own',
      '_clean/clean-1.csv | A-1 | clean',
    ]);
    expect(plan.notScreened).toEqual([]);
    expect(plan.screenedAsClean).toEqual([]);
  });

  it('screens a near miss against the criterion its folder is named after', () => {
    const plan = planOwnCriterion([history('B-2/near-miss.csv', 'near_miss')], ['A-1', 'B-2'], ['A-1', 'B-2'], ['A-1']);
    expect(plan.pairs).toEqual([{ caseIndex: 0, criterionId: 'B-2', role: 'own' }]);
  });

  it('screens a clean history against the first ten, and not against the further ones', () => {
    const all = [...TEN, 'FURTHER-1', 'FURTHER-2'];
    const plan = planOwnCriterion([history('_clean/clean-1.csv', 'clean')], all, all, TEN);
    expect(plan.pairs.map((p) => p.criterionId)).toEqual(TEN);
    expect(plan.pairs.every((p) => p.role === 'clean')).toBe(true);
  });

  it('screens a history against every criterion its entry expects, in run order', () => {
    const both = [history('A-1/pos-both.csv', 'positive', ['B-2', 'A-1'])];
    expect(planOwnCriterion(both, ['A-1', 'B-2'], ['A-1', 'B-2'], []).pairs.map((p) => p.criterionId)).toEqual(['A-1', 'B-2']);
  });

  it('leaves out a history whose criterion is in use but not in this run, and says so', () => {
    const plan = planOwnCriterion(cases, ['A-1'], ['A-1', 'B-2'], ['A-1']);
    expect(shown(plan.pairs, cases)).toEqual([
      'A-1/pos-brand.csv | A-1 | own',
      'A-1/near-miss.csv | A-1 | own',
      '_clean/clean-1.csv | A-1 | clean',
    ]);
    expect(plan.notScreened).toEqual(['B-2/pos-fact.csv', 'B-2/pos-nofact.csv', 'B-2/near-miss.csv']);
  });

  it('never leaves out a near miss whose folder names no criterion: it is screened like a clean history', () => {
    const odd = [history('_demo/near-miss.csv', 'near_miss')];
    const plan = planOwnCriterion(odd, ['A-1', 'B-2'], ['A-1', 'B-2'], ['A-1']);
    expect(plan.pairs).toEqual([{ caseIndex: 0, criterionId: 'A-1', role: 'clean' }]);
    expect(plan.screenedAsClean).toEqual(['_demo/near-miss.csv']);
    expect(plan.notScreened).toEqual([]);
  });
});

describe('the seeded generator', () => {
  it('gives the same numbers for the same seed, between 0 and 1', () => {
    const a = seededRandom(SAMPLE_SEED);
    const b = seededRandom(SAMPLE_SEED);
    const first = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(45);
    const other = seededRandom(SAMPLE_SEED + 1);
    expect(Array.from({ length: 50 }, () => other())).not.toEqual(first);
  });

  it('shuffles without losing or repeating anything', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    const once = shuffled(items, seededRandom(7));
    expect([...once].sort((x, y) => x - y)).toEqual(items);
    expect(once).not.toEqual(items);
    expect(shuffled(items, seededRandom(7))).toEqual(once);
    expect(items[0]).toBe(0);   // the list that was given is left as it was
  });
});

describe('the false-flag sample', () => {
  const criteria = Array.from({ length: 45 }, (_, i) => `C-${String(i + 1).padStart(2, '0')}`);
  const cases = criteria.flatMap((id) => [history(`${id}/pos-brand.csv`, 'positive', [id]), history(`${id}/near-miss.csv`, 'near_miss')]);
  const own = planOwnCriterion(cases, criteria, criteria, criteria.slice(0, 10)).pairs;

  it('draws one history in ten, and up to thirty other criteria for each', () => {
    const sample = planSample(cases, criteria, own);
    expect(SAMPLE_ONE_IN).toBe(10);
    expect(SAMPLE_PER_HISTORY).toBe(30);
    expect(sample.info).toMatchObject({ seed: SAMPLE_SEED, oneIn: 10, perHistory: 30, eligible: 90 });
    expect(sample.info.histories).toHaveLength(9);
    expect(sample.pairs).toHaveLength(9 * 30);
    expect(sample.info.screenings).toBe(270);
    expect(sample.pairs.every((p) => p.role === 'sample')).toBe(true);
    // Never a criterion the history is already screened against, and never the same one twice.
    const ownKeys = new Set(own.map((p) => `${p.caseIndex}|${p.criterionId}`));
    const keys = sample.pairs.map((p) => `${p.caseIndex}|${p.criterionId}`);
    expect(keys.some((k) => ownKeys.has(k))).toBe(false);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives the same sample every time for the same test set', () => {
    const one = planSample(cases, criteria, own);
    const two = planSample(cases, criteria, own);
    expect(two).toEqual(one);
    expect(planSample(cases, criteria, own, SAMPLE_SEED + 1).info.histories).not.toEqual(one.info.histories);
  });

  it('takes every other criterion when there are fewer than thirty', () => {
    const few = ['A-1', 'B-2', 'C-3'];
    const three = few.map((id) => history(`${id}/pos-brand.csv`, 'positive', [id]));
    const mine = planOwnCriterion(three, few, few, few).pairs;
    const sample = planSample(three, few, mine);
    expect(sample.info.histories).toHaveLength(1);        // one in ten, rounded up, so a small run still has a sample
    expect(sample.pairs).toHaveLength(2);
    const sampled = three.findIndex((c) => c.file === sample.info.histories[0]);
    expect(sample.pairs.map((p) => p.criterionId)).toEqual(few.filter((id) => id !== few[sampled]));
  });

  it('never draws a history that could not be read, or one with no other criterion', () => {
    const one = ['A-1'];
    const lonely = [history('A-1/pos-brand.csv', 'positive', ['A-1'])];
    expect(planSample(lonely, one, planOwnCriterion(lonely, one, one, one).pairs)).toMatchObject({ pairs: [], info: { eligible: 0, histories: [], screenings: 0 } });

    const two = ['A-1', 'B-2'];
    const unread = [history('A-1/pos-brand.csv', 'positive', ['A-1'], false), history('B-2/pos-brand.csv', 'positive', ['B-2'])];
    const sample = planSample(unread, two, planOwnCriterion(unread, two, two, two).pairs);
    expect(sample.info.eligible).toBe(1);
    expect(sample.info.histories).toEqual(['B-2/pos-brand.csv']);
  });

  it('puts the calls in order: history by history, the criteria of one history in run order', () => {
    const ids = ['A-1', 'B-2', 'C-3'];
    const ownPairs: PlannedPair[] = [
      { caseIndex: 0, criterionId: 'B-2', role: 'own' },
      { caseIndex: 1, criterionId: 'C-3', role: 'own' },
    ];
    const samplePairs: PlannedPair[] = [
      { caseIndex: 1, criterionId: 'A-1', role: 'sample' },
      { caseIndex: 0, criterionId: 'C-3', role: 'sample' },
      { caseIndex: 0, criterionId: 'A-1', role: 'sample' },
      { caseIndex: 0, criterionId: 'B-2', role: 'sample' },    // already planned as its own: kept once, as "own"
    ];
    expect(inCallOrder([ownPairs, samplePairs], ids)).toEqual([
      { caseIndex: 0, criterionId: 'A-1', role: 'sample' },
      { caseIndex: 0, criterionId: 'B-2', role: 'own' },
      { caseIndex: 0, criterionId: 'C-3', role: 'sample' },
      { caseIndex: 1, criterionId: 'A-1', role: 'sample' },
      { caseIndex: 1, criterionId: 'C-3', role: 'own' },
    ]);
  });
});
