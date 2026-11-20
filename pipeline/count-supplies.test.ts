// The supply count. No model is called. The copied histories are read from this folder, not from a wave folder.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Criterion, Finding, HistoryLine, ScreenResult } from '../shared/types.ts';
import { criterionBlock, readCriterion } from './criteria.ts';
import { supplyCount, supplyCountNote } from './count-supplies.ts';
import { parseCsv } from './csv.ts';
import { checkLetterFacts } from './facts.ts';
import { checkMessages } from './check.ts';
import { draftLetter, letterAllowedText, letterMessages } from './letter.ts';
import { latestDate, screenMessages, screenPartMessages } from './screen.ts';
import { fakeChat, testConfig, testCriterion, testLines, testPatient } from './testkit.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'count-supplies');

const screen: ScreenResult = {
  lineIds: ['L003'], medicines: ['celecoxib'], reason: 'Celebrex was supplied.',
  linesVerified: true, missingFacts: [], model: 'lantern-screen', at: '2026-11-18T00:00:00.000Z', seconds: 1
};

const finding: Finding = {
  id: 'F0001', caseId: 'C0001', criterionId: testCriterion.id, state: 'accepted', possible: false,
  screen: { ...screen, lineIds: ['L003', 'L005'], medicines: ['celecoxib'] },
  check: {
    confirmed: true, lineIds: ['L003'], whatMatches: 'Celebrex.', whatCannotBeSeen: 'Whether it was taken.',
    completed: true, model: 'lantern-check', at: '2026-11-18T00:00:10.000Z', seconds: 1
  },
  decision: { action: 'accept', by: 'The pharmacist on duty', at: '2026-11-18T00:01:00.000Z' },
  seenByPharmacist: true
};

function rawCriterion(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'T', label: 'T', statement: 'A statement.', rule_for_models: 'A rule.',
    medicine_groups: [{
      key: 'A', name: 'Inhalers', ingredients: ['salbutamol', 'ibuprofen'],
      brands: { salbutamol: ['Ventolin'], ibuprofen: ['Nurofen'] }
    }],
    ...extra
  };
}

function countedCriterion(window: 'any' | 'last' = 'last', form: string[] | undefined = undefined): Criterion {
  const field: Record<string, unknown> = { group: 'A', months: 12, window };
  if (form) field.form_has = form;
  return readCriterion(rawCriterion({ count_supplies: field }), 'T');
}

function line(id: string, text: string): HistoryLine {
  return { id, text };
}

const PACKS: HistoryLine[] = [
  line('L001', '2026-01-01 | Ventolin (salbutamol) 100 microgram metered dose inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A'),
  line('L002', '2026-06-01 | Ventolin (salbutamol) 100 microgram metered dose inhaler | qty 1 | repeats 0 | inhale | Dr A'),
  line('L003', '2026-08-01 | Ventolin (salbutamol) 100 microgram metered dose inhaler | qty 2 inhalers | repeats 0 | inhale | Dr A'),
  line('L004', '2026-08-02 | Nurofen (ibuprofen) 200 mg tablet | qty 24 | repeats 0 | use inhaler technique | Dr A'),
  line('L005', '2026-08-03 | CONDITION | Uses a salbutamol inhaler'),
  line('L006', '2026-08-04 | Ventolin (salbutamol) 100 microgram metered dose inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A Taken back by the pharmacist at the counter.'),
  line('L007', '2026-08-05 | Ventolin (salbutamol) inhaler | qty 30 capsules | repeats 0 | inhale | Dr A'),
  line('L008', '2026-09-01 | Lipitor (atorvastatin) 40 mg tablet | qty 30 | repeats 0 | one at night | Dr A')
];

