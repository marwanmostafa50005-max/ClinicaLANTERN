// Pure helpers for the bell panel: which findings wait, how they group, and how they filter.
import { listFacts, missingFactsOf } from '../../shared/facts.ts';
import type { CaseRecord, CriterionRun, Finding } from '../../shared/types.ts';
import type { CriterionView } from './criteria.ts';

const tidyIds = (ids: unknown): string[] => {
  const out: string[] = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

/** Lines to highlight: Model 2's when the check completed and named lines; otherwise Model 1's. */
export function matchingLineIds(finding: Pick<Finding, 'screen' | 'check'>): string[] {
  const check = finding.check;
  if (check?.completed === true && check.lineIds.length > 0) return tidyIds(check.lineIds);
  return tidyIds(finding.screen.lineIds);
}

/** Fixed notes carried on a waiting finding card. */
export function findingNotes(finding: Finding): string[] {
  const notes: string[] = [];
  if (finding.check && finding.check.completed !== true) notes.push('second check not completed');
  if (!finding.screen.linesVerified) notes.push('lines not verified');
  return notes;
}

export function waitingFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.state === 'confirmed');
}

/** Confirmed findings the pharmacist has not accepted or bypassed; opening the bell does not change this. */
export function bellBadgeCount(findings: Finding[]): number {
  return waitingFindings(findings).length;
}

export function bellBadgeAriaLabel(count: number): string {
  return count === 1 ? 'Findings: 1 waiting for your decision' : `Findings: ${count} waiting for your decision`;
}

/** Model 1 suspected it and Model 2 turned it back; no pharmacist decision yet. */
export function disputedFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.state === 'not_confirmed' && !f.decision);
}

export function decidedFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => {
    if (f.state === 'accepted' || f.state === 'bypassed') return true;
    return f.state === 'not_confirmed' && f.decision?.action === 'dismiss';
  });
}

export interface FailedScreen {
  caseId: string;
  fileName: string;
  patientLabel: string;
  criterionId: string;
  criterionLabel: string;
}

/** Every criterion that could not be screened on a history, in server case order. */
export function failedScreens(cases: CaseRecord[], criteria: Record<string, CriterionView>): FailedScreen[] {
  const out: FailedScreen[] = [];
  for (const c of cases) {
    for (const run of c.screening.criteria) {
      if (run.status !== 'failed') continue;
      const view = criteria[run.criterionId];
      out.push({
        caseId: c.id,
        fileName: c.fileName,
        patientLabel: c.patient.label,
        criterionId: run.criterionId,
        criterionLabel: view?.label ?? run.criterionId,
      });
    }
  }
  return out;
}

export interface HistoryGroup {
  caseId: string;
  caseRecord: CaseRecord;
  waiting: Finding[];
}

/** Waiting findings in groups by imported history, in server list order. */
export function groupWaitingByHistory(
  waiting: Finding[],
  cases: CaseRecord[],
): HistoryGroup[] {
  const byCase = new Map<string, Finding[]>();
  for (const f of waiting) {
    const list = byCase.get(f.caseId) ?? [];
    list.push(f);
    byCase.set(f.caseId, list);
  }
  const groups: HistoryGroup[] = [];
  for (const c of cases) {
    const list = byCase.get(c.id);
    if (!list || list.length === 0) continue;
    groups.push({ caseId: c.id, caseRecord: c, waiting: list });
  }
  return groups;
}

function signedFirst(a: Finding, b: Finding, criteria: Record<string, CriterionView>): number {
  const sa = criteria[a.criterionId]?.signedBy !== null && criteria[a.criterionId]?.signedBy !== undefined;
  const sb = criteria[b.criterionId]?.signedBy !== null && criteria[b.criterionId]?.signedBy !== undefined;
  if (sa !== sb) return sa ? -1 : 1;
  return 0;
}

/** Signed criteria first; server order within each band. */
export function orderWaitingInGroup(findings: Finding[], criteria: Record<string, CriterionView>): Finding[] {
  const indexed = findings.map((f, i) => ({ f, i }));
  indexed.sort((a, b) => {
    const band = signedFirst(a.f, b.f, criteria);
    return band !== 0 ? band : a.i - b.i;
  });
  return indexed.map((x) => x.f);
}

export function isPossibleFinding(finding: Finding): boolean {
  return finding.possible === true;
}

/** Words after the fixed prefix "The record does not show: ". */
export function recordDoesNotShow(finding: Finding): string {
  return listFacts(missingFactsOf(finding));
}

const norm = (value: string): string => value.trim().toLowerCase();

/** Filter waiting findings by criterion label, patient label or file name. Empty text returns all. */
export function filterWaiting(
  waiting: Finding[],
  cases: CaseRecord[],
  criteria: Record<string, CriterionView>,
  query: string,
): Finding[] {
  const q = norm(query);
  if (q === '') return waiting;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  return waiting.filter((f) => {
    const c = caseById.get(f.caseId);
    const label = criteria[f.criterionId]?.label ?? f.criterionId;
    const bits = [label, c?.patient.label ?? '', c?.fileName ?? ''].map(norm).join(' ');
    return bits.includes(q);
  });
}

/** The search box appears when more than twenty findings wait. */
export const SEARCH_BOX_MIN = 21;

export function shouldShowSearch(waitingCount: number): boolean {
  return waitingCount > 20;
}

export function whatCannotBeSeenWords(finding: Finding, criterion: CriterionView | undefined): string {
  const check = finding.check;
  if (check?.completed === true && check.whatCannotBeSeen.trim() !== '') return check.whatCannotBeSeen.trim();
  return (criterion?.cannotBeSeen ?? '').trim();
}

/** Mantle's lines for a disputed finding. */
export function mantleLineIds(finding: Finding): string[] {
  return tidyIds(finding.screen.lineIds);
}

/** Lumen's lines for a disputed finding when the check completed. */
export function lumenLineIds(finding: Finding): string[] {
  const check = finding.check;
  return check?.completed === true ? tidyIds(check.lineIds) : [];
}

export function criterionRunFailed(run: CriterionRun): boolean {
  return run.status === 'failed';
}