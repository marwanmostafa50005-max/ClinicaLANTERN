// Which criterion is screened on which history. Pure functions only: no files, no clock, no model.
//
// A full run screens every criterion on every history.
// A quick run and a wave run screen a history against its own criterion only:
//   - a history with a planted finding: the criteria its answer entry expects;
//   - a near miss: the criterion its folder is named after;
//   - a clean history: the first ten criteria.
// A quick run also takes a sample: one history in ten, chosen by a fixed seed, is screened against
// up to thirty other criteria chosen by the same seed. That gives an estimate of the false flags a
// full run would show. It is an estimate, and the table says so.

import type { ExpectedCase } from '../shared/types.ts';
import type { PairRole, SampleInfo } from './types.ts';
import { folderOf } from './files.ts';

export const SAMPLE_SEED = 20261118;      // fixed, so the same test set always gives the same sample
export const SAMPLE_ONE_IN = 10;          // one history in ten
export const SAMPLE_PER_HISTORY = 30;     // at most thirty other criteria for a sampled history

export interface PlannedPair {
  caseIndex: number;                      // place of the history in the run
  criterionId: string;
  role?: PairRole;                        // left out in a full run
}

export interface PlanCase {
  file: string;
  kind: ExpectedCase['kind'];
  findings: { criterion: string }[];
  readable: boolean;                      // false when the history could not be read (no call is made for it)
}

// A small random number generator with a seed (mulberry32). The same seed gives the same numbers
// on every computer, which Math.random does not.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A shuffled copy (Fisher and Yates). The order depends only on the generator.
export function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Every criterion on every history, history by history: the model's reading of a history is
// reused for the criteria that follow it.
export function planFullRun(caseCount: number, criterionIds: string[]): PlannedPair[] {
  const pairs: PlannedPair[] = [];
  for (let caseIndex = 0; caseIndex < caseCount; caseIndex++) {
    for (const criterionId of criterionIds) pairs.push({ caseIndex, criterionId });
  }
  return pairs;
}

export interface OwnPlan {
  pairs: PlannedPair[];
  notScreened: string[];                  // histories that no criterion of this run was planned for
  screenedAsClean: string[];              // near misses whose folder names no criterion: screened like a clean history
}

// criterionIds: the criteria in this run, in order.
// knownIds: every criterion in use, also the ones an option left out of this run.
// firstTenIds: the criteria a clean history is screened against.
export function planOwnCriterion(cases: PlanCase[], criterionIds: string[], knownIds: string[], firstTenIds: string[]): OwnPlan {
  const inRun = new Set(criterionIds);
  const known = new Set([...knownIds, ...criterionIds]);
  const firstTen = new Set(firstTenIds);
  const cleanSet = criterionIds.filter((id) => firstTen.has(id));
  const pairs: PlannedPair[] = [];
  const notScreened: string[] = [];
  const screenedAsClean: string[] = [];

  cases.forEach((c, caseIndex) => {
    let wanted: string[];
    let role: PairRole = 'own';
    const expected = new Set(c.findings.map((f) => f.criterion));
    if (expected.size > 0) {
      wanted = criterionIds.filter((id) => expected.has(id));
    } else if (c.kind === 'clean') {
      wanted = cleanSet;
      role = 'clean';
    } else {
      const folder = folderOf(c.file);
      if (inRun.has(folder)) {
        wanted = [folder];
      } else if (known.has(folder)) {
        wanted = [];                      // its criterion is in use, but not in this run
      } else {
        // The folder names no criterion. The history is never left out without a word: it is
        // screened like a clean history, and the run says so.
        wanted = cleanSet;
        role = 'clean';
        if (wanted.length > 0) screenedAsClean.push(c.file);
      }
    }
    if (wanted.length === 0) notScreened.push(c.file);
    for (const criterionId of wanted) pairs.push({ caseIndex, criterionId, role });
  });
  return { pairs, notScreened, screenedAsClean };
}

export interface SamplePlan {
  pairs: PlannedPair[];
  info: SampleInfo;
}

// One history in ten, and for each of them up to thirty criteria it is not already screened against.
// Only histories that can be read, and that have such a criterion, can be drawn.
export function planSample(
  cases: PlanCase[],
  criterionIds: string[],
  own: PlannedPair[],
  seed: number = SAMPLE_SEED,
  oneIn: number = SAMPLE_ONE_IN,
  perHistory: number = SAMPLE_PER_HISTORY,
): SamplePlan {
  const already = new Map<number, Set<string>>();
  for (const pair of own) {
    let set = already.get(pair.caseIndex);
    if (!set) {
      set = new Set<string>();
      already.set(pair.caseIndex, set);
    }
    set.add(pair.criterionId);
  }
  const others = (caseIndex: number): string[] => criterionIds.filter((id) => !already.get(caseIndex)?.has(id));
  const eligible = cases.map((_, i) => i).filter((i) => cases[i].readable && others(i).length > 0);
  const random = seededRandom(seed);
  const count = eligible.length === 0 ? 0 : Math.ceil(eligible.length / oneIn);
  const chosen = shuffled(eligible, random).slice(0, count).sort((a, b) => a - b);
  const place = new Map(criterionIds.map((id, i) => [id, i]));
  const pairs: PlannedPair[] = [];
  for (const caseIndex of chosen) {
    const picked = shuffled(others(caseIndex), random)
      .slice(0, perHistory)
      .sort((a, b) => (place.get(a) ?? 0) - (place.get(b) ?? 0));
    for (const criterionId of picked) pairs.push({ caseIndex, criterionId, role: 'sample' });
  }
  return {
    pairs,
    info: { seed, oneIn, perHistory, eligible: eligible.length, histories: chosen.map((i) => cases[i].file), screenings: pairs.length },
  };
}

// The pairs of several plans in the order the calls are made: history by history, and for one
// history the criteria in run order. A pair that is planned twice is kept once, with its first role.
export function inCallOrder(plans: PlannedPair[][], criterionIds: string[]): PlannedPair[] {
  const place = new Map(criterionIds.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const all: PlannedPair[] = [];
  for (const plan of plans) {
    for (const pair of plan) {
      const key = `${pair.caseIndex}|${pair.criterionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(pair);
    }
  }
  return all
    .map((pair, order) => ({ pair, order }))
    .sort((a, b) => a.pair.caseIndex - b.pair.caseIndex
      || (place.get(a.pair.criterionId) ?? 0) - (place.get(b.pair.criterionId) ?? 0)
      || a.order - b.order)
    .map((x) => x.pair);
}
