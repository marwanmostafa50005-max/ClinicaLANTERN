// Reading the files of a test run: one history, a list of criteria, a fingerprint of a file.
// The scorer (eval/run.ts) and the wave reader (eval/wave.ts) both use these.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Criterion, ExpectedCase, HistoryLine } from '../shared/types.ts';
import { isFactLine } from '../shared/facts.ts';
import type { CaseRun, Pipeline } from './types.ts';
import { oneLine, stringList } from './score.ts';

export function errorText(err: unknown): string {
  return oneLine(err instanceof Error ? err.message : String(err), 300);
}

// Some editors put a byte order mark at the start of a file. It is not part of the text.
export function withoutMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function folderOf(file: string): string {
  const parts = file.split(/[\\/]+/).filter((p) => p !== '');
  return parts.slice(0, -1).join('/');
}

export function isFolder(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

// These are never opened, whatever an option says (the test data of the earlier project).
export const NEVER_OPENED = ['sealed', 'holdout', 'review-card', 'founder-review-queue', 'synthetic_cases'];

export function neverOpened(target: string): boolean {
  const low = target.toLowerCase();
  return NEVER_OPENED.some((word) => low.includes(word));
}

// A fingerprint of a file as it is on disk now, so a later step can tell whether the file changed.
export function sha256OfFile(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// The lines that are a condition, a result or an observation: "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2"
// (docs/SPEC.md section 6a). Which line is a fact is decided by the one shared rule (shared/facts.ts).
export function factLineIdsOf(lines: HistoryLine[]): string[] {
  return lines.filter((l) => isFactLine(l.text)).map((l) => l.id);
}

// Reads one history the way the app does: the CSV text goes to the pipeline's own reader.
// A history that cannot be read is never screened, and it is never "no findings".
export function readCase(pipeline: Pipeline, casesDir: string, expected: ExpectedCase, index: number): CaseRun {
  const run: CaseRun = {
    caseId: `C${String(index + 1).padStart(4, '0')}`,
    file: expected.file,
    folder: folderOf(expected.file),
    kind: expected.kind,
    about: expected.about,
    findings: expected.findings,
    patient: null,
    lines: [],
    problems: [],
    cannotAssess: null,
  };
  const full = path.resolve(casesDir, expected.file);
  if (!isInside(casesDir, full)) {
    run.cannotAssess = 'The file is not inside the cases folder.';
    return run;
  }
  if (path.extname(full).toLowerCase() !== '.csv') {
    run.cannotAssess = 'Only CSV histories can be scored.';
    return run;
  }
  let text: string;
  try {
    text = withoutMark(fs.readFileSync(full, 'utf8'));   // the browser drops this mark too
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code !== 'ENOENT') run.cannotAssess = `The file could not be opened (${String(code ?? 'unknown error')}).`;
    else if (/^cases[\\/]/i.test(expected.file)) run.cannotAssess = 'The file was not found. Write the path from inside the cases folder, without "cases/" at the start.';
    else run.cannotAssess = 'The file was not found.';
    return run;
  }

  let parsed: ReturnType<Pipeline['parseCsv']>;
  try {
    parsed = pipeline.parseCsv(text);
  } catch (err) {
    run.cannotAssess = `The CSV reader stopped with an error. ${errorText(err)}`;
    return run;
  }
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const wellFormed = lines.every((l) => typeof l?.id === 'string' && typeof l?.text === 'string');
  run.problems = stringList(parsed?.problems);
  if (!parsed || typeof parsed.patient?.label !== 'string' || !wellFormed) {
    run.cannotAssess = 'The CSV reader gave an answer the scorer cannot use.';
    return run;
  }
  run.patient = parsed.patient;
  run.lines = lines;
  const facts = factLineIdsOf(lines);
  if (facts.length > 0) run.factLineIds = facts;
  if (run.problems.length > 0) run.cannotAssess = `The CSV reader reported a problem. ${run.problems.join(' ')}`;
  else if (lines.length === 0) run.cannotAssess = 'The history has no lines.';
  return run;
}

// ---------- criteria that are not loaded by the pipeline's own list ----------

// Loads one criterion through the pipeline's own loader: <criteriaDir>/<id>/criterion.json.
// What loads here is what the app would load. One criterion is asked for at a time, so a file that
// does not load gives its own reason and never takes another criterion with it.
export async function loadOneCriterionFrom(pipeline: Pipeline, criteriaDir: string, id: string): Promise<Criterion> {
  const load = pipeline.loadCriteriaFrom;
  if (typeof load !== 'function') throw new Error('The pipeline does not have: loadCriteriaFrom.');
  const list = await load.call(pipeline, criteriaDir, [id]);
  const found = Array.isArray(list) ? list.find((c) => c && typeof c === 'object') : undefined;
  if (!found) throw new Error(`Criterion ${id} did not load: the loader gave nothing back.`);
  return found;
}

// A reason may quote a full path of this computer. Results name a folder by its own name only.
export function withoutFolder(text: string, folder: string, name: string): string {
  let out = text;
  for (const form of new Set([folder, folder.split('\\').join('/'), folder.split('/').join('\\')])) {
    if (form === '') continue;
    // Windows paths are not case sensitive: a drive letter may come back in the other case.
    const lower = out.toLowerCase();
    const want = form.toLowerCase();
    if (lower.length !== out.length || want.length !== form.length) {
      out = out.split(form).join(name);
      continue;
    }
    let rebuilt = '';
    let from = 0;
    for (let at = lower.indexOf(want, from); at !== -1; at = lower.indexOf(want, from)) {
      rebuilt += out.slice(from, at) + name;
      from = at + form.length;
    }
    out = rebuilt + out.slice(from);
  }
  return out;
}
