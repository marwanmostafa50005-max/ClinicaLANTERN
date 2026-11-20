import { describe, expect, it } from 'vitest';
import type { HistoryLine } from '../shared/types.ts';
import { lineId } from './csv.ts';
import { findDates, longDate, parseDateField } from './dates.ts';
import {
  clipText, countParts, fitsInOneCall, historyBlock, historyCharBudget, joinedNote, joinDistinct, keepKnownLineIds, linesFromRows,
  mergeNames, partsHolding, patientText, promptFits, promptLength, splitIntoParts
} from './history.ts';

function makeLines(n: number): HistoryLine[] {
  return Array.from({ length: n }, (_, i) => ({ id: lineId(i + 1), text: `2026-01-01 | Medicine ${i + 1}` }));
}

describe('the line-ID guard', () => {
  const lines = makeLines(5);

  it('keeps IDs that exist, in history order, each once', () => {
    expect(keepKnownLineIds(['L004', 'L002', 'L004'], lines)).toEqual({ kept: ['L002', 'L004'], dropped: [] });
  });

  it('drops IDs that do not exist', () => {
    const guard = keepKnownLineIds(['L002', 'L099', 'L4', 'line 3', ''], lines);
    expect(guard.kept).toEqual(['L002']);
    expect(guard.dropped).toEqual(['L099', 'L4', 'line 3', '']);
  });

  it('accepts lower case and spaces around an ID, and survives a wrong type', () => {
    expect(keepKnownLineIds([' l003 '], lines).kept).toEqual(['L003']);
    expect(keepKnownLineIds([7, null, { id: 'L001' }], lines).kept).toEqual([]);
    expect(keepKnownLineIds('L001', lines).kept).toEqual([]);
  });

  it('records a value that is not text by its JSON, and drops a blank', () => {
    expect(keepKnownLineIds([7, null, { id: 'L001' }, '  ', 'L 002', ' l002 '], lines)).toEqual({
      kept: ['L002'],
      dropped: ['7', 'null', '{"id":"L001"}', '  ', 'L 002']
    });
    expect(keepKnownLineIds([], lines)).toEqual({ kept: [], dropped: [] });
  });
});

