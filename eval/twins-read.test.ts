// Tests for the twin read-back of task K05. No model. Fictional data only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPages, readCaseTable, mergedPrintHtml } from './twins.ts';
import { normalizeLineText, readTextPdfLines } from './twins-read.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A twin of one history is made in a temp folder when Edge is present; skipped otherwise.
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const hasEdge = fs.existsSync(EDGE);

describe('reading a text twin back', () => {
  it.skipIf(!hasEdge)('reads the printed rows the way the app does', async () => {
    const csvFile = path.join(REPO, 'cases', 'STOPP-C10', 'pos-brand.csv');
    const out = path.join(REPO, 'data', 'tmp', 'twins-read-test');
    fs.mkdirSync(out, { recursive: true });
    const t = readCaseTable(fs.readFileSync(csvFile, 'utf8'));
    const pages = buildPages(t);
    fs.writeFileSync(path.join(out, 'all-pages.html'), mergedPrintHtml(pages));
    // print just the text PDF with Edge
    const { spawnSync } = await import('node:child_process');
    const pdf = path.join(out, 'text.pdf');
    const run = spawnSync(EDGE, ['--headless', '--disable-gpu', `--user-data-dir=${path.join(out, '.edge')}`, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file:///${path.join(out, 'all-pages.html').split(path.sep).join('/')}`], { stdio: 'ignore' });
    expect(run.error).toBeUndefined();
    for (let i = 0; i < 60 && !fs.existsSync(pdf); i++) await new Promise((r) => setTimeout(r, 500));
    expect(fs.existsSync(pdf)).toBe(true);

    const { lines, problems } = await readTextPdfLines(pdf);
    expect(problems).toEqual([]);
    // every printed row comes back: header rows (one per page) plus the data rows
    const expectedRows = t.rows.length;
    expect(lines.length).toBeGreaterThanOrEqual(expectedRows);
    const all = lines.map((l) => normalizeLineText(l.text)).join(' | ');
    for (const needle of ['Mobic', 'Eliquis', 'Dr A. Example', 'Fictional patient. No real person.']) {
      expect(all, needle).toContain(needle);
    }
    // the planted medicine lines are among the read rows, dates printed day first (08/06/2026)
    const hasMobicRow = lines.some((l) => /\d{2}\/0[6789]\/2026/.test(normalizeLineText(l.text)) && normalizeLineText(l.text).includes('Mobic'));
    expect(hasMobicRow).toBe(true);
  }, 120000);
});

describe('normalizeLineText', () => {
  it('joins the spaces the PDF extractor leaves inside dates', () => {
    expect(normalizeLineText('2026- 01-08 | Mobic')).toBe('2026- 01-08 | Mobic');
    expect(normalizeLineText('Take  ONE\ttablet')).toBe('Take ONE tablet');
  });
});
