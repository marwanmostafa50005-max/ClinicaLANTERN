// Makes the twins of task K05: one fictional history in three forms - the CSV, a PDF with text
// inside, and scan-style page pictures with no text inside. Fictional patients only.
//
//   node eval/twins.ts make <case csv> <out folder>     writes the text PDF and the scan
//                                                       pictures with headless Edge
//
// The printed form follows the measured form of tools\demo-files.mjs (18 November): the columns
// date, medicine, strength, form, quantity, repeats, directions, prescriber; dates printed the
// Australian way (day first); no cell wraps; the text PDF on A4 landscape pages; the scan
// pictures as large as an A4 sheet on its side (1754 by 1240); a heading that says the patient
// is fictional; at most 22 data rows on a page.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv, readCsvTable } from '../pipeline/csv.ts';

export const ROWS_PER_PAGE = 22;
export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const SCAN_WIDTH = 1754;   // A4 on its side at 150 dots per inch
export const SCAN_HEIGHT = 1240;

export interface TwinTable {
  patient: string;
  rows: string[][];               // eight cells per row, printed the Australian way
}

// Reads a case CSV into printed rows. Fact rows become one fact line.
export function readCaseTable(csvText: string): TwinTable {
  const parsed = parseCsv(csvText);
  const table = readCsvTable(csvText);
  const rows = table.rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) return { patient: 'Fictional patient', rows: [] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const cRef = col('patient_ref');
  const cSex = col('patient_sex');
  const cType = col('record_type');
  const cDate = col('dispense_date');
  const cMed = col('medicine');
  const cBrand = col('brand');
  const cStrength = col('strength');
  const cForm = col('form');
  const cQty = col('quantity');
  const cRep = col('repeats_left');
  const cDir = col('directions');
  const cPres = col('prescriber');
  const cDetail = col('detail');
  const cValue = col('value');
  const cell = (r: string[], i: number) => (i < 0 ? '' : (r[i] ?? '').trim());
  const auDate = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };

  const first = rows[1];
  const ref = cell(first, cRef) || 'Fictional patient';
  const age = typeof parsed.patient.age === 'number' ? String(parsed.patient.age) : '';
  const sex = cSex >= 0 ? cell(first, cSex) : '';
  const sexWord = sex === 'F' ? 'female' : sex === 'M' ? 'male' : sex;
  const patient = `${ref}${age ? `, age ${age}` : ''}${sexWord ? `, ${sexWord}` : ''}`;

  const out: string[][] = [];
  for (const r of rows.slice(1)) {
    const type = cell(r, cType).toLowerCase();
    if (type === 'condition' || type === 'result' || type === 'observation') {
      out.push([auDate(cell(r, cDate)), `${type.toUpperCase()}: ${cell(r, cDetail)} ${cell(r, cValue)}`.trim(), '', '', '', '', '', '']);
    } else {
      const brand = cell(r, cBrand);
      const med = cell(r, cMed);
      const medText = brand && med && brand !== med ? `${brand} (${med})` : brand || med;
      out.push([auDate(cell(r, cDate)), medText, cell(r, cStrength), cell(r, cForm), cell(r, cQty), cell(r, cRep), cell(r, cDir), cell(r, cPres)]);
    }
  }
  return { patient, rows: out };
}