describe('long histories', () => {
  it('leaves a history that fits as one part', () => {
    expect(splitIntoParts(makeLines(150), 150, 30)).toHaveLength(1);
    expect(countParts(150, 150, 30)).toBe(1);
  });

  it('splits a longer history into overlapping parts that cover every line', () => {
    const lines = makeLines(400);
    const parts = splitIntoParts(lines, 150, 30);
    expect(parts.map(p => [p[0].id, p[p.length - 1].id])).toEqual([
      ['L001', 'L150'], ['L121', 'L270'], ['L241', 'L390'], ['L361', 'L400']
    ]);
    expect(countParts(400, 150, 30)).toBe(4);
    expect(new Set(parts.flat().map(l => l.id)).size).toBe(400);
    // Each part shares 30 lines with the one before it.
    expect(parts[1].slice(0, 30).map(l => l.id)).toEqual(parts[0].slice(-30).map(l => l.id));
  });

  it('counts parts the same way it splits them', () => {
    for (const n of [1, 149, 150, 151, 270, 271, 999]) {
      expect(countParts(n, 150, 30)).toBe(splitIntoParts(makeLines(n), 150, 30).length);
    }
  });

  it('also splits by size, and always moves forward', () => {
    const wide = makeLines(12).map(l => ({ ...l, text: 'x'.repeat(96) }));       // 104 characters a line with its ID
    const parts = splitIntoParts(wide, 150, 2, 630);                             // six lines fit in one part
    expect(parts.map(p => p.map(l => l.id).join(' '))).toEqual([
      'L001 L002 L003 L004 L005 L006', 'L005 L006 L007 L008 L009 L010', 'L009 L010 L011 L012'
    ]);
    // Neighbouring parts never share more than a third of a part, so a small part still moves on well.
    expect(splitIntoParts(wide, 150, 30, 630).map(p => p[0].id)).toEqual(['L001', 'L005', 'L009']);
    // A single line that is larger than the limit still gets a part of its own: nothing is skipped.
    const huge = splitIntoParts(wide, 150, 30, 50);
    expect(huge).toHaveLength(12);
    expect(huge.flat().map(l => l.id)).toEqual(wide.map(l => l.id));
  });

  it('knows how much history fits beside the rest of the prompt', () => {
    expect(historyCharBudget(16384, 1200)).toBe(27368);
    expect(historyCharBudget(16384, 4000)).toBe(21768);
    expect(historyCharBudget(2048, 1200)).toBe(4000);
    expect(promptFits(16384, 2788, 1200)).toBe(true);
    expect(promptFits(16384, 15120, 1200)).toBe(true);
    expect(promptFits(16384, 15121, 1200)).toBe(false);
    expect(promptFits(16384, 0, 1200)).toBe(true);                               // no count reported: nothing to judge
  });

  it('notices a prompt that Ollama cut short', () => {
    // Measured on this PC: 150 demo lines, 21,277 characters, 8,214 tokens. All of it was read.
    expect(promptFits(16384, 8214, 1200, 21277)).toBe(true);
    // Measured on this PC: 389 lines went in (about 56,000 characters) and only 8,195 tokens were read.
    expect(promptFits(16384, 8195, 1200, 56000)).toBe(false);
    // A short prompt cannot be cut, whatever its text is like.
    expect(promptFits(16384, 2000, 1200, 9000)).toBe(true);
  });

  it('trusts a missing token count, and cuts only past 3.8 characters a token', () => {
    expect(promptFits(16384, -5, 1200, 99999)).toBe(true);
    // 38,000 characters over 10,000 tokens is 3.8 exactly, so the prompt was not cut.
    expect(promptFits(16384, 10000, 1200, 38000)).toBe(true);
    // One more character is over 3.8, so the start of the history may have been dropped.
    expect(promptFits(16384, 10000, 1200, 38001)).toBe(false);
    // 20,000 characters is the smallest prompt that can be cut. One under that stays trusted.
    expect(promptFits(16384, 100, 1200, 19999)).toBe(true);
    expect(promptFits(16384, 100, 1200, 20000)).toBe(false);
  });

  it('picks the fewest parts that hold the cited lines', () => {
    const parts = splitIntoParts(makeLines(400), 150, 30);
    expect(partsHolding(parts, ['L130', 'L140'])).toEqual([0]);            // in the overlap: one part is enough
    expect(partsHolding(parts, ['L010', 'L395'])).toEqual([0, 3]);
    expect(partsHolding(parts, [])).toEqual([0, 1, 2, 3]);                  // nothing to look for: check everything
    expect(partsHolding(parts, ['L999'])).toEqual([0, 1, 2, 3]);
  });
});

