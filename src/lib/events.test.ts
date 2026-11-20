import { describe, expect, it } from 'vitest';
import type { AppState, CaseRecord, CheckResult, Finding, Letter } from '../../shared/types.ts';
import {
  countNotFullyScreened, countScansToCheck, newThings, notFullyScreened, popUpWords, popUpsFor, scanNeedsCheck,
} from './events.ts';
import type { NewThings } from './events.ts';

const screen = { lineIds: [], medicines: [], reason: '', linesVerified: true, missingFacts: [], model: 'm', at: '', seconds: 1 };

function check(over: Partial<CheckResult> = {}): CheckResult {
  return { confirmed: true, lineIds: [], whatMatches: '', whatCannotBeSeen: '', completed: true, model: 'm', at: '', seconds: 1, ...over };
}

function finding(id: string, state: Finding['state'], seen = false, result: CheckResult | undefined = check()): Finding {
  const f: Finding = { id, caseId: 'C0001', criterionId: 'X', state, possible: false, screen, seenByPharmacist: seen };
  if (state !== 'suspected' && result) f.check = result;
  return f;
}

function letter(id: string, status: Letter['status'], seen = false): Letter {
  return { id, findingId: 'F0001', caseId: 'C0001', status, subject: '', body: '', editedByPharmacist: false, seenByPharmacist: seen };
}

function scan(id: string, over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id,
    fileName: 'scan.pdf',
    importedAt: '',
    source: 'pdf-image',
    patient: { label: 'Fictional patient' },
    lines: [{ id: 'L001', text: 'row' }],
    transcriptionConfirmed: false,
    parts: 1,
    screening: { status: 'not_started', criteria: [] },
    ...over,
  };
}

function history(id: string, status: CaseRecord['screening']['status'], runs: CaseRecord['screening']['criteria'][number]['status'][], over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id, fileName: `${id}.csv`, importedAt: '', source: 'csv', patient: { label: 'Fictional patient' },
    lines: [{ id: 'L001', text: '2026-08-21 | Celebrex' }], transcriptionConfirmed: true, parts: 1,
    screening: { status, criteria: runs.map((s, i) => ({ criterionId: `K${i + 1}`, status: s })) },
    ...over,
  };
}

function state(over: Partial<AppState>): AppState {
  return { version: 1, cases: [], findings: [], letters: [], jobs: [], activity: [], ...over };
}

const NOTHING: NewThings = { confirmedFindings: 0, uncheckedFindings: 0, readyLetters: 0, scansToCheck: 0, cannotAssess: 0, notFullyScreened: 0 };

describe('newThings', () => {
  it('counts a finding that Model 2 has just confirmed', () => {
    const before = state({ findings: [finding('F1', 'suspected')] });
    const after = state({ findings: [finding('F1', 'confirmed')] });
    expect(newThings(before, after)).toEqual({ ...NOTHING, confirmedFindings: 1 });
  });

  it('does not count a finding that was already confirmed, or one already seen', () => {
    const before = state({ findings: [finding('F1', 'confirmed')] });
    const after = state({ findings: [finding('F1', 'confirmed'), finding('F2', 'confirmed', true)] });
    expect(newThings(before, after).confirmedFindings).toBe(0);
  });

  it('does not count a finding the second check did not confirm', () => {
    const before = state({ findings: [finding('F1', 'suspected')] });
    const after = state({ findings: [finding('F1', 'not_confirmed', false, check({ confirmed: false }))] });
    expect(newThings(before, after)).toEqual(NOTHING);
  });

  it('does not call a finding "confirmed" when the second check did not finish, or is unclear', () => {
    const before = state({ findings: [finding('F1', 'suspected'), finding('F2', 'suspected')] });
    const after = state({
      findings: [
        finding('F1', 'confirmed', false, check({ confirmed: false, completed: false })),
        finding('F2', 'confirmed', false, check({ confirmed: false, unclear: true })),
      ],
    });
    expect(newThings(before, after)).toEqual({ ...NOTHING, uncheckedFindings: 2 });
  });

  it('counts a letter that has just become ready', () => {
    const before = state({ letters: [letter('T1', 'drafting'), letter('T2', 'ready')] });
    const after = state({ letters: [letter('T1', 'ready'), letter('T2', 'ready')] });
    expect(newThings(before, after).readyLetters).toBe(1);
  });

  it('counts a scan whose rows have just been read', () => {
    const before = state({ cases: [scan('C1', { lines: [] })] });
    const after = state({ cases: [scan('C1')] });
    expect(newThings(before, after).scansToCheck).toBe(1);
  });

  // The review of 18 November: with the models down the page showed "Idle", no badge and no pop-up.
  it('counts a history whose screening has just ended with a criterion that could not be screened', () => {
    const before = state({ cases: [history('C1', 'running', ['running', 'waiting'])] });
    const after = state({ cases: [history('C1', 'done', ['failed', 'failed'])] });
    expect(newThings(before, after)).toEqual({ ...NOTHING, notFullyScreened: 1 });
    expect(newThings(after, after)).toEqual(NOTHING);                        // said once
  });

  it('counts a screening that has just been interrupted, and a history that has just turned out to be unreadable', () => {
    const before = state({ cases: [history('C1', 'running', ['running']), scan('C2', { lines: [] })] });
    const after = state({
      cases: [history('C1', 'interrupted', ['waiting']), scan('C2', { lines: [], cannotAssess: 'Page 1 of the scan could not be read.' })],
    });
    expect(newThings(before, after)).toEqual({ ...NOTHING, notFullyScreened: 1, cannotAssess: 1 });
  });

  it('counts a history that cannot be assessed at the moment it is imported, but not a scan the pharmacist discarded himself', () => {
    const imported = state({ cases: [history('C1', 'not_started', [], { cannotAssess: 'No row has a date that can be read.' })] });
    expect(newThings(state({}), imported).cannotAssess).toBe(1);
    const discarded = state({ cases: [scan('C2', { cannotAssess: 'The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened.' })] });
    expect(newThings(state({ cases: [scan('C2')] }), discarded).cannotAssess).toBe(0);
  });
});

