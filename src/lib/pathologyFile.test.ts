import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PathologyReadings } from '../components/PathologyUpload.tsx';
import type { ReadReading } from './pathologyAnswer.ts';
import { ensurePathologyWorker, pathologyRoutePages, planPathologyDocument } from './pdf.ts';
import {
  PAGE_NUMBERS_REFUSAL,
  pathologyBody,
  pathologyReadProgress,
  preparePathologyUpload,
  testNames,
  testsLine,
} from './pathologyFile.ts';

/** A text-only PDF, one page for each list of lines. No picture, so each page stays text. */
function textPdf(linesPerPage: string[][]): Uint8Array {
  const objects: (string | null)[] = [];
  const add = (body: string | null): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pages = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const lines of linesPerPage) {
    const stream = lines.map((line, i) => {
      const safe = line.replace(/[\\()]/g, (mark) => '\\' + mark);
      return `BT /F1 12 Tf 40 ${800 - i * 18} Td (${safe}) Tj ET`;
    }).join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

/** A copy the File constructor accepts. A Buffer's backing store is not a plain ArrayBuffer to the type checker. */
function fileFrom(name: string, bytes: Uint8Array, type: string): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}

const REPORT = 'Fictional laboratory report. Sodium 128 mmol/L (135-145) L. Collected 12 March 2026.';

describe('the names on the upload way', () => {
  it('joins one name, two names, and three names', () => {
    expect(testNames([{ name: 'Sodium' }])).toBe('Sodium');
    expect(testNames([{ name: 'ALT' }, { name: 'AST' }])).toBe('ALT and AST');
    expect(testNames([{ name: 'Sodium' }, { name: 'Potassium' }, { name: 'Creatinine' }])).toBe('Sodium, Potassium and Creatinine');
    expect(testsLine([{ name: 'Sodium' }])).toBe(
      'Tests the LANTERN can read from a report for this question: Sodium. path-O-finder reads the report for the LANTERN. It reads. It does not judge the result.',
    );
  });
});

describe('the file the upload way sends', () => {
  it('keeps the lines of a text PDF as pages', async () => {
    const file = fileFrom('fictional-report.pdf', textPdf([[REPORT], [REPORT]]), 'application/pdf');
    const seen: string[] = [];
    const body = await preparePathologyUpload(file, (text) => seen.push(text));
    expect(body.fileName).toBe('fictional-report.pdf');
    expect(body.pages).toHaveLength(2);
    expect(body.pages?.[0].join(' ')).toContain('Sodium 128 mmol/L');
    expect(body.pages?.[1].join(' ')).toContain('Collected 12 March 2026');
    expect(body.pageImages).toBeUndefined();
    expect(body.pageNumbers).toBeUndefined();
    expect(seen).toContain('Reading page 1 of 2');
    expect(seen).toContain('Reading page 2 of 2');
  });

  it('keeps a text PDF in its own pages when a blank page is left out', async () => {
    const file = fileFrom('fictional-report.pdf', textPdf([[REPORT], [], ['Collected 12 March 2026 only on page 3']]), 'application/pdf');
    const body = await preparePathologyUpload(file);
    expect(body.pages).toHaveLength(2);
    expect(body.pages?.[0].join(' ')).toContain('Sodium 128 mmol/L');
    expect(body.pages?.[0].join(' ')).not.toContain('only on page 3');
    expect(body.pages?.[1].join(' ')).toContain('only on page 3');
    expect(body.pages?.[1].join(' ')).not.toContain('Sodium 128');
    expect(body.pageImages).toBeUndefined();
    expect(body.pageNumbers).toEqual([1, 3]);
  });

  it('sends a picture as one page image', async () => {
    const file = fileFrom('fictional-page.png', ONE_PIXEL_PNG, 'image/png');
    const body = await preparePathologyUpload(file);
    expect(body.pages).toBeUndefined();
    expect(body.pageImages).toHaveLength(1);
    expect(body.pageImages?.[0].startsWith('iVBORw0KGgo')).toBe(true);
    expect(body.pageNumbers).toBeUndefined();
    const source = readFileSync(new URL('./pathologyFile.ts', import.meta.url), 'utf8');
    expect(source).toContain('return pdf.readPicture(file)');
    expect(source).toContain("typeof document !== 'undefined'");
  });

  it('refuses an empty file and a pathology test of more than 10 pages', async () => {
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    await expect(preparePathologyUpload(empty)).rejects.toThrow('This file is empty.');
    const long = fileFrom('long.pdf', textPdf(Array.from({ length: 11 }, () => [REPORT])), 'application/pdf');
    await expect(preparePathologyUpload(long)).rejects.toThrow(
      'The pathology test has more than 10 pages. Upload only the pages that hold the result.',
    );
  });

});