describe('the history text', () => {
  it('puts the patient first and numbers every line', () => {
    const block = historyBlock({ label: 'Fictional patient F-001', age: 72, sex: 'F' }, makeLines(2));
    expect(block).toBe(
      'PATIENT (fictional)\nFictional patient F-001, female, 72 years\n\n' +
      'DISPENSING HISTORY (one supply per line, each line starts with its ID)\n' +
      'L001 | 2026-01-01 | Medicine 1\nL002 | 2026-01-01 | Medicine 2'
    );
  });

  it('writes the patient in plain words', () => {
    expect(patientText({ label: 'Fictional patient F-002', sex: 'm' })).toBe('Fictional patient F-002, male');
    expect(patientText({ label: '' })).toBe('Fictional patient');
    expect(patientText({ label: '  ', sex: ' female ', age: 72 })).toBe('Fictional patient, female, 72 years');
    expect(patientText({ label: 'Fictional patient F-003', sex: 'Male', age: Number.NaN })).toBe('Fictional patient F-003, male');
    expect(patientText({ label: 'Fictional patient F-004', sex: '  Other  ', age: Number.POSITIVE_INFINITY })).toBe('Fictional patient F-004, Other');
    expect(patientText({ label: 'Fictional patient F-005', age: 0 })).toBe('Fictional patient F-005, 0 years');
  });

  it('keeps a date of birth out of the patient line a model or a letter reads, and keeps a supply date', () => {
    const leaked = patientText({
      label: 'Fictional patient F-100 DOB: 15/03/1954',
      sex: 'female, born 15 March 1954',
      age: 72,
      dateOfBirth: '1954-03-15'
    });
    expect(leaked).toBe('Fictional patient F-100, female, 72 years');
    expect(leaked).not.toMatch(/1954|DOB|born/i);

    // A date in the reference is a birth date when it is the date already read, even with no label.
    expect(patientText({
      label: 'Fictional patient F-100 15/03/1954',
      age: 72,
      dateOfBirth: '1954-03-15'
    })).toBe('Fictional patient F-100, 72 years');

    // With no date of birth on the record, an unlabelled date in the reference stays: it may be part of the reference.
    expect(patientText({ label: 'Fictional patient F-100 15/03/1954' })).toBe('Fictional patient F-100 15/03/1954');

    // A labelled birth date is removed even when the record has no date-of-birth field.
    expect(patientText({ label: 'Fictional patient F-100, date of birth 15/03/1954' })).toBe('Fictional patient F-100');

    const lines: HistoryLine[] = [
      { id: 'L001', text: '1954-03-15 | Warfarin 5 mg | DOB: 15/03/1954' },
      { id: 'L002', text: '2026-08-21 | Atorvastatin 20 mg | qty 30' }
    ];
    const block = historyBlock({
      label: 'Fictional patient F-100 DOB: 15/03/1954', sex: 'F', age: 72, dateOfBirth: '1954-03-15'
    }, lines);
    expect(block).toContain('PATIENT (fictional)\nFictional patient F-100, female, 72 years\n');
    expect(block).toContain('L001 | 1954-03-15 | Warfarin 5 mg');
    expect(block).toContain('L002 | 2026-08-21 | Atorvastatin 20 mg | qty 30');
    expect(block).not.toMatch(/DOB|15\/03\/1954/);

    // The supply date stays when it is the birthday. A later copy of that date in free text does not.
    const sameDay = historyBlock(
      { label: 'Fictional patient F-100', dateOfBirth: '1954-03-15' },
      [{ id: 'L001', text: '1954-03-15 | Warfarin | started 15/03/1954' }]
    );
    expect(sameDay).toContain('L001 | 1954-03-15 | Warfarin | started');
    expect(sameDay).not.toContain('15/03/1954');

    // A date that is not the birth date is left, including one written in free text.
    const other = historyBlock(
      { label: 'Fictional patient F-100', dateOfBirth: '1954-03-15' },
      [{ id: 'L001', text: '2026-08-21 | Warfarin | started 21/08/2026' }]
    );
    expect(other).toContain('L001 | 2026-08-21 | Warfarin | started 21/08/2026');
  });

  // docs/SPEC.md section 6a: a record may also carry conditions and results.
  it('says in the heading that the record holds facts, only when one of its lines is a fact', () => {
    const lines: HistoryLine[] = [
      { id: 'L001', text: '2026-07-10 | CONDITION | Heart failure' },
      { id: 'L002', text: '2026-08-21 | Celebrex 200 mg capsule | qty 30' }
    ];
    expect(historyBlock({ label: 'Fictional patient F-001' }, lines)).toBe(
      'PATIENT (fictional)\nFictional patient F-001\n\n' +
      'DISPENSING HISTORY WITH RECORDED FACTS (one supply or one fact per line, each line starts with its ID; ' +
      'a fact line says CONDITION, RESULT or OBSERVATION after its date)\n' +
      'L001 | 2026-07-10 | CONDITION | Heart failure\nL002 | 2026-08-21 | Celebrex 200 mg capsule | qty 30'
    );
    // A history of supplies only keeps the heading it always had.
    expect(historyBlock({ label: 'Fictional patient F-001' }, lines.slice(1)))
      .toContain('DISPENSING HISTORY (one supply per line, each line starts with its ID)\nL002 |');
    // The line-ID guard treats a fact line like any other line.
    expect(keepKnownLineIds(['L001', 'L002', 'L003'], lines)).toEqual({ kept: ['L001', 'L002'], dropped: ['L003'] });
  });

  it('says to the model that the lines read together also hold the facts, for a criterion that needs facts', () => {
    expect(joinedNote(398, 14, true)).toBe(
      'This history is long: 398 lines. Only the 14 lines that hold a medicine listed for this criterion, or a fact this criterion needs, are shown here. ' +
      'They come from every part of the history. The lines that are not shown hold other medicines and other facts.');
    expect(joinedNote(398, 1, true)).toContain('Only the 1 line that holds a medicine listed for this criterion, or a fact this criterion needs, is shown here.');
    expect(joinedNote(398, 0, true)).toBe(
      'This history is long: 398 lines. No line of it holds a medicine listed for this criterion or a fact this criterion needs, so no line is shown here. ' +
      'The lines that are not shown hold other medicines and other facts.');
    // A criterion without facts gets the note it always got.
    expect(joinedNote(398, 14, false)).toBe(joinedNote(398, 14));
  });
});

