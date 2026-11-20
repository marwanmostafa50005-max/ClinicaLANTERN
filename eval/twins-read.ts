// Reads the twins back the way the app reads them (task K05, steps 4 and 5). No model for the
// text PDF; a scan picture needs Model 1 (transcribePageImage). Fictional patients only.

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { placeText, groupIntoRows } from '../src/lib/pdfRows.ts';
import { linesFromRows } from '../pipeline/history.ts';
import { transcribePageImage } from '../pipeline/index.ts';
import type { HistoryLine, LanternConfig } from '../shared/types.ts';

// A text PDF, read with the page's own functions: placeText and groupIntoRows, then the
// server's linesFromRows. Dates may come back split ("2026- 01-08"); normalize spaces before
// matching the planted lines.
export async function readTextPdfLines(pdfPath: string): Promise<{ lines: HistoryLine[]; problems: string[] }> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data }).promise;
  const rows: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces = content.items.map((item) => placeText(viewport.transform, item as { str: string; transform: number[]; width: number; height: number }));
    // Edge's PDF writer splits some dates at the separator ("2026- 01-08", "08/ 01/2026"); join them again.
    rows.push(...groupIntoRows(pieces).map((r) => r
      .replace(/(\d{4})- (\d{2})-(\d{2})/g, '$1-$2-$3')
      .replace(/(\d{2})\/ (\d{2}\/\d{4})/g, '$1/$2')));
  }
  return linesFromRows(rows);
}

// A scan-style picture, read by Model 1 exactly as the app reads a scanned page.
export async function readScanLines(cfg: LanternConfig, pngPath: string): Promise<{ lines: HistoryLine[]; problems: string[] }> {
  const base64Png = fs.readFileSync(pngPath).toString('base64');
  const out = await transcribePageImage(cfg, base64Png);
  if (!out.ok) return { lines: [], problems: [out.error] };
  return linesFromRows(out.rows);
}

// Dates the PDF extractor splits are joined again for matching.
export function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
