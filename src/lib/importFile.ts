// Turns the file the pharmacist chose into the request the server expects.
//   CSV  -> csvText, as text
//   PDF with text inside -> rows, one entry per printed row
//   PDF without text, or a photo -> pageImages, one PNG per page, for Model 1 to read
import type { ImportRequest } from '../../shared/types.ts';
import { plural } from './format.ts';
import { JOB_NAMES } from './modelNames.ts';

/** Files larger than this are refused before anything is read. */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** The local server takes at most 40 MB in one request. The page stops a little before that. */
export const MAX_REQUEST_BYTES = 38 * 1024 * 1024;

/** Roughly how many bytes the request will be when it is sent. */
export function requestBytes(request: ImportRequest): number {
  let size = (request.csvText ?? '').length + request.fileName.length + 200;
  for (const row of request.rows ?? []) size += row.length + 4;
  for (const page of request.pageImages ?? []) size += page.length + 4;
  return size;
}

/** Refuses a request the server would not take, in words that say what to do. */
export function checkSize(request: ImportRequest): void {
  if (requestBytes(request) <= MAX_REQUEST_BYTES) return;
  throw new ImportError(
    request.source === 'pdf-image'
      ? 'The pictures of these pages are too large to send together. Split the scan into smaller files, or use a CSV file.'
      : 'This history is too large to send. Split it into smaller files.',
  );
}

export interface PreparedImport {
  request: ImportRequest;
  /** Plain sentences for the pharmacist about what was read. */
  notes: string[];
  /** Things the pharmacist should look at: for example a page that gave only one or two rows. */
  warnings: string[];
  /** Pictures of the pages that were sent (data addresses), kept in this tab so the rows can be checked against them. */
  previews: string[];
}

/** A problem the pharmacist can understand. The message is shown as it is. */
export class ImportError extends Error {}

export type FileKind = 'csv' | 'pdf' | 'picture' | 'unknown';

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, i) => bytes[i] === value);
}

/** Decide what a file is from its first bytes, then from its name. */
export function sniffKind(name: string, head: Uint8Array): FileKind {
  const lower = name.toLowerCase();
  // "%PDF" may come after a few stray bytes.
  const text = Array.from(head.subarray(0, 1024), (b) => String.fromCharCode(b)).join('');
  if (text.includes('%PDF-')) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'picture';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'picture';
  // Spreadsheets and Word files are zip files or old Office files. They are not CSV.
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) return 'unknown';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g)$/.test(lower)) return 'picture';
  if (/\.(csv|txt|tsv)$/.test(lower)) return 'csv';
  // No known ending: treat readable text as CSV.
  return head.subarray(0, 512).includes(0) ? 'unknown' : 'csv';
}

/** Read text the way spreadsheet programs save it: UTF-8 first, then UTF-16, then Windows Western. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function pageList(pages: number[]): string {
  if (pages.length === 1) return `Page ${pages[0]} is blank and was left out.`;
  return `Pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]} are blank and were left out.`;
}

/**
 * A second net for a PDF read as text: a page that gave only one or two rows may hold a table the
 * page could not read (a picture, or text in a form it does not know). The pharmacist is asked to look.
 */
export function thinPageWarnings(rowsOnPages: { page: number; rows: number }[]): string[] {
  return rowsOnPages
    .filter((p) => p.rows <= 2)
    .map((p) =>
      `Page ${p.page} gave only ${p.rows === 0 ? 'no rows' : plural(p.rows, 'row', 'rows')}. ` +
      'If that page holds more supplies, they were not read. Open the lines of this history and compare them with the file.');
}

export async function prepareImport(
  file: File,
  onProgress: (text: string) => void = () => {},
): Promise<PreparedImport> {
  const prepared = await readForImport(file, onProgress);
  checkSize(prepared.request);
  return prepared;
}

async function readForImport(file: File, onProgress: (text: string) => void): Promise<PreparedImport> {
  if (file.size === 0) throw new ImportError('This file is empty.');
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError('This file is larger than 40 MB. Use a smaller file.');
  }

  onProgress('Opening the file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(file.name, bytes);

  if (kind === 'unknown') {
    const lower = file.name.toLowerCase();
    if (/\.(xlsx?|docx?|doc)$/.test(lower)) {
      throw new ImportError('A spreadsheet or Word file cannot be read. Use a CSV file or a PDF.');
    }
    throw new ImportError('This kind of file cannot be read. Use a CSV file or a PDF.');
  }

  if (kind === 'csv') {
    const csvText = decodeText(bytes);
    if (csvText.trim() === '') throw new ImportError('This file is empty.');
    return { request: { fileName: file.name, source: 'csv', csvText }, notes: [], warnings: [], previews: [] };
  }

  // The PDF reader is large, so it is loaded only now.
  const pdf = await import('./pdf.ts');

  try {
    if (kind === 'picture') {
      onProgress('Getting the picture ready');
      const png = await pdf.readPicture(file);
      return {
        request: { fileName: file.name, source: 'pdf-image', pageImages: [png] },
        notes: [`This is a picture. ${JOB_NAMES.screen} will read the rows from it. You will be asked to check the rows.`],
        warnings: [],
        previews: [`data:image/png;base64,${png}`],
      };
    }

    const read = await pdf.readPdf(bytes, (p) =>
      onProgress(
        p.doing === 'reading'
          ? `Reading page ${p.page} of ${p.pages}`
          : `Getting page ${p.page} of ${p.pages} ready as a picture`,
      ),
    );

    const notes: string[] = [];
    if (read.blankPages.length > 0) notes.push(pageList(read.blankPages));

    if (read.kind === 'text') {
      const textPages = read.pages - read.blankPages.length;
      notes.unshift(`${plural(read.rows.length, 'row', 'rows')} read from ${plural(textPages, 'page', 'pages')} of text.`);
      return { request: { fileName: file.name, source: 'pdf-text', rows: read.rows }, notes, warnings: thinPageWarnings(read.rowsOnPages), previews: [] };
    }

    notes.unshift(
      read.mixed
        ? `Some pages are pictures, so every page was sent as a picture. ${JOB_NAMES.screen} will read the rows. You will be asked to check them.`
        : `This PDF is a scan: its pages are pictures. ${JOB_NAMES.screen} will read the rows from the pictures. You will be asked to check them.`,
    );
    return {
      request: { fileName: file.name, source: 'pdf-image', pageImages: read.pageImages },
      notes,
      warnings: [],
      previews: read.pageImages.map((png) => `data:image/png;base64,${png}`),
    };
  } catch (err) {
    if (err instanceof pdf.PdfReadError) throw new ImportError(err.message);
    throw new ImportError('This file could not be read. Try a CSV file or another PDF.');
  }
}