describe('reading count_supplies', () => {
  it('leaves a criterion without the field exactly as it was', () => {
    const loaded = readCriterion(rawCriterion(), 'T');
    expect(loaded.count_supplies).toBeUndefined();
    expect(criterionBlock(loaded)).not.toContain('count_supplies');
    expect(criterionBlock(loaded)).not.toContain('COUNTED');
    const asked = countedCriterion('last', ['inhaler']);
    expect(asked.count_supplies).toEqual({ group: 'A', months: 12, window: 'last', form_has: ['inhaler'] });
    expect(criterionBlock(asked)).toBe(criterionBlock(loaded));
    expect(supplyCountNote(loaded, PACKS)).toBe('');
  });

  it('refuses a count that is not shaped as the field says', () => {
    expect(() => readCriterion(rawCriterion({ count_supplies: { group: 'Z', months: 12, window: 'last' } }), 'T')).toThrow(/group Z/);
    expect(() => readCriterion(rawCriterion({ count_supplies: { group: 'A', months: 0, window: 'last' } }), 'T')).toThrow(/months/);
    expect(() => readCriterion(rawCriterion({ count_supplies: { group: 'A', months: 12, window: 'each' } }), 'T')).toThrow(/window/);
    expect(() => readCriterion(rawCriterion({ count_supplies: { group: 'A', months: 12, window: 'last', form_has: [''] } }), 'T')).toThrow(/form_has/);
    const emptyForm = readCriterion(rawCriterion({ count_supplies: { group: 'A', months: 12, window: 'any', form_has: [] } }), 'T');
    expect(emptyForm.count_supplies).toEqual({ group: 'A', months: 12, window: 'any' });
  });

  it('reads a pack rule and refuses one that has no word or no whole per', () => {
    const loaded = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last', packs: [{ form_has: 'capsule', per: 30 }] }
    }), 'T');
    expect(loaded.count_supplies).toEqual({
      group: 'A', months: 12, window: 'last', packs: [{ form_has: 'capsule', per: 30 }]
    });
    expect(criterionBlock(loaded)).toBe(criterionBlock(readCriterion(rawCriterion(), 'T')));
    const empty = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last', packs: [] }
    }), 'T');
    expect(empty.count_supplies).toEqual({ group: 'A', months: 12, window: 'last' });
    const refuse = (packs: unknown) => readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last', packs }
    }), 'T');
    expect(() => refuse('capsule')).toThrow(/packs/);
    expect(() => refuse([{ per: 30 }])).toThrow(/form_has/);
    expect(() => refuse([{ form_has: '  ', per: 30 }])).toThrow(/form_has/);
    expect(() => refuse([{ form_has: 'capsule' }])).toThrow(/per/);
    expect(() => refuse([{ form_has: 'capsule', per: 0 }])).toThrow(/per/);
    expect(() => refuse([{ form_has: 'capsule', per: 1.5 }])).toThrow(/per/);
  });
});

