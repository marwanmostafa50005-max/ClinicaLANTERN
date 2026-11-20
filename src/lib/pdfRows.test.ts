import { describe, expect, it } from 'vitest';
import { countLetters, groupIntoRows, multiplyTransform, placeText } from './pdfRows.ts';
import type { PlacedText } from './pdfRows.ts';

/** A piece of 9 pt text. The width is a rough 4.5 pt for each letter unless given. */
function piece(str: string, x: number, y: number, width = str.length * 4.5, height = 9): PlacedText {
  return { str, x, y, width, height };
}

describe('groupIntoRows', () => {
  it('gives one entry for each printed row, top to bottom, columns left to right', () => {
    const rows = groupIntoRows([
      piece('Dr G. Sample', 505, 102),
      piece('2026-08-21', 40, 118),
      piece('2026-08-03', 40, 102),
      piece('Celebrex (celecoxib) 200 mg capsule', 100, 118),
      piece('Micardis (telmisartan) 40 mg tablet', 100, 102),
      piece('Dr H. Locum', 505, 118),
    ]);
    expect(rows).toEqual([
      '2026-08-03 | Micardis (telmisartan) 40 mg tablet | Dr G. Sample',
      '2026-08-21 | Celebrex (celecoxib) 200 mg capsule | Dr H. Locum',
    ]);
  });

  it('keeps pieces on one row when the baselines differ by a hair', () => {
    const rows = groupIntoRows([piece('Take ONE capsule', 345, 100, 70), piece('daily with food', 417.5, 100.4, 62)]);
    expect(rows).toEqual(['Take ONE capsule daily with food']);
  });

  it('starts a new row when the next line of print is a full line lower', () => {
    const rows = groupIntoRows([piece('first line', 40, 100), piece('second line', 40, 111)]);
    expect(rows).toEqual(['first line', 'second line']);
  });

  it('joins pieces that touch without adding a space', () => {
    const rows = groupIntoRows([piece('Lipi', 100, 50, 18), piece('tor 40 mg', 118.2, 50, 40)]);
    expect(rows).toEqual(['Lipitor 40 mg']);
  });

  it('drops the blank pieces a PDF reader adds between columns', () => {
    const rows = groupIntoRows([
      piece('Date', 40, 86, 19),
      { str: ' ', x: 59, y: 86, width: 41, height: 0 },
      piece('Medicine', 100, 86, 36),
      { str: '', x: 40, y: 86, width: 0, height: 0 },
    ]);
    expect(rows).toEqual(['Date | Medicine']);
  });

  it('splits a fixed-width report row at runs of spaces', () => {
    const line = '2026-08-03  Micardis (telmisartan) 40 mg tablet        28  5  Dr G. Sample';
    expect(groupIntoRows([piece(line, 30, 90, line.length * 4.8, 8)])).toEqual([
      '2026-08-03 | Micardis (telmisartan) 40 mg tablet | 28 | 5 | Dr G. Sample',
    ]);
  });

  it('turns odd spaces into plain ones and does not double a space at a join', () => {
    const rows = groupIntoRows([piece(`Take ONE${String.fromCharCode(0xa0)}tablet `, 345, 60, 62), piece(' daily', 407.5, 60, 24)]);
    expect(rows).toEqual(['Take ONE tablet daily']);
  });

  it('gives nothing for a page with no text', () => {
    expect(groupIntoRows([])).toEqual([]);
    expect(groupIntoRows([{ str: '   ', x: 0, y: 0, width: 10, height: 9 }])).toEqual([]);
  });
});

describe('countLetters', () => {
  it('counts print, not spaces or column marks', () => {
    expect(countLetters(['ab | cd', ' e '])).toBe(5);
    expect(countLetters([])).toBe(0);
  });

  it('tells a page of text from a page with a stamp only', () => {
    expect(countLetters(groupIntoRows([piece('APPROVED', 400, 700, 50)]))).toBeLessThan(40);
    expect(
      countLetters(
        groupIntoRows([
          piece('Dr G. Sample', 505, 102),
          piece('2026-08-21', 40, 118),
          piece('2026-08-03', 40, 102),
          piece('Celebrex (celecoxib) 200 mg capsule', 100, 118),
          piece('Micardis (telmisartan) 40 mg tablet', 100, 102),
          piece('Dr H. Locum', 505, 118),
        ]),
      ),
    ).toBeGreaterThanOrEqual(40);
  });
});

describe('placeText', () => {
  const viewport = [2, 0, 0, 2, 0, 0];
  const item = { str: 'Hi', transform: [1, 0, 0, 1, 10, 20], width: 12, height: 9 };

  it('matches multiplying the two transforms by hand on a plain page', () => {
    const m = multiplyTransform(viewport, item.transform);
    const placed = placeText(viewport, item);
    expect(placed).toEqual({
      str: 'Hi',
      x: m[4],
      y: m[5],
      width: 12,
      height: Math.hypot(m[2], m[3]) || 9,
    });
    expect(placed.x).toBe(20);
    expect(placed.y).toBe(40);
  });

  it('matches a page turned by 90 degrees', () => {
    const turned = [0, 2, -2, 0, 595, 0];
    const glyph = { str: 'x', transform: [1, 0, 0, 1, 40, 100], width: 8, height: 10 };
    const byHand = multiplyTransform(turned, glyph.transform);
    const placed = placeText(turned, glyph);
    expect(placed.x).toBeCloseTo(byHand[4], 5);
    expect(placed.y).toBeCloseTo(byHand[5], 5);
    expect(placed.height).toBeCloseTo(Math.hypot(byHand[2], byHand[3]), 5);
  });
});
