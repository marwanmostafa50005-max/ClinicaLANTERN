import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CriterionView } from '../lib/criteria.ts';
import { CriteriaPanel, CriterionDetail, criteriaCountsLine } from './CriteriaPanel.tsx';

const signed: CriterionView = {
  id: 'S1',
  label: 'Sample 1',
  title: 'A signed sample',
  statement: 'Words the pharmacist reads as evidence.',
  sourceName: 'Sample text for the page mock-up',
  credit: 'Sample credit line.',
  cannotBeSeen: 'Cannot be seen from supplies alone.',
  rule: 'Suspect when both appear.',
  urgency: 'routine',
  signedBy: { name: 'A. Reviewer', date: '2026-11-19' },
};

describe('CriteriaPanel', () => {
  it('shows the counts line', () => {
    expect(criteriaCountsLine(12, 10)).toBe(
      '12 criteria in use. 10 signed by the clinical reviewer. The others are drafts.',
    );
    expect(criteriaCountsLine(2, 1)).toBe('2 criteria in use. 1 signed by the clinical reviewer. The other is a draft.');
    expect(criteriaCountsLine(1, 1)).toBe('1 criterion in use. It is signed by the clinical reviewer.');
    expect(criteriaCountsLine(3, 3)).toBe('3 criteria in use. All are signed by the clinical reviewer.');
    expect(criteriaCountsLine(531, 0)).toBe('531 criteria in use. None is signed by the clinical reviewer yet: all are drafts.');
    expect(criteriaCountsLine(0, 0)).toBe('No criterion is in use.');
    const html = renderToStaticMarkup(<CriteriaPanel onClose={() => undefined} />);
    expect(html).toContain('The criteria in use');
  });

  it('opens a row that shows the words of the criterion, its credit, and who signed', () => {
    const html = renderToStaticMarkup(<CriterionDetail criterion={signed} />);
    expect(html).toContain('class="criterion-text"');
    expect(html).toContain('Words the pharmacist reads as evidence.');
    expect(html).toContain('Sample credit line.');
    expect(html).toContain('Signed by A. Reviewer on 19 Nov 2026');
  });
});