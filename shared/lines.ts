// One rule for the lines of a finding. The bell panel, the letter and the scorer all use it,
// so the pharmacist sees, the doctor reads and the scorer judges the same lines.
// Erasable TypeScript only: Node runs this file directly, and the page bundles it.
import type { Finding } from './types.ts';

export interface FindingLines {
  /** Every line to show and to print: the lines of the second check and the lines of the first model, in history order. */
  all: string[];
  /** The lines the second check named. Empty when the check was not completed. */
  byCheck: string[];
  /** The lines only the first model named. On the page they are marked as such. */
  byScreenOnly: string[];
}

function lineNumber(id: string): number {
  const n = Number(id.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function tidy(ids: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The lines of a finding. Model 2's lines are shown, and Model 1's lines are kept as well:
 * the two models do pick different lines, and a line that proves the finding must not drop out
 * of sight because the second model named another one.
 * A check that was not completed named nothing: its record carries the first model's lines.
 */
export function findingLines(finding: Pick<Finding, 'screen' | 'check'>): FindingLines {
  const check = finding.check;
  const byCheck = check && check.completed ? tidy(check.lineIds) : [];
  const byScreen = tidy(finding.screen?.lineIds);
  const byScreenOnly = byScreen.filter(id => !byCheck.includes(id));
  const all = [...byCheck, ...byScreenOnly].sort((a, b) => lineNumber(a) - lineNumber(b));
  return { all, byCheck, byScreenOnly };
}
