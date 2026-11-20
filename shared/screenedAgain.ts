// Words for the moment after an answer, when findings leave and those criteria are screened again.
// The page and the status line both use this. It does not decide a finding.
import type { AppState, CaseRecord, CriterionRunStatus } from './types.ts';

/** A result the pharmacist has already been shown. Waiting is not one: the criterion had not finished. */
const HAD_A_RESULT: ReadonlySet<CriterionRunStatus> = new Set(['clear', 'suspected', 'failed']);

/**
 * Said while those criteria are waiting or being screened again.
 * It stops once they have a result again.
 */
export const SCREENED_AGAIN =
  'Some criteria go back to waiting after an answer and are screened again. Findings from those criteria are taken off until that screening finishes.';

/** True when an answer has put a criterion that already had a result back to waiting or running. */
export function criteriaScreenedAgain(c: CaseRecord): boolean {
  for (const q of c.questions ?? []) {
    if (q.status !== 'answered') continue;
    for (const held of q.heldRuns ?? []) {
      if (!HAD_A_RESULT.has(held.status)) continue;
      const run = c.screening.criteria.find((item) => item.criterionId === held.criterionId);
      if (run && (run.status === 'waiting' || run.status === 'running')) return true;
    }
  }
  return false;
}

export function anyCriteriaScreenedAgain(state: AppState): boolean {
  return state.cases.some(criteriaScreenedAgain);
}
