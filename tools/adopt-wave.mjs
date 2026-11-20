// tools/adopt-wave.mjs
//
// Brings the criteria of a wave folder that passed their scored run into the repository.
//
//   node tools/adopt-wave.mjs --wave <folder> --results <results.json of a wave run> [--dry-run]
//
// For each criterion of the wave folder that is in the "passing" list of the results AND that the
// case check (tools/check-cases.mjs --wave) calls ok:
//   1. it copies <wave>/criteria/<ID>/ and <wave>/cases/<ID>/ into the repository;
//   2. it adds the ID to the "further" list of criteria/active.json. The first ten (active) and
//      the reserves are never touched, and an ID is never added twice;
//   3. it adds the histories of the criterion to cases/expected.json.
//
// It never writes over a criterion folder or a cases folder that is already in the repository: it
// reports it and skips. When the folders are already there and are byte for byte the same (an
// earlier run was stopped half way), it only completes the list and the answer sheet.
// It prints what it did. With --dry-run it prints what it would do and writes nothing.
//
// A third thing is checked when the results allow it: the files in the wave folder must be the
// files that were scored. The scorer keeps a fingerprint (SHA-256) of each file it scored. A file
// that changed after the run is not adopted. Score the wave folder again.
//
// One adoption runs at a time. While it writes, a small lock file sits in the criteria folder
// (criteria/.adopt-wave.lock). It is taken away at the end. A second adoption that is started
// meanwhile stops and says so. A lock left by a run that is gone is taken over.
//
// Other options:
//   --repo <folder>      the repository to adopt into. The default is the one this tool is in.
//   --sheet <file>       the answer sheet to add to. The default is cases/expected.json. When the
//                        sheet does not exist it is made, and the tool says so. A sheet made this
//                        way holds the adopted histories only, and it is not signed.
//   --signed-sheet-ok    add to an answer sheet that the clinical reviewer has signed. A signed
//                        sheet is changed only with his word (docs/SPEC.md section 9).
//   --wave may be given again, or with commas. A folder that holds wave folders stands for all of them.
//
// Ends with code 0 when it ran and nothing went wrong while writing, 1 when a copy or a file could
// not be written, 2 when it could not run. A criterion that is skipped is not an error.
// Fictional patients only. The models are not called.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkWaveFolder } from './check-cases.mjs';
import { findWaveFolders } from '../eval/wave.ts';
import { formatList, formatSheet, planAdoption, readList, readResultsLists, withCases, withFurther } from '../eval/adopt.ts';

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEVER_OPEN = ['sealed', 'holdout', 'review-card', 'founder-review-queue', 'synthetic_cases'];

export const USAGE = [
  'Use: node tools/adopt-wave.mjs --wave <folder> --results <results.json of a wave run> [--dry-run]',
  '',
  'It adopts the criteria of the wave folder that are in the passing list of the results and that the',
  'case check calls ok. It copies their folders into the repository, adds their IDs to the further',
  'list of criteria/active.json and adds their histories to cases/expected.json.',
  'It never writes over a folder that is already there. With --dry-run it writes nothing.',
  '',
  'Options:',
  '  --wave <folder>      A wave folder. Give it again, or use commas, for several.',
  '  --results <file>     The results.json of the wave run that scored it.',
  '  --dry-run            Say what would be done. Write nothing.',
  '  --repo <folder>      The repository to adopt into. The default is the one this tool is in.',
  '  --sheet <file>       The answer sheet to add to. The default is cases/expected.json.',
  '                       When it does not exist it is made, not signed, and the tool says so.',
  '  --signed-sheet-ok    Add to an answer sheet that is signed. Only with the clinical reviewer\'s word.',
  '  --help               Show this text.'
].join('\n');

// ---------- small helpers ----------

class CannotRun extends Error {}

// Some editors put a byte order mark at the start of a file. It is not part of the text.
function withoutMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(file) {
  return JSON.parse(withoutMark(fs.readFileSync(file, 'utf8')));
}

function isFolder(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function isFile(target) {
  try { return fs.statSync(target).isFile(); } catch { return false; }
}

function neverOpened(target) {
  const low = String(target).toLowerCase();
  return NEVER_OPEN.some((word) => low.includes(word));
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function errorWords(err) {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
}

// Every file under a folder, as paths from that folder with forward slashes, in name order.
// Throws when the folder holds something that is not a plain file or folder, or a name that is never opened.
function filesUnder(folder) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (neverOpened(entry.name)) throw new Error(`${rel} is a name that is never opened or copied`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
      else throw new Error(`${rel} is not a plain file`);
    }
  };
  walk(folder, '');
  return out;
}