describe('rows from a PDF or a scan', () => {
  it('numbers the rows and accepts a history with dated rows', () => {
    const read = linesFromRows(['Example Pharmacy: dispensing history', ' 2026-08-21   Celebrex 200 mg ', '', '21/09/2026 Xarelto 20 mg'], [1, 1, 1, 2]);
    expect(read.problems).toEqual([]);
    expect(read.lines).toEqual([
      { id: 'L001', text: 'Example Pharmacy: dispensing history', page: 1 },
      { id: 'L002', text: '2026-08-21 Celebrex 200 mg', page: 1 },
      { id: 'L003', text: '21/09/2026 Xarelto 20 mg', page: 2 }
    ]);
  });

  it('reports a history with no dated row, no rows at all, or a date that cannot be read', () => {
    expect(linesFromRows(['Celebrex 200 mg', 'Xarelto 20 mg']).problems).toEqual(['No row has a date that can be read.']);
    expect(linesFromRows([]).problems).toEqual(['No rows could be read from the file.']);
    expect(linesFromRows('not a list').problems).toEqual(['No rows could be read from the file.']);
    expect(linesFromRows(['2026-08-21 Celebrex', '31/02/2026 Xarelto']).problems).toEqual(['Line L002: the date "31/02/2026" cannot be read.']);
  });

  // The review of 18 November: a scan row with a misread date ("21/O8/2026") or no date was
  // accepted and screened, while the same row in a CSV file gave "Cannot assess".
  it('asks of a row read from a scan what a CSV file asks: a date that can be read, first in the row', () => {
    const rows = [
      '2026-08-08 | Xarelto 20 mg tablet | qty 28',
      '21/O8/2026 | Celebrex 200 mg capsule | qty 30',
      'Lipitor 40 mg tablet | qty 30',
      '21/08/2026 | Celebrex 200 mg capsule | qty 30'
    ];
    const read = linesFromRows(rows, [1, 1, 2, 2], { everyRowDated: true });
    expect(read.lines.map(l => [l.id, l.page])).toEqual([['L001', 1], ['L002', 1], ['L003', 2], ['L004', 2]]);
    expect(read.problems).toEqual(['Line L002: the date "21/O8/2026" cannot be read.', 'Line L003 has no date.']);
    // Without the rule (a PDF with text, whose title rows have no date) the same rows pass.
    expect(linesFromRows(rows).problems).toEqual([]);
    expect(linesFromRows(['2026-08-08 | Xarelto 20 mg tablet', '21/08/2026 | Celebrex 200 mg capsule'], undefined, { everyRowDated: true }).problems).toEqual([]);
  });

  it('does not cut a very long row short without saying so', () => {
    const read = linesFromRows(['2026-08-21 Celebrex 200 mg', '2026-08-22 ' + 'x'.repeat(1200)]);
    expect(read.lines[1].text).toHaveLength(1000);
    expect(read.problems).toEqual(['Line L002 is too long to read (over 1000 characters).']);
  });

  it('names five bad dates and says how many more, and names up to five lines that are too long', () => {
    const good = '2026-08-08 | Xarelto 20 mg tablet';
    const bad = (n: number): string => `${n}/O8/2026 | Celebrex`;
    const six = linesFromRows([good, bad(1), bad(2), bad(3), bad(4), bad(5), bad(6)], undefined, { everyRowDated: true });
    expect(six.problems).toEqual([
      'Line L002: the date "1/O8/2026" cannot be read.',
      'Line L003: the date "2/O8/2026" cannot be read.',
      'Line L004: the date "3/O8/2026" cannot be read.',
      'Line L005: the date "4/O8/2026" cannot be read.',
      'Line L006: the date "5/O8/2026" cannot be read.',
      'There are 1 more rows like this.'
    ]);
    const five = linesFromRows([good, bad(1), bad(2), bad(3), bad(4), bad(5)], undefined, { everyRowDated: true });
    expect(five.problems).toHaveLength(5);
    expect(five.problems.some(problem => problem.startsWith('There are'))).toBe(false);

    const long = (tag: string): string => `2026-08-21 ${tag} ` + 'x'.repeat(1200);
    const two = linesFromRows(['2026-08-01 short', long('a'), long('b')]);
    expect(two.problems).toEqual(['Lines L002, L003 are too long to read (over 1000 characters).']);
    const many = linesFromRows([long('a'), long('b'), long('c'), long('d'), long('e'), long('f')]);
    expect(many.lines).toHaveLength(6);
    expect(many.lines.every(line => line.text.length === 1000)).toBe(true);
    expect(many.problems).toEqual(['Lines L001, L002, L003, L004, L005 are too long to read (over 1000 characters).']);

    expect(linesFromRows(['2026-08-21 Celebrex', 4, ''], [1, 2, 3]).lines).toEqual([
      { id: 'L001', text: '2026-08-21 Celebrex', page: 1 }
    ]);
    expect(linesFromRows(['2026-08-21 Celebrex'], ['no' as unknown as number]).lines).toEqual([
      { id: 'L001', text: '2026-08-21 Celebrex' }
    ]);
  });
});