describe('counting supply lines', () => {
  it('counts a whole number, skips a fact, a taken-back line and a quantity that names capsules', () => {
    const tally = supplyCount(countedCriterion('last', ['inhaler']), PACKS);
    // Newest date is the Lipitor line, 2026-09-01. L001 is more than 12 months before it? 2025-09-01 would be the cut.
    // 2026-01-01 is inside. The tablet's direction says inhaler, and that does not qualify it.
    expect(tally.total).toBe(4);
    expect(tally.lines).toBe(3);
    expect(tally.unread).toEqual(['L007']);
    expect(tally.note).toContain('Group A supplies from 2026-01-01 to 2026-08-01 (the 12 months ending on the newest date of the record): L001 1, L002 1, L003 2.');
    expect(tally.note).toContain('Lines: 3. Total supplied: 4. Quantity not read: L007.');
    expect(tally.note).toContain('The application could not settle the lines named above. Count the listed lines as given, look at the lines named above yourself, and say in your answer what you did.');
    expect(tally.note).not.toContain('Do not count again');
    expect(tally.note).not.toContain('L004');
    expect(tally.note).not.toContain('L005');
    expect(tally.note).not.toContain('L006');
  });

  it('uses 1 month when the count is one month', () => {
    const criterion = readCriterion(rawCriterion({ count_supplies: { group: 'A', months: 1, window: 'last', form_has: ['inhaler'] } }), 'T');
    const tally = supplyCount(criterion, PACKS);
    expect(tally.note).toContain('(the 1 month ending on the newest date of the record)');
    expect(tally.total).toBe(2);
    expect(tally.lines).toBe(1);
    expect(tally.unread).toEqual(['L007']);
  });

  it('keeps the window with the highest total, and the newest when two are equal', () => {
    const packs = [
      line('L001', '2026-01-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler'),
      line('L002', '2026-06-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler'),
      line('L003', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler')
    ];
    const criterion = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 6, window: 'any', form_has: ['inhaler'] }
    }), 'T');
    const tally = supplyCount(criterion, packs);
    expect(tally.windowEnd).toBe('2026-08-01');
    expect(tally.total).toBe(2);
    expect(tally.note).toContain('from 2026-06-01 to 2026-08-01 (the 6 months ending on 2026-08-01): L002 1, L003 1.');
  });

  it('says none when nothing in the window was counted', () => {
    const tally = supplyCount(countedCriterion('last', ['inhaler']), [
      line('L001', '2026-08-01 | Lipitor (atorvastatin) 40 mg tablet | qty 30')
    ]);
    expect(tally.total).toBe(0);
    expect(tally.note).toBe('COUNTED BY THE APPLICATION. Group A supplies (the 12 months ending on the newest date of the record): none. Lines: 0. Total supplied: 0. Quantity not read: none. Do not count again: use these numbers.');
  });

  it('turns a capsule pack into inhalers and leaves every other line as it was', () => {
    const lines = [
      line('L001', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 2 inhalers'),
      line('L033', '2026-09-22 | Ventolin (salbutamol) inhalation capsules | qty 30'),
      line('L034', '2026-09-23 | Ventolin (salbutamol) inhalation capsules | qty 60'),
      line('L035', '2026-09-24 | Ventolin (salbutamol) inhalation capsules | qty 1'),
      line('L007', '2026-09-25 | Ventolin (salbutamol) inhaler | qty 30 capsules')
    ];
    const packs = [{ form_has: 'capsule', per: 30 }];
    const plain = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last' }
    }), 'T');
    const packed = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last', packs }
    }), 'T');
    const before = supplyCount(plain, lines);
    expect(before.note).toContain('L001 2, L033 30, L034 60, L035 1.');
    expect(before.note).not.toContain('one pack');
    expect(before.total).toBe(93);
    expect(before.unread).toEqual(['L007']);
    const tally = supplyCount(packed, lines);
    expect(tally.note).toContain('L001 2, L033 1 (30 capsules, one pack of 30), L034 2 (60 capsules, one pack of 30), L035 1 (1 capsule, one pack of 30).');
    expect(tally.total).toBe(6);
    expect(tally.unread).toEqual(['L007']);
    expect(tally.note).toContain('Total supplied: 6.');
  });

  it('uses the first pack rule, and the converted amount when it chooses the window', () => {
    const lines = [
      line('L001', '2026-01-01 | Ventolin (salbutamol) inhaler | qty 2 inhalers'),
      line('L033', '2026-08-01 | Ventolin (salbutamol) inhalation capsules | qty 30')
    ];
    const packs = [{ form_has: 'capsule', per: 30 }, { form_has: 'inhalation', per: 10 }];
    const both = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 12, window: 'last', packs }
    }), 'T');
    const shown = supplyCount(both, lines);
    expect(shown.note).toContain('L033 1 (30 capsules, one pack of 30)');
    expect(shown.note).not.toContain('one pack of 10');
    const rawWindow = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 6, window: 'any' }
    }), 'T');
    const packedWindow = readCriterion(rawCriterion({
      count_supplies: { group: 'A', months: 6, window: 'any', packs }
    }), 'T');
    // Without a pack rule the August line is 30, so that window wins.
    expect(supplyCount(rawWindow, lines).windowEnd).toBe('2026-08-01');
    expect(supplyCount(rawWindow, lines).total).toBe(30);
    // 30 capsules is 1 inhaler, so the January window of 2 is the higher total.
    const tally = supplyCount(packedWindow, lines);
    expect(tally.windowEnd).toBe('2026-01-01');
    expect(tally.total).toBe(2);
    expect(tally.note).not.toContain('L033');
  });
});

