// Turns the pathology test the pharmacist chose into the body the server expects.
// A PDF is read by src/lib/pdf.ts, the same way a history PDF is read: each page that has text
// keeps its lines, and a page without text becomes one PNG. A picture file becomes one PNG.
import type { PathologyReading } from '../../pipeline/pathology.ts';
import { MAX_FILE_BYTES, sniffKind } from './importFile.ts';

/** What was read from one uploaded pathology test. Nothing is written until the pharmacist confirms. */
export interface PathologyResponse {
  fact: string;
  tests: { key: string; name: string }[];
  readings: (PathologyReading & { readBy: 'text' | 'model' })[];
  abstained: string[];
  collected?: { date: string; line: string };
  dateNote?: string;
  note?: string;
}

/** The body of POST .../pathology. */
export interface PathologyUploadRequest {
  fileName: string;
  pages?: string[][];
  pageImages?: string[];
  /**
   * The original page number of every page sent, text pages first, then pictures.
   * Sent only when a page was left out or the pages are not 1, 2, 3 of the file.
   */
  pageNumbers?: number[];
}

/** The route's own words when the page list is not one rising number per supplied page. */
export const PAGE_NUMBERS_REFUSAL =
  'The page numbers must give one whole number of at least 1 for each supplied page, in strictly rising order.';

/** What the pharmacist sees while a page is read or drawn. The same words a history PDF uses. */
export function pathologyReadProgress(progress: { page: number; pages: number; doing: 'reading' | 'drawing' }): string {
  return progress.doing === 'drawing'
    ? `Getting page ${progress.page} of ${progress.pages} ready as a picture`
    : `Reading page ${progress.page} of ${progress.pages}`;
}

/**
 * The body the route takes. Page numbers are sent when they are not simply 1, 2, 3 of the file.
 * A list that the route would refuse is refused here, before anything is sent.
 */
export function pathologyBody(
  fileName: string,
  pages: string[][],
  pageImages: string[],
  pageNumbers: number[],
): PathologyUploadRequest {
  const count = pages.length + pageImages.length;
  const rising = pageNumbers.length === count && pageNumbers.every((page, index) =>
    Number.isSafeInteger(page) && page >= 1 && (index === 0 || page > pageNumbers[index - 1]));
  if (!rising) throw new PathologyFileError(PAGE_NUMBERS_REFUSAL);
  const body: PathologyUploadRequest = { fileName };
  if (pages.length > 0) body.pages = pages;
  if (pageImages.length > 0) body.pageImages = pageImages;
  const sequential = pageNumbers.every((page, index) => page === index + 1);
  if (!sequential) body.pageNumbers = pageNumbers;
  return body;
}

/** A problem the pharmacist can understand. The message is shown as it is. */
export class PathologyFileError extends Error {}

/** The line under the path-O-finder mark, word for word. */
export const PATHOLOGY_SLOGAN = 'Every result finds its path, and every path is one a pharmacist chose.';

/** Replaces the last two sentences of the tests line. */
export const PATHOLOGY_READS =
  'path-O-finder reads the report for the LANTERN. It reads. It does not judge the result.';

/** "Sodium", "ALT and AST", or "Sodium, Potassium and Creatinine". */
export function testNames(tests: { name: string }[]): string {
  const names = tests.map((test) => test.name).filter((name) => name !== '');
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The one line under the upload way. */
export function testsLine(tests: { name: string }[]): string {
  return `Tests the LANTERN can read from a report for this question: ${testNames(tests)}. ${PATHOLOGY_READS}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * One picture becomes the PNG the server takes. In the browser it is drawn the way a history
 * photo is drawn. The test runner has no canvas, so a PNG file is already that picture.
 */
async function picturePng(file: File, bytes: Uint8Array): Promise<string> {
  if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
    const pdf = await import('./pdf.ts');
    return pdf.readPicture(file);
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return bytesToBase64(bytes);
  }
  throw new PathologyFileError('This picture could not be opened.');
}

/**
 * The file the pharmacist chose, as the pathology route takes it.
 * `onProgress` is given "Reading page 1 of 2" while the file is read.
 */
export async function preparePathologyUpload(
  file: File,
  onProgress: (text: string) => void = () => {},
): Promise<PathologyUploadRequest> {
  if (file.size === 0) throw new PathologyFileError('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new PathologyFileError('This file is larger than 40 MB. Use a smaller file.');

  onProgress('Opening the file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(file.name, bytes);

  if (kind === 'picture') {
    onProgress('Reading page 1 of 1');
    return { fileName: file.name, pageImages: [await picturePng(file, bytes)] };
  }
  if (kind !== 'pdf') {
    throw new PathologyFileError('This kind of file cannot be read. Use a PDF or a picture (PNG or JPEG).');
  }

  const pdf = await import('./pdf.ts');
  try {
    const read = await pdf.readPathologyDocument(bytes, (progress) => {
      onProgress(pathologyReadProgress(progress));
    });
    if (read.pages.length + read.pageImages.length === 0) {
      throw new PathologyFileError('The pathology test is empty.');
    }
    return pathologyBody(file.name, read.pages, read.pageImages, read.pageNumbers);
  } catch (err) {
    if (err instanceof PathologyFileError) throw err;
    if (err instanceof pdf.PdfReadError) throw new PathologyFileError(err.message);
    throw new PathologyFileError('This file could not be read. Try another PDF or a picture.');
  }
}
