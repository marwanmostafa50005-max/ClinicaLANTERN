// The rules of the adoption helper (tools/adopt-wave.mjs). Pure functions only: no files, no clock.
//
// A criterion of a wave folder is adopted into the repository when it is in the passing list of a
// wave run AND the case check says it is ok. Adopting means: its two folders are copied, its ID is
// added to the "further" list of criteria/active.json, and its histories are added to the answer
// sheet. Nothing that is already in the repository is written over.

import type { ExpectedCase, ExpectedFinding } from '../shared/types.ts';

// ---------- what the helper read, as plain data ----------

export interface WaveCriterionSeen {
  id: string;
  drafted: boolean;                 // false: the folder holds NOT_DRAFTED.md in place of criterion.json
}

export interface CheckVerdict {
  status: 'ok' | 'not_ok' | 'not_drafted';
  problems: string[];
}

// How a criterion's folders stand in the repository now.
// absent: neither folder is there. same: both are there, byte for byte the same as in the wave folder.
// different: at least one is there and is not the same as in the wave folder.
export type RepoState = 'absent' | 'same' | 'different';

export interface AdoptInput {
  wave: string;                                 // the wave folder's own name
  criteria: WaveCriterionSeen[];                // every criterion folder of the wave folder, in order
  passing: string[];                            // results.json: passing
  notPassing: Record<string, string>;           // results.json: not_passing, ID -> its result and reason
  check: Record<string, CheckVerdict>;          // tools/check-cases.mjs --wave, ID -> verdict
  changedSinceScored: Record<string, string>;   // ID -> the first file that is not the file that was scored
  repo: Record<string, RepoState>;
  repoDetail: Record<string, string>;           // ID -> which folder is already there, in words
  list: CriteriaList;                           // criteria/active.json as it is now
  sheetFiles: string[];                         // the histories the answer sheet lists now
  parts: Record<string, ExpectedCase[]>;        // ID -> its part of the answer sheet
}

export interface CriteriaList {
  active: string[];
  reserves: string[];
  further: string[];
}

// adopt: copy the two folders, then add the ID and the histories.
// complete: the folders are already there and are the same; only the list or the sheet is completed.
// skip: nothing is done, and the reason says why.
export type AdoptAction = 'adopt' | 'complete' | 'skip';

export interface AdoptDecision {
  id: string;
  action: AdoptAction;
  reason: string;                   // for a skip: why. For the others: what is done.
  copyFolders: boolean;
  addToFurther: boolean;
  addCases: ExpectedCase[];         // the histories to add to the answer sheet
}

