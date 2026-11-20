import { describe, expect, it } from 'vitest';
import type { Finding } from '../../shared/types.ts';
import {
  countDisputedWaiting,
  shouldAnnounceStatusChange,
  statusAnnouncementBucket,
  statusTextWithoutCriterionNumbers,
} from './statusLine.ts';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F0001',
    caseId: 'C0001',
    criterionId: 'ONE',
    state: 'not_confirmed',
    possible: false,
    screen: {
      lineIds: [],
      medicines: [],
      reason: '',
      linesVerified: true,
      missingFacts: [],
      model: 'm',
      at: '2026-11-18T00:00:00.000Z',
      seconds: 1,
    },
    seenByPharmacist: false,
    ...over,
  };
}

describe('countDisputedWaiting', () => {
  it('counts a not_confirmed finding with no decision', () => {
    expect(countDisputedWaiting([finding()])).toBe(1);
  });

  it('does not count a not_confirmed finding that already has a decision', () => {
    expect(
      countDisputedWaiting([
        finding({ decision: { action: 'bypass', by: 'pharmacist', at: '2026-11-18T00:00:00.000Z' } }),
      ]),
    ).toBe(0);
  });
});

describe('statusAnnouncementBucket', () => {
  it('treats criterion numbers as the same bucket', () => {
    const a = statusAnnouncementBucket('Mantle is screening: criterion 3 of 413', false, 'screen');
    const b = statusAnnouncementBucket('Mantle is screening: criterion 214 of 413', false, 'screen');
    expect(a).toBe(b);
    expect(statusTextWithoutCriterionNumbers(a)).toContain('criterion n of N');
  });

  it('announces idle after a screening line', () => {
    const screen = statusAnnouncementBucket('Mantle is screening: criterion 1 of 413', false, 'screen');
    const idle = statusAnnouncementBucket('Idle', false, null);
    expect(shouldAnnounceStatusChange(screen, idle)).toBe(true);
  });

  it('does not announce again when only numbers change', () => {
    const three = statusAnnouncementBucket('Mantle is screening: criterion 3 of 413', false, 'screen');
    const four = statusAnnouncementBucket('Mantle is screening: criterion 4 of 413', false, 'screen');
    expect(shouldAnnounceStatusChange(three, four)).toBe(false);
  });
});