describe('a long history read together, and a text a model wrote', () => {
  it('says to the model that only the listed lines are shown, and where they come from', () => {
    expect(joinedNote(398, 14)).toBe(
      'This history is long: 398 lines. Only the 14 lines that hold a medicine listed for this criterion are shown here. ' +
      'They come from every part of the history. The lines that are not shown hold other medicines.');
    expect(joinedNote(200, 1)).toContain('Only the 1 line that holds a medicine');
  });

  it('knows whether lines fit in one call: by their number and by their size', () => {
    const lines = makeLines(12);
    expect(fitsInOneCall(lines, 150, 10_000)).toBe(true);
    expect(fitsInOneCall(lines, 10, 10_000)).toBe(false);
    expect(fitsInOneCall(lines, 150, 100)).toBe(false);
  });

  it('cuts a text that reached its limit back to a whole sentence, and says that more was written', () => {
    const short = 'Celebrex and Xarelto are both supplied.';
    expect(clipText(`  ${short}  `, 700, '(More was written.)')).toBe(short);
    const long = 'First sentence here. Second sentence here. Third sentence that goes on and on';
    expect(clipText(long, 60, '(More was written.)')).toBe('First sentence here. Second sentence here. (More was written.)');
    // No sentence end to cut at: the text is cut at a word and marked.
    expect(clipText('one two three four five six seven eight nine ten', 20, '(More.)')).toBe('one two three four ... (More.)');
  });

  it('cuts at a question or an exclamation, and at a word when that end is too early', () => {
    expect(clipText('  one\n\ntwo   three  ', 50, '(More.)')).toBe('one two three');
    expect(clipText('   ', 10, '(More.)')).toBe('');
    // The later mark wins. "! " sits on the 0.4 line of a 30-character cut, so the sentence is kept.
    expect(clipText(
      'Go now. Stop! And then a lot more text follows after the mark here.',
      30,
      '(More was written.)'
    )).toBe('Go now. Stop! (More was written.)');
    expect(clipText(
      'Is this still needed? The rest of the note goes on past the limit of the cut.',
      40,
      '(More was written.)'
    )).toBe('Is this still needed? (More was written.)');
    expect(clipText(
      'Really? Yes it is. And then more text follows well past the limit of the cut.',
      40,
      '(More.)'
    )).toBe('Really? Yes it is. (More.)');
    // A sentence end before 0.4 of the cut falls through to a word, and a trailing mark is set aside.
    expect(clipText('Abc. rest of the sentence keeps going past the cut', 10, '(More.)')).toBe('Abc. rest ... (More.)');
    expect(clipText('word, word, word, extra extra extra', 18, '(More.)')).toBe('word, word, word ... (More.)');
    expect(clipText('alpha; beta: (gamma more words follow here for sure)', 16, '(More.)')).toBe('alpha; beta ... (More.)');
    // No space inside the cut, and a text that is exactly the limit, both take the whole head.
    expect(clipText('abcdefghijklmnopqrstuvwxyz more', 10, '(More.)')).toBe('abcdefghij ... (More.)');
    expect(clipText('abcdefghij', 10, '(More.)')).toBe('abcdefghij ... (More.)');
    // A question mark with no space after it is not a sentence end.
    expect(clipText('What?More text continues past the limit of this cut for sure now', 20, '(More.)'))
      .toBe('What?More text ... (More.)');
    expect(clipText('Go now. Stop! And then a lot more text follows after the mark here.', 30, '')).toBe('Go now. Stop!');
  });

  it('joins texts and names without blanks or repeats, and counts the letters of a prompt', () => {
    expect(joinDistinct(['  Celebrex ', '', 'celebrex', 'Xarelto'])).toBe('Celebrex Xarelto');
    expect(joinDistinct(['one', 'two'], ' and ')).toBe('one and two');
    expect(mergeNames([['Celebrex', '  '], ['celebrex', 12 as unknown as string], ['Xarelto']])).toEqual(['Celebrex', 'Xarelto']);
    expect(promptLength([{ content: 'one' }, { content: 'two' }])).toBe(6);
    expect(promptLength([])).toBe(0);
  });
});