function skip(id: string, reason: string): AdoptDecision {
  return { id, action: 'skip', reason, copyFolders: false, addToFurther: false, addCases: [] };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// One answer sheet entry with its four fields, in the order the sheet writes them.
export function cleanEntry(entry: ExpectedCase): ExpectedCase {
  const findings: ExpectedFinding[] = entry.findings.map((f) => ({ criterion: f.criterion, must_cite: f.must_cite.map((group) => [...group]) }));
  return { file: entry.file.replace(/\\/g, '/'), kind: entry.kind, about: entry.about, findings };
}

// Decides, for every criterion folder of one wave folder, what the helper does. It writes nothing.
export function planAdoption(input: AdoptInput): AdoptDecision[] {
  const passing = new Set(input.passing);
  const inSheet = new Set(input.sheetFiles.map((f) => f.replace(/\\/g, '/').toLowerCase()));
  const listed = new Set([...input.list.active, ...input.list.reserves, ...input.list.further]);
  const decisions: AdoptDecision[] = [];

  for (const criterion of input.criteria) {
    const id = criterion.id;
    if (!criterion.drafted) {
      decisions.push(skip(id, 'not drafted'));
      continue;
    }
    if (!passing.has(id)) {
      const why = input.notPassing[id];
      decisions.push(skip(id, why !== undefined ? `not in the passing list. ${why}` : 'not in these results. The run that wrote them did not score this criterion.'));
      continue;
    }
    const verdict = input.check[id];
    if (!verdict || verdict.status !== 'ok') {
      const first = verdict?.problems[0] ?? 'the case check gave no verdict for it';
      const more = (verdict?.problems.length ?? 0) > 1 ? ` (and ${(verdict?.problems.length ?? 1) - 1} more)` : '';
      decisions.push(skip(id, `the case check does not say ok. ${first}${more}`));
      continue;
    }
    const changed = input.changedSinceScored[id];
    if (changed !== undefined) {
      decisions.push(skip(id, `its files are not the files that were scored (${changed}). Score the wave folder again.`));
      continue;
    }

    const state = input.repo[id] ?? 'absent';
    if (state === 'different') {
      decisions.push(skip(id, `${input.repoDetail[id] ?? 'a folder of this criterion'} is already in the repository and is not the same. Nothing was written over.`));
      continue;
    }

    const addToFurther = !listed.has(id);
    const part = (input.parts[id] ?? []).map(cleanEntry);
    const addCases = part.filter((entry) => !inSheet.has(entry.file.toLowerCase()));
    if (state === 'same') {
      // The folders were copied before (an earlier run, perhaps one that was stopped). Only what is
      // still missing from the list and the sheet is added.
      if (!addToFurther && addCases.length === 0) {
        decisions.push(skip(id, 'already in the repository, in the list and in the answer sheet.'));
        continue;
      }
      const done: string[] = [];
      if (addToFurther) done.push('adds the ID to the further list');
      if (addCases.length > 0) done.push(`adds ${plural(addCases.length, 'history', 'histories')} to the answer sheet`);
      decisions.push({ id, action: 'complete', reason: `the folders are already in the repository and are the same; ${done.join(', ')}`, copyFolders: false, addToFurther, addCases });
      listed.add(id);
      for (const entry of addCases) inSheet.add(entry.file.toLowerCase());
      continue;
    }

    const done = [`copies criteria/${id} and cases/${id}`];
    done.push(addToFurther ? 'adds the ID to the further list' : 'the ID is already in the list');
    done.push(
      addCases.length > 0
        ? `adds ${plural(addCases.length, 'history', 'histories')} to the answer sheet`
        : 'its histories are already in the answer sheet',
    );
    decisions.push({ id, action: 'adopt', reason: done.join(', '), copyFolders: true, addToFurther, addCases });
    listed.add(id);
    for (const entry of addCases) inSheet.add(entry.file.toLowerCase());
  }
  return decisions;
}

// ---------- the two files the helper changes ----------

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// criteria/active.json as the three lists. Throws a plain sentence when the file is not usable.
export function readList(raw: unknown): CriteriaList {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('criteria/active.json is not a JSON object.');
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.active)) throw new Error('criteria/active.json has no "active" list.');
  if (record.further !== undefined && record.further !== null && !Array.isArray(record.further)) {
    throw new Error('The "further" entry of criteria/active.json is not a list.');
  }
  return { active: stringsOf(record.active), reserves: stringsOf(record.reserves), further: stringsOf(record.further) };
}

// The list file with IDs added to "further". The active ten and the reserves are the same objects
// as before: they are never touched. An ID that is already in any of the three lists is not added.
export function withFurther(raw: Record<string, unknown>, ids: string[]): Record<string, unknown> {
  const list = readList(raw);
  const have = new Set([...list.active, ...list.reserves, ...list.further]);
  const further = [...(Array.isArray(raw.further) ? raw.further : [])];
  for (const id of ids) {
    if (have.has(id)) continue;
    have.add(id);
    further.push(id);
  }
  // "further" keeps its place when the file has it, and comes last when it is new.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) out[key] = key === 'further' ? further : value;
  if (!('further' in raw)) out.further = further;
  return out;
}

