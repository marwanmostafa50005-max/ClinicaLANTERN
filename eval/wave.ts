// Reads a wave folder in place, so its criteria can be scored before they are in the repository.
//
//   <wave>/criteria/<ID>/criterion.json      one criterion
//   <wave>/criteria/<ID>/NOT_DRAFTED.md      in its place when the criterion was not drafted
//   <wave>/cases/<ID>/*.csv                  its fictional test histories
//   <wave>/cases/<ID>/expected.part.json     its part of the answer sheet
//
// A folder with NOT_DRAFTED.md and no criterion.json is "not drafted". A criterion file, an answer
// part or a history that will not load makes that one criterion "files not usable", with the
// reason. The other criteria still run.

import fs from 'node:fs';
import path from 'node:path';
import type { Criterion, ExpectedCase } from '../shared/types.ts';
import type { CaseRun, Pipeline } from './types.ts';
import { checkSheet, oneLine } from './score.ts';
import { errorText, folderOf, isFile, isFolder, loadOneCriterionFrom, neverOpened, readCase, sha256OfFile, withoutFolder, withoutMark } from './files.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export interface WaveFolder {
  name: string;                 // the folder's own name, for example "W101"
  dir: string;                  // its full path on this computer (never written into the results)
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

function subfolders(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(byName);
  } catch {
    return [];
  }
}

// Turns what was typed after --wave into wave folders. A folder with a "criteria" folder in it is
// a wave folder. A folder that holds wave folders stands for all of them, in name order.
export function findWaveFolders(given: string[], cwd: string): { waves: WaveFolder[]; errors: string[] } {
  const waves: WaveFolder[] = [];
  const errors: string[] = [];
  const seenDirs = new Set<string>();
  const add = (dir: string): void => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seenDirs.has(key)) return;
    seenDirs.add(key);
    waves.push({ name: path.basename(dir), dir });
  };
  for (const typed of given) {
    const dir = path.resolve(cwd, typed);
    if (neverOpened(dir)) {
      errors.push(`This folder is never opened: ${typed}`);
      continue;
    }
    if (!isFolder(dir)) {
      errors.push(`The wave folder was not found: ${typed}`);
      continue;
    }
    if (isFolder(path.join(dir, 'criteria'))) {
      add(dir);
      continue;
    }
    const inside = subfolders(dir).filter((name) => !neverOpened(name) && isFolder(path.join(dir, name, 'criteria')));
    if (inside.length === 0) {
      errors.push(`This is not a wave folder: ${typed}. It has no "criteria" folder, and no folder inside it has one.`);
      continue;
    }
    for (const name of inside) add(path.join(dir, name));
  }
  const names = new Map<string, number>();
  for (const wave of waves) names.set(wave.name.toLowerCase(), (names.get(wave.name.toLowerCase()) ?? 0) + 1);
  for (const wave of waves) {
    if ((names.get(wave.name.toLowerCase()) ?? 0) > 1) {
      errors.push(`Two wave folders have the same name: ${wave.name}. Give each wave folder a name of its own.`);
      names.set(wave.name.toLowerCase(), 0);
    }
  }
  return { waves, errors };
}

export type WaveItemStatus = 'ready' | 'not_drafted' | 'not_usable';

// One criterion folder of a wave folder, as it was read.
export interface WaveItem {
  wave: string;
  id: string;
  status: WaveItemStatus;
  reason: string;               // empty when ready; "not drafted"; or why the files are not usable
  criterion: Criterion | null;  // set when ready
  entries: ExpectedCase[];      // its part of the answer sheet
  cases: CaseRun[];             // its histories, as read
  warnings: string[];           // things to look at; they do not stop the criterion
  files: Record<string, string>;   // path inside the wave folder -> SHA-256, for the files that are scored
}

function notUsable(wave: string, id: string, reason: string): WaveItem {
  return { wave, id, status: 'not_usable', reason: oneLine(reason, 400), criterion: null, entries: [], cases: [], warnings: [], files: {} };
}

function readJsonFile(file: string): unknown {
  return JSON.parse(withoutMark(fs.readFileSync(file, 'utf8')));
}

