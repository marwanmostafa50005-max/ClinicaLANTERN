// The now line and the counts, called on a state with no engine and no model.
import { describe, expect, it } from 'vitest';
import { SCREENED_AGAIN } from '../shared/screenedAgain.ts';
import type { CaseRecord, CheckResult, Finding, Letter, ScreenResult } from '../shared/types.ts';
import { emptyState } from './store.ts';
import {
  awaitsTranscription,
  computeCounts,
  computeNow,
  confirmedByTheCheck,
  disputedWaiting,
  fullyScreened,
  HELD_FOR_MODELS,
  isOverdue,
  PASS_NOT_FINISHED,
  reachedTheBell
} from './view.ts';

const names = { screen: 'Mantle', check: 'Lumen', letter: 'Ogee' };
const now = new Date('2026-11-18T12:00:00.000Z');

function screen(): ScreenResult {
  return {
    lineIds: ['L001'], medicines: ['celecoxib'], reason: 'Named on a line.', linesVerified: true,
    missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1
  };
}

function check(partial: Partial<CheckResult> = {}): CheckResult {
  return {
    confirmed: false, lineIds: [], whatMatches: '', whatCannotBeSeen: '', completed: true,
    model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 1, ...partial
  };
}

function finding(partial: Partial<Finding> & Pick<Finding, 'id' | 'state'>): Finding {
  return {
    caseId: 'C0001', criterionId: 'ONE', possible: false, screen: screen(), seenByPharmacist: false, ...partial
  };
}

function history(partial: Partial<CaseRecord> & Pick<CaseRecord, 'id'>): CaseRecord {
  return {
    fileName: 'history.csv', importedAt: '', source: 'csv', patient: { label: 'Fictional patient' }, lines: [],
    transcriptionConfirmed: true, parts: 1, screening: { status: 'not_started', criteria: [] }, ...partial
  };
}

function letter(partial: Partial<Letter> & Pick<Letter, 'id' | 'status'>): Letter {
  return {
    findingId: 'F0001', caseId: 'C0001', subject: 'Review', body: 'Fictional patient.', editedByPharmacist: false,
    seenByPharmacist: false, ...partial
  };
}

describe('awaitsTranscription', () => {
  it('is true only for a scan the pharmacist has not confirmed', () => {
    expect(awaitsTranscription(history({ id: 'C0001', source: 'pdf-image', transcriptionConfirmed: false }))).toBe(true);
    expect(awaitsTranscription(history({ id: 'C0002', source: 'pdf-image', transcriptionConfirmed: true }))).toBe(false);
    expect(awaitsTranscription(history({ id: 'C0003', source: 'csv' }))).toBe(false);
    expect(awaitsTranscription(history({ id: 'C0004', source: 'pdf-text' }))).toBe(false);
  });
});

describe('reachedTheBell and confirmedByTheCheck', () => {
  it('a plain completed no does not reach the bell, and only a completed yes is confirmed', () => {
    const plain = finding({ id: 'F0001', state: 'not_confirmed', check: check({ confirmed: false, completed: true }) });
    const yes = finding({ id: 'F0002', state: 'confirmed', check: check({ confirmed: true, completed: true, lineIds: ['L001'] }) });
    const unfinished = finding({ id: 'F0003', state: 'suspected', check: check({ confirmed: false, completed: false }) });
    const unclear = finding({ id: 'F0004', state: 'not_confirmed', check: check({ confirmed: false, completed: true, unclear: true }) });
    const noCheck = finding({ id: 'F0005', state: 'confirmed' });

    expect(reachedTheBell(plain)).toBe(false);
    expect(reachedTheBell(yes)).toBe(true);
    expect(reachedTheBell(unfinished)).toBe(true);
    expect(reachedTheBell(unclear)).toBe(true);
    expect(reachedTheBell(noCheck)).toBe(false);

    expect(confirmedByTheCheck(yes)).toBe(true);
    expect(confirmedByTheCheck(plain)).toBe(false);
    expect(confirmedByTheCheck(unfinished)).toBe(false);
    expect(confirmedByTheCheck(finding({ id: 'F0006', state: 'confirmed', check: check({ confirmed: true, completed: false }) }))).toBe(false);
    expect(confirmedByTheCheck(noCheck)).toBe(false);
  });
});

