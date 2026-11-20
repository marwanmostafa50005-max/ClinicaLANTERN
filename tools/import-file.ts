// Sends one file to a running ClinicaLANTERN server the way the page does, then prints the case
// id and what happens until the history is screened or it waits for the pharmacist.
// A text PDF is read here, with the page's own row builder. A scan is sent as pictures.
//
// node tools/import-file.ts <file> --server http://127.0.0.1:8788 [--confirm]
// One or more .png files are the pages of one scan. --confirm confirms the rows as they were read.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupIntoRows, placeText } from '../src/lib/pdfRows.ts';
import { reachedTheBell } from '../server/view.ts';
import type { CaseRecord, StateResponse } from '../shared/types.ts';

const USAGE = 'Usage: node tools/import-file.ts <file> [--server http://127.0.0.1:8788] [--confirm]\nA .csv file is sent as text. A .pdf with text is sent as rows. One or more .png files are sent as page pictures.';

export async function rowsFromPdf(file: string): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = getDocument({ data });
  const doc = await task.promise;
  const rows: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const pieces = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue;
        pieces.push(placeText(viewport.transform as number[], {
          str: item.str,
          transform: item.transform as number[],
          width: item.width,
          height: item.height
        }));
      }
      rows.push(...groupIntoRows(pieces));
    }
  } finally {
    await task.destroy();
  }
  return rows;
}

interface ImportBody {
  fileName: string;
  source: 'csv' | 'pdf-text' | 'pdf-image';
  csvText?: string;
  rows?: string[];
  pageImages?: string[];
}

/** The body the page would post for these files. */
export async function bodyFor(files: string[]): Promise<ImportBody> {
  if (files.length === 0) throw new Error('Name a file to import.');
  const kinds = files.map(file => path.extname(file).toLowerCase());
  if (kinds.every(kind => kind === '.png')) {
    return {
      fileName: path.basename(files[0]),
      source: 'pdf-image',
      pageImages: files.map(file => fs.readFileSync(file).toString('base64'))
    };
  }
  if (files.length !== 1) throw new Error('Only PNG pictures can be sent together. A CSV or a PDF is one file.');
  const file = files[0];
  const fileName = path.basename(file);
  if (kinds[0] === '.csv') return { fileName, source: 'csv', csvText: fs.readFileSync(file, 'utf8') };
  if (kinds[0] === '.pdf') {
    const rows = await rowsFromPdf(file);
    if (rows.length === 0) {
      throw new Error('This PDF has no text rows. A scan is sent as PNG pictures, one file for each page.');
    }
    return { fileName, source: 'pdf-text', rows };
  }
  throw new Error(`This tool sends a .csv, a .pdf or a .png file. ${fileName} is none of those.`);
}

function say(line: string): void {
  console.log(line);
}

async function readJson(url: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json && typeof json === 'object' && 'error' in json ? String((json as { error: unknown }).error) : `The server answered ${res.status}.`;
    throw new Error(message);
  }
  return json;
}

function report(c: CaseRecord, now: string, findingsAtBell: number): string {
  if (c.cannotAssess) return `${c.id} ${c.fileName}: Cannot assess: ${c.cannotAssess}`;
  if (c.source === 'pdf-image' && !c.transcriptionConfirmed) {
    return `${c.id} ${c.fileName}: ${c.lines.length} rows read from ${c.pages ?? 0} pages. ${now || 'Waiting for the rows to be checked.'}`;
  }
  const screened = c.screening.status;
  return `${c.id} ${c.fileName}: ${c.lines.length} lines, screening ${screened}. ${findingsAtBell} findings at the bell. ${now}`.trim();
}

async function watch(server: string, caseId: string, confirm: boolean): Promise<void> {
  const deadline = Date.now() + 20 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const state = await readJson(`${server}/api/state`, 'GET') as StateResponse;
    const c = state.state.cases.find(item => item.id === caseId);
    if (!c) {
      say(`Case ${caseId} is not in the state.`);
      return;
    }
    const bell = state.state.findings.filter(f => f.caseId === caseId && reachedTheBell(f)).length;
    const line = report(c, state.now.text, bell);
    if (line !== last) {
      say(line);
      last = line;
    }
    if (c.cannotAssess) return;
    const reading = state.state.jobs.some(job =>
      job.caseId === caseId && job.stage === 'screen' && (job.status === 'queued' || job.status === 'running'));
    if (c.source === 'pdf-image' && !c.transcriptionConfirmed && !reading) {
      if (c.lines.length === 0) {
        say(`${caseId}: the scan was not read. Nothing is waiting to be confirmed.`);
        return;
      }
      if (!confirm) {
        say(`${caseId}: waiting for the pharmacist to confirm ${c.lines.length} rows.`);
        return;
      }
      await readJson(`${server}/api/cases/${caseId}/confirm-transcription`, 'POST', { rows: c.lines.map(row => row.text) });
      say(`${caseId}: confirmed ${c.lines.length} rows as they were read. Screening is queued.`);
      last = '';
      continue;
    }
    if (c.screening.status === 'done' || c.screening.status === 'interrupted') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  say(`${caseId}: still going after 20 minutes.`);
}

function filesFrom(argv: string[]): { files: string[]; server: string; confirm: boolean } {
  const files: string[] = [];
  let server = 'http://127.0.0.1:8788';
  let confirm = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--server') {
      const next = argv[++i];
      if (!next) throw new Error('Say the server address after --server.');
      server = next.replace(/\/$/, '');
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else files.push(arg);
  }
  return { files, server, confirm };
}

export async function main(argv: string[]): Promise<void> {
  const { files, server, confirm } = filesFrom(argv);
  if (files.length === 0) throw new Error(USAGE);
  const body = await bodyFor(files);
  say(`Sending ${body.fileName} as ${body.source} to ${server}.`);
  const imported = await readJson(`${server}/api/cases`, 'POST', body) as { caseId?: string };
  if (!imported.caseId) throw new Error('The server did not return a case id.');
  say(`Case ${imported.caseId}.`);
  await watch(server, imported.caseId, confirm);
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main(process.argv.slice(2)).catch(err => {
    say(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
