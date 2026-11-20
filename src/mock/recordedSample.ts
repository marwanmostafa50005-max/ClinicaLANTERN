// One made-up recording for ?replay=1&mock=1. It is not shown under the recorded-run label.
import type { AppState, Counts, NowRunning } from '../../shared/types.ts';
import { JOB_NAMES } from '../lib/modelNames.ts';
import { RECORDING_FORMAT, type RecordedRun } from '../lib/recorded.ts';
import { SAMPLE_CRITERIA, makeFixture } from './fixtures.ts';

const CLOCK = Date.parse('2026-11-18T12:00:00.000Z');

function countsOf(state: AppState): Counts {
  const nowMs = CLOCK;
  const { cases, findings, letters } = state;
  const isOverdue = (l: (typeof letters)[0]): boolean =>
    l.status === 'sent' && !l.reply && l.dueAt !== undefined && new Date(l.dueAt).getTime() < nowMs;
  return {
    historiesScreened: cases.filter((c) => c.screening.status === 'done' && !c.screening.criteria.some((run) => run.status === 'failed')).length,
    findingsConfirmed: findings.filter((f) => f.check !== undefined && f.check.completed && f.check.confirmed).length,
    accepted: findings.filter((f) => f.state === 'accepted').length,
    bypassed: findings.filter((f) => f.state === 'bypassed').length,
    lettersReady: letters.filter((l) => l.status === 'ready').length,
    lettersSent: letters.filter((l) => l.sentAt !== undefined).length,
    repliesRecorded: letters.filter((l) => l.reply !== undefined).length,
    closed: letters.filter((l) => l.status === 'closed').length,
    overdue: letters.filter(isOverdue).length,
    bellBadge: findings.filter((f) => f.state === 'confirmed').length,
    letterBadge: letters.filter((l) => l.status === 'ready' && !l.seenByPharmacist).length,
  };
}

function rsp(state: AppState, now: NowRunning, afterMs: number, note = ''): RecordedRun['frames'][0] {
  return {
    afterMs,
    note,
    response: {
      state: structuredClone(state),
      counts: countsOf(state),
      now,
      serverTime: new Date(CLOCK).toISOString(),
      recorded: true,
    },
  };
}

const full = makeFixture(CLOCK);
const screening: AppState = {
  ...structuredClone(full),
  findings: [],
  letters: [],
  jobs: [{ id: 'J0001', stage: 'screen', caseId: 'C0005', status: 'running' }],
};

const bell: AppState = {
  ...structuredClone(full),
  letters: [],
  jobs: [],
  findings: full.findings.map((f) => (f.state === 'confirmed' ? { ...f, seenByPharmacist: false } : f)),
};

export const RECORDED_SAMPLE: RecordedRun = {
  format: RECORDING_FORMAT,
  title: 'Sample walk-through (made up)',
  about: 'Fictional sample data on the page: screening, a finding, and a letter. No model ran.',
  recordedAt: new Date(CLOCK).toISOString(),
  madeHow: 'Built from the sample data for looking at replay mode in the browser. Nothing was recorded from a live run.',
  criteria: SAMPLE_CRITERIA,
  frames: [
    // The count is the count of the sample criteria in use: the history of this frame shows one bar for each.
    rsp(screening, { stage: 'screen', text: `${JOB_NAMES.screen} is screening: criterion 4 of ${SAMPLE_CRITERIA.length}` }, 0),
    rsp(bell, { stage: null, text: 'Idle' }, 1200),
    rsp(full, { stage: null, text: 'Idle' }, 45_000, 'The pharmacist accepted one finding in the sample story.'),
  ],
};