// Reads every criterion folder of one wave folder. firstCaseIndex numbers the histories on from
// the waves read before. taken remembers which wave an ID was first seen in.
export async function readWaveFolder(
  pipeline: Pipeline,
  wave: WaveFolder,
  firstCaseIndex: number,
  taken: Map<string, string>,
): Promise<WaveItem[]> {
  const criteriaDir = path.join(wave.dir, 'criteria');
  const casesDir = path.join(wave.dir, 'cases');
  const items: WaveItem[] = [];
  let caseIndex = firstCaseIndex;
  // A reason from the loader may quote the full path of the file. The results name the wave folder only.
  const errorWords = (err: unknown): string => withoutFolder(errorText(err), wave.dir, wave.name);

  for (const id of subfolders(criteriaDir)) {
    if (neverOpened(id)) continue;
    const folder = path.join(criteriaDir, id);
    const criterionFile = path.join(folder, 'criterion.json');

    if (!isFile(criterionFile)) {
      if (isFile(path.join(folder, 'NOT_DRAFTED.md'))) {
        items.push({ wave: wave.name, id, status: 'not_drafted', reason: 'not drafted', criterion: null, entries: [], cases: [], warnings: [], files: {} });
      } else {
        items.push(notUsable(wave.name, id, 'the folder has no criterion.json and no NOT_DRAFTED.md'));
      }
      continue;
    }
    if (!SAFE_ID.test(id)) {
      items.push(notUsable(wave.name, id, 'the folder name cannot be used as a criterion ID'));
      continue;
    }
    const firstWave = taken.get(id.toLowerCase());
    if (firstWave !== undefined) {
      items.push(notUsable(wave.name, id, `the same criterion ID is also in ${firstWave}. An ID must be in one wave folder only`));
      continue;
    }
    taken.set(id.toLowerCase(), wave.name);

    // The criterion file, through the pipeline's own loader: what loads here is what the app would load.
    let criterion: Criterion;
    try {
      criterion = await loadOneCriterionFrom(pipeline, criteriaDir, id);
    } catch (err) {
      items.push(notUsable(wave.name, id, `criterion.json: ${errorWords(err)}`));
      continue;
    }
    if (typeof criterion.id !== 'string' || criterion.id !== id) {
      items.push(notUsable(wave.name, id, `criterion.json gives the ID "${String(criterion.id)}", but its folder is named ${id}`));
      continue;
    }

    // Its part of the answer sheet.
    const partFile = path.join(casesDir, id, 'expected.part.json');
    if (!isFile(partFile)) {
      items.push(notUsable(wave.name, id, `cases/${id}/expected.part.json was not found`));
      continue;
    }
    let part: unknown;
    try {
      part = readJsonFile(partFile);
    } catch (err) {
      items.push(notUsable(wave.name, id, `expected.part.json could not be read. ${errorWords(err)}`));
      continue;
    }
    const listed = Array.isArray(part) ? part : (part as { cases?: unknown } | null)?.cases;
    if (!Array.isArray(listed)) {
      items.push(notUsable(wave.name, id, 'expected.part.json is not a list of histories'));
      continue;
    }
    const checked = checkSheet({ signed_by_clinical_reviewer: null, cases: listed });
    if (checked.sheet === null) {
      items.push(notUsable(wave.name, id, `expected.part.json: ${checked.fatal.join(' ')}`));
      continue;
    }
    const entries = checked.sheet.cases;
    const outside = entries.find((entry) => folderOf(entry.file) !== id);
    if (outside) {
      items.push(notUsable(wave.name, id, `expected.part.json names ${outside.file}, which is not in the folder ${id}`));
      continue;
    }

    // Its histories, through the pipeline's own CSV reader.
    const cases: CaseRun[] = [];
    const unread: string[] = [];
    for (const entry of entries) {
      const read = readCase(pipeline, casesDir, entry, caseIndex + cases.length);
      read.wave = wave.name;
      cases.push(read);
      if (read.cannotAssess !== null) unread.push(`${path.basename(entry.file)}: ${read.cannotAssess}`);
    }
    if (unread.length > 0) {
      items.push(notUsable(wave.name, id, unread.join(' ')));
      continue;
    }
    caseIndex += cases.length;

    const warnings = [...checked.warnings];
    const named = new Set(entries.map((entry) => path.basename(entry.file).toLowerCase()));
    let inFolder: string[] = [];
    try {
      inFolder = fs.readdirSync(path.join(casesDir, id)).filter((name) => name.toLowerCase().endsWith('.csv'));
    } catch {
      inFolder = [];
    }
    for (const name of inFolder.sort(byName)) {
      if (!named.has(name.toLowerCase())) warnings.push(`${id}/${name}: the file is in the wave folder, but expected.part.json does not list it. It was not scored.`);
    }

    const files: Record<string, string> = {};
    try {
      files[`criteria/${id}/criterion.json`] = sha256OfFile(criterionFile);
      files[`cases/${id}/expected.part.json`] = sha256OfFile(partFile);
      for (const entry of entries) files[`cases/${entry.file}`] = sha256OfFile(path.join(casesDir, entry.file));
    } catch (err) {
      items.push(notUsable(wave.name, id, `a file could not be read again. ${errorWords(err)}`));
      caseIndex -= cases.length;
      continue;
    }

    items.push({ wave: wave.name, id, status: 'ready', reason: '', criterion, entries, cases, warnings, files });
  }
  return items;
}