/** A picture PDF: a full-page image, then a page with nothing on it, then a full-page image. */
function picturePdfBlankSecond(): Uint8Array {
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
  const picture = `q 515 0 0 720 40 50 cm /Im1 Do Q\nBT /F1 12 Tf 40 800 Td (Sodium 128 mmol/L (135-145) L) Tj ET`;
  const content = add(`<< /Length ${picture.length} >>\nstream\n${picture}\nendstream`);
  const scan = `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${content} 0 R >>`;
  kids.push(add(scan), add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] >>`), add(scan));
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}

const LINE = 'Sodium 128 mmol/L (135-145) L';

describe('the page number the pharmacist sees', () => {
  it('shows page 3 for a result on the third page when the second page is blank', async () => {
    const plan = await planPathologyDocument(picturePdfBlankSecond());
    expect(plan.pages).toEqual([]);
    expect(plan.imagePages).toEqual([1, 3]);
    expect(plan.pageNumbers).toEqual([1, 3]);
    const body = pathologyBody('fictional-scan.pdf', plan.pages, ['picture-1', 'picture-3'], plan.pageNumbers);
    expect(body.pages).toBeUndefined();
    expect(body.pageImages).toEqual(['picture-1', 'picture-3']);
    expect(body.pageNumbers).toEqual([1, 3]);
    const resultPage = body.pageNumbers?.[1];
    expect(resultPage).toBe(3);
    const reading: ReadReading = {
      analyte: 'sodium', name: 'Sodium', value: 128, valueWords: '128', unit: 'mmol/L',
      refLow: 135, refHigh: 145, flag: 'L', date: '2026-03-12', line: LINE, page: resultPage ?? 0,
      sure: true, readBy: 'model',
    };
    const markup = renderToStaticMarkup(createElement(PathologyReadings, {
      fact: 'Serum sodium',
      readings: [reading],
      idPrefix: 'Q0009-read',
      dates: {},
      disabled: false,
      typingForm: null,
      onDate: () => undefined,
      onUse: () => undefined,
      onTypeMyself: () => undefined,
    }));
    expect(markup).toContain('Line of the report (page 3): &quot;Sodium 128 mmol/L (135-145) L&quot;');
    expect(markup).toContain('Read by: the reading model, twice, and both readings agreed');
  });

  it('does not send a picture page as text, and sends a later picture after the text pages', () => {
    const mixed = pathologyRoutePages([
      { page: 1, kind: 'text', rows: ['Sodium 128 mmol/L'] },
      { page: 2, kind: 'blank', rows: [] },
      { page: 3, kind: 'scan', rows: ['a stamp that is not sent as text'] },
    ]);
    expect(mixed.pages).toEqual([['Sodium 128 mmol/L']]);
    expect(mixed.imagePages).toEqual([3]);
    expect(mixed.pageNumbers).toEqual([1, 3]);
    const pictureFirst = pathologyRoutePages([
      { page: 1, kind: 'scan', rows: ['Sodium 128 mmol/L'] },
      { page: 2, kind: 'text', rows: ['Collected 12 March 2026'] },
    ]);
    expect(pictureFirst.pages).toEqual([]);
    expect(pictureFirst.imagePages).toEqual([1, 2]);
    expect(pictureFirst.pageNumbers).toEqual([1, 2]);
  });

  it('tells the pharmacist before a bad page list is sent, and names drawing as well as reading', () => {
    expect(() => pathologyBody('bad.pdf', [['a']], [], [1, 2])).toThrow(PAGE_NUMBERS_REFUSAL);
    expect(() => pathologyBody('bad.pdf', [['a'], ['b']], [], [2, 1])).toThrow(PAGE_NUMBERS_REFUSAL);
    expect(pathologyBody('ok.pdf', [['a'], ['b']], [], [1, 2]).pageNumbers).toBeUndefined();
    expect(pathologyReadProgress({ page: 2, pages: 3, doing: 'reading' })).toBe('Reading page 2 of 3');
    expect(pathologyReadProgress({ page: 3, pages: 3, doing: 'drawing' })).toBe('Getting page 3 of 3 ready as a picture');
  });

  it('sets the PDF worker address the browser requires, and leaves the one Node already set', () => {
    const browser = { workerSrc: '' };
    ensurePathologyWorker({ GlobalWorkerOptions: browser }, '/assets/pdf.worker.min.mjs');
    expect(browser.workerSrc).toBe('/assets/pdf.worker.min.mjs');
    const node = { workerSrc: './pdf.worker.mjs' };
    ensurePathologyWorker({ GlobalWorkerOptions: node }, '/assets/pdf.worker.min.mjs');
    expect(node.workerSrc).toBe('./pdf.worker.mjs');
  });
});
