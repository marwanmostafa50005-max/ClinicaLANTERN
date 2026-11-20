// The sample files for the PDF routes, made from cases/_demo/positive.csv, and the checks on them.
// Fictional patient only. No real person.
//
//   node tools/demo-files.mjs make            writes, with headless Edge:
//                                               cases/_demo/positive.pdf       a PDF with text inside, two A4 pages
//                                               cases/_demo/positive-scan.png  a picture of the same table
//                                               cases/_demo/positive-scan.pdf  a PDF of two pages that are pictures
//                                                                              with no text, as a scanner makes them
//                                             To make only some of them: make pdf | make png | make scan-pdf
//   node tools/demo-files.mjs check-pdf       reads positive.pdf with the page's own row code (src/lib/pdfRows.ts)
//                                             and compares the rows with the CSV. No model is called.
//   node tools/demo-files.mjs check-scan      has Model 1 read positive-scan.png (pipeline transcribePageImage)
//                                             and compares the rows with the CSV. Ollama must be running.
//                                             Wait until the app server is idle first: there is one GPU.
//   node tools/demo-files.mjs check-scan-pdf  checks that every page of positive-scan.pdf is a picture with no
//                                             text, so the page will treat it as a scan. No model is called.
//
// The pictures are drawn by a computer. They are clean. They are not real scans of paper.
// Importing this file does not start Edge and does not call a model. Those run only when this file is the one that was started.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { edgePdf, edgePicture, pngSize, removeFolder, ROOT } from './edge.mjs';

const DEMO = path.join(ROOT, 'cases', '_demo');
const CSV = path.join(DEMO, 'positive.csv');
const PDF = path.join(DEMO, 'positive.pdf');
const PNG = path.join(DEMO, 'positive-scan.png');
const SCAN_PDF = path.join(DEMO, 'positive-scan.pdf');
const HEADINGS = ['Date', 'Medicine', 'Strength', 'Form', 'Qty', 'Repeats', 'Directions', 'Prescriber'];
const SCAN_WIDTH = 1754;       // A4 on its side at 150 dots per inch
const SCAN_HEIGHT = 1240;

const command = process.argv[2] ?? '';
const say = text => console.log(text);

/** The supplies of the demo history as they are printed: one list of eight cells for each row. */
export async function printedRows() {
  const { readCsvTable } = await import('../pipeline/csv.ts');
  const table = readCsvTable(fs.readFileSync(CSV, 'utf8')).rows.filter(r => r.some(cell => cell.trim() !== ''));
  const at = name => table[0].indexOf(name);
  const col = Object.fromEntries(
    ['patient_ref', 'patient_age', 'patient_sex', 'dispense_date', 'medicine', 'brand', 'strength', 'form', 'quantity', 'repeats_left', 'directions', 'prescriber']
      .map(name => [name, at(name)]));
  const rows = table.slice(1).map(r => {
    const [year, month, day] = r[col.dispense_date].split('-');
    const brand = r[col.brand].trim();
    const medicine = r[col.medicine].trim();
    return [
      `${day}/${month}/${year}`,                                   // printed the Australian way, day first
      brand && medicine ? `${brand} (${medicine})` : brand || medicine,
      r[col.strength], r[col.form], r[col.quantity], r[col.repeats_left], r[col.directions], r[col.prescriber]
    ].map(cell => cell.trim());
  });
  const first = table[1];
  return { rows, patient: { ref: first[col.patient_ref], age: first[col.patient_age], sex: first[col.patient_sex] === 'F' ? 'Female' : first[col.patient_sex] } };
}

