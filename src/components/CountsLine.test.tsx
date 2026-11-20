import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Counts } from '../../shared/types.ts';
import { CountsLine } from './CountsLine.tsx';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const full: Counts = {
  historiesScreened: 1,
  findingsConfirmed: 3,
  accepted: 0,
  bypassed: 0,
  lettersReady: 0,
  lettersSent: 1,
  repliesRecorded: 0,
  closed: 0,
  overdue: 2,
  bellBadge: 0,
  letterBadge: 0,
};

// The words of the approved first screen: each count says what it counts, and one is written as one.
const labels = [
  '1 history screened',
  '3 findings confirmed',
  '0 accepted',
  '0 bypassed',
  '1 letter sent',
  '0 replies recorded',
  '0 letters closed',
  '2 letters overdue',
];

const all = (n: number): Counts => ({
  historiesScreened: n,
  findingsConfirmed: n,
  accepted: n,
  bypassed: n,
  lettersReady: 0,
  lettersSent: n,
  repliesRecorded: n,
  closed: n,
  overdue: n,
  bellBadge: 0,
  letterBadge: 0,
});

describe('CountsLine', () => {
  it('shows the eight labels in the fixed order', () => {
    const html = text(renderToStaticMarkup(<CountsLine counts={full} />));
    const positions = labels.map((label) => html.indexOf(label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
    expect(renderToStaticMarkup(<CountsLine counts={full} />).match(/<li /g)?.length).toBe(8);
  });

  it('writes one as one', () => {
    const html = text(renderToStaticMarkup(<CountsLine counts={all(1)} />));
    expect(html).toBe(
      '1 history screened 1 finding confirmed 1 accepted 1 bypassed 1 letter sent 1 reply recorded 1 letter closed 1 letter overdue',
    );
  });

  it('writes any other number as many', () => {
    const two = text(renderToStaticMarkup(<CountsLine counts={all(2)} />));
    expect(two).toBe(
      '2 histories screened 2 findings confirmed 2 accepted 2 bypassed 2 letters sent 2 replies recorded 2 letters closed 2 letters overdue',
    );
    const none = text(renderToStaticMarkup(<CountsLine counts={all(0)} />));
    expect(none).toBe(
      '0 histories screened 0 findings confirmed 0 accepted 0 bypassed 0 letters sent 0 replies recorded 0 letters closed 0 letters overdue',
    );
  });

  it('shows not known yet when counts are null, not zero', () => {
    const html = renderToStaticMarkup(<CountsLine counts={null} />);
    expect(html).toContain('not known yet');
    expect(text(html)).not.toMatch(/\b0\b/);
  });

  it('marks overdue in words and alarm class when above zero', () => {
    const html = renderToStaticMarkup(<CountsLine counts={full} />);
    expect(html).toContain('count--alarm');
    expect(html.match(/count--alarm/g)?.length).toBe(1);
    expect(text(html)).toContain('2 letters overdue');
  });

  it('has no alarm when nothing is overdue', () => {
    const html = renderToStaticMarkup(<CountsLine counts={{ ...full, overdue: 0 }} />);
    expect(html).not.toContain('count--alarm');
    expect(text(html)).toContain('0 letters overdue');
  });
});