describe('fullyScreened', () => {
  it('counts a history only when screening is done and no criterion failed', () => {
    const done = history({
      id: 'C0001',
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'clear' }, { criterionId: 'TWO', status: 'suspected' }] }
    });
    const failed = history({
      id: 'C0002',
      screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'failed' }] }
    });
    const running = history({
      id: 'C0003',
      screening: { status: 'running', criteria: [{ criterionId: 'ONE', status: 'clear' }] }
    });
    expect(fullyScreened(done)).toBe(true);
    expect(fullyScreened(failed)).toBe(false);
    expect(fullyScreened(running)).toBe(false);
  });
});

describe('isOverdue', () => {
  it('is true only for a sent letter whose due time has passed', () => {
    const sent = letter({ id: 'T0001', status: 'sent', sentAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-10T00:00:00.000Z' });
    expect(isOverdue(sent, now)).toBe(true);
    expect(isOverdue({ ...sent, dueAt: '2026-11-18T12:00:00.000Z' }, now)).toBe(false);
    expect(isOverdue({ ...sent, dueAt: '2026-12-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isOverdue({ ...sent, dueAt: 'not-a-date' }, now)).toBe(false);
    expect(isOverdue({ ...sent, dueAt: undefined }, now)).toBe(false);
    expect(isOverdue({ ...sent, status: 'closed' }, now)).toBe(false);
    expect(isOverdue(letter({ id: 'T0002', status: 'ready', dueAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(false);
  });
});

describe('computeCounts', () => {
  it('counts screened histories, confirmed findings, letters and the two badges', () => {
    const state = emptyState();
    state.cases.push(
      history({ id: 'C0001', screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'clear' }] } }),
      history({ id: 'C0002', screening: { status: 'done', criteria: [{ criterionId: 'ONE', status: 'failed' }] } }),
      history({ id: 'C0003', screening: { status: 'running', criteria: [] } })
    );
    state.findings.push(
      finding({ id: 'F0001', state: 'confirmed', check: check({ confirmed: true, completed: true }) }),
      finding({ id: 'F0002', state: 'confirmed', seenByPharmacist: true, check: check({ confirmed: true, completed: true }) }),
      finding({ id: 'F0003', state: 'confirmed' }),
      finding({ id: 'F0004', state: 'accepted' }),
      finding({ id: 'F0005', state: 'bypassed' }),
      finding({ id: 'F0006', state: 'suspected' })
    );
    state.letters.push(
      letter({ id: 'T0001', status: 'ready' }),
      letter({ id: 'T0002', status: 'ready', seenByPharmacist: true }),
      letter({ id: 'T0003', status: 'sent', sentAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-10T00:00:00.000Z' }),
      letter({
        id: 'T0004', status: 'reply_recorded', sentAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-10T00:00:00.000Z',
        reply: { at: '2026-11-12T00:00:00.000Z', outcome: 'will_review', note: 'Noted.' }
      }),
      letter({ id: 'T0005', status: 'closed', sentAt: '2026-10-01T00:00:00.000Z', closedAt: '2026-11-01T00:00:00.000Z' }),
      letter({ id: 'T0006', status: 'drafting' })
    );

    expect(computeCounts(state, now)).toEqual({
      historiesScreened: 1,
      findingsConfirmed: 2,
      accepted: 1,
      bypassed: 1,
      lettersReady: 2,
      lettersSent: 3,
      repliesRecorded: 1,
      closed: 1,
      overdue: 1,
      bellBadge: 2,
      letterBadge: 1
    });
  });
});

describe('disputedWaiting', () => {
  it('counts a not-confirmed finding only while it has no decision', () => {
    const state = emptyState();
    state.findings.push(
      finding({ id: 'F0001', state: 'not_confirmed' }),
      finding({ id: 'F0002', state: 'not_confirmed', decision: { action: 'dismiss', by: 'pharmacist', at: '2026-11-18T00:00:00.000Z' } }),
      finding({ id: 'F0003', state: 'confirmed' }),
      finding({ id: 'F0004', state: 'suspected' })
    );
    expect(disputedWaiting(state)).toBe(1);
    expect(disputedWaiting(emptyState())).toBe(0);
  });
});

describe('computeNow', () => {
  it('names the criterion, the part, and how many other histories wait', () => {
    const state = emptyState();
    state.cases.push(history({
      id: 'C0001',
      parts: 4,
      screening: {
        status: 'running',
        criteria: [
          { criterionId: 'ONE', status: 'clear' },
          { criterionId: 'TWO', status: 'running' },
          { criterionId: 'THREE', status: 'waiting' }
        ]
      }
    }));
    state.jobs.push(
      { id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' },
      { id: 'J0002', stage: 'screen', caseId: 'C0002', status: 'queued' },
      { id: 'J0003', stage: 'screen', caseId: 'C0003', status: 'queued' },
      { id: 'J0004', stage: 'check', caseId: 'C0001', status: 'queued' }
    );

    expect(computeNow(state, { parts: 4, part: 2 }, names)).toEqual({
      stage: 'screen',
      text: `Mantle is screening: criterion 2 of 3 (long history, part 2 of 4). 2 more histories are waiting. ${PASS_NOT_FINISHED}`
    });
    expect(computeNow(state, { parts: 4, part: 0 }, names).text).toBe(
      `Mantle is screening: criterion 2 of 3 (long history, reading the listed lines together). 2 more histories are waiting. ${PASS_NOT_FINISHED}`
    );
    expect(computeNow(state, {}, names).text).toBe(
      `Mantle is screening: criterion 2 of 3 (long history, read in 4 parts). 2 more histories are waiting. ${PASS_NOT_FINISHED}`
    );
    expect(computeNow(state).text.startsWith('Model 1 is screening: criterion 2 of 3')).toBe(true);
  });

  it('shows the current parts when answers grow a one-part import into a long history', () => {
    const state = emptyState();
    const c = history({
      id: 'C0001',
      lines: Array.from({ length: 151 }, (_, index) => ({ id: `L${String(index + 1).padStart(3, '0')}`, text: `2026-01-01 | line ${index + 1}` })),
      parts: 1,
      screening: { status: 'running', criteria: [{ criterionId: 'ONE', status: 'running' }] }
    });
    state.cases.push(c);
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: c.id, status: 'running' });

    expect(computeNow(state, {}, names).text).toBe(
      `Mantle is screening: criterion 1 of 1 (long history, read in 2 parts). ${PASS_NOT_FINISHED}`
    );
    expect(c.parts).toBe(1);
  });

  it('picks the next criterion when none is marked running, and stays plain when the history is missing', () => {
    const settled = emptyState();
    settled.cases.push(history({
      id: 'C0001',
      screening: {
        status: 'running',
        criteria: [
          { criterionId: 'ONE', status: 'clear' },
          { criterionId: 'TWO', status: 'clear' },
          { criterionId: 'THREE', status: 'waiting' }
        ]
      }
    }));
    settled.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' });
    expect(computeNow(settled, {}, names).text).toBe(`Mantle is screening: criterion 3 of 3. ${PASS_NOT_FINISHED}`);

    const fresh = emptyState();
    fresh.cases.push(history({
      id: 'C0001',
      screening: { status: 'running', criteria: [{ criterionId: 'ONE', status: 'waiting' }, { criterionId: 'TWO', status: 'waiting' }] }
    }));
    fresh.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' });
    expect(computeNow(fresh, {}, names).text).toBe(`Mantle is screening: criterion 1 of 2. ${PASS_NOT_FINISHED}`);

    const missing = emptyState();
    missing.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C9999', status: 'running' });
    expect(computeNow(missing, {}, names)).toEqual({ stage: 'screen', text: 'Mantle is screening' });
  });

  it('says criteria are screened again after an answer, until they have a result again', () => {
    const state = emptyState();
    state.cases.push(history({
      id: 'C0001',
      screening: { status: 'waiting', criteria: [{ criterionId: 'ONE', status: 'waiting' }] },
      questions: [{
        id: 'Q0001', key: 'condition\nheart failure', kind: 'condition', what: 'Heart failure',
        meets: 'the patient has it', criterionIds: ['ONE'], findingIds: [], source: 'possible',
        status: 'answered', needsValue: false, options: [{ words: 'No', effect: 'does_not_meet' }],
        heldRuns: [{ criterionId: 'ONE', status: 'suspected' }]
      }]
    }));
    expect(computeNow(state, {}, names).text).toBe(`Idle. ${SCREENED_AGAIN}`);

    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' });
    state.cases[0].screening.status = 'running';
    state.cases[0].screening.criteria[0].status = 'running';
    expect(computeNow(state, {}, names).text).toBe(
      `Mantle is screening: criterion 1 of 1. ${PASS_NOT_FINISHED} ${SCREENED_AGAIN}`
    );

    // A question answered before that criterion had a result is a first screening, not a return.
    state.cases[0].questions![0].heldRuns = [{ criterionId: 'ONE', status: 'waiting' }];
    expect(computeNow(state, {}, names).text).toBe(`Mantle is screening: criterion 1 of 1. ${PASS_NOT_FINISHED}`);

    state.cases[0].questions![0].heldRuns = [{ criterionId: 'ONE', status: 'suspected' }];
    state.cases[0].screening.criteria[0].status = 'clear';
    expect(computeNow(state, {}, names).text).not.toContain(SCREENED_AGAIN);
  });

  it('reads a scan without a page number, and screens once the rows are confirmed', () => {
    const scan = emptyState();
    scan.cases.push(history({ id: 'C0001', source: 'pdf-image', transcriptionConfirmed: false, fileName: 'scan.pdf' }));
    scan.jobs.push({ id: 'J0001', stage: 'screen', caseId: 'C0001', status: 'running' });
    expect(computeNow(scan, {}, names).text).toBe('Mantle is reading a scanned page');
    expect(computeNow(scan, { page: 1 }, names).text).toBe('Mantle is reading a scanned page');

    scan.cases[0].transcriptionConfirmed = true;
    expect(computeNow(scan, { page: 1, pages: 2 }, names).text).toBe('Mantle is screening');
  });

  it('says one finding or one letter when the lists are empty, and the real number when they are not', () => {
    const checking = emptyState();
    checking.jobs.push({ id: 'J0001', stage: 'check', caseId: 'C0001', status: 'running' });
    expect(computeNow(checking).text).toBe('Model 2 is double-checking 1 finding');
    checking.findings.push(finding({ id: 'F0001', state: 'suspected' }));
    expect(computeNow(checking, {}, names).text).toBe('Lumen is double-checking 1 finding');

    const writing = emptyState();
    writing.jobs.push({ id: 'J0001', stage: 'letter', caseId: 'C0001', status: 'running' });
    expect(computeNow(writing, {}, names).text).toBe('Ogee is writing 1 letter');
    writing.letters.push(letter({ id: 'T0001', status: 'drafting' }), letter({ id: 'T0002', status: 'drafting' }));
    expect(computeNow(writing, {}, names).text).toBe('Ogee is writing 2 letters');
  });

  it('does not say a letter is being written for a finding that is gone', () => {
    const state = emptyState();
    state.findings.push(finding({ id: 'F0001', state: 'confirmed' }));
    state.jobs.push({ id: 'J0001', stage: 'letter', caseId: 'C0001', findingId: 'F0001', status: 'running' });
    expect(computeNow(state, {}, names).text).toBe('Idle');
    expect(computeNow(state, {}, names).text).not.toMatch(/writing/i);
    state.jobs.push({ id: 'J0002', stage: 'check', caseId: 'C0001', status: 'queued' });
    expect(computeNow(state, {}, names).text).toBe('Starting the next step');
    state.findings[0].state = 'accepted';
    expect(computeNow(state, {}, names).text).toBe('Ogee is writing 1 letter');
  });

  it('uses the held job even when another job is queued first, and a running job wins', () => {
    expect(HELD_FOR_MODELS.startsWith('Waiting. The local model server')).toBe(true);
    const held = emptyState();
    held.jobs.push(
      { id: 'J0001', stage: 'letter', caseId: 'C0001', status: 'queued', detail: 'Waiting for the pharmacist' },
      { id: 'J0002', stage: 'screen', caseId: 'C0002', status: 'queued', detail: HELD_FOR_MODELS }
    );
    expect(computeNow(held)).toEqual({
      stage: 'screen',
      text: 'The local models are not running. This step starts again when they answer.'
    });

    const ordinary = emptyState();
    ordinary.jobs.push({ id: 'J0001', stage: 'check', caseId: 'C0001', status: 'queued', detail: 'Waiting for the pharmacist' });
    expect(computeNow(ordinary)).toEqual({ stage: 'check', text: 'Starting the next step' });

    held.jobs.push({ id: 'J0003', stage: 'letter', caseId: 'C0001', status: 'running' });
    expect(computeNow(held, {}, names).text).toBe('Ogee is writing 1 letter');
  });

  it('says Warming up Mantle while the warm-up job runs', () => {
    const state = emptyState();
    state.jobs.push({ id: 'J0001', stage: 'screen', caseId: '', status: 'running', warmup: true });
    expect(computeNow(state, {}, names)).toEqual({ stage: 'screen', text: 'Warming up Mantle' });
    expect(computeNow(state)).toEqual({ stage: 'screen', text: 'Warming up Model 1' });
    expect(computeNow(state, {}, { screen: 'North', check: 'Lumen', letter: 'Ogee' })).toEqual({
      stage: 'screen', text: 'Warming up North'
    });
  });
});
