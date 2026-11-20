import { describe, expect, it } from 'vitest';
import { byId, criterionName, readCriteria, toCriterionView } from './criteria.ts';

const full = {
  id: 'STOPP-X1',
  label: 'STOPP X1',
  family: 'STOPP',
  title: 'A short title',
  statement: 'The text shown to the pharmacist.',
  statement_origin: 'published',
  source: { document: 'A document', citation: 'A citation', licence: 'CC BY 4.0', licence_status: 'proposed', credit: 'The credit line.' },
  plain_summary: 'One sentence.',
  medicine_groups: [],
  rule_for_models: '',
  cannot_be_seen: 'What cannot be seen.',
  ask_the_gp: 'a review',
  urgency: 'routine',
  draft: true,
  signed_by_clinical_reviewer: null,
};

describe('toCriterionView', () => {
  it('reads the full shape from shared/types.ts', () => {
    expect(toCriterionView(full)).toEqual({
      id: 'STOPP-X1',
      label: 'STOPP X1',
      title: 'A short title',
      statement: 'The text shown to the pharmacist.',
      sourceName: 'A document',
      credit: 'The credit line.',
      cannotBeSeen: 'What cannot be seen.',
      rule: '',
      urgency: 'routine',
      signedBy: null,
    });
    // The rule the models were given is shown to the pharmacist with the criterion.
    expect(toCriterionView({ ...full, rule_for_models: ' Suspect a finding when both are supplied within 60 days. ' })?.rule)
      .toBe('Suspect a finding when both are supplied within 60 days.');
  });

  it('reads a shorter shape with the credit at the top level', () => {
    const view = toCriterionView({ id: 'A', label: 'A', statement: 'Text.', source: 'A document', credit: 'Top credit.' });
    expect(view?.credit).toBe('Top credit.');
    expect(view?.title).toBe('');
    expect(view?.cannotBeSeen).toBe('');
  });

  it('falls back to the citation, then the document, when there is no credit line', () => {
    expect(toCriterionView({ ...full, source: { citation: 'Only a citation' } })?.credit).toBe('Only a citation');
    expect(toCriterionView({ id: 'A', statement: 'Text.', source: 'Just a name' })?.credit).toBe('Just a name');
  });

  it('shows the sign-off when the clinical reviewer has signed', () => {
    const view = toCriterionView({ ...full, signed_by_clinical_reviewer: { name: 'A. Pharmacist', date: '2026-11-19' } });
    expect(view?.signedBy).toEqual({ name: 'A. Pharmacist', date: '2026-11-19' });
  });

  it('reads urgency and the modification notice from the source', () => {
    const view = toCriterionView({
      ...full,
      urgency: 'same_day',
      source: { ...full.source, modification_notice: 'Adapted for the prototype.' },
    });
    expect(view?.urgency).toBe('same_day');
    expect(view?.modificationNotice).toBe('Adapted for the prototype.');
  });

  // docs/SPEC.md section 6a: a criterion may need a fact that a dispensing history does not hold.
  it('reads the facts a criterion needs, and leaves the field out when it needs none', () => {
    expect(toCriterionView(full)?.needsFacts).toBeUndefined();
    const view = toCriterionView({
      ...full,
      needs_facts: [
        { kind: 'result', what: ' eGFR ', meets: 'Below 30 mL/min/1.73 m2.' },
        { kind: 'Condition', what: 'Heart failure' },
        { kind: 'result', what: '' },             // it has no name
        { kind: 'opinion', what: 'Frailty' },     // a kind the contract does not know
        'eGFR',                                   // not an entry at all
      ],
    });
    expect(view?.needsFacts).toEqual([
      { kind: 'result', what: 'eGFR', meets: 'Below 30 mL/min/1.73 m2.' },
      { kind: 'condition', what: 'Heart failure', meets: '' },
    ]);
    expect(toCriterionView({ ...full, needs_facts: [] })?.needsFacts).toBeUndefined();
    expect(toCriterionView({ ...full, needs_facts: 'eGFR' })?.needsFacts).toBeUndefined();
  });

  it('refuses anything without an ID or without the criterion text', () => {
    expect(toCriterionView({ id: 'A', label: 'A' })).toBeNull();
    expect(toCriterionView({ statement: 'Text.' })).toBeNull();
    expect(toCriterionView(null)).toBeNull();
    expect(toCriterionView('STOPP-X1')).toBeNull();
  });
});

describe('readCriteria', () => {
  it('accepts a list, an object holding a list, and an object keyed by ID', () => {
    expect(readCriteria([full]).map((c) => c.id)).toEqual(['STOPP-X1']);
    expect(readCriteria({ criteria: [full] }).map((c) => c.id)).toEqual(['STOPP-X1']);
    expect(readCriteria({ 'STOPP-X1': full }).map((c) => c.id)).toEqual(['STOPP-X1']);
  });

  it('skips a list of bare IDs and looks further for the real list', () => {
    expect(readCriteria({ active: ['STOPP-X1'], criteria: [full] }).map((c) => c.id)).toEqual(['STOPP-X1']);
  });

  // docs/SPEC.md section 6a: the criteria in use after the first ten. A finding of one of them needs its text too.
  it('reads the further criteria after the first list, each of them once', () => {
    const further = { ...full, id: 'START-G1', label: 'START G1' };
    expect(readCriteria([full, further]).map((c) => c.id)).toEqual(['STOPP-X1', 'START-G1']);
    expect(readCriteria({ active: [full], further: [further, full] }).map((c) => c.id)).toEqual(['STOPP-X1', 'START-G1']);
    expect(readCriteria({ criteria: [full], further: [further] }).map((c) => c.id)).toEqual(['STOPP-X1', 'START-G1']);
    // Lists of bare IDs beside the real list are still skipped.
    expect(readCriteria({ active: ['STOPP-X1'], further: ['START-G1'], criteria: [full, further] }).map((c) => c.id))
      .toEqual(['STOPP-X1', 'START-G1']);
  });

  it('gives an empty list for anything else', () => {
    expect(readCriteria(undefined)).toEqual([]);
    expect(readCriteria('nothing')).toEqual([]);
    expect(readCriteria({ error: 'no' })).toEqual([]);
  });
});

describe('names', () => {
  it('joins the label and the title, or gives the label alone', () => {
    const [view] = readCriteria([full]);
    expect(criterionName(view)).toBe('STOPP X1: A short title');
    expect(criterionName({ ...view, title: '' })).toBe('STOPP X1');
    expect(byId([view])['STOPP-X1']).toBe(view);
  });
});