export const HEADINGS = ['Date', 'Medicine', 'Strength', 'Form', 'Quantity', 'Repeats', 'Directions', 'Prescriber'];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tableHtml(t: TwinTable, slice: string[][], print: boolean): string {
  const head = HEADINGS.map((h) => `<th>${h}</th>`).join('');
  const body = slice.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n');
  const title = `Dispensing history - ${esc(t.patient)}`;
  const fictional = '<div class="fictional">Fictional patient. No real person.</div>';
  if (print) {
    return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font: 16px "Segoe UI", Arial, sans-serif; color: #111; }
  h1 { font-size: 15pt; margin: 0 0 3pt; }
  .fictional { color: #b42318; font-size: 10pt; margin-bottom: 8pt; }
  table { border-collapse: collapse; margin-top: 8pt; width: 100%; }
  th, td { padding: 2.5pt 9pt; text-align: left; white-space: nowrap; border-bottom: 0.5pt solid #999; }
  th { font-weight: 600; }
</style></head><body>
<h1>${title}</h1>
${fictional}
<table>
<thead><tr>${head}</tr></thead>
${body}
</table>
</body></html>`;
  }
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 22px "Segoe UI", Arial, sans-serif; color: #111; width: ${SCAN_WIDTH}px; height: ${SCAN_HEIGHT}px; overflow: hidden; margin: 0; padding: 24px 40px 0; box-sizing: border-box; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .fictional { color: #b42318; font-size: 16px; margin-bottom: 12px; }
  table { border-collapse: collapse; margin-top: 8px; width: 100%; }
  th, td { padding: 2px 12px; line-height: 19px; text-align: left; white-space: nowrap; border-bottom: 1px solid #aaa; }
</style></head><body>
<h1>${title}</h1>
${fictional}
<table>
<thead><tr>${head}</tr></thead>
${body}
</table>
</body></html>`;
}

export interface TwinPages {
  print: string[];    // one HTML string per A4 landscape page (text PDF)
  scan: string[];     // one HTML string per scan picture (1754 x 1240)
}

export function buildPages(t: TwinTable): TwinPages {
  const slices: string[][][] = [];
  for (let start = 0; start < t.rows.length; start += ROWS_PER_PAGE) slices.push(t.rows.slice(start, start + ROWS_PER_PAGE));
  return {
    print: slices.map((s) => tableHtml(t, s, true)),
    scan: slices.map((s) => tableHtml(t, s, false)),
  };
}

// The multi-page document that prints as the text PDF: one section per page, a page break after each.
export function mergedPrintHtml(pages: TwinPages): string {
  const bodies = pages.print.map((p) => {
    const m = p.match(/<body>([\s\S]*)<\/body>/);
    return `<section class="sheet">${m ? m[1] : ''}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 0; color: #111; }
  .sheet { page-break-after: always; padding: 14mm; }
  h1 { font-size: 15pt; margin: 0 0 3pt; }
  .fictional { color: #b42318; font-size: 10pt; margin-bottom: 8pt; }
  table { border-collapse: collapse; margin-top: 8pt; width: 100%; }
  th, td { padding: 2.5pt 9pt; text-align: left; white-space: nowrap; border-bottom: 0.5pt solid #999; }
  th { font-weight: 600; }
</style></head><body>${bodies.join('\n')}</body></html>`;
}

export async function waitForFile(file: string, atMostMs = 30000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      const st = fs.statSync(file);
      if (st.size > 0) return true;
    } catch { /* not there yet */ }
    if (Date.now() - start > atMostMs) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function edgeArgs(kind: 'pdf' | 'shot', input: string, output: string, tempDir: string): string[] {
  const base = ['--headless', '--disable-gpu', `--user-data-dir=${tempDir}`];
  const fileUrl = pathToFileURL(input).href;
  if (kind === 'pdf') return [...base, '--no-pdf-header-footer', `--print-to-pdf=${output}`, fileUrl];
  return [...base, `--window-size=${SCAN_WIDTH},${SCAN_HEIGHT}`, `--screenshot=${output}`, fileUrl];
}

// ---------- CLI ----------

async function main(): Promise<void> {
  const [, , cmd, csvFile, outArg] = process.argv;
  if (cmd !== 'make' || !csvFile || !outArg) {
    console.log('Use: node eval/twins.ts make <case csv> <out folder>');
    process.exit(2);
  }
  const outFolder = path.resolve(outArg);
  fs.mkdirSync(outFolder, { recursive: true });
  const t = readCaseTable(fs.readFileSync(csvFile, 'utf8'));
  const pages = buildPages(t);
  const merged = path.join(outFolder, 'all-pages.html');
  const textPdf = path.join(outFolder, 'text.pdf');
  fs.writeFileSync(merged, mergedPrintHtml(pages));
  const { spawnSync } = await import('node:child_process');
  // Edge writes a profile next to --user-data-dir; keep it out of the twins folder.
  const profileRoot = path.resolve('data/tmp/edge-profiles');
  fs.mkdirSync(profileRoot, { recursive: true });
  const run1 = spawnSync(EDGE, edgeArgs('pdf', merged, textPdf, path.join(profileRoot, `pdf-${path.basename(outFolder)}`)), { stdio: 'ignore' });
  if (run1.error) { console.error(run1.error.message); process.exit(1); }
  if (!(await waitForFile(textPdf))) { console.error(`no file: ${textPdf}`); process.exit(1); }
  console.log(`wrote ${textPdf}`);
  for (let i = 0; i < pages.scan.length; i++) {
    const html = path.join(outFolder, `scan-${i + 1}.html`);
    const png = path.join(outFolder, `scan-${i + 1}.png`);
    fs.writeFileSync(html, pages.scan[i]);
    const run = spawnSync(EDGE, edgeArgs('shot', html, png, path.join(profileRoot, `shot-${path.basename(outFolder)}-${i + 1}`)), { stdio: 'ignore' });
    if (run.error) { console.error(run.error.message); process.exit(1); }
    if (!(await waitForFile(png))) { console.error(`no file: ${png}`); process.exit(1); }
    console.log(`wrote ${png}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('twins.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
