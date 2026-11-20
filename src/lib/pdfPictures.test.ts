import { describe, expect, it } from 'vitest';
import { countLetters, groupIntoRows } from './pdfRows.ts';
import type { PlacedText } from './pdfRows.ts';
import { pageKind, pictureShare, SCAN_PICTURE_SHARE } from './pdfPictures.ts';
import type { PictureOps } from './pdfPictures.ts';

const MIN_TEXT_LETTERS = 40;

// ---------- with hand-made drawing steps ----------

const OPS: Required<PictureOps> = {
  save: 1, restore: 2, transform: 3, paintFormXObjectBegin: 4, paintFormXObjectEnd: 5,
  paintImageXObject: 6, paintInlineImageXObject: 7, paintImageMaskXObject: 8, paintSolidColorImageMask: 9,
  paintImageXObjectRepeat: 10, paintInlineImageXObjectGroup: 11, paintImageMaskXObjectGroup: 12, paintImageMaskXObjectRepeat: 13,
};
const A4 = { w: 595, h: 842 };

function share(steps: [number, unknown?][]): number {
  return pictureShare(steps.map((s) => s[0]), steps.map((s) => s[1] ?? null), OPS, A4.w, A4.h);
}

describe('how much of a page pictures cover', () => {
  it('is nothing for a page with no picture', () => {
    expect(share([[OPS.save], [OPS.transform, [1, 0, 0, 1, 0, 0]], [OPS.restore]])).toBe(0);
  });

  it('is about the whole page for a full-page scan', () => {
    expect(share([[OPS.save], [OPS.transform, [595, 0, 0, 842, 0, 0]], [OPS.paintImageXObject, ['img', 1754, 1240]], [OPS.restore]])).toBeCloseTo(1, 5);
  });

  it('is small for a logo', () => {
    const logo = share([[OPS.save], [OPS.transform, [150, 0, 0, 60, 40, 760]], [OPS.paintImageXObject, ['logo', 300, 120]], [OPS.restore]]);
    expect(logo).toBeLessThan(0.03);
    expect(logo).toBeGreaterThan(0);
  });

  it('adds up a scan that is stored as strips, and follows transforms inside one another', () => {
    const strips: [number, unknown?][] = [];
    for (let i = 0; i < 10; i++) {
      strips.push([OPS.save], [OPS.transform, [595, 0, 0, 84.2, 0, i * 84.2]], [OPS.paintImageXObject, ['strip', 1240, 175]], [OPS.restore]);
    }
    expect(share(strips)).toBeCloseTo(1, 5);
    // A picture inside a form that is itself scaled, and a transform that is undone by restore.
    const nested = share([
      [OPS.save], [OPS.transform, [0.5, 0, 0, 0.5, 0, 0]],
      [OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0], [0, 0, 595, 842]]],
      [OPS.transform, [595, 0, 0, 842, 0, 0]], [OPS.paintImageXObject, ['img', 10, 10]],
      [OPS.paintFormXObjectEnd], [OPS.restore],
      [OPS.transform, [10, 0, 0, 10, 0, 0]], [OPS.paintInlineImageXObject, [{}]],
    ]);
    expect(nested).toBeCloseTo(1 + 100 / (595 * 842), 5);
  });

  it('counts a picture whose size cannot be told as the whole page: when in doubt, a scan', () => {
    expect(share([[OPS.paintImageXObjectRepeat, ['img', 1, 1, [0, 0]]]])).toBe(Number.POSITIVE_INFINITY);
    expect(share([[OPS.paintImageMaskXObjectGroup, [[]]]])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('what a page of a PDF is', () => {
  it('is a scan when pictures cover a good part of it, however much text lies over them', () => {
    // The defect of 18 November: a scan with a fax header of 40 letters or more was read as text.
    expect(pageKind(92, 0.74, MIN_TEXT_LETTERS)).toBe('scan');
    expect(pageKind(4000, 1, MIN_TEXT_LETTERS)).toBe('scan');           // a scan with a full layer of recognised text
    expect(pageKind(9, 0.74, MIN_TEXT_LETTERS)).toBe('scan');
    expect(pageKind(0, SCAN_PICTURE_SHARE, MIN_TEXT_LETTERS)).toBe('scan');
  });

  it('is text when it holds real text and no picture, or only a small one such as a logo', () => {
    expect(pageKind(2000, 0, MIN_TEXT_LETTERS)).toBe('text');
    expect(pageKind(2000, 0.02, MIN_TEXT_LETTERS)).toBe('text');
    expect(pageKind(12, 0, MIN_TEXT_LETTERS)).toBe('text');
  });

  it('is a scan when it holds hardly any text and any picture at all', () => {
    expect(pageKind(12, 0.01, MIN_TEXT_LETTERS)).toBe('scan');
  });

  it('is not known when there is neither text nor a picture: the page is then drawn and looked at', () => {
    expect(pageKind(0, 0, MIN_TEXT_LETTERS)).toBe('unknown');
  });
});

// ---------- with real PDF files, read by the PDF library the page uses ----------

/** A small PDF written by hand: on every page one large picture (the scanned table) and one line of real text over it. */
function scanWithHeaderPdf(headers: string[], picture: { w: number; h: number; x: number; y: number } = { w: 515, h: 720, x: 40, y: 50 }): Uint8Array {
  const objects: (string | null)[] = [];
  const add = (body: string | null): number => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pages = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const w = 64;
  const h = 90;
  const pixels = Buffer.alloc(w * h, 0xff);
  for (let y = 8; y < h - 4; y += 4) for (let x = 4; x < w - 4; x++) pixels[y * w + x] = 0x30;
  const hex = pixels.toString('hex').toUpperCase() + '>';
  const image = add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length} >>\nstream\n${hex}\nendstream`);
  const kids: number[] = [];
  for (const header of headers) {
    const safe = header.replace(/[\\()]/g, (m) => '\\' + m);
    const stream = `q ${picture.w} 0 0 ${picture.h} ${picture.x} ${picture.y} cm /Im1 Do Q\nBT /F1 9 Tf 40 812 Td (${safe}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** Reads each page the way src/lib/pdf.ts does: its letters, the share covered by pictures, and what it is. */
async function kindsOf(data: Uint8Array): Promise<{ letters: number; share: number; kind: string }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  const out: { letters: number; share: number; kind: string }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces: PlacedText[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const m = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
      pieces.push({ str: item.str, x: m[4], y: m[5], width: item.width, height: Math.hypot(m[2], m[3]) || item.height });
    }
    const letters = countLetters(groupIntoRows(pieces));
    const ops = await page.getOperatorList();
    const share = pictureShare(ops.fnArray, ops.argsArray, pdfjs.OPS, viewport.width, viewport.height);
    out.push({ letters, share, kind: pageKind(letters, share, MIN_TEXT_LETTERS) });
  }
  await task.destroy();
  return out;
}

describe('real PDF files', () => {
  const FAX = [
    'Fax from Example Community Pharmacy (fictional) 18/11/2026 09:12 Dispensing history F-001 Page 1 of 2',
    'Fax from Example Community Pharmacy (fictional) 18/11/2026 09:12 Dispensing history F-001 Page 2 of 2',
  ];

  it('takes a scan with a fax header of 40 letters or more on each page as a scan, not as text', async () => {
    const pages = await kindsOf(scanWithHeaderPdf(FAX));
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page.letters).toBeGreaterThanOrEqual(MIN_TEXT_LETTERS);     // before the fix this alone made it "text"
      expect(page.share).toBeGreaterThan(0.7);
      expect(page.kind).toBe('scan');
    }
  });

  it('still takes a scan with a short stamp as a scan', async () => {
    const pages = await kindsOf(scanWithHeaderPdf(['Page 1 of 2', 'Page 2 of 2']));
    expect(pages.map((p) => p.kind)).toEqual(['scan', 'scan']);
  });

  it('takes a page of text with a small logo as text', async () => {
    const pages = await kindsOf(scanWithHeaderPdf([FAX[0]], { w: 120, h: 50, x: 40, y: 760 }));
    expect(pages[0].share).toBeLessThan(0.05);
    expect(pages[0].kind).toBe('text');
  });
});
