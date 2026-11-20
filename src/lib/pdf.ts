// Reads a PDF in the browser with pdf.js. Nothing leaves this computer.
//
// A page with text inside: the text is grouped into printed rows (no model needed).
// A page that is a picture (a scan): the page is drawn to a PNG picture for Model 1 to read.
// A page is a scan when pictures cover a good part of it, however much text lies over them:
// a scanned page often carries a fax header, a stamp or a thin layer of recognised text.
// If any page of a file is a scan, every page is sent as a picture, so no page is left out
// and the pharmacist checks all the rows together.
//
// This file is loaded only when a PDF is imported, to keep the first page load small.
import type { PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import pathologyWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import jbig2Url from 'pdfjs-dist/wasm/jbig2.wasm?url';
import openjpegUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url';
import { pageKind, pictureShare } from './pdfPictures.ts';
import { countLetters, groupIntoRows, placeText } from './pdfRows.ts';
import type { PlacedText } from './pdfRows.ts';

/** The most pages sent from one scan. The local server has the same limit. Each page takes the model about a minute. */
export const MAX_SCAN_PAGES = 30;

/** The most pages of one uploaded pathology test. The server has the same limit. */
export const MAX_PATHOLOGY_DOCUMENT_PAGES = 10;

/** A page with fewer letters than this, and any picture on it, is treated as a scan with a stamp on it. */
export const MIN_TEXT_LETTERS = 40;

/**
 * A scanned page is drawn at 150 dots per inch: an A4 page is 1240 by 1754 points upright and
 * 1754 by 1240 on its side. (Until 18 November a page on its side was drawn only 1240 wide, about
 * 106 dots per inch, and Model 1 then misread one date in 45 rows of the demo scan.)
 */
const TARGET_DOTS_PER_INCH = 150;
const PDF_UNITS_PER_INCH = 72;
const MAX_SIDE = 1800;

export interface PdfProgress {
  page: number;
  pages: number;
  doing: 'reading' | 'drawing';
}

export type PdfRead =
  | { kind: 'text'; rows: string[]; pages: number; blankPages: number[]; rowsOnPages: { page: number; rows: number }[] }
  | { kind: 'images'; pageImages: string[]; pages: number; blankPages: number[]; mixed: boolean };

/** A problem the pharmacist can understand. The message is shown as it is. */
export class PdfReadError extends Error {}

// pdf.js decodes some scan formats (JBIG2, JPEG 2000) with small helper files.
// They are bundled with the page and handed over from here, so no address outside this computer is used.
const HELPER_FILES: Record<string, string> = {
  'jbig2.wasm': jbig2Url,
  'openjpeg.wasm': openjpegUrl,
};

class BundledBinaryData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === 'wasmUrl' ? HELPER_FILES[filename] : undefined;
    if (!url) throw new Error(`Not bundled with the page: ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

type PageKind = 'text' | 'scan' | 'blank';

interface PageRead {
  kind: PageKind;
  rows: string[];
}

export async function readPdf(
  data: Uint8Array,
  onProgress: (progress: PdfProgress) => void = () => {},
): Promise<PdfRead> {
  // The small ready-made build: the same library, already made compact by its authors.
  const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;


  const task = pdfjs.getDocument({
    data,
    BinaryDataFactory: BundledBinaryData,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'PasswordException') {
        throw new PdfReadError('This PDF is locked with a password. Save a copy without the password, then import it.');
      }
      throw new PdfReadError('This file could not be read as a PDF.');
    }

    const pages = doc.numPages;
    const reads: PageRead[] = [];

    // First pass: read the text of every page and decide what each page is.
    for (let n = 1; n <= pages; n++) {
      onProgress({ page: n, pages, doing: 'reading' });
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const pieces: PlacedText[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        pieces.push(
          placeText(viewport.transform as number[], {
            str: item.str,
            transform: item.transform as number[],
            width: item.width,
            height: item.height,
          }),
        );
      }
      const rows = groupIntoRows(pieces);
      const letters = countLetters(rows);

      // The pictures are looked for on every page, not only on a page with little text.
      const ops = await page.getOperatorList();
      const share = pictureShare(ops.fnArray, ops.argsArray, pdfjs.OPS, viewport.width, viewport.height);
      const found = pageKind(letters, share, MIN_TEXT_LETTERS);
      let kind: PageKind;
      if (found !== 'unknown') kind = found;
      // No text and no picture: the page is blank unless something else is drawn on it.
      else kind = isBlank(await drawPage(page)) ? 'blank' : 'scan';
      reads.push({ kind, rows });
      page.cleanup();
    }

    const blankPages = reads.flatMap((read, i) => (read.kind === 'blank' ? [i + 1] : []));
    const scanPages = reads.filter((read) => read.kind === 'scan').length;
    const textPages = reads.filter((read) => read.kind === 'text').length;

    if (scanPages === 0) {
      const rowsOnPages = reads.flatMap((read, i) => (read.kind === 'blank' ? [] : [{ page: i + 1, rows: read.rows.length }]));
      return { kind: 'text', rows: reads.flatMap((read) => read.rows), pages, blankPages, rowsOnPages };
    }

    // Second pass: at least one page is a scan, so every page that is not blank becomes a picture.
    const toDraw = reads.flatMap((read, i) => (read.kind === 'blank' ? [] : [i + 1]));
    if (toDraw.length > MAX_SCAN_PAGES) {
      throw new PdfReadError(
        `This scan has ${toDraw.length} pages. The prototype reads up to ${MAX_SCAN_PAGES} pages from a scan. Split the file, or use a CSV.`,
      );
    }
    const pageImages: string[] = [];
    for (const n of toDraw) {
      onProgress({ page: n, pages, doing: 'drawing' });
      const page = await doc.getPage(n);
      const canvas = await drawPage(page);
      pageImages.push(canvasToPngBase64(canvas));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return { kind: 'images', pageImages, pages, blankPages, mixed: textPages > 0 };
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** One page of a pathology test, after the same text-or-picture decision a history PDF uses. */
export interface PathologyPageRead {
  /** The page's own number in the file, starting at 1. */
  page: number;
  kind: PageKind;
  rows: string[];
}

/**
 * The pages the pathology route is given. Blank pages are left out. A picture page is not also
 * sent as text. Text stays text when every picture comes after it, so the original numbers still
 * rise: the route takes text pages first, then pictures, and the numbers must keep rising.
 * A picture that sits before a later page of text cannot be numbered that way, so the whole
 * document is sent as pictures and the lines are not sent as well.
 */
export function pathologyRoutePages(reads: PathologyPageRead[]): {
  pages: string[][];
  imagePages: number[];
  pageNumbers: number[];
} {
  const content = reads.filter((read) => read.kind !== 'blank');
  const pictureBeforeText = content.some((read, index) =>
    read.kind === 'scan' && content.slice(index + 1).some((later) => later.kind === 'text'));
  if (pictureBeforeText) {
    const imagePages = content.map((read) => read.page);
    return { pages: [], imagePages, pageNumbers: imagePages };
  }
  const text = content.filter((read) => read.kind === 'text');
  const images = content.filter((read) => read.kind === 'scan');
  return {
    pages: text.map((read) => read.rows),
    imagePages: images.map((read) => read.page),
    pageNumbers: [...text.map((read) => read.page), ...images.map((read) => read.page)],
  };
}

/**
 * The browser refuses to open a PDF until a worker address is set. Node sets its own when the
 * library loads, and replacing that address makes the tests load the page's worker instead.
 */
export function ensurePathologyWorker(
  pdfjs: { GlobalWorkerOptions: { workerSrc: string } },
  bundledWorkerUrl: string,
): void {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = bundledWorkerUrl;
}

/** Operators that change state and leave no ink. Anything else may be a mark on the page. */
const QUIET_OPERATORS = [
  'save', 'restore', 'transform', 'setLineWidth', 'setLineCap', 'setLineJoin', 'setMiterLimit', 'setDash',
  'setRenderingIntent', 'setFlatness', 'setGState', 'setStrokeRGBColor', 'setFillRGBColor', 'setStrokeGray',
  'setFillGray', 'setStrokeColorN', 'setFillColorN', 'setStrokeColorSpace', 'setFillColorSpace',
  'beginText', 'endText', 'moveText', 'setLeadingMoveText', 'setLeading', 'setFont', 'setTextMatrix',
  'nextLine', 'setCharSpacing', 'setWordSpacing', 'setHScale', 'setTextRenderingMode', 'setTextRise',
];

function operatorPaints(fnArray: ArrayLike<number>, ops: Record<string, number>): boolean {
  const quiet = new Set<number>();
  for (const name of QUIET_OPERATORS) {
    const code = ops[name];
    if (typeof code === 'number') quiet.add(code);
  }
  for (let i = 0; i < fnArray.length; i++) {
    if (!quiet.has(fnArray[i])) return true;
  }
  return false;
}

interface LoadedPathology {
  task: { destroy(): Promise<void> };
  doc: { numPages: number; getPage(n: number): Promise<PDFPageProxy> };
  reads: PathologyPageRead[];
}

async function loadPathologyDocument(
  data: Uint8Array,
  onProgress: (progress: PdfProgress) => void,
): Promise<LoadedPathology> {
  // The legacy build runs on this thread, the same way the page's own PDF tests read a file.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist');
  ensurePathologyWorker(pdfjs, pathologyWorkerUrl);
  const task = pdfjs.getDocument({
    data,
    BinaryDataFactory: BundledBinaryData,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') {
      throw new PdfReadError('This PDF is locked with a password. Save a copy without the password, then import it.');
    }
    throw new PdfReadError('This file could not be read as a PDF.');
  }

  const pageCount = doc.numPages;
  if (pageCount > MAX_PATHOLOGY_DOCUMENT_PAGES) {
    await task.destroy().catch(() => {});
    throw new PdfReadError(
      `The pathology test has more than ${MAX_PATHOLOGY_DOCUMENT_PAGES} pages. Upload only the pages that hold the result.`,
    );
  }

  const reads: PathologyPageRead[] = [];
  try {
    for (let n = 1; n <= pageCount; n++) {
      onProgress({ page: n, pages: pageCount, doing: 'reading' });
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const pieces: PlacedText[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        pieces.push(
          placeText(viewport.transform as number[], {
            str: item.str,
            transform: item.transform as number[],
            width: item.width,
            height: item.height,
          }),
        );
      }
      const rows = groupIntoRows(pieces);
      const letters = countLetters(rows);
      const ops = await page.getOperatorList();
      const share = pictureShare(ops.fnArray, ops.argsArray, pdfjs.OPS, viewport.width, viewport.height);
      const found = pageKind(letters, share, MIN_TEXT_LETTERS);
      let kind: PageKind;
      if (found !== 'unknown') kind = found;
      else if (!operatorPaints(ops.fnArray, pdfjs.OPS as unknown as Record<string, number>)) kind = 'blank';
      else kind = isBlank(await drawPage(page)) ? 'blank' : 'scan';
      reads.push({ page: n, kind, rows });
      page.cleanup();
    }
  } catch (err) {
    await task.destroy().catch(() => {});
    throw err;
  }
  return { task, doc, reads };
}

/**
 * Reads an uploaded pathology test with the same row grouping and the same decision of what a page
 * is as a history PDF. A page with text keeps its lines. A page without text becomes one PNG.
 * A blank page is left out. Its number is kept in `pageNumbers`, with the text pages first.
 * Text pages stay text even when a later page of the same file is a picture.
 */
export async function planPathologyDocument(
  data: Uint8Array,
  onProgress: (progress: PdfProgress) => void = () => {},
): Promise<{ pages: string[][]; imagePages: number[]; pageNumbers: number[] }> {
  const loaded = await loadPathologyDocument(data, onProgress);
  try {
    return pathologyRoutePages(loaded.reads);
  } finally {
    await loaded.task.destroy().catch(() => {});
  }
}

/**
 * The same reading as `planPathologyDocument`, with each picture page drawn to a PNG.
 */
export async function readPathologyDocument(
  data: Uint8Array,
  onProgress: (progress: PdfProgress) => void = () => {},
): Promise<{ pages: string[][]; pageImages: string[]; pageNumbers: number[] }> {
  const loaded = await loadPathologyDocument(data, onProgress);
  try {
    const route = pathologyRoutePages(loaded.reads);
    const pageImages: string[] = [];
    for (const n of route.imagePages) {
      onProgress({ page: n, pages: loaded.doc.numPages, doing: 'drawing' });
      const page = await loaded.doc.getPage(n);
      const canvas = await drawPage(page);
      pageImages.push(canvasToPngBase64(canvas));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return { pages: route.pages, pageImages, pageNumbers: route.pageNumbers };
  } finally {
    await loaded.task.destroy().catch(() => {});
  }
}

async function drawPage(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(TARGET_DOTS_PER_INCH / PDF_UNITS_PER_INCH, MAX_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** True when every sampled pixel is white: nothing was drawn on the page. */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Every third pixel is enough to find a line of print.
  for (let i = 0; i < data.length; i += 12) {
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
  }
  return true;
}

/** The contract asks for base64 PNG with no "data:" prefix. */
export function canvasToPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** A photo or picture file (PNG or JPEG) of a printed history, drawn to one PNG page. */
export async function readPicture(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PdfReadError('This picture could not be opened.');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PdfReadError('This picture could not be opened.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = canvasToPngBase64(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return png;
}
