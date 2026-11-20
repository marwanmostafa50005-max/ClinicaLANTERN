// Scores the twins of task K05 (steps 4 to 6). For every history of the answer sheet: reads the
// text PDF and the scan pictures back the way the app reads them, and answers two questions per
// twin: how many rows read exactly (date, brand and quantity all right), and whether the planted
// finding's lines come back (matched by date and brand, as the line IDs differ).
// No pharmacist confirms the rows in a test run: the table says so.
// Usage: node eval/twins-score.ts [planted-only] [text-only]
// Run: in REPO, with Ollama up, under a GPU.lock of your own. Fictional patients only.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../pipeline/config.ts';
import { parseCsv } from '../pipeline/csv.ts';
import { readTextPdfLines, readScanLines, normalizeLineText } from './twins-read.ts';

const sheet = JSON.parse(fs.readFileSync('cases/expected.json', 'utf8'));
const args = process.argv.slice(2);
const plantedOnly = args.includes('planted-only');
const textOnly = args.includes('text-only');

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').toLowerCase().trim();
}

// One printed row from a CSV line. A line reads "date | medicine | qty N | repeats M | ...".
// The twin table shows the brand (or ingredient) and the bare quantity in their own columns.
function rowParts(text: string): { date: string; iso: string; medicine: string; qty: string } | null {
  const parts = text.split(' | ');
  if (parts.length < 3) return null;
  const iso = parts[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const med = parts[1].trim();
  const qtyM = parts[2].trim().match(/^qty (\d+)$/);
  const d = new Date(iso + 'T00:00:00Z');
  // The twin table prints the date day first; Model 1, reading the picture, often writes it back
  // ISO. Match either rendering.
  const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const base = med.split(' (')[0];
  const cut = base.match(/\s+\d+(?:\.\d+)?\s*(?:mg|microgram|g|ml|units?)(?=\s|$)/i);
  const medicine = cut && cut.index !== undefined ? base.slice(0, cut.index) : base;
  return { date, iso, medicine, qty: qtyM ? qtyM[1] : '' };
}

function printedRows(csvText: string) {
  const parsed = parseCsv(csvText);
  const rows = [];
  for (const line of parsed.lines) {
    const r = rowParts(line.text);
    if (r) rows.push(r);
  }
  return rows;
}

function countExact(rows: ReturnType<typeof printedRows>, lines: { text: string }[]) {
  const texts = lines.map((l) => norm(normalizeLineText(l.text)));
  let exact = 0;
  for (const r of rows) {
    const hit = texts.some(
      (t) => (t.includes(norm(r.date)) || t.includes(r.iso)) && t.includes(norm(r.medicine)) && (r.qty === '' || t.includes('qty ' + r.qty) || t.includes(' ' + r.qty + ' ')),
    );
    if (hit) exact++;
  }
  return { exact, total: rows.length };
}

function plantedFound(caseEntry: (typeof sheet.cases)[number], lines: { text: string }[]) {
  const texts = lines.map((l) => norm(normalizeLineText(l.text)));
  const csv = parseCsv(fs.readFileSync(path.join('cases', caseEntry.file), 'utf8'));
  const byId = new Map(csv.lines.map((l) => [l.id, l]));
  for (const f of caseEntry.findings) {
    for (const group of f.must_cite) {
      let ok = false;
      for (const id of group) {
        const line = byId.get(id);
        if (!line) continue;
        const r = rowParts(line.text);
        if (!r) continue;
        if (texts.some((t) => (t.includes(norm(r.date)) || t.includes(r.iso)) && t.includes(norm(r.medicine)))) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
  }
  return true;
}

async function main() {
  const cfg = loadConfig('.');
  const out: string[] = [];
  let plantedSeen = 0, plantedCaughtText = 0, plantedCaughtScan = 0;
  const rowsText = { exact: 0, total: 0 }, rowsScan = { exact: 0, total: 0 };
  for (const c of sheet.cases) {
    if (plantedOnly && c.kind !== 'positive') continue;
    const folder = path.join('cases', '_twins', c.file.replace('.csv', ''));
    if (!fs.existsSync(folder)) {
      console.log(`SKIP ${c.file}: no twins`);
      continue;
    }
    const csvText = fs.readFileSync(path.join('cases', c.file), 'utf8');
    const rows = printedRows(csvText);
    const planted = c.findings.length > 0;
    if (planted) plantedSeen++;

    const pdfOut = await readTextPdfLines(path.join(folder, 'text.pdf'));
    const pdfCount = countExact(rows, pdfOut.lines);
    const pdfFound = !planted || plantedFound(c, pdfOut.lines);
    if (planted && pdfFound) plantedCaughtText++;
    rowsText.exact += pdfCount.exact;
    rowsText.total += pdfCount.total;

    let scanCount = { exact: 0, total: 0 }, scanFound: boolean | null = null, scanCell = '';
    if (textOnly) {
      scanCell = 'not run yet';
    } else {
      try {
        const pages = fs.readdirSync(folder).filter((f) => /^scan-\d+\.png$/.test(f)).sort();
        const all = [];
        for (const p of pages) {
          const r = await readScanLines(cfg, path.join(folder, p));
          all.push(...r.lines);
          // keep what Model 1 read, so a re-count never needs the model again
          const readBack = r.lines.map((l) => l.text).join('\n') + '\n';
          fs.writeFileSync(path.join(folder, p.replace(/\.png$/, '.read.txt')), readBack);
        }
        scanCount = countExact(rows, all);
        scanFound = !planted || plantedFound(c, all);
        if (planted && scanFound) plantedCaughtScan++;
        rowsScan.exact += scanCount.exact;
        rowsScan.total += scanCount.total;
        scanCell = `${scanCount.exact} of ${scanCount.total}`;
      } catch (e) {
        scanCell = `scan read failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    out.push(
      `| ${c.file} | ${c.kind} | ${pdfCount.exact} of ${pdfCount.total} | ${planted ? (pdfFound ? 'yes' : 'NO') : '-'} | ${scanCell} | ${planted ? (scanFound === null ? '-' : scanFound ? 'yes' : 'NO') : '-'} |`,
    );
    console.log(`${c.file}: text ${pdfCount.exact}/${pdfCount.total}${planted ? (pdfFound ? ' planted-ok' : ' PLANTED-MISS') : ''} | scan ${scanCell}`);
  }
  const head =
    '| History | Kind | Text PDF rows exact | Planted lines back (text) | Scan rows exact | Planted lines back (scan) |\n|---|---|---|---|---|---|\n';
  let sums = `\nText PDFs: rows read exactly ${rowsText.exact} of ${rowsText.total}. Planted findings whose lines came back: ${plantedCaughtText} of ${plantedSeen}.\n`;
  if (!textOnly) {
    sums += `Scans: rows read exactly ${rowsScan.exact} of ${rowsScan.total}. Planted findings whose lines came back: ${plantedCaughtScan} of ${plantedSeen}. No pharmacist confirmed the rows in this test run.\n`;
  } else {
    sums += 'Scans: not run yet (text-only pass).\n';
  }
  fs.writeFileSync('eval/results/twins-table.md', head + out.join('\n') + '\n' + sums);
  console.log(sums.trim());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