describe('scanNeedsCheck', () => {
  it('is true only for a scan with rows that the pharmacist has not confirmed', () => {
    expect(scanNeedsCheck(scan('C1'))).toBe(true);
    expect(scanNeedsCheck(scan('C1', { lines: [] }))).toBe(false);
    expect(scanNeedsCheck(scan('C1', { transcriptionConfirmed: true }))).toBe(false);
    expect(scanNeedsCheck(scan('C1', { cannotAssess: 'No dated rows.' }))).toBe(false);
    expect(scanNeedsCheck(scan('C1', { source: 'csv' }))).toBe(false);
    expect(countScansToCheck(state({ cases: [scan('C1'), scan('C2', { transcriptionConfirmed: true })] }))).toBe(1);
  });

  it('stops counting a scan once the pharmacist has discarded it, so the number on the magnifying glass clears', () => {
    const discarded = scan('C1', { cannotAssess: 'The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened.' });
    expect(countScansToCheck(state({ cases: [discarded] }))).toBe(0);
  });
});

describe('notFullyScreened', () => {
  it('is true while a criterion has no result: could not be screened, or interrupted', () => {
    expect(notFullyScreened(history('C1', 'done', ['clear', 'failed']))).toBe(true);
    expect(notFullyScreened(history('C1', 'interrupted', ['clear', 'waiting']))).toBe(true);
    expect(notFullyScreened(history('C1', 'done', ['clear', 'suspected']))).toBe(false);
    expect(notFullyScreened(history('C1', 'running', ['clear', 'running']))).toBe(false);
    expect(notFullyScreened(history('C1', 'waiting', ['waiting']))).toBe(false);
    // A history that cannot be assessed is told apart: it was never screened at all.
    expect(notFullyScreened(history('C1', 'not_started', [], { cannotAssess: 'No row has a date.' }))).toBe(false);
    expect(countNotFullyScreened(state({ cases: [history('C1', 'done', ['failed']), history('C2', 'done', ['clear'])] }))).toBe(1);
  });
});

describe('pop-ups', () => {
  it('gives one pop-up for each kind of new thing', () => {
    expect(popUpsFor({ ...NOTHING, confirmedFindings: 2, readyLetters: 1 })).toEqual([
      { kind: 'finding', panel: 'bell', count: 2 },
      { kind: 'letter', panel: 'letter', count: 1 },
    ]);
    expect(popUpsFor(NOTHING)).toEqual([]);
    expect(popUpsFor({ ...NOTHING, uncheckedFindings: 1, scansToCheck: 1, cannotAssess: 1, notFullyScreened: 2 })).toEqual([
      { kind: 'unchecked', panel: 'bell', count: 1 },
      { kind: 'scan', panel: 'import', count: 1 },
      { kind: 'cannot_assess', panel: 'import', count: 1 },
      { kind: 'not_fully_screened', panel: 'import', count: 2 },
    ]);
  });

  it('raises no pop-up about the panel that is open: it would cover the top of that panel', () => {
    const things = { ...NOTHING, confirmedFindings: 1, readyLetters: 1, scansToCheck: 1 };
    expect(popUpsFor(things, 'letter').map((p) => p.panel)).toEqual(['bell', 'import']);
    expect(popUpsFor(things, 'bell').map((p) => p.panel)).toEqual(['letter', 'import']);
    expect(popUpsFor(things, null)).toHaveLength(3);
  });

  it('uses plain words for one and for many', () => {
    expect(popUpWords('finding', 1).text).toBe('A finding was confirmed. It is waiting under the bell.');
    expect(popUpWords('finding', 3).text).toBe('3 findings were confirmed. They are waiting under the bell.');
    expect(popUpWords('letter', 1)).toEqual({ text: 'A letter is ready to review.', action: 'Open the letters' });
    expect(popUpWords('letter', 2).text).toBe('2 letters are ready to review.');
    expect(popUpWords('scan', 1).action).toBe('Check the rows');
  });

  it('never says "confirmed" for a finding Model 2 did not confirm', () => {
    expect(popUpWords('unchecked', 1).text).toBe('A finding is waiting under the bell. The second check did not give a clear yes.');
    expect(popUpWords('unchecked', 2).text).not.toContain('confirmed');
  });

  it('says plainly that a history was not screened, or not fully', () => {
    expect(popUpWords('not_fully_screened', 1).text).toBe('A history was not fully screened. This is not a clear result.');
    expect(popUpWords('not_fully_screened', 2).text).toBe('2 histories were not fully screened. This is not a clear result.');
    expect(popUpWords('cannot_assess', 1).text).toBe('A history cannot be assessed. It was not screened.');
  });
});
