import { describe, expect, it } from 'vitest';
import { ImportError, MAX_REQUEST_BYTES, checkSize, decodeText, prepareImport, requestBytes, sniffKind, thinPageWarnings } from './importFile.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
/** The micro sign, as in "100 micrograms". */
const MICRO = String.fromCharCode(0xb5);

describe('a PDF read as text: the second net', () => {
  it('asks for a look when a page gave only one or two rows', () => {
    expect(thinPageWarnings([{ page: 1, rows: 24 }, { page: 2, rows: 1 }, { page: 3, rows: 2 }])).toEqual([
      'Page 2 gave only 1 row. If that page holds more supplies, they were not read. Open the lines of this history and compare them with the file.',
      'Page 3 gave only 2 rows. If that page holds more supplies, they were not read. Open the lines of this history and compare them with the file.',
    ]);
  });

  it('says nothing when every page gave a table of rows', () => {
    expect(thinPageWarnings([{ page: 1, rows: 27 }, { page: 2, rows: 23 }])).toEqual([]);
  });

  it('gives a CSV import no warnings', async () => {
    const file = new File(['patient_ref,dispense_date,brand\nF-001,2026-08-21,Celebrex\n'], 'history.csv');
    expect((await prepareImport(file)).warnings).toEqual([]);
  });
});

describe('sniffKind', () => {
  it('knows a PDF by its first bytes, whatever its name', () => {
    expect(sniffKind('history.pdf', bytes('%PDF-1.7\n'))).toBe('pdf');
    expect(sniffKind('history.csv', bytes('%PDF-1.4\n'))).toBe('pdf');
    expect(sniffKind('history', bytes('\n\n%PDF-1.4\n'))).toBe('pdf');
  });

  it('knows a picture by its first bytes', () => {
    expect(sniffKind('photo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('picture');
    expect(sniffKind('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('picture');
  });

  it('treats text as CSV', () => {
    expect(sniffKind('history.csv', bytes('patient_ref,dispense_date\n'))).toBe('csv');
    expect(sniffKind('export.txt', bytes('a,b\n'))).toBe('csv');
    expect(sniffKind('export', bytes('a,b\n'))).toBe('csv');
  });

  it('refuses spreadsheets and other files that are not text', () => {
    expect(sniffKind('history.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('unknown');
    expect(sniffKind('history.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toBe('unknown');
    expect(sniffKind('history.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('unknown');
    expect(sniffKind('mystery', new Uint8Array([1, 2, 0, 4]))).toBe('unknown');
  });
});

describe('decodeText', () => {
  it('reads UTF-8, with or without its mark at the start', () => {
    expect(decodeText(bytes(`100 ${MICRO}g`))).toBe(`100 ${MICRO}g`);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  it('reads Windows Western text when the file is not UTF-8', () => {
    // A dose in micrograms saved by an older program: there the micro sign is the single byte B5.
    expect(decodeText(new Uint8Array([0x31, 0x30, 0x30, 0x20, 0xb5, 0x67]))).toBe(`100 ${MICRO}g`);
  });

  it('reads UTF-16 as spreadsheets save it', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]))).toBe('a,b');
  });
});

describe('the size of what is sent', () => {
  it('lets an ordinary history and an ordinary scan through', () => {
    expect(() => checkSize({ fileName: 'a.csv', source: 'csv', csvText: 'x'.repeat(200_000) })).not.toThrow();
    expect(() => checkSize({ fileName: 'a.pdf', source: 'pdf-image', pageImages: ['x'.repeat(3_000_000), 'y'.repeat(3_000_000)] })).not.toThrow();
  });

  it('refuses pictures that are too large together, and says what to do', () => {
    const page = 'x'.repeat(4_000_000);
    const request = { fileName: 'big.pdf', source: 'pdf-image' as const, pageImages: Array.from({ length: 10 }, () => page) };
    expect(requestBytes(request)).toBeGreaterThan(MAX_REQUEST_BYTES);
    expect(() => checkSize(request)).toThrow(ImportError);
    expect(() => checkSize(request)).toThrow('Split the scan into smaller files, or use a CSV file.');
  });
});

describe('prepareImport', () => {
  it('sends a CSV as text', async () => {
    const csv = 'patient_ref,dispense_date,medicine\nFICT-1,2026-08-21,celecoxib\n';
    const prepared = await prepareImport(new File([csv], 'fictional.csv', { type: 'text/csv' }));
    expect(prepared.request).toEqual({ fileName: 'fictional.csv', source: 'csv', csvText: csv });
    expect(prepared.notes).toEqual([]);
    expect(prepared.previews).toEqual([]);
  });

  it('refuses an empty file and a spreadsheet in plain words', async () => {
    await expect(prepareImport(new File([], 'empty.csv'))).rejects.toThrow('This file is empty.');
    await expect(prepareImport(new File(['   \n'], 'blank.csv'))).rejects.toThrow('This file is empty.');
    const xlsx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])], 'history.xlsx');
    await expect(prepareImport(xlsx)).rejects.toBeInstanceOf(ImportError);
    await expect(prepareImport(xlsx)).rejects.toThrow('A spreadsheet or Word file cannot be read. Use a CSV file or a PDF.');
  });
});
