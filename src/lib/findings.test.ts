import { describe, expect, it } from 'vitest';
import type { CaseRecord, Finding } from '../../shared/types.ts';
import type { CriterionView } from './criteria.ts';
import {
  bellBadgeCount,
  disputedFindings,
  failedScreens,
  filterWaiting,
  findingNotes,
  groupWaitingByHistory,
  isPossibleFinding,
  matchingLineIds,
  orderWaitingInGroup,
  recordDoesNotShow,
  shouldShowSearch,
  waitingFindings,
} from './findings.ts';

const baseFinding = (over: Partial<Finding> = {}): Finding => ({
  id: 'F1',
  caseId: 'C1',
  criterionId: 'A',
  state: 'confirmed',
  possible: false,
  screen: {
    lineIds: ['L001', 'L002'],
    medicines: [],
    reason: 'r',
    linesVerified: true,
    missingFacts: [],
    model: 'm',
    at: '2026-01-01',
    seconds: 1,
  },
  seenByPharmacist: false,
  ...over,
});

const caseA: CaseRecord = {
  id: 'C1',
  fileName: 'alpha.csv',
  importedAt: '2026-01-01',
  source: 'csv',
  patient: { label: 'Patient Alpha' },
  lines: [],
  transcriptionConfirmed: true,
  parts: 1,
  screening: { status: 'done', criteria: [{ criterionId: 'X', status: 'failed' }] },
};

const caseB: CaseRecord = {
  id: 'C2',
  fileName: 'beta.csv',
  importedAt: '2026-01-01',
  source: 'csv',
  patient: { label: 'Patient Beta' },
  lines: [],
  transcriptionConfirmed: true,
  parts: 1,
  screening: { status: 'done', criteria: [] },
};

const signed: CriterionView = {
  id: 'S', label: 'Signed one', title: '', statement: 't', sourceName: '', credit: '', cannotBeSeen: '', rule: '', urgency: 'routine', signedBy: { name: 'A', date: '2026-01-01' },
};

const draft: CriterionView = {
  id: 'D', label: 'Draft one', title: '', statement: 't', sourceName: '', credit: '', cannotBeSeen: '', rule: '', urgency: 'routine', signedBy: null,
};

describe('matchingLineIds', () => {
  it('uses Model 2 lines when the check completed and named lines', () => {
    expect(
      matchingLineIds({
        screen: { ...baseFinding().screen, lineIds: ['L001'] },
        check: { confirmed: true, lineIds: ['L002'], whatMatches: '', whatCannotBeSeen: '', completed: true, model: 'm', at: '', seconds: 1 },
      }),
    ).toEqual(['L002']);
  });

  it('falls back to Model 1 lines when the check did not complete or named none', () => {
    expect(matchingLineIds({ screen: { ...baseFinding().screen, lineIds: ['L001', 'L003'] }, check: { confirmed: false, lineIds: [], whatMatches: '', whatCannotBeSeen: '', completed: false, model: 'm', at: '', seconds: 1 } }))
      .toEqual(['L001', 'L003']);
    expect(matchingLineIds({ screen: { ...baseFinding().screen, lineIds: ['L004'] } })).toEqual(['L004']);
  });
});

describe('findingNotes', () => {
  it('carries the fixed notes for an incomplete check and unverified lines', () => {
    expect(findingNotes(baseFinding())).toEqual([]);
    expect(
      findingNotes(
        baseFinding({
          check: { confirmed: true, lineIds: [], whatMatches: '', whatCannotBeSeen: '', completed: false, model: 'm', at: '', seconds: 1 },
        }),
      ),
    ).toEqual(['second check not completed']);
    expect(findingNotes(baseFinding({ screen: { ...baseFinding().screen, linesVerified: false } }))).toEqual(['lines not verified']);
  });
});

describe('waiting, disputed and failed', () => {
  it('lists confirmed findings as waiting', () => {
    const list = [baseFinding(), baseFinding({ id: 'F2', state: 'accepted' }), baseFinding({ id: 'F3', state: 'suspected' })];
    expect(waitingFindings(list).map((f) => f.id)).toEqual(['F1']);
  });

  it('lists not_confirmed findings without a decision as disputed', () => {
    expect(disputedFindings([baseFinding({ state: 'not_confirmed' })]).length).toBe(1);
    expect(disputedFindings([baseFinding({ state: 'not_confirmed', decision: { action: 'dismiss', by: 'p', at: '' } })]).length).toBe(0);
  });

  it('names each failed criterion on its file', () => {
    const failed = failedScreens([caseA], { X: { ...draft, id: 'X', label: 'Criterion X' } });
    expect(failed).toEqual([
      { caseId: 'C1', fileName: 'alpha.csv', patientLabel: 'Patient Alpha', criterionId: 'X', criterionLabel: 'Criterion X' },
    ]);
  });
});