const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One page of a scanned PDF: a picture of part of the table, as large as an A4 sheet on its side. */
export function scanPageHtml(rows, patient, pageNumber, pageCount) {
  const head = HEADINGS.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>Dispensing history (fictional patient)</title>
<style>
  html, body { margin: 0; background: #fff; }
  body { font: 19px "Segoe UI", Arial, sans-serif; color: #111; width: ${SCAN_WIDTH}px; height: ${SCAN_HEIGHT}px; overflow: hidden; }
  .sheet { padding: 44px 48px 0; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  p { margin: 0; line-height: 1.3; }
  table { border-collapse: collapse; margin-top: 14px; width: 100%; }
  th, td { padding: 6px 12px; line-height: 24px; text-align: left; white-space: nowrap; border-bottom: 1px solid #aaa; }
  th { border-bottom: 2px solid #111; }
</style></head>
<body><div class="sheet">
<h1>Dispensing history</h1>
<p>Example Community Pharmacy (fictional). Patient: Fictional patient ${esc(patient.ref)}. Age ${esc(patient.age)}. ${esc(patient.sex)}. Page ${pageNumber} of ${pageCount}.</p>
<p>Fictional patient. No real person.</p>
<table><thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody></table>
</div></body></html>
`;
}

export function tableHtml(rows, patient, kind) {
  const paged = kind === 'pdf';
  const style = paged
    ? `@page { size: A4 landscape; margin: 14mm; }
       body { font: 9.5pt "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
       h1 { font-size: 15pt; margin: 0 0 3pt; }
       p { margin: 0 0 2pt; }
       table { border-collapse: collapse; margin-top: 8pt; width: 100%; }
       th, td { padding: 2.5pt 9pt; text-align: left; white-space: nowrap; border-bottom: 0.5pt solid #999; }
       th { border-bottom: 1pt solid #111; }
       thead { display: table-header-group; }
       tr { break-inside: avoid; }`
    : `html, body { margin: 0; background: #fff; }
       body { font: 16px "Segoe UI", Arial, sans-serif; color: #111; width: ${SCAN_WIDTH}px; height: ${SCAN_HEIGHT}px; overflow: hidden; }
       .sheet { padding: 22px 40px 0; }
       h1 { font-size: 22px; margin: 0 0 2px; }
       p { margin: 0; line-height: 1.25; }
       table { border-collapse: collapse; margin-top: 8px; width: 100%; }
       th, td { padding: 2px 12px; line-height: 19px; text-align: left; white-space: nowrap; border-bottom: 1px solid #aaa; }
       th { border-bottom: 2px solid #111; }`;
  const head = HEADINGS.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>Dispensing history (fictional patient)</title>
<style>${style}</style></head>
<body><div class="sheet">
<h1>Dispensing history</h1>
<p>Example Community Pharmacy (fictional). Patient: Fictional patient ${esc(patient.ref)}. Age ${esc(patient.age)}. ${esc(patient.sex)}.</p>
<p>Fictional patient. No real person.</p>
<table><thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody></table>
</div></body></html>
`;
}

/** Makes the sample files. With no names it makes all three; with names (pdf, png, scan-pdf) only those. */
async function make(only) {
  const wanted = name => only.length === 0 || only.includes(name);
  const { rows, patient } = await printedRows();
  const work = path.join(ROOT, 'data', 'tmp', `demo-files-${process.pid}`);
  fs.mkdirSync(work, { recursive: true });
  let allOk = true;

  if (wanted('pdf')) {
    const pdfHtml = path.join(work, 'positive-print.html');
    fs.writeFileSync(pdfHtml, tableHtml(rows, patient, 'pdf'));
    const ok = await edgePdf(PDF, pathToFileURL(pdfHtml).href);
    say(ok ? `Written: ${path.relative(ROOT, PDF)} (${fs.statSync(PDF).size} bytes)` : 'The PDF was NOT written. Is Microsoft Edge installed?');
    allOk = allOk && ok;
  }

  if (wanted('png')) {
    const scanHtml = path.join(work, 'positive-scan.html');
    fs.writeFileSync(scanHtml, tableHtml(rows, patient, 'scan'));
    const ok = await edgePicture(PNG, pathToFileURL(scanHtml).href, SCAN_WIDTH, SCAN_HEIGHT, 2000);
    const size = ok ? pngSize(PNG) : null;
    say(ok
      ? `Written: ${path.relative(ROOT, PNG)} (${fs.statSync(PNG).size} bytes, ${size?.width} by ${size?.height})`
      : 'The picture was NOT written. Is Microsoft Edge installed?');
    allOk = allOk && ok;
  }

  if (wanted('scan-pdf')) {
    // A scanned PDF: two pages, each one a picture with no text inside, as a scanner makes them.
    const firstRows = Math.ceil(rows.length / 2);
    const halves = [rows.slice(0, firstRows), rows.slice(firstRows)];
    const pictures = [];
    for (let i = 0; i < halves.length; i++) {
      const html = path.join(work, `scan-page-${i + 1}.html`);
      const png = path.join(work, `scan-page-${i + 1}.png`);
      fs.writeFileSync(html, scanPageHtml(halves[i], patient, i + 1, halves.length));
      if (await edgePicture(png, pathToFileURL(html).href, SCAN_WIDTH, SCAN_HEIGHT, 2000)) pictures.push(png);
    }
    let ok = false;
    if (pictures.length === halves.length) {
      const wrapper = path.join(work, 'scan-pdf.html');
      fs.writeFileSync(wrapper, `<!doctype html><html><head><meta charset="utf-8"><title>Scanned dispensing history (fictional patient)</title>
<style>@page { size: A4 landscape; margin: 0; } html, body { margin: 0; } img { display: block; width: 297mm; height: 209.9mm; break-after: page; }</style></head>
<body>${pictures.map(p => `<img src="${pathToFileURL(p).href}" alt="">`).join('')}</body></html>`);
      ok = await edgePdf(SCAN_PDF, pathToFileURL(wrapper).href);
    }
    say(ok
      ? `Written: ${path.relative(ROOT, SCAN_PDF)} (${fs.statSync(SCAN_PDF).size} bytes, ${halves.length} pages of pictures: ${halves.map(h => h.length).join(' and ')} rows)`
      : 'The scanned PDF was NOT written.');
    allOk = allOk && ok;
  }

  await removeFolder(work);
  say(`${rows.length} supply rows are printed in each file.`);
  return allOk ? 0 : 1;
}

/** Looks at the scanned PDF the way src/lib/pdf.ts does: a page with almost no text and a picture on it is a scan. */
async function checkScanPdf() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { countLetters, groupIntoRows } = await import('../src/lib/pdfRows.ts');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(SCAN_PDF)), verbosity: pdfjs.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObject]);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces = content.items.filter(i => 'str' in i).map(i => ({ str: i.str, x: i.transform[4], y: view.height - i.transform[5], width: i.width, height: i.height }));
    const letters = countLetters(groupIntoRows(pieces));
    const ops = await page.getOperatorList();
    pages.push({ page: n, letters, picture: ops.fnArray.some(fn => imageOps.has(fn)), width: Math.round(view.width), height: Math.round(view.height) });
  }
  await task.destroy().catch(() => {});
  say(`${path.relative(ROOT, SCAN_PDF)}: ${pages.length} pages.`);
  for (const p of pages) say(`  Page ${p.page}: ${p.width} by ${p.height} points, ${p.letters} letters of text, ${p.picture ? 'a picture' : 'no picture'}.`);
  const ok = pages.length === 2 && pages.every(p => p.letters < 40 && p.picture);
  say(ok ? 'PASS: every page is a picture with no text. The page will send the pages to Model 1 as pictures.' : 'FAIL: this is not a scan as the page understands it.');
  return ok ? 0 : 1;
}

/** Reads the PDF the way src/lib/pdf.ts does for a page with text: place each piece, then group into rows. */
async function pdfRowsByPage(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { groupIntoRows, countLetters } = await import('../src/lib/pdfRows.ts');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: pdfjs.VerbosityLevel.ERRORS });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const m = pdfjs.Util.transform(viewport.transform, item.transform);
      pieces.push({ str: item.str, x: m[4], y: m[5], width: item.width, height: Math.hypot(m[2], m[3]) || item.height });
    }
    const rows = groupIntoRows(pieces);
    pages.push({ page: n, rows, letters: countLetters(rows) });
  }
  await task.destroy().catch(() => {});
  return pages;
}

async function checkPdf() {
  const { rows: printed } = await printedRows();
  const { linesFromRows } = await import('../pipeline/history.ts');
  const pages = await pdfRowsByPage(PDF);
  const read = pages.flatMap(p => p.rows);
  const truth = printed.map(cells => cells.join(' | '));
  const headingRow = HEADINGS.join(' | ');
  const supplyRows = read.filter(row => /^\d{2}\/\d{2}\/\d{4} \| /.test(row));
  const others = read.filter(row => !/^\d{2}\/\d{2}\/\d{4} \| /.test(row));

  say(`${path.relative(ROOT, PDF)}: ${pages.length} pages. Rows read on each page: ${pages.map(p => p.rows.length).join(', ')}.`);
  let wrong = 0;
  truth.forEach((want, i) => {
    if (supplyRows[i] !== want) {
      wrong++;
      if (wrong <= 5) say(`  Row ${i + 1} differs.\n    printed: ${want}\n    read:    ${supplyRows[i] ?? '(nothing)'}`);
    }
  });
  const exact = truth.length - wrong;
  const headingsOk = others.filter(row => row === headingRow).length === pages.length;
  say(`Supply rows: ${supplyRows.length} read, ${truth.length} printed, ${exact} exactly the same and in the same order.`);
  say(`Other rows: ${others.length} (the title, the patient line, the fictional-patient line, and the column headings once on each page).`);
  for (const row of others) say(`  ${row}`);

  // What the server does with these rows when the page sends them (source "pdf-text").
  const imported = linesFromRows(read);
  say(`The server would number ${imported.lines.length} lines. Problems found by the import check: ${imported.problems.length === 0 ? 'none' : imported.problems.join(' ')}`);
  const ok = wrong === 0 && supplyRows.length === truth.length && headingsOk && imported.problems.length === 0 && read.length === truth.length + others.length;
  say(ok ? 'PASS: one row for each printed row.' : 'FAIL: the rows read are not the rows printed.');
  return ok ? 0 : 1;
}

async function checkScan() {
  const { loadConfig, parseCsv, transcribePageImage } = await import('../pipeline/index.ts');
  const cfg = loadConfig(ROOT);
  const truth = parseCsv(fs.readFileSync(CSV, 'utf8')).lines.map(l => l.text);
  const size = pngSize(PNG);
  say(`${path.relative(ROOT, PNG)}: ${size?.width} by ${size?.height}. Model 1 (${cfg.models.screen}) reads it now. This takes a minute or two.`);
  const t0 = performance.now();
  const answer = await transcribePageImage(cfg, fs.readFileSync(PNG).toString('base64'));
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  if (!answer.ok) {
    say(`FAIL: the page could not be read in ${seconds} s. ${answer.error}`);
    return 1;
  }
  let exact = 0;
  const differences = [];
  const most = Math.max(truth.length, answer.rows.length);
  for (let i = 0; i < most; i++) {
    if (answer.rows[i] === truth[i]) exact++;
    else differences.push({ row: i + 1, printed: truth[i] ?? '(nothing)', read: answer.rows[i] ?? '(nothing)' });
  }
  say(`Rows read: ${answer.rows.length}. Rows printed: ${truth.length}. Exactly the same: ${exact}. Time: ${seconds} s.`);
  for (const d of differences.slice(0, 12)) say(`  Row ${d.row} differs.\n    printed: ${d.printed}\n    read:    ${d.read}`);
  if (differences.length > 12) say(`  and ${differences.length - 12} more.`);
  const out = path.join(ROOT, 'data', 'tmp', 'check-scan.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model: cfg.models.screen, seconds, printed: truth.length, read: answer.rows.length, exact, differences, rows: answer.rows }, null, 1));
  const ok = exact === truth.length && answer.rows.length === truth.length;
  say(ok ? 'PASS: every row was read exactly.' : 'NOT EXACT: the pharmacist would have to correct the rows above before screening.');
  return ok ? 0 : 1;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  let code = 2;
  try {
    if (command === 'make') code = await make(process.argv.slice(3));
    else if (command === 'check-pdf') code = await checkPdf();
    else if (command === 'check-scan') code = await checkScan();
    else if (command === 'check-scan-pdf') code = await checkScanPdf();
    else say('Use: node tools/demo-files.mjs make | check-pdf | check-scan | check-scan-pdf');
  } catch (e) {
    console.error('Stopped with an error:', e instanceof Error ? e.message : e);
  }
  process.exit(code);
}