// True when two folders hold the same files with the same bytes.
function sameFolder(a, b) {
  const filesA = filesUnder(a);
  const filesB = filesUnder(b);
  if (filesA.length !== filesB.length || filesA.some((f, i) => f !== filesB[i])) return false;
  return filesA.every((f) => sha256(path.join(a, f)) === sha256(path.join(b, f)));
}

// Copies a folder to a place that does not exist yet. The copy is made beside the target under
// another name and then given its name, so a half copy never sits under the real name.
function copyFolderNew(from, to) {
  if (fs.existsSync(to)) throw new Error(`${path.basename(to)} is already there`);
  const staging = `${to}.adopting-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    for (const rel of filesUnder(from)) {
      const target = path.join(staging, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(from, rel), target, fs.constants.COPYFILE_EXCL);
    }
    if (!fs.existsSync(staging)) fs.mkdirSync(staging, { recursive: true });
    fs.renameSync(staging, to);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

// Writes a file in one step: the text goes to a new file beside it, which then takes its name.
function writeFileWhole(file, text) {
  const staging = `${file}.adopting-${process.pid}`;
  fs.writeFileSync(staging, text, 'utf8');
  fs.renameSync(staging, file);
}

// ---------- options ----------

export function parseArgs(argv) {
  const options = { waves: [], results: null, dryRun: false, repo: null, sheet: null, signedSheetOk: false, help: false };
  const errors = [];
  const list = (value) => value.split(',').map((v) => v.trim()).filter((v) => v !== '');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let name = arg;
    let inline = null;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) { name = arg.slice(0, eq); inline = arg.slice(eq + 1); }
    const value = () => {
      if (inline !== null) return inline.trim() === '' ? null : inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i++;
      return next;
    };
    switch (name) {
      case '--help': case '-h': options.help = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--signed-sheet-ok': options.signedSheetOk = true; break;
      case '--wave': {
        const v = value();
        if (v === null || list(v).length === 0) errors.push('Option --wave needs a wave folder.');
        else options.waves.push(...list(v));
        break;
      }
      case '--results': {
        const v = value();
        if (v === null) errors.push('Option --results needs the results.json of a wave run.');
        else if (options.results !== null) errors.push('Give --results once.');
        else options.results = v;
        break;
      }
      case '--repo': {
        const v = value();
        if (v === null) errors.push('Option --repo needs a folder.');
        else options.repo = v;
        break;
      }
      case '--sheet': {
        const v = value();
        if (v === null) errors.push('Option --sheet needs the path of an answer sheet.');
        else options.sheet = v;
        break;
      }
      default:
        errors.push(`Unknown option: ${arg}`);
    }
  }
  if (!options.help) {
    if (options.waves.length === 0) errors.push('Give the wave folder: --wave <folder>.');
    if (options.results === null) errors.push('Give the results of its wave run: --results <results.json>.');
  }
  return { options, errors };
}

// ---------- the run ----------

export function main(argv, env = {}) {
  const log = env.log ?? ((line) => console.log(line));
  const cwd = path.resolve(env.cwd ?? process.cwd());
  const { options, errors } = parseArgs(argv);
  if (options.help) {
    log(USAGE);
    return 0;
  }
  if (errors.length > 0) {
    for (const e of errors) log(e);
    log('');
    log(USAGE);
    return 2;
  }
  try {
    return adopt(options, cwd, log);
  } catch (err) {
    // What stops the helper before it starts is found before anything is written.
    if (err instanceof CannotRun) log(err.message);
    else {
      log(`The adoption helper stopped with an error. ${errorWords(err)}`);
      log('Nothing more was written. Run it again: it completes what is half done and writes over nothing.');
    }
    return 2;
  }
}

// True when a process with this number is running on this computer.
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

// One adoption at a time. Two that ran together would each read the list and the answer sheet,
// and the one that wrote last would drop what the other had added. The lock is a small file in the
// criteria folder. A lock left behind by a run that is gone is taken over.
function takeLock(repo) {
  const file = path.join(repo, 'criteria', '.adopt-wave.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = fs.openSync(file, 'wx');
      fs.writeSync(handle, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(handle);
      return file;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      let owner = null;
      try {
        owner = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        owner = null;
      }
      if (owner && Number.isInteger(owner.pid) && owner.pid !== process.pid && isRunning(owner.pid)) {
        throw new CannotRun(`Another adoption is running (process ${owner.pid}, started ${String(owner.at ?? 'at a time it does not give')}). Wait for it to end, then run this again. Nothing was written.`);
      }
      fs.rmSync(file, { force: true });
    }
  }
  throw new CannotRun('The adoption lock could not be taken (criteria/.adopt-wave.lock). Nothing was written.');
}

function adopt(options, cwd, log) {
  const repo = path.resolve(cwd, options.repo ?? TOOL_ROOT);
  if (!isFolder(path.join(repo, 'criteria')) || !isFolder(path.join(repo, 'cases'))) {
    throw new CannotRun(`This is not the repository: ${options.repo ?? repo}. It has no criteria folder or no cases folder.`);
  }
  // The lock is taken before the list and the answer sheet are read. A dry run reads only, so it takes none.
  const lock = options.dryRun ? null : takeLock(repo);
  try {
    return adoptInto(repo, options, cwd, log);
  } finally {
    if (lock !== null) fs.rmSync(lock, { force: true });
  }
}

function adoptInto(repo, options, cwd, log) {
  const dry = options.dryRun;

  // ----- the repository -----
  const listFile = path.join(repo, 'criteria', 'active.json');
  let listRaw;
  let list;
  try {
    listRaw = readJson(listFile);
    list = readList(listRaw);
  } catch (err) {
    throw new CannotRun(`The list of criteria could not be used (criteria/active.json). ${errorWords(err)}`);
  }

  let sheetFile = options.sheet === null ? path.join(repo, 'cases', 'expected.json') : path.resolve(cwd, options.sheet);
  if (options.sheet !== null && !fs.existsSync(sheetFile) && !path.isAbsolute(options.sheet)) sheetFile = path.resolve(repo, options.sheet);
  const sheetName = path.relative(repo, sheetFile).split(path.sep).join('/');
  let sheetRaw;
  let sheetIsNew = false;
  if (fs.existsSync(sheetFile)) {
    try {
      sheetRaw = readJson(sheetFile);
    } catch (err) {
      throw new CannotRun(`The answer sheet could not be read (${sheetName}). ${errorWords(err)}`);
    }
    if (typeof sheetRaw !== 'object' || sheetRaw === null || !Array.isArray(sheetRaw.cases)) {
      throw new CannotRun(`The answer sheet has no "cases" list (${sheetName}).`);
    }
    const signed = sheetRaw.signed_by_clinical_reviewer;
    if (signed && !options.signedSheetOk) {
      throw new CannotRun(
        `The answer sheet ${sheetName} is signed by ${String(signed.name ?? 'the clinical reviewer')} on ${String(signed.date ?? 'a date it does not give')}. ` +
        'A signed sheet is changed only with his word (docs/SPEC.md section 9). Nothing was written. With his word, run this again with --signed-sheet-ok.'
      );
    }
  } else {
    // No answer sheet yet. It is made, not signed, and the tool says so in its first lines and in its last.
    if (!isFolder(path.dirname(sheetFile))) throw new CannotRun(`The answer sheet cannot be made: the folder of ${sheetName} does not exist.`);
    sheetRaw = { signed_by_clinical_reviewer: null, cases: [] };
    sheetIsNew = true;
  }

  // ----- the results of the wave run -----
  const resultsFile = path.resolve(cwd, options.results);
  let results;
  try {
    results = readResultsLists(readJson(resultsFile));
  } catch (err) {
    const missing = err && err.code === 'ENOENT';
    throw new CannotRun(missing ? `The results file was not found: ${options.results}` : `The results file could not be used: ${options.results}. ${errorWords(err)}`);
  }

  // ----- the wave folders -----
  const found = findWaveFolders(options.waves, cwd);
  if (found.errors.length > 0) throw new CannotRun(found.errors.join('\n'));

  log(`ClinicaLANTERN adoption helper.${dry ? ' DRY RUN: nothing is written.' : ''} Fictional patients only.`);
  log(`Repository: ${repo}`);
  log(`Results: ${resultsFile}. Passing: ${results.passing.length}. Not passing: ${Object.keys(results.notPassing).length}.`);
  if (results.stoppedEarly) log(`Note: that run stopped early. ${results.stoppedEarly} Only the criteria it finished can be in its passing list.`);
  if (results.mode !== '' && results.mode !== 'wave') log(`Note: those results are from a ${results.mode} run, not a wave run.`);
  if (sheetIsNew) {
    log(dry
      ? `Answer sheet: ${sheetName} was not found. A real run would make it, not signed. It would hold the adopted histories only: the histories of the first ten are not in it.`
      : `Answer sheet: ${sheetName} was not found. It is made when a history is added, and it is not signed. It holds the adopted histories only: the histories of the first ten are not in it.`);
  } else {
    log(`Answer sheet: ${sheetName}.`);
  }

  let sheetNow = sheetRaw;
  let listNow = listRaw;
  const totals = { adopted: 0, completed: 0, skipped: 0, failed: 0, histories: 0, furtherAdded: 0 };
  const decided = [];

  for (const wave of found.waves) {
    const checked = checkWaveFolder(wave.dir, wave.name);
    const verdictOf = Object.fromEntries(checked.criteria.map((c) => [c.id, { status: c.status, problems: c.problems }]));
    const criteria = checked.criteria.map((c) => ({ id: c.id, drafted: c.status !== 'not_drafted' }));

    // The files in the wave folder must be the files that were scored.
    const changedSinceScored = {};
    const parts = {};
    const repoState = {};
    const repoDetail = {};
    const withoutFingerprint = [];
    for (const c of checked.criteria) {
      if (c.status === 'not_drafted') continue;
      const scored = results.scoredFiles[c.id];
      if (scored) {
        for (const [rel, hash] of Object.entries(scored)) {
          const steps = rel.split('/');
          // Only files inside this criterion's two folders are read.
          const inside = steps.length >= 3 && (steps[0] === 'criteria' || steps[0] === 'cases') && steps[1] === c.id && !steps.some((s) => s === '..' || s === '');
          if (!inside) { changedSinceScored[c.id] = `the results name ${rel}, which is not a file of this criterion`; break; }
          const file = path.join(wave.dir, ...steps);
          if (!isFile(file)) { changedSinceScored[c.id] = `${rel} is no longer there`; break; }
          if (sha256(file) !== hash) { changedSinceScored[c.id] = rel; break; }
        }
      } else if (results.passing.includes(c.id)) {
        withoutFingerprint.push(c.id);
      }
      try {
        const part = readJson(path.join(wave.dir, 'cases', c.id, 'expected.part.json'));
        parts[c.id] = Array.isArray(part) ? part : Array.isArray(part?.cases) ? part.cases : [];
      } catch {
        parts[c.id] = [];
      }
      // How the two folders stand in the repository now.
      const fromCriteria = path.join(wave.dir, 'criteria', c.id);
      const fromCases = path.join(wave.dir, 'cases', c.id);
      const toCriteria = path.join(repo, 'criteria', c.id);
      const toCases = path.join(repo, 'cases', c.id);
      const hasCriteria = fs.existsSync(toCriteria);
      const hasCases = fs.existsSync(toCases);
      if (!hasCriteria && !hasCases) repoState[c.id] = 'absent';
      else {
        let same = false;
        try {
          same = hasCriteria && hasCases && isFolder(fromCases) && sameFolder(fromCriteria, toCriteria) && sameFolder(fromCases, toCases);
        } catch {
          same = false;
        }
        repoState[c.id] = same ? 'same' : 'different';
        repoDetail[c.id] = hasCriteria ? `criteria/${c.id}` : `cases/${c.id}`;
      }
    }

    const decisions = planAdoption({
      wave: wave.name,
      criteria,
      passing: results.passing,
      notPassing: results.notPassing,
      check: verdictOf,
      changedSinceScored,
      repo: repoState,
      repoDetail,
      list: readList(listNow),
      sheetFiles: sheetNow.cases.map((c) => (c && typeof c.file === 'string' ? c.file : '')).filter((f) => f !== ''),
      parts
    });

    log('');
    log(`Wave folder ${wave.name}: ${decisions.length} criterion ${decisions.length === 1 ? 'folder' : 'folders'}.`);
    if (withoutFingerprint.length > 0) {
      log(`Note: the results hold no file fingerprints for ${withoutFingerprint.join(', ')}. It could not be checked that these are the files that were scored.`);
    }

    for (const decision of decisions) {
      if (decision.action === 'skip') {
        totals.skipped++;
        log(`SKIPPED  ${decision.id}  ${decision.reason}`);
        decided.push({ wave: wave.name, id: decision.id, action: 'skipped', reason: decision.reason });
        continue;
      }
      // ----- the copy -----
      let copied = true;
      if (decision.copyFolders && !dry) {
        const fromCriteria = path.join(wave.dir, 'criteria', decision.id);
        const fromCases = path.join(wave.dir, 'cases', decision.id);
        const toCriteria = path.join(repo, 'criteria', decision.id);
        const toCases = path.join(repo, 'cases', decision.id);
        try {
          copyFolderNew(fromCriteria, toCriteria);
          try {
            copyFolderNew(fromCases, toCases);
          } catch (err) {
            // The criterion folder was made by this run a moment ago. It is taken away again, so no half adoption stays.
            fs.rmSync(toCriteria, { recursive: true, force: true });
            throw err;
          }
        } catch (err) {
          copied = false;
          totals.failed++;
          log(`FAILED   ${decision.id}  the folders could not be copied. ${errorWords(err)} Nothing of this criterion was left in the repository.`);
          decided.push({ wave: wave.name, id: decision.id, action: 'failed', reason: errorWords(err) });
        }
      }
      if (!copied) continue;

      // ----- the list and the answer sheet, in memory; they are written once, at the end -----
      if (decision.addToFurther) {
        listNow = withFurther(listNow, [decision.id]);
        totals.furtherAdded++;
      }
      if (decision.addCases.length > 0) {
        const next = withCases(sheetNow, decision.addCases);
        sheetNow = next.sheet;
        totals.histories += next.added;
      }
      if (decision.action === 'adopt') totals.adopted++;
      else totals.completed++;
      const word = decision.action === 'adopt' ? (dry ? 'WOULD ADOPT' : 'ADOPTED') : (dry ? 'WOULD COMPLETE' : 'COMPLETED');
      log(`${word}  ${decision.id}  ${whatWasDone(decision, dry)}`);
      decided.push({ wave: wave.name, id: decision.id, action: decision.action, reason: decision.reason });
    }
  }

  // ----- the two files: the answer sheet first, then the list -----
  const sheetChanged = totals.histories > 0;
  const listChanged = totals.furtherAdded > 0;
  let writeFailed = false;
  if (!dry) {
    try {
      if (sheetChanged) writeFileWhole(sheetFile, formatSheet(sheetNow));
    } catch (err) {
      writeFailed = true;
      log(`FAILED   the answer sheet could not be written (${sheetName}). ${errorWords(err)}`);
    }
    try {
      if (listChanged && !writeFailed) writeFileWhole(listFile, formatList(listNow));
    } catch (err) {
      writeFailed = true;
      log(`FAILED   criteria/active.json could not be written. ${errorWords(err)}`);
    }
    if (writeFailed) log('The folders that were copied are in place. Run this again: it completes the list and the answer sheet.');
  }

  log('');
  log(dry ? 'DRY RUN. Nothing was written. This is what would be done:' : 'What was done:');
  log(`  Adopted: ${totals.adopted}. Completed: ${totals.completed}. Skipped: ${totals.skipped}. Failed: ${totals.failed}.`);
  log(`  IDs added to the further list of criteria/active.json: ${totals.furtherAdded}. The first ten and the reserves were not touched.`);
  log(`  Histories added to ${sheetName}: ${totals.histories}.${sheetIsNew && totals.histories > 0 ? ` The sheet did not exist. It ${dry ? 'would be' : 'was'} made, not signed.` : ''}`);
  if (!dry && (sheetChanged || listChanged) && !writeFailed) {
    log('Next: run "node tools/check-cases.mjs" and "npm test". Start a clean demo before you use the page: the list of criteria changed.');
  }
  return totals.failed > 0 || writeFailed ? 1 : 0;
}

// What was done for one criterion, or what would be done in a dry run, in one line.
function whatWasDone(decision, dry) {
  const id = decision.id;
  const n = decision.addCases.length;
  const steps = [];
  if (decision.copyFolders) steps.push(`${dry ? 'would copy' : 'copied'} criteria/${id} and cases/${id}`);
  else steps.push('the folders were already in the repository, the same files');
  steps.push(decision.addToFurther ? `${dry ? 'would add' : 'added'} the ID to the further list` : 'the ID was already in the list');
  steps.push(n > 0 ? `${dry ? 'would add' : 'added'} ${n} ${n === 1 ? 'history' : 'histories'} to the answer sheet` : 'its histories were already in the answer sheet');
  return `${steps.join('; ')}.`;
}

function startedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const here = fs.realpathSync(fileURLToPath(import.meta.url));
    const there = fs.realpathSync(path.resolve(entry));
    return process.platform === 'win32' ? here.toLowerCase() === there.toLowerCase() : here === there;
  } catch {
    return false;
  }
}

if (startedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