describe('groups and order', () => {
  it('groups waiting findings by history in server order', () => {
    const w = [baseFinding({ caseId: 'C2' }), baseFinding({ id: 'F2', caseId: 'C1' })];
    const groups = groupWaitingByHistory(w, [caseA, caseB]);
    expect(groups.map((g) => g.caseId)).toEqual(['C1', 'C2']);
    expect(groups[0].waiting.map((f) => f.id)).toEqual(['F2']);
  });

  it('puts signed criteria before draft criteria inside a group', () => {
    const w = [
      baseFinding({ id: 'd', criterionId: 'D' }),
      baseFinding({ id: 's', criterionId: 'S' }),
      baseFinding({ id: 'd2', criterionId: 'D' }),
    ];
    const ordered = orderWaitingInGroup(w, { S: signed, D: draft });
    expect(ordered.map((f) => f.id)).toEqual(['s', 'd', 'd2']);
  });
});

describe('possible findings', () => {
  it('is marked possible when the contract says so', () => {
    expect(isPossibleFinding(baseFinding({ possible: true }))).toBe(true);
    expect(recordDoesNotShow(baseFinding({ possible: true, screen: { ...baseFinding().screen, missingFacts: ['a recent kidney function result'] } })))
      .toBe('a recent kidney function result');
  });
});

describe('the red number on the bell', () => {
  it('counts confirmed findings waiting; seen does not drop it; accept and bypass take one off each', () => {
    const three = [
      baseFinding({ id: 'F1' }),
      baseFinding({ id: 'F2' }),
      baseFinding({ id: 'F3' }),
    ];
    expect(bellBadgeCount(three)).toBe(3);
    expect(bellBadgeCount(three.map((f) => ({ ...f, seenByPharmacist: true })))).toBe(3);
    const afterAccept = [
      { ...three[0], state: 'accepted' as const },
      three[1],
      three[2],
    ];
    expect(bellBadgeCount(afterAccept)).toBe(2);
    const afterBypass = [
      afterAccept[0],
      { ...three[1], state: 'bypassed' as const },
      three[2],
    ];
    expect(bellBadgeCount(afterBypass)).toBe(1);
  });

  it('does not count a disputed finding, and accept anyway does not change the count', () => {
    const confirmed = baseFinding({ id: 'F1' });
    const disputed = baseFinding({ id: 'F2', state: 'not_confirmed' });
    expect(bellBadgeCount([confirmed, disputed])).toBe(1);
    const anyway = { ...disputed, state: 'accepted' as const, decision: { action: 'accept' as const, by: 'p', at: '', reason: 'r' } };
    expect(bellBadgeCount([confirmed, anyway])).toBe(1);
  });

  it('shows no badge when nothing waits', () => {
    expect(bellBadgeCount([])).toBe(0);
    expect(bellBadgeCount([baseFinding({ state: 'accepted' }), baseFinding({ state: 'bypassed' })])).toBe(0);
  });
});

describe('filter and search box', () => {
  const waiting = [
    baseFinding({ id: 'F1', criterionId: 'S' }),
    baseFinding({ id: 'F2', caseId: 'C2', criterionId: 'D' }),
  ];
  const criteria = { S: signed, D: draft };
  const cases = [caseA, caseB];

  it('returns every waiting finding when the filter text is empty', () => {
    expect(filterWaiting(waiting, cases, criteria, '')).toHaveLength(2);
  });

  it('returns an empty list when nothing matches and never throws', () => {
    expect(filterWaiting(waiting, cases, criteria, 'zzz-no-match')).toEqual([]);
  });

  it('matches patient label, file name and criterion label without case', () => {
    expect(filterWaiting(waiting, cases, criteria, 'ALPHA').map((f) => f.id)).toEqual(['F1']);
    expect(filterWaiting(waiting, cases, criteria, 'beta.csv').map((f) => f.id)).toEqual(['F2']);
    expect(filterWaiting(waiting, cases, criteria, 'draft').map((f) => f.id)).toEqual(['F2']);
  });

  it('shows the search box only when more than twenty findings wait', () => {
    expect(shouldShowSearch(20)).toBe(false);
    expect(shouldShowSearch(21)).toBe(true);
  });
});