describe('the count in the three prompts', () => {
  const asked: Criterion = {
    ...testCriterion,
    count_supplies: { group: 'A', months: 12, window: 'last' }
  };

  it('adds nothing when the criterion does not ask, even if a whole history is passed in', () => {
    const part = testLines.slice(2, 3);
    expect(screenPartMessages(testPatient, part, testCriterion, 0, 2)[1].content)
      .toBe(screenPartMessages(testPatient, part, testCriterion, 0, 2, testLines)[1].content);
    const latest = latestDate(testLines);
    expect(checkMessages(testPatient, testLines, testCriterion, screen, '', latest)[1].content)
      .toBe(checkMessages(testPatient, testLines, testCriterion, screen, '', latest, part)[1].content);
    const cited = testLines.slice(2, 3);
    expect(letterMessages(testPatient, testCriterion, finding, cited)[1].content)
      .toBe(letterMessages(testPatient, testCriterion, finding, cited, testLines)[1].content);
    expect(screenMessages(testPatient, testLines, testCriterion)[1].content).not.toContain('COUNTED BY THE APPLICATION');
  });

  it('puts the count of the whole history after the criterion and before the task', () => {
    const text = screenMessages(testPatient, testLines, asked)[1].content;
    expect(text.indexOf('RULE')).toBeLessThan(text.indexOf('COUNTED BY THE APPLICATION'));
    expect(text.indexOf('COUNTED BY THE APPLICATION')).toBeLessThan(text.indexOf('\nTASK'));
    expect(text).toContain('Total supplied: 60');
    expect(text).toContain('L003 30, L005 30');
    const part = testLines.slice(2, 3);
    const partOnly = screenPartMessages(testPatient, part, asked, 0, 2)[1].content;
    const whole = screenPartMessages(testPatient, part, asked, 0, 2, testLines)[1].content;
    expect(partOnly).toContain('Total supplied: 30');
    expect(whole).toContain('Total supplied: 60');
    expect(whole).toContain('This is part 1 of 2');
    expect(whole.indexOf('DISPENSING HISTORY')).toBeLessThan(whole.indexOf('COUNTED BY THE APPLICATION'));
  });

  it('gives the check and the letter the same numbers', () => {
    const checked = checkMessages(testPatient, testLines, asked, screen)[1].content;
    expect(checked.indexOf('COUNTED BY THE APPLICATION')).toBeLessThan(checked.indexOf('SUSPECTED FINDING FROM THE FIRST STEP'));
    expect(checked).toContain('Total supplied: 60');
    const cited = testLines.slice(2, 3);
    expect(letterMessages(testPatient, asked, finding, cited)[1].content).toContain('Total supplied: 30');
    const letter = letterMessages(testPatient, asked, finding, cited, testLines)[1].content;
    expect(letter.startsWith('COUNTED BY THE APPLICATION.')).toBe(true);
    expect(letter).toContain('Total supplied: 60');
    expect(letter).toContain('FINDING ACCEPTED BY THE PHARMACIST');
  });

  it('sends the whole history to the letter model', async () => {
    const fake = fakeChat([{ fail: 'No answer in this test.' }]);
    await draftLetter(testConfig, testPatient, testLines, asked, finding, { chat: fake.chat });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].messages[1].content).toContain('Total supplied: 60');
  });
});