// The answer sheet with histories added at its end. A history that is already listed is not added again.
export function withCases(raw: Record<string, unknown>, entries: ExpectedCase[]): { sheet: Record<string, unknown>; added: number } {
  if (!Array.isArray(raw.cases)) throw new Error('The answer sheet has no "cases" list.');
  const cases: unknown[] = [...raw.cases];
  const have = new Set<string>();
  for (const c of cases) {
    const file = (c as { file?: unknown } | null)?.file;
    if (typeof file === 'string') have.add(file.replace(/\\/g, '/').toLowerCase());
  }
  let added = 0;
  for (const entry of entries) {
    const clean = cleanEntry(entry);
    if (have.has(clean.file.toLowerCase())) continue;
    have.add(clean.file.toLowerCase());
    cases.push(clean);
    added++;
  }
  return { sheet: { ...raw, cases }, added };
}

// JSON in the style of the answer sheet: two spaces, and a list of plain strings on one line, so
// the line IDs of a finding stay readable. It parses back to exactly the same value.
export function formatJson(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => typeof item === 'string')) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    const inner = `${indent}  `;
    return `[\n${value.map((item) => `${inner}${formatJson(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    return `{\n${entries.map(([key, v]) => `${inner}${JSON.stringify(key)}: ${formatJson(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function formatSheet(sheet: Record<string, unknown>): string {
  return `${formatJson(sheet)}\n`;
}

// criteria/active.json is written the way it is kept: two spaces, one ID on each line.
export function formatList(list: Record<string, unknown>): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}

// ---------- reading results.json ----------

export interface ResultsLists {
  passing: string[];
  notPassing: Record<string, string>;                         // ID -> "FAIL: reason"
  scoredFiles: Record<string, Record<string, string>>;        // ID -> path in the wave folder -> SHA-256 when it was scored
  waveOf: Record<string, string>;                             // ID -> the wave folder it was scored in
  mode: string;
  stoppedEarly: string | null;
}

// The two lists of a results.json, read without trusting its shape. An entry may be an ID, or an
// object with an "id". Throws a plain sentence when the file has no passing list.
export function readResultsLists(raw: unknown): ResultsLists {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('The results file is not a JSON object.');
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.passing)) {
    throw new Error('The results file has no "passing" list. It was written by an older scorer, or it is not a results.json.');
  }
  const idOf = (entry: unknown): string => {
    if (typeof entry === 'string') return entry.trim();
    const id = (entry as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id.trim() : '';
  };
  const passing = [...new Set(record.passing.map(idOf).filter((id) => id !== ''))];
  const notPassing: Record<string, string> = {};
  for (const entry of Array.isArray(record.not_passing) ? record.not_passing : []) {
    const id = idOf(entry);
    if (id === '') continue;
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const result = typeof item.result === 'string' ? item.result.replace(/_/g, ' ') : 'NOT PASSING';
    const reason = typeof item.reason === 'string' ? item.reason : stringsOf(item.reasons).join(' ');
    notPassing[id] = reason.trim() === '' ? `${result}.` : `${result}: ${reason.trim()}`;
  }
  const scoredFiles: Record<string, Record<string, string>> = {};
  const waveOf: Record<string, string> = {};
  for (const wave of Array.isArray(record.waves) ? record.waves : []) {
    const w = (typeof wave === 'object' && wave !== null ? wave : {}) as Record<string, unknown>;
    const name = typeof w.name === 'string' ? w.name : '';
    for (const criterion of Array.isArray(w.criteria) ? w.criteria : []) {
      const c = (typeof criterion === 'object' && criterion !== null ? criterion : {}) as Record<string, unknown>;
      const id = typeof c.id === 'string' ? c.id : '';
      if (id === '') continue;
      waveOf[id] = name;
      const files: Record<string, string> = {};
      if (typeof c.files === 'object' && c.files !== null) {
        for (const [file, hash] of Object.entries(c.files as Record<string, unknown>)) if (typeof hash === 'string') files[file] = hash;
      }
      if (Object.keys(files).length > 0) scoredFiles[id] = files;
    }
  }
  return {
    passing,
    notPassing,
    scoredFiles,
    waveOf,
    mode: typeof record.mode === 'string' ? record.mode : '',
    stoppedEarly: typeof record.stoppedEarly === 'string' ? record.stoppedEarly : null,
  };
}
