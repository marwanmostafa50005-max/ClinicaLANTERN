import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { edgePdf, ROOT } from '../../tools/edge.mjs';
import { removeOwnedDataDir } from './walk-safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'page-reports');
const work = path.join(ROOT, 'data', 'tmp', `k-path-3-reports-${process.pid}`);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(work, { recursive: true });

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const base = body => `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>Fictional pathology report</title><style>@page{size:A4;margin:18mm}body{font:14px "Segoe UI",Arial,sans-serif;color:#111}section{break-after:page}section:last-child{break-after:auto}p{line-height:1.5}pre{font:12px Consolas,monospace;white-space:nowrap}</style></head><body>${body}</body></html>`;
const heading = `<h1>Fictional pathology report</h1><p>Made-up report for local software testing only. No real person.</p><p>Collected: 12/03/2026 08:15</p>`;
const sodium = 'Sodium 128 mmol/L (135-145) L';

async function make(name, html) {
  const input = path.join(work, `${name}.html`);
  const output = path.join(out, `${name}.pdf`);
  fs.writeFileSync(input, html);
  if (!await edgePdf(output, pathToFileURL(input).href)) throw new Error(`Could not make ${name}.pdf`);
  console.log(`${name}.pdf: ${fs.statSync(output).size} bytes`);
}

try {
  await make('text-sodium', base(`${heading}<p>${sodium}</p><p>Potassium 4.4 mmol/L (3.5-5.2)</p>`));
  await make('vitamin-d-report', base(`<h1>Fictional pathology report</h1><p>Made-up report for local software testing only. No real person.</p><p>Patient reference: F-MEGA01 (fictional)</p><p>Collected: 18/11/2026 08:15</p><p>25-hydroxyvitamin D 32 nmol/L (50-150) L</p><p>Calcium 2.31 mmol/L (2.10-2.60)</p><p>Comment: fictional values for a software test.</p>`));
  const long = `Accreditation and comment ${'x'.repeat(340)}`;
  await make('long-line', base(`${heading}<pre style="font-size:2px">${esc(long)}</pre><pre>${sodium}</pre>`));
  await make('eleven-pages', base(Array.from({ length: 11 }, (_, i) => `<section><h1>Fictional report</h1><p>Page ${i + 1} of 11</p><p>Potassium 4.4 mmol/L (3.5-5.2)</p></section>`).join('')));

  const image = pathToFileURL(path.join(here, 'clean.png')).href;
  const scanHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Fictional scanned pathology</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}.blank{height:296mm;break-after:page}img{display:block;width:210mm;height:296mm}</style></head><body><div class="blank"></div><img src="${image}" alt=""></body></html>`;
  await make('blank-then-scan', scanHtml);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [name, expected] of [['text-sodium', 1], ['long-line', 1], ['eleven-pages', 11], ['blank-then-scan', 2]]) {
    const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(out, `${name}.pdf`))), verbosity: pdfjs.VerbosityLevel.ERRORS });
    const doc = await task.promise;
    console.log(`${name}.pdf: ${doc.numPages} page(s)`);
    if (doc.numPages !== expected) throw new Error(`${name}.pdf has ${doc.numPages} pages, expected ${expected}`);
    await task.destroy().catch(() => {});
  }
} finally {
  if (!await removeOwnedDataDir(work)) throw new Error(`Could not remove the report work folder: ${work}`);
}
