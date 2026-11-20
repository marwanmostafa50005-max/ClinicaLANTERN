// Works out what is new between two answers from /api/state, for the small pop-up messages,
// and which histories still need the pharmacist. Pure code: no browser, no server.
import type { AppState, CaseRecord, Finding } from '../../shared/types.ts';

export interface NewThings {
  /** Findings that Model 2 has just confirmed and the pharmacist has not seen. */
  confirmedFindings: number;
  /** Findings that have just reached the bell without a clear yes from Model 2: the check did not finish, or it is unclear. */
  uncheckedFindings: number;
  /** Letters that Model 3 has just finished and the pharmacist has not seen. */
  readyLetters: number;
  /** Scans whose rows have just been read and now wait for the pharmacist to check them. */
  scansToCheck: number;
  /** Histories that have just turned out to be impossible to assess. They were not screened. */
  cannotAssess: number;
  /** Histories whose screening has just ended without a result for every criterion. */
  notFullyScreened: number;
}

/** A scan whose rows are read and still wait for the pharmacist's check. */
export function scanNeedsCheck(c: CaseRecord): boolean {
  return c.source === 'pdf-image' && !c.transcriptionConfirmed && !c.cannotAssess && c.lines.length > 0;
}

export function countScansToCheck(state: AppState): number {
  return state.cases.filter(scanNeedsCheck).length;
}

/**
 * A history whose screening ended without a result for every criterion: a criterion could not be
 * screened, or the screening was interrupted. This is never "no finding", so the first screen says so
 * until the history is screened again.
 */
export function notFullyScreened(c: CaseRecord): boolean {
  if (c.cannotAssess) return false;
  if (c.screening.status === 'interrupted') return true;
  return c.screening.status === 'done' && c.screening.criteria.some((run) => run.status === 'failed');
}

export function countNotFullyScreened(state: AppState): number {
  return state.cases.filter(notFullyScreened).length;
}

/** A history that could not be read safely. One the pharmacist discarded himself is not news to him. */
function couldNotBeAssessed(c: CaseRecord): boolean {
  return typeof c.cannotAssess === 'string' && c.cannotAssess !== '' && !c.cannotAssess.startsWith('The pharmacist discarded');
}

/** True when Model 2 really confirmed the finding. False when its check did not finish or is unclear. */
export function confirmedByTheCheck(f: Finding): boolean {
  return f.check !== undefined && f.check.completed && f.check.confirmed;
}

export function newThings(before: AppState, after: AppState): NewThings {
  const confirmedBefore = new Set(before.findings.filter((f) => f.state === 'confirmed').map((f) => f.id));
  const readyBefore = new Set(before.letters.filter((l) => l.status === 'ready').map((l) => l.id));
  const scansBefore = new Set(before.cases.filter(scanNeedsCheck).map((c) => c.id));
  const cannotBefore = new Set(before.cases.filter(couldNotBeAssessed).map((c) => c.id));
  const notFullyBefore = new Set(before.cases.filter(notFullyScreened).map((c) => c.id));
  const atTheBell = after.findings.filter((f) => f.state === 'confirmed' && !f.seenByPharmacist && !confirmedBefore.has(f.id));

  return {
    confirmedFindings: atTheBell.filter(confirmedByTheCheck).length,
    uncheckedFindings: atTheBell.filter((f) => !confirmedByTheCheck(f)).length,
    readyLetters: after.letters.filter((l) => l.status === 'ready' && !l.seenByPharmacist && !readyBefore.has(l.id))
      .length,
    scansToCheck: after.cases.filter((c) => scanNeedsCheck(c) && !scansBefore.has(c.id)).length,
    cannotAssess: after.cases.filter((c) => couldNotBeAssessed(c) && !cannotBefore.has(c.id)).length,
    notFullyScreened: after.cases.filter((c) => notFullyScreened(c) && !notFullyBefore.has(c.id)).length,
  };
}

export type PanelName = 'import' | 'bell' | 'letter';

export type PopUpKind = 'finding' | 'unchecked' | 'letter' | 'scan' | 'cannot_assess' | 'not_fully_screened';

export interface PopUp {
  /** What the pop-up is about. One pop-up shows for each kind. */
  kind: PopUpKind;
  /** The panel the pop-up offers to open. */
  panel: PanelName;
  /** How many new things of this kind the pop-up stands for. */
  count: number;
}

/**
 * One pop-up for each kind of new thing. A pop-up about the panel that is open now is not raised:
 * the pharmacist is already looking at it, and it would cover the top of that panel.
 */
export function popUpsFor(things: NewThings, openPanel: PanelName | null = null): PopUp[] {
  const out: PopUp[] = [];
  if (things.confirmedFindings > 0) out.push({ kind: 'finding', panel: 'bell', count: things.confirmedFindings });
  if (things.uncheckedFindings > 0) out.push({ kind: 'unchecked', panel: 'bell', count: things.uncheckedFindings });
  if (things.readyLetters > 0) out.push({ kind: 'letter', panel: 'letter', count: things.readyLetters });
  if (things.scansToCheck > 0) out.push({ kind: 'scan', panel: 'import', count: things.scansToCheck });
  if (things.cannotAssess > 0) out.push({ kind: 'cannot_assess', panel: 'import', count: things.cannotAssess });
  if (things.notFullyScreened > 0) out.push({ kind: 'not_fully_screened', panel: 'import', count: things.notFullyScreened });
  return out.filter((p) => p.panel !== openPanel);
}

/** The words of a pop-up and of its button, in plain English. */
export function popUpWords(kind: PopUpKind, count: number): { text: string; action: string } {
  switch (kind) {
    case 'finding':
      return {
        text:
          count === 1
            ? 'A finding was confirmed. It is waiting under the bell.'
            : `${count} findings were confirmed. They are waiting under the bell.`,
        action: 'Open the bell',
      };
    case 'unchecked':
      // Model 2 confirmed nothing here, so the pop-up does not say "confirmed".
      return {
        text:
          count === 1
            ? 'A finding is waiting under the bell. The second check did not give a clear yes.'
            : `${count} findings are waiting under the bell. The second check did not give a clear yes.`,
        action: 'Open the bell',
      };
    case 'letter':
      return {
        text: count === 1 ? 'A letter is ready to review.' : `${count} letters are ready to review.`,
        action: 'Open the letters',
      };
    case 'scan':
      return {
        text:
          count === 1
            ? 'The rows from the scan are ready. Please check them before screening starts.'
            : `The rows from ${count} scans are ready. Please check them before screening starts.`,
        action: 'Check the rows',
      };
    case 'cannot_assess':
      return {
        text:
          count === 1
            ? 'A history cannot be assessed. It was not screened.'
            : `${count} histories cannot be assessed. They were not screened.`,
        action: 'See why',
      };
    case 'not_fully_screened':
      return {
        text:
          count === 1
            ? 'A history was not fully screened. This is not a clear result.'
            : `${count} histories were not fully screened. This is not a clear result.`,
        action: 'See which',
      };
  }
}
