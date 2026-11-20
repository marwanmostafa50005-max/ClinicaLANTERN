import type { Finding, Stage } from '../../shared/types.ts';

/** Disputed findings waiting for the pharmacist with no decision yet. */
export function countDisputedWaiting(findings: Finding[]): number {
  return findings.filter((f) => f.state === 'not_confirmed' && !f.decision).length;
}

/** Remove criterion step numbers so a move from 3 to 4 of 413 is not a new announcement. */
export function statusTextWithoutCriterionNumbers(text: string): string {
  return text.replace(/criterion \d+ of \d+/gi, 'criterion n of N');
}

/** Bucket for screen-reader announcements: same bucket means do not announce again. */
export function statusAnnouncementBucket(
  text: string,
  serverDown: boolean,
  stage: Stage | null | undefined,
): string {
  if (serverDown) return 'server-down';
  const trimmed = text.trim();
  if (trimmed === 'Starting' || trimmed === '') return 'starting';
  if (trimmed === 'Idle') return 'idle';
  if (stage === 'screen') return `screen:${statusTextWithoutCriterionNumbers(trimmed)}`;
  if (stage === 'check') return `check:${statusTextWithoutCriterionNumbers(trimmed)}`;
  if (stage === 'letter') return `letter:${statusTextWithoutCriterionNumbers(trimmed)}`;
  return statusTextWithoutCriterionNumbers(trimmed);
}

export function shouldAnnounceStatusChange(previous: string | null, next: string): boolean {
  if (previous === null) return true;
  return previous !== next;
}

export function disputedCountLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? '1 finding on which the two models disagree'
    : `${count} findings on which the two models disagree`;
}