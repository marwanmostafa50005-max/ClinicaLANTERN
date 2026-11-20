// The part of a criterion the page shows, read carefully from whatever GET /api/criteria sends.
// docs/SPEC.md says the call gives "label, statement, source, credit". The full shape is
// `Criterion` in shared/types.ts. This reader accepts the full shape, and also a shorter one
// with the credit line at the top level, so the source text is shown either way.
import type { Criterion, NeededFact } from '../../shared/types.ts';

export interface CriterionView {
  id: string;
  label: string;
  title: string;
  /** The criterion text shown to the pharmacist as evidence. */
  statement: string;
  /** The credit line shown with the statement. */
  credit: string;
  /** The source document name, for grouping in the criteria panel. */
  sourceName: string;
  /** What a dispensing history cannot show, as written with the criterion. */
  cannotBeSeen: string;
  /** What the models were asked to look for: the one-sentence rule given to them with the criterion. */
  rule: string;
  /** When the source carries a modification notice (STOPP/START credit). */
  modificationNotice?: string;
  /** Whether the criterion is marked for same-day review. */
  urgency: 'routine' | 'same_day';
  /** Null until the clinical reviewer signs. */
  signedBy: { name: string; date: string } | null;
  /**
   * The facts the criterion needs that a dispensing history does not hold (docs/SPEC.md section 6a).
   * Only there when the criterion file lists one.
   */
  needsFacts?: NeededFact[];
}

type Loose = Partial<Omit<Criterion, 'source'>> & {
  source?: Partial<Criterion['source']> | string;
  credit?: string;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The list "needs_facts" of a criterion file. An entry with no name, or of a kind the contract does not know, is left out. */
function readNeededFacts(value: unknown): NeededFact[] {
  const out: NeededFact[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const kind = text(entry.kind).toLowerCase();
    const what = text(entry.what);
    if (what === '' || (kind !== 'condition' && kind !== 'result' && kind !== 'observation')) continue;
    out.push({ kind, what, meets: text(entry.meets) });
  }
  return out;
}

export function toCriterionView(raw: unknown): CriterionView | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Loose;
  const id = text(c.id);
  const statement = text(c.statement);
  if (id === '' || statement === '') return null;
  const source = c.source && typeof c.source === 'object' ? c.source : undefined;
  const signed = c.signed_by_clinical_reviewer;
  const view: CriterionView = {
    id,
    label: text(c.label) || id,
    title: text(c.title) || text(c.plain_summary),
    statement,
    sourceName: text(source?.document) || (typeof c.source === 'string' ? text(c.source) : ''),
    credit: text(source?.credit) || text(c.credit) || text(source?.citation) || text(source?.document) || text(c.source),
    cannotBeSeen: text(c.cannot_be_seen),
    rule: text(c.rule_for_models),
    urgency: c.urgency === 'same_day' ? 'same_day' : 'routine',
    signedBy: signed && text(signed.name) !== '' ? { name: text(signed.name), date: text(signed.date) } : null,
  };
  const notice = text(source?.modification_notice);
  if (notice !== '') view.modificationNotice = notice;
  const needs = readNeededFacts(c.needs_facts);
  if (needs.length > 0) view.needsFacts = needs;
  return view;
}

/**
 * Accepts a list, an object that holds a list, or an object keyed by criterion ID.
 * When the object also holds a list "further" (the criteria in use after the first ten,
 * docs/SPEC.md section 6a), those follow the first list, so a finding of a further criterion
 * is shown with its text too.
 */
export function readCriteria(data: unknown): CriterionView[] {
  const fromList = (list: unknown[]): CriterionView[] =>
    list.map(toCriterionView).filter((c): c is CriterionView => c !== null);

  if (Array.isArray(data)) return fromList(data);
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  for (const key of ['criteria', 'active', 'items', 'list']) {
    const value = record[key];
    if (Array.isArray(value)) {
      const views = fromList(value);
      if (views.length > 0) {
        const known = new Set(views.map((c) => c.id));
        const further = Array.isArray(record.further) ? fromList(record.further).filter((c) => !known.has(c.id)) : [];
        return [...views, ...further];
      }
    }
  }
  return fromList(Object.values(record));
}

/** "STOPP C10: short title", or the label alone when there is no title. */
export function criterionName(criterion: CriterionView): string {
  return criterion.title ? `${criterion.label}: ${criterion.title}` : criterion.label;
}

export function byId(list: CriterionView[]): Record<string, CriterionView> {
  const out: Record<string, CriterionView> = {};
  for (const criterion of list) out[criterion.id] = criterion;
  return out;
}
