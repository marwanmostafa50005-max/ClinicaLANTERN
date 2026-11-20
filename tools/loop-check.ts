// Walks a running server through the letter loop and prints the statuses and the counts.
// node tools/loop-check.ts --server http://127.0.0.1:8788
// Two histories is the full walk. --histories 1 sends one letter, moves the clock, and shows it overdue.
// The two-history walk on the real models is for the review. This file does not start a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isOverdue, reachedTheBell } from '../server/view.ts';
import type { Finding, Letter, StateResponse } from '../shared/types.ts';

const USAGE = 'Usage: node tools/loop-check.ts [--server http://127.0.0.1:8788] [--histories 1|2]';
const WAIT_MS = 20 * 60 * 1000;

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function readOptions(argv: string[]): { server: string; histories: number } {
  let server = 'http://127.0.0.1:8788';
  let histories = 2;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--server') {
      const next = argv[++i];
      if (!next) throw new Error('Say the server address after --server.');
      server = next.replace(/\/$/, '');
    } else if (arg === '--histories') {
      const next = argv[++i];
      if (next !== '1' && next !== '2') throw new Error('Say 1 or 2 after --histories.');
      histories = Number(next);
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else throw new Error(`Unexpected argument ${arg}. ${USAGE}`);
  }
  return { server, histories };
}

/** One line per letter, then the counts, then the status line. */
export function reportLines(state: StateResponse, letterIds: string[]): string[] {
  const when = new Date(state.serverTime);
  const lines = letterIds.map(id => {
    const letter = state.state.letters.find(item => item.id === id);
    if (!letter) return `${id} missing`;
    if (isOverdue(letter, when)) return `${id} sent overdue`;
    return `${id} ${letter.status}`;
  });
  const c = state.counts;
  lines.push(`letters sent ${c.lettersSent}, replies recorded ${c.repliesRecorded}, closed ${c.closed}, overdue ${c.overdue}`);
  lines.push(state.now.text);
  return lines;
}

async function call(server: string, method: string, route: string, body?: unknown): Promise<unknown> {
  const res = await fetch(server + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = typeof json === 'object' && json !== null && 'error' in json
      ? String((json as { error: unknown }).error)
      : `The server answered ${res.status}.`;
    throw new Error(message);
  }
  return json;
}

async function stateOf(server: string): Promise<StateResponse> {
  return await call(server, 'GET', '/api/state') as StateResponse;
}

function busy(state: StateResponse): boolean {
  return state.state.jobs.some(job => job.status === 'queued' || job.status === 'running');
}

async function waitUntil(server: string, ready: (state: StateResponse) => boolean, what: string): Promise<StateResponse> {
  const deadline = Date.now() + WAIT_MS;
  let last = '';
  while (Date.now() < deadline) {
    const state = await stateOf(server);
    if (state.now.text !== last) {
      console.log(state.now.text);
      last = state.now.text;
    }
    if (ready(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${what} was still going after 20 minutes.`);
}

function bellFinding(state: StateResponse, caseId: string): Finding | undefined {
  return state.state.findings.find(f => f.caseId === caseId && reachedTheBell(f));
}

function letterFor(state: StateResponse, findingId: string): Letter | undefined {
  return state.state.letters.find(letter => letter.findingId === findingId);
}

async function oneHistory(server: string, csvText: string): Promise<string> {
  const imported = await call(server, 'POST', '/api/cases', {
    fileName: 'positive.csv', source: 'csv', csvText
  }) as { caseId?: string };
  if (!imported.caseId) throw new Error('The server did not return a case id.');
  const caseId = imported.caseId;
  console.log(`Case ${caseId}.`);
  const screened = await waitUntil(server, state => {
    const c = state.state.cases.find(item => item.id === caseId);
    if (c?.cannotAssess) return true;
    return c !== undefined && (c.screening.status === 'done' || c.screening.status === 'interrupted') && !busy(state);
  }, `Screening ${caseId}`);
  const row = screened.state.cases.find(item => item.id === caseId);
  if (!row || row.cannotAssess) throw new Error(`${caseId}: Cannot assess: ${row?.cannotAssess ?? 'the history was not imported'}.`);
  if (row.screening.status !== 'done') throw new Error(`${caseId}: screening stopped before it was done.`);
  const finding = bellFinding(screened, caseId);
  if (!finding) throw new Error(`${caseId}: no finding reached the bell.`);
  await call(server, 'POST', `/api/findings/${finding.id}/decision`, { action: 'accept' });
  const ready = await waitUntil(server, state => {
    const letter = letterFor(state, finding.id);
    return letter !== undefined && letter.status !== 'drafting' && !busy(state);
  }, `The letter for ${caseId}`);
  const letter = letterFor(ready, finding.id);
  if (!letter || letter.status !== 'ready') throw new Error(`${caseId}: the letter did not become ready.`);
  const preview = await call(server, 'POST', `/api/letters/${letter.id}/preview`, {}) as { previewToken?: string };
  const sentBody = preview.previewToken ? { by: 'print' as const, previewToken: preview.previewToken } : { by: 'print' as const };
  await call(server, 'POST', `/api/letters/${letter.id}/sent`, sentBody);
  console.log(`${letter.id} marked as sent.`);
  return letter.id;
}

export async function main(argv: string[], repo = repoRoot()): Promise<void> {
  const { server, histories } = readOptions(argv);
  const csvText = fs.readFileSync(path.join(repo, 'cases', '_demo', 'positive.csv'), 'utf8');
  const letterIds: string[] = [];
  for (let n = 0; n < histories; n++) letterIds.push(await oneHistory(server, csvText));
  if (histories === 2) {
    await call(server, 'POST', `/api/letters/${letterIds[0]}/reply`, { outcome: 'will_review', note: 'Seen next week.' });
    await call(server, 'POST', `/api/letters/${letterIds[0]}/close`, {});
  }
  await call(server, 'POST', '/api/demo-clock', { days: 8 });
  const end = await stateOf(server);
  for (const line of reportLines(end, letterIds)) console.log(line);
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
