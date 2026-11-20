// Turns the loose pieces of text on a PDF page into printed rows.
// Pure code with no browser or PDF library in it, so it can be tested on its own.

/** One piece of text and where it sits on the page. y grows down the page; (x, y) is the start of the baseline. */
export interface PlacedText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Row {
  y: number;
  height: number;
  items: PlacedText[];
}

/** Columns in a table row are joined with this, the same way the server writes a CSV row as one line. */
export const COLUMN_BREAK = ' | ';

function clean(str: string): string {
  // Tabs, non-breaking spaces and the other odd spaces of Unicode become plain spaces.
  let out = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    const oddSpace =
      code === 0x09 || code === 0xa0 || (code >= 0x2000 && code <= 0x200b) || code === 0x202f || code === 0x3000;
    out += oddSpace ? ' ' : ch;
  }
  return out;
}

/**
 * Group text pieces by vertical position, one entry per printed row, top to bottom.
 * Inside a row the pieces run left to right. A wide gap is a new column; a small gap is a space.
 */
export function groupIntoRows(pieces: PlacedText[]): string[] {
  const items = pieces
    .map((p) => ({ ...p, str: clean(p.str) }))
    .filter((p) => p.str.trim() !== '' && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Row[] = [];
  for (const item of items) {
    const height = item.height > 0 ? item.height : 10;
    const last = rows[rows.length - 1];
    // Same row when the baselines are closer than half the smaller text height.
    if (last && Math.abs(item.y - last.y) <= Math.max(1.5, 0.5 * Math.min(height, last.height))) {
      last.items.push(item);
      last.y += (item.y - last.y) / last.items.length;
      last.height = Math.min(last.height, height);
    } else {
      rows.push({ y: item.y, height, items: [item] });
    }
  }

  return rows.map(rowText).filter((text) => text !== '');
}

function rowText(row: Row): string {
  const items = [...row.items].sort((a, b) => a.x - b.x);
  let text = '';
  let end = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const height = item.height > 0 ? item.height : row.height;
    const gap = item.x - end;
    // Reports printed in a fixed-width font pad their columns with runs of spaces.
    const piece = item.str.replace(/ {2,}/g, COLUMN_BREAK);
    if (text === '') {
      text = piece;
    } else if (gap > 0.75 * height) {
      text = text.trimEnd() + COLUMN_BREAK + piece.trimStart();
    } else if (gap > 0.15 * height || text.endsWith(' ') || piece.startsWith(' ')) {
      text = text.trimEnd() + ' ' + piece.trimStart();
    } else {
      text += piece;
    }
    end = Math.max(end, item.x + Math.max(0, item.width));
  }

  return text
    .split(COLUMN_BREAK)
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(COLUMN_BREAK);
}

/** How much real text a set of rows holds. Used to tell a page of text from a scan. */
export function countLetters(rows: string[]): number {
  return rows.join('').replace(/[\s|]/g, '').length;
}

/** Multiply two PDF transform matrices (six numbers each), the same way pdf.js does. */
export function multiplyTransform(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Put one pdf.js text item where it is seen on the page. The viewport transform and the item transform
 * are multiplied here so this file stays free of pdf.js (the scorer uses the same rule in Node).
 */
export function placeText(
  viewportTransform: number[],
  item: { str: string; transform: number[]; width: number; height: number },
): PlacedText {
  const m = multiplyTransform(viewportTransform, item.transform);
  return {
    str: item.str,
    x: m[4],
    y: m[5],
    width: item.width,
    height: Math.hypot(m[2], m[3]) || item.height,
  };
}
