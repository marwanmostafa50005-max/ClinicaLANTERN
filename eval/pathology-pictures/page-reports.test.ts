import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPathologyDocument } from '../../src/lib/pdf.ts';
import { analytesForFact, readPathology } from '../../pipeline/pathology.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('K-PATH-3 generated text report', () => {
  it('reads the text PDF with the page reader', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(here, 'page-reports', 'text-sodium.pdf')));
    const result = await readPathologyDocument(bytes);
    expect(result.pages.flat().join(' ')).toContain('Sodium 128 mmol/L');
  });

  it('keeps the overlong report line whole for the server to skip', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(here, 'page-reports', 'long-line.pdf')));
    const result = await readPathologyDocument(bytes);
    console.log('Long-line page rows:', result.pages[0].map(line => ({ length: line.length, start: line.slice(0, 80) })));
    expect(result.pages[0].some(line => line.length > 300)).toBe(true);
  });

  it('reads the START-H5 vitamin D result from its generated report without a model', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(here, 'page-reports', 'vitamin-d-report.pdf')));
    const document = await readPathologyDocument(bytes);
    const wanted = analytesForFact('25-hydroxyvitamin D (25-hydroxycolecalciferol) level');
    const result = readPathology(document.pages, wanted);
    expect(wanted).toEqual(['vitamin_d']);
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]).toMatchObject({
      value: 32,
      unit: 'nmol/L',
      refLow: 50,
      refHigh: 150,
      date: '2026-11-18'
    });
    expect(result.collected?.date).toBe('2026-11-18');
  });
});
