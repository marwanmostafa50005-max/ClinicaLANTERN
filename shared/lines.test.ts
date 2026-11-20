import { describe, expect, it } from 'vitest';
import type { Finding } from './types.ts';
import { findingLines } from './lines.ts';

type Lines = Pick<Finding, 'screen' | 'check'>;

function finding(screenIds: string[], check?: { lineIds: string[]; completed?: boolean; confirmed?: boolean }): Lines {
  const out: Lines = {
    screen: { lineIds: screenIds, medicines: [], reason: '', linesVerified: screenIds.length > 0, missingFacts: [], model: 'lantern-screen', at: '', seconds: 1 }
  };
  if (check) {
    out.check = {
      confirmed: check.confirmed ?? true, lineIds: check.lineIds, whatMatches: '', whatCannotBeSeen: '',
      completed: check.completed ?? true, model: 'lantern-check', at: '', seconds: 1
    };
  }
  return out;
}

describe('the lines of a finding: one rule for the page, the letter and the scorer', () => {
  it('shows the lines of the second check and keeps the lines of the first model', () => {
    // What a real run of 18 November gave: Model 1 cited L008 and L041, Model 2 cited L041 and L045.
    const lines = findingLines(finding(['L008', 'L041'], { lineIds: ['L041', 'L045'] }));
    expect(lines.all).toEqual(['L008', 'L041', 'L045']);
    expect(lines.byCheck).toEqual(['L041', 'L045']);
    expect(lines.byScreenOnly).toEqual(['L008']);
  });

  it('never loses the proving lines when the second model names other lines', () => {
    // The stand-in of the review: Model 1 cites the planted lines, Model 2 confirms but cites metformin and perindopril.
    const lines = findingLines(finding(['L036', 'L040'], { lineIds: ['L001', 'L002'] }));
    expect(lines.all).toEqual(['L001', 'L002', 'L036', 'L040']);
    expect(lines.byScreenOnly).toEqual(['L036', 'L040']);
  });

  it('uses the first model alone when the second check was not completed, or has not run', () => {
    // A check that did not finish carries the first model's lines in its record. They are not its own.
    const unfinished = findingLines(finding(['L003', 'L002'], { lineIds: ['L003', 'L002'], completed: false, confirmed: false }));
    expect(unfinished).toEqual({ all: ['L002', 'L003'], byCheck: [], byScreenOnly: ['L003', 'L002'] });
    expect(findingLines(finding(['L010'])).all).toEqual(['L010']);
  });

  it('puts the lines in history order, each once, and tidies how an ID is written', () => {
    const lines = findingLines(finding(['L120', ' l002 ', 'L002'], { lineIds: ['L1000', 'L045', 'L045'] }));
    expect(lines.all).toEqual(['L002', 'L045', 'L120', 'L1000']);
  });

  it('gives nothing when no model named a line', () => {
    expect(findingLines(finding([], { lineIds: [] })).all).toEqual([]);
  });

  it('drops a value that is not a line id, and sorts an id with no number first', () => {
    const odd = finding(['nope', 'L003']);
    (odd.screen.lineIds as unknown[]).push(12, '  ', null);
    const lines = findingLines(odd);
    expect(lines.all).toEqual(['NOPE', 'L003']);
    expect(lines.byCheck).toEqual([]);
    expect(lines.byScreenOnly).toEqual(['NOPE', 'L003']);
  });

  it('keeps a tied line number in the order it was named, and an absent screen names nothing', () => {
    const tied = findingLines(finding(['A2', 'L003'], { lineIds: ['B2'] }));
    expect(tied.all).toEqual(['B2', 'A2', 'L003']);
    expect(tied.byCheck).toEqual(['B2']);
    expect(tied.byScreenOnly).toEqual(['A2', 'L003']);
    expect(findingLines({} as Lines)).toEqual({ all: [], byCheck: [], byScreenOnly: [] });
    expect(findingLines(finding(['L010', 'L002', 'L010'])).byScreenOnly).toEqual(['L010', 'L002']);
  });

  it('keeps the second check in the order it was named, and ignores a list that is not a list', () => {
    const lines = findingLines(finding(['L002'], { lineIds: ['L100', 'L002', 'l100'] }));
    expect(lines.byCheck).toEqual(['L100', 'L002']);
    expect(lines.all).toEqual(['L002', 'L100']);
    expect(lines.byScreenOnly).toEqual([]);

    const notAList = finding(['L005']);
    (notAList.screen as { lineIds: unknown }).lineIds = 'L005';
    expect(findingLines(notAList)).toEqual({ all: [], byCheck: [], byScreenOnly: [] });

    const huge = 'L' + '9'.repeat(400);
    const big = findingLines(finding([huge, 'L002']));
    expect(big.all).toEqual([huge, 'L002']);
  });

  it('keeps the lines of a finished check that did not confirm, and reads a number that is the whole id', () => {
    const turned = findingLines(finding(['L008'], { lineIds: ['L009'], completed: true, confirmed: false }));
    expect(turned).toEqual({ all: ['L008', 'L009'], byCheck: ['L009'], byScreenOnly: ['L008'] });

    const noList = findingLines({
      screen: { lineIds: ['L004'] },
      check: { completed: true }
    } as unknown as Lines);
    expect(noList).toEqual({ all: ['L004'], byCheck: [], byScreenOnly: ['L004'] });

    const numbers = findingLines(finding([' 12 ', 'L2A3', 'L003']));
    expect(numbers.all).toEqual(['L003', '12', 'L2A3']);
    expect(numbers.byScreenOnly).toEqual(['12', 'L2A3', 'L003']);
  });

  it('drops a second-check list that is not a list, and keeps a check when the first model named nothing', () => {
    const notAList = finding(['L002'], { lineIds: ['L009'] });
    (notAList.check as { lineIds: unknown }).lineIds = 'L009';
    expect(findingLines(notAList)).toEqual({ all: ['L002'], byCheck: [], byScreenOnly: ['L002'] });

    const noScreen = findingLines({
      check: {
        confirmed: true, lineIds: [' l004 ', 'L004'], whatMatches: '', whatCannotBeSeen: '',
        completed: true, model: 'lantern-check', at: '', seconds: 0
      }
    } as unknown as Lines);
    expect(noScreen).toEqual({ all: ['L004'], byCheck: ['L004'], byScreenOnly: [] });
  });

  it('counts one line when only the case differs, and a dot in an id is not a decimal point', () => {
    const lines = findingLines(finding([' l008 ', 'L003'], { lineIds: ['L008', 'l008'] }));
    expect(lines.byCheck).toEqual(['L008']);
    expect(lines.byScreenOnly).toEqual(['L003']);
    expect(lines.all).toEqual(['L003', 'L008']);

    const dotted = findingLines(finding(['L1.5', 'L2']));
    expect(dotted.all).toEqual(['L2', 'L1.5']);
    expect(dotted.byScreenOnly).toEqual(['L1.5', 'L2']);

    const spaced = findingLines(finding(['L 008'], { lineIds: ['L008'] }));
    expect(spaced.byScreenOnly).toEqual(['L 008']);
    expect(spaced.all).toEqual(['L008', 'L 008']);
  });
});