describe('the copied respiratory histories', () => {
  function load(id: string, file: string, window: 'any' | 'last', packs?: { form_has: string; per: number }[]) {
    const dir = path.join(FIXTURES, id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'criterion.json'), 'utf8')) as Record<string, unknown>;
    expect(raw).not.toHaveProperty('count_supplies');
    const count: Record<string, unknown> = { group: 'A', months: 12, window, form_has: ['inhaler'] };
    if (packs) count.packs = packs;
    const loaded = readCriterion({ ...raw, count_supplies: count }, id);
    const parsed = parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(parsed.lines.length).toBeGreaterThan(0);
    return { parsed, tally: supplyCount(loaded, parsed.lines) };
  }

  it('counts group A inhalers of SCOTRESP-01 in the busiest 12 months', () => {
    expect(load('SCOTRESP-01', 'pos-brand.csv', 'any').tally.total).toBe(12);
    expect(load('SCOTRESP-01', 'pos-buried.csv', 'any').tally.total).toBe(12);
    expect(load('SCOTRESP-01', 'near-miss.csv', 'any').tally.total).toBe(11);
  });

  it('counts group A inhalers of SCOTRESP-09 in the last 12 months of the record', () => {
    expect(load('SCOTRESP-09', 'pos-brand.csv', 'last').tally.total).toBe(14);
    expect(load('SCOTRESP-09', 'pos-buried.csv', 'last').tally.total).toBe(14);
    const { parsed, tally } = load('SCOTRESP-09', 'near-miss.csv', 'last');
    const enerzair = parsed.lines.find(item => /enerzair/i.test(item.text));
    expect(enerzair).toBeTruthy();
    // The quantity cell is "30". The form says the pack holds 30 capsules and 1 inhaler.
    // "30" starts with a whole number and names no unit, so it is counted as 30 and not turned into 1 inhaler.
    expect(enerzair!.text).toMatch(/\bqty 30(\s|\|)/);
    expect(enerzair!.text.toLowerCase()).toContain('30 capsules and 1 inhaler per pack');
    expect(tally.note).toContain(`${enerzair!.id} 30`);
    // Twelve other counted lines are 1 each. This quantity is the digits 30 and names no unit,
    // so it is added as 30. The total is 42. Leaving the pack unread would leave 12, and counting
    // it as one inhaler would make 13. The quantity does not say either of those.
    expect(tally.total).toBe(42);
    expect(tally.lines).toBe(13);
    expect(tally.unread).toEqual([]);
    expect(tally.note).toContain('Lines: 13. Total supplied: 42. Quantity not read: none.');
    expect(tally.note).not.toContain('one pack');
  });

  it('counts one 30-capsule Enerzair pack as one inhaler', () => {
    const packs = [{ form_has: 'capsule', per: 30 }];
    expect(load('SCOTRESP-09', 'pos-brand.csv', 'last', packs).tally.total).toBe(14);
    expect(load('SCOTRESP-09', 'pos-buried.csv', 'last', packs).tally.total).toBe(14);
    const { parsed, tally } = load('SCOTRESP-09', 'near-miss.csv', 'last', packs);
    const enerzair = parsed.lines.find(item => /enerzair/i.test(item.text));
    expect(enerzair).toBeTruthy();
    expect(tally.note).toContain(`${enerzair!.id} 1 (30 capsules, one pack of 30)`);
    expect(tally.total).toBe(13);
    expect(tally.lines).toBe(13);
    expect(tally.note).toContain('Lines: 13. Total supplied: 13. Quantity not read: none.');
  });
});

const ROOT = path.resolve(FIXTURES, '..', '..', '..');
const SETTLED = 'Do not count again: use these numbers.';
const UNSETTLED = 'The application could not settle the lines named above. Count the listed lines as given, look at the lines named above yourself, and say in your answer what you did.';

