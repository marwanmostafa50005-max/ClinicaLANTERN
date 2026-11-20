import type { CriterionView } from './criteria.ts';

export interface CriteriaSourceGroup {
  source: string;
  count: number;
  criteria: CriterionView[];
}

/** Each criterion sits under its source, in the order sources first appear in the list from the server. */
export function groupCriteriaBySource(list: CriterionView[]): CriteriaSourceGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, CriterionView[]>();
  for (const criterion of list) {
    const source = criterion.sourceName.trim() !== '' ? criterion.sourceName : 'Unknown source';
    if (!buckets.has(source)) {
      buckets.set(source, []);
      order.push(source);
    }
    buckets.get(source)!.push(criterion);
  }
  return order.map((source) => {
    const criteria = buckets.get(source) ?? [];
    return { source, count: criteria.length, criteria };
  });
}

/** Filters on label, title, statement and source name. Case-insensitive. */
export function filterCriteriaList(list: CriterionView[], query: string): CriterionView[] {
  const q = query.trim().toLowerCase();
  if (q === '') return list;
  return list.filter((c) => {
    if (c.label.toLowerCase().includes(q)) return true;
    if (c.title.toLowerCase().includes(q)) return true;
    if (c.statement.toLowerCase().includes(q)) return true;
    if (c.sourceName.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function countSigned(list: CriterionView[]): number {
  return list.filter((c) => c.signedBy !== null).length;
}