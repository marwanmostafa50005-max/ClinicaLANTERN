import { describe, expect, it } from 'vitest';
import { byId, readCriteria } from '../lib/criteria.ts';
import { groupWaitingByHistory, orderWaitingInGroup } from '../lib/findings.ts';
import { JOB_NAMES } from '../lib/modelNames.ts';
import { SAMPLE_CRITERIA, makeFixture, makeManyFixture } from './fixtures.ts';
import { RECORDED_SAMPLE } from './recordedSample.ts';

const NOW = new Date('2026-11-18T09:00:00.000Z').getTime();

/** The sample criteria as the page shows them, by ID. */
const criteria = byId(readCriteria(SAMPLE_CRITERIA));

describe('sample bell states', () => {
  const state = () => makeFixture(NOW);
  const findings = () => state().findings;
  const waiting = () => findings().filter((f) => f.state === 'confirmed');

  it('holds each bell state for the sample view', () => {
    expect(waiting().some((f) => f.possible)).toBe(true);
    expect(waiting().some((f) => f.check?.completed === false)).toBe(true);
    expect(waiting().some((f) => !f.screen.linesVerified)).toBe(true);
    expect(findings().some((f) => f.state === 'not_confirmed' && !f.decision)).toBe(true);
    expect(findings().some((f) => f.state === 'accepted')).toBe(true);
    expect(findings().some((f) => f.state === 'bypassed' && f.decision?.reason)).toBe(true);
    expect(state().cases.some((c) => c.screening.criteria.some((r) => r.status === 'failed'))).toBe(true);
  });

  it('uses at least two histories for waiting findings', () => {
    const ids = new Set(waiting().map((f) => f.caseId));
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  it('holds a waiting finding of a same-day criterion and one of a signed criterion', () => {
    const of = (f: { criterionId: string }) => criteria[f.criterionId];
    expect(waiting().some((f) => of(f)?.urgency === 'same_day')).toBe(true);
    expect(waiting().some((f) => of(f)?.signedBy?.name === 'Sample reviewer (mock-up only)')).toBe(true);
    // The other waiting findings belong to routine criteria.
    expect(waiting().some((f) => of(f)?.urgency === 'routine')).toBe(true);
  });

  // The first card of the findings page is the card of the approved picture: the title first, then
  // the evidence. The special states of the sample view (same day, lines not verified, second check
  // not completed, possible finding) are on later cards.
  it('keeps the first card of the findings page free of special states', () => {
    const group = groupWaitingByHistory(waiting(), state().cases)[0];
    const first = orderWaitingInGroup(group.waiting, criteria)[0];
    expect(first.id).toBe('F0001');
    expect(criteria[first.criterionId]).toMatchObject({ urgency: 'routine', signedBy: null });
    expect(first.screen.linesVerified).toBe(true);
    expect(first.check).toMatchObject({ completed: true, confirmed: true });
    expect(first.check?.unclear).not.toBe(true);
    expect(first.possible).toBe(false);
  });

  it('shows "lines not verified" as the real server records it: the first model named no line, the second check did', () => {
    const unverified = waiting().filter((f) => !f.screen.linesVerified);
    expect(unverified).toHaveLength(1);
    expect(unverified[0].screen.lineIds).toEqual([]);
    expect(unverified[0].check?.completed).toBe(true);
    expect(unverified[0].check?.lineIds.length).toBeGreaterThan(0);
    // Every other finding of the sample data names lines, and they are verified.
    for (const f of findings().filter((one) => one.screen.linesVerified)) expect(f.screen.lineIds.length, f.id).toBeGreaterThan(0);
  });

  it('holds more than twenty waiting findings when many mode is built', () => {
    const many = makeManyFixture(NOW);
    expect(many.findings.filter((f) => f.state === 'confirmed').length).toBeGreaterThan(20);
    expect(new Set(many.findings.filter((f) => f.state === 'confirmed').map((f) => f.caseId)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('the made-up recording of the sample view', () => {
  it('names in its status line the criterion that its own first frame shows as running, of the criteria in use', () => {
    const first = RECORDED_SAMPLE.frames[0].response;
    const running = first.state.cases.find((c) => c.screening.status === 'running');
    const runs = running?.screening.criteria ?? [];
    const at = runs.findIndex((run) => run.status === 'running') + 1;
    expect(at).toBeGreaterThan(0);
    expect(runs).toHaveLength(SAMPLE_CRITERIA.length);
    expect(first.now).toEqual({ stage: 'screen', text: `${JOB_NAMES.screen} is screening: criterion ${at} of ${runs.length}` });
  });
});