function steroidCriterion(window: 'any' | 'last' = 'last', packs?: { form_has: string; per: number }[]): Criterion {
  const count: Record<string, unknown> = { group: 'A', months: 12, window, form_has: ['inhaler'] };
  if (packs) count.packs = packs;
  return readCriterion(rawCriterion({
    medicine_groups: [{
      key: 'A', name: 'Inhaled corticosteroids',
      ingredients: ['fluticasone propionate', 'salbutamol', 'iron'],
      brands: {
        'fluticasone propionate': ['Seretide MDI', 'Symbicort Turbuhaler'],
        salbutamol: ['Ventolin'],
        iron: ['Ferro-Tab'],
        mometasone: ['Enerzair Breezhaler']
      }
    }],
    count_supplies: count
  }), 'T');
}

describe('a count that never states a wrong total', () => {
  it('matches the product as whole words, and names a near match without counting it', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => line(
        `L${String(i + 1).padStart(3, '0')}`,
        '2026-08-01 | Ventolin (salbutamol) metered dose inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example'
      )),
      line('L011', '2026-08-01 | Atrovent (ipratropium) metered dose inhaler | qty 1 inhaler | repeats 0 | Use after Ventolin if wheezy | Dr A. Example'),
      line('L012', '2026-08-01 | Symbicort 200/6 dry powder inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example'),
      line('L013', '2026-08-01 | fluticasone 250 microgram metered dose inhaler | qty 1 | repeats 0 | inhale | Dr A. Example'),
      line('L014', '2026-08-01 | Seretide MDI 250/25 metered dose inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example'),
      line('L015', '2026-08-01 | Spiractin (spironolactone) 25 mg inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example'),
      line('L016', '2026-08-01 | Symbicort Turbuhaler 200/6 dry powder inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example')
    ];
    const tally = supplyCount(steroidCriterion(), lines);
    expect(tally.total).toBe(12);
    expect(tally.lines).toBe(12);
    expect(tally.note).not.toContain('L011');
    expect(tally.note).not.toContain('L015');
    expect(tally.note).toContain('Possibly of this group, not counted: L012, L013.');
    expect(tally.note).toContain('L016 1');
    expect(tally.note).toContain(UNSETTLED);
    expect(tally.note).not.toContain(SETTLED);
  });

  it('names every unread line of an any-window, including those outside the window that won', () => {
    const early = [
      ...Array.from({ length: 10 }, (_, i) => line(
        `L${String(i + 1).padStart(3, '0')}`,
        `2024-0${(i % 6) + 1}-15 | Ventolin (salbutamol) inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A`
      )),
      line('L011', '2024-02-01 | Ventolin (salbutamol) inhaler | qty 200 puffs | repeats 0 | inhale | Dr A'),
      line('L012', '2024-03-01 | Ventolin (salbutamol) inhaler | qty 200 puffs | repeats 0 | inhale | Dr A'),
      line('L013', '2024-04-01 | Ventolin (salbutamol) inhaler | qty 200 puffs | repeats 0 | inhale | Dr A')
    ];
    const late = Array.from({ length: 11 }, (_, i) => line(
      `L${String(i + 14).padStart(3, '0')}`,
      '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A'
    ));
    const tally = supplyCount(steroidCriterion('any'), [...early, ...late]);
    expect(tally.windowEnd).toBe('2026-08-01');
    expect(tally.total).toBe(11);
    expect(tally.unread).toEqual(['L011', 'L012', 'L013']);
    expect(tally.note).toContain('Quantity not read: L011, L012, L013.');
    expect(tally.note).not.toContain('Quantity not read: none');
    expect(tally.note).toContain(UNSETTLED);
    expect(tally.note).not.toContain(SETTLED);
  });

  it('keeps a number of inhalers or devices, and divides only a bare number or a number of capsules', () => {
    const product = 'Enerzair Breezhaler inhalation capsules (30 capsules and 1 inhaler per pack)';
    const packs = [{ form_has: 'capsule', per: 30 }];
    const inhalers = Array.from({ length: 7 }, (_, i) => line(
      `L${String(i + 1).padStart(3, '0')}`,
      `2026-08-01 | ${product} | qty 2 inhalers | repeats 0 | inhale | Dr A. Example`
    ));
    const divided = supplyCount(steroidCriterion('last', packs), [
      ...inhalers,
      line('L008', `2026-08-02 | ${product} | qty 30 capsules | repeats 0 | inhale | Dr A. Example`),
      line('L009', `2026-08-03 | ${product} | qty 60 capsules | repeats 0 | inhale | Dr A. Example`),
      line('L010', `2026-08-04 | ${product} | qty 2 devices | repeats 0 | inhale | Dr A. Example`),
      line('L011', `2026-08-05 | ${product} | qty 30 | repeats 0 | inhale | Dr A. Example`)
    ]);
    expect(divided.total).toBe(14 + 1 + 2 + 2 + 1);
    expect(divided.note).toContain('L001 2');
    expect(divided.note).not.toContain('2 capsules, one pack of 30');
    expect(divided.note).toContain('L008 1 (30 capsules, one pack of 30)');
    expect(divided.note).toContain('L009 2 (60 capsules, one pack of 30)');
    expect(divided.note).toContain('L010 2');
    expect(divided.note).toContain('L011 1 (30 capsules, one pack of 30)');
    expect(divided.unread).toEqual([]);
    expect(divided.note).toContain(SETTLED);
  });

  it('leaves a decimal, a fraction, a range, a bracketed unit and a unit of several words unread', () => {
    const lines = [
      line('L001', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 2.5 mL | repeats 0 | inhale | Dr A'),
      line('L002', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 200 metered doses | repeats 0 | inhale | Dr A'),
      line('L003', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 30 inhalation capsules | repeats 0 | inhale | Dr A'),
      line('L004', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1.5 capsules | repeats 0 | inhale | Dr A'),
      line('L005', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 0.5 inhalers | repeats 0 | inhale | Dr A'),
      line('L006', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 200-puff | repeats 0 | inhale | Dr A'),
      line('L007', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 30 (capsules) | repeats 0 | inhale | Dr A'),
      line('L008', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1/2 inhaler | repeats 0 | inhale | Dr A'),
      line('L009', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A')
    ];
    const tally = supplyCount(steroidCriterion(), lines);
    expect(tally.total).toBe(1);
    expect(tally.lines).toBe(1);
    expect(tally.unread).toEqual(['L001', 'L002', 'L003', 'L004', 'L005', 'L006', 'L007', 'L008']);
    expect(tally.note).toContain('L009 1');
    expect(tally.note).toContain('Total supplied: 1.');
    expect(tally.note).not.toContain('Total supplied: 232');
    expect(tally.note).not.toContain('Total supplied: 0');
    expect(tally.note).toContain(UNSETTLED);
  });

  it('does not say none or a total of zero when every quantity of the group was unread', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line(
      `L${String(i + 1).padStart(3, '0')}`,
      '2026-08-01 | Ventolin (salbutamol) inhaler | qty 200 puffs | repeats 0 | inhale | Dr A'
    ));
    const tally = supplyCount(steroidCriterion(), lines);
    expect(tally.total).toBe(0);
    expect(tally.lines).toBe(0);
    expect(tally.unread).toHaveLength(12);
    expect(tally.note).toContain('the application could not read the quantities of L001, L002, L003, L004, L005, L006, L007, L008, L009, L010, L011, L012.');
    expect(tally.note).toContain('Quantity not read: L001, L002, L003, L004, L005, L006, L007, L008, L009, L010, L011, L012.');
    expect(tally.note).not.toContain('Total supplied: 0');
    expect(tally.note).not.toContain(': none');
    expect(tally.note).toContain(UNSETTLED);
    expect(tally.note).not.toContain(SETTLED);
  });

  it('does not state a total when the count itself was not read', () => {
    const bad = steroidCriterion();
    bad.count_supplies = { group: 'A', months: 0, window: 'last' };
    const unreadCount = supplyCount(bad, [
      line('L001', '2026-08-01 | Ventolin (salbutamol) inhaler | qty 1 inhaler')
    ]);
    expect(unreadCount.note).toBe('COUNTED BY THE APPLICATION. Group A supplies could not be counted: the count was not read.');
    expect(unreadCount.note).not.toContain('Total supplied');
    expect(unreadCount.note).not.toContain(SETTLED);
    const missing = steroidCriterion();
    missing.count_supplies = { group: 'Z', months: 12, window: 'last' };
    expect(supplyCount(missing, []).note).toBe('COUNTED BY THE APPLICATION. Group Z is not a medicine group of this criterion.');
  });

  it('keeps the six scored respiratory blocks byte for byte', () => {
    const pinned: Array<[string, string, string]> = [
      ['SCOTRESP-01', 'pos-brand.csv', '84caccc5c2f4eb2be13da5977b7b8136652f95e09638b87a220f8fed39304851'],
      ['SCOTRESP-01', 'pos-buried.csv', 'f2055371a616bb1fa2ff0df4bd4693af4eac5379057afea82e0dbdc683cbac83'],
      ['SCOTRESP-01', 'near-miss.csv', '156e878fc46ccf30e155a4e0b92b8cc97b0887f781aa21d33d1955576409cbda'],
      ['SCOTRESP-09', 'pos-brand.csv', '2a8c0c170efcf047b07ead11a4654cdb09df8ac6648bf8e87bc59a75db3dfbaf'],
      ['SCOTRESP-09', 'pos-buried.csv', 'cb8e04687f1cc3b6eb18ecdb1609efab368647e96a87f108be4eb2308e55851b'],
      ['SCOTRESP-09', 'near-miss.csv', '070700e6af49aebbec652456bbb096eecb742e819d42e0fe9dd646c6b1388a22']
    ];
    for (const [id, file, hash] of pinned) {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'criteria', id, 'criterion.json'), 'utf8')) as Record<string, unknown>;
      const loaded = readCriterion(raw, id);
      const parsed = parseCsv(fs.readFileSync(path.join(FIXTURES, id, file), 'utf8'));
      const note = supplyCount(loaded, parsed.lines).note;
      expect(createHash('sha256').update(note).digest('hex'), `${id}/${file}`).toBe(hash);
      expect(note).toContain(SETTLED);
      expect(note).not.toContain('Possibly of this group');
    }
  });

  it('does not treat the count paragraph as a source the letter may quote from', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'criteria', 'SCOTRESP-09', 'criterion.json'), 'utf8')) as Record<string, unknown>;
    const loaded = readCriterion(raw, 'SCOTRESP-09');
    const lines = Array.from({ length: 15 }, (_, i) => line(
      `L${String(i + 1).padStart(3, '0')}`,
      `2026-${String((i % 9) + 1).padStart(2, '0')}-01 | Symbicort Turbuhaler (budesonide) 200 microgram dry powder inhaler | qty 1 inhaler | repeats 0 | inhale | Dr A. Example`
    ));
    const tally = supplyCount(loaded, lines);
    expect(tally.total).toBe(15);
    expect(tally.note).toContain('Total supplied: 15.');
    const allowed = letterAllowedText(testPatient, loaded, lines);
    // The criterion's own rule names the count paragraph. The paragraph itself, with the total, is not allowed text.
    expect(allowed).not.toContain(tally.note);
    expect(allowed).not.toContain('Total supplied: 15');
    expect(checkLetterFacts(['15 inhalers were supplied in the last 12 months.'], allowed)).toEqual([]);
    expect(checkLetterFacts(['15 months of inhalers were supplied.'], allowed).join('\n')).toContain('The amount "15 months" is not in the dispensing lines or the criterion.');
  });
});