describe('dates', () => {
  it('reads date fields day first', () => {
    expect(parseDateField('2026-08-21')).toBe('2026-08-21');
    expect(parseDateField('21/08/2026')).toBe('2026-08-21');
    expect(parseDateField('3/4/26')).toBe('2026-04-03');
    expect(parseDateField('21 August 2026')).toBe('2026-08-21');
    expect(parseDateField('21-Aug-2026')).toBe('2026-08-21');
    expect(parseDateField('2026-08-21T10:30:00')).toBe('2026-08-21');
    expect(parseDateField('31/02/2026')).toBeNull();
    expect(parseDateField('08/21/2026')).toBeNull();
    expect(parseDateField('soon')).toBeNull();
    expect(parseDateField('')).toBeNull();
  });

  it('finds dates written in different ways inside a sentence', () => {
    const found = findDates('Supplied on 21/08/2026, on 2026-09-20, on 8 October 2026 and on September 8, 2026. Seen in August 2026 and on 21 August.');
    expect(found.dates.map(d => [d.kind, d.iso ?? d.yearMonth ?? d.monthDay])).toEqual([
      ['full', '2026-08-21'], ['full', '2026-09-20'], ['full', '2026-10-08'], ['full', '2026-09-08'],
      ['month_year', '2026-08'], ['day_month', '08-21']
    ]);
    expect(found.rest).not.toMatch(/\d/);
  });

  it('does not read ordinary words as dates', () => {
    expect(findDates('These 2 may interact. Take 1 in March.').dates).toEqual([]);
    expect(findDates('Celebrex 200 mg, qty 30, repeats 2').dates).toEqual([]);
  });

  it('writes a date in words', () => {
    expect(longDate('2026-08-21')).toBe('21 August 2026');
    expect(longDate('not a date')).toBe('not a date');
  });
});
