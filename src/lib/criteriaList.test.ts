import { describe, expect, it } from 'vitest';
import type { CriterionView } from './criteria.ts';
import { filterCriteriaList, groupCriteriaBySource } from './criteriaList.ts';

function criterion(
  id: string,
  title: string,
  statement: string,
  sourceName: string,
  extra: Partial<CriterionView> = {},
): CriterionView {
  return {
    id,
    label: id,
    title,
    statement,
    sourceName,
    credit: '',
    cannotBeSeen: '',
    rule: '',
    urgency: 'routine',
    signedBy: null,
    ...extra,
  };
}

describe('groupCriteriaBySource', () => {
  it('puts each criterion under its source with the right count', () => {
    const list = [
      criterion('A', 'One', 'alpha text', 'Doc A'),
      criterion('B', 'Two', 'beta text', 'Doc B'),
      criterion('C', 'Three', 'gamma text', 'Doc A'),
    ];
    const groups = groupCriteriaBySource(list);
    expect(groups.map((g) => [g.source, g.count])).toEqual([
      ['Doc A', 2],
      ['Doc B', 1],
    ]);
    expect(groups[0]?.criteria.map((c) => c.id)).toEqual(['A', 'C']);
  });
});

describe('filterCriteriaList', () => {
  const list = [
    criterion('X1', 'Kidney medicine', 'Statement about kidneys.', 'STOPP/START criteria'),
    criterion('X2', 'Sleep tablet', 'Statement about benzodiazepines.', 'Another list'),
  ];

  it('finds a criterion by title, text and source', () => {
    expect(filterCriteriaList(list, 'kidney').map((c) => c.id)).toEqual(['X1']);
    expect(filterCriteriaList(list, 'benzodiazepines').map((c) => c.id)).toEqual(['X2']);
    expect(filterCriteriaList(list, 'STOPP').map((c) => c.id)).toEqual(['X1']);
  });

  it('finds nothing for a word that is nowhere', () => {
    expect(filterCriteriaList(list, 'antibiotics')).toEqual([]);
  });
});