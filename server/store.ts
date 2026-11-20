// The state file: data/state.json. Everything that happened is in it.
// It is written after every step, and always as a whole new file that then replaces the old one,
// so a crash in the middle of a write cannot leave half a file.
import fs from 'node:fs';
import path from 'node:path';
import type { AppState } from '../shared/types.ts';

export function emptyState(): AppState {
  return { version: 1, cases: [], findings: [], letters: [], jobs: [], activity: [] };
}

function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes a file so that readers only ever see the old text or the new text, never a mix. */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = fs.openSync(temp, 'w');
  try {
    fs.writeSync(handle, text);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (e) {
      // On Windows another program (a virus scanner, a backup tool) can hold the file for a moment.
      if (attempt >= 6) {
        try { fs.unlinkSync(temp); } catch { /* nothing more to do */ }
        throw e;
      }
      pauseSync(25 * attempt);
    }
  }
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isList = (value: unknown, each: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(each);

function isCase(value: unknown): boolean {
  if (!isObj(value)) return false;
  const screening = value.screening;
  return isText(value.id) && isText(value.fileName) && isText(value.source) && isObj(value.patient) && isText(value.patient.label) &&
    isList(value.lines, line => isObj(line) && isText(line.id) && isText(line.text)) &&
    typeof value.transcriptionConfirmed === 'boolean' && typeof value.parts === 'number' &&
    isObj(screening) && isText(screening.status) &&
    isList(screening.criteria, run => isObj(run) && isText(run.criterionId) && isText(run.status));
}

function isFinding(value: unknown): boolean {
  if (!isObj(value)) return false;
  const screen = value.screen;
  const check = value.check;
  return isText(value.id) && isText(value.caseId) && isText(value.criterionId) && isText(value.state) &&
    isObj(screen) && isList(screen.lineIds, isText) && isList(screen.medicines, isText) && isText(screen.reason) &&
    // Added on 18 November (docs/SPEC.md section 6a). A state saved before then does not have them.
    (value.possible === undefined || typeof value.possible === 'boolean') &&
    (screen.missingFacts === undefined || isList(screen.missingFacts, isText)) &&
    (check === undefined || (isObj(check) && isList(check.lineIds, isText) && typeof check.confirmed === 'boolean' && typeof check.completed === 'boolean'));
}

/**
 * Fills in what a state saved before 18 November does not have: a finding with no list of missing
 * facts gets an empty one, and a finding with no "possible" mark is possible only when its list
 * names a fact. So an old state file still loads, and the rest of the program can rely on the fields.
 */
export function withNewFields(state: AppState): AppState {
  for (const finding of state.findings) {
    const loose = finding as { possible?: unknown; screen: { missingFacts?: unknown } };
    if (!Array.isArray(loose.screen.missingFacts)) finding.screen.missingFacts = [];
    if (typeof loose.possible !== 'boolean') finding.possible = finding.screen.missingFacts.length > 0;
  }
  return state;
}

function isLetter(value: unknown): boolean {
  return isObj(value) && isText(value.id) && isText(value.findingId) && isText(value.caseId) && isText(value.status) &&
    isText(value.subject) && isText(value.body);
}

function isJob(value: unknown): boolean {
  return isObj(value) && isText(value.id) && isText(value.stage) && isText(value.caseId) && isText(value.status);
}

function isActivity(value: unknown): boolean {
  return isObj(value) && isText(value.at) && isText(value.kind) && isText(value.text);
}

/**
 * True when the value has the shape of a state file, all the way in. A file that is valid JSON but
 * damaged inside (a case with no screening part, an empty entry in a list) is not a state: it
 * would stop the server from starting, or make every answer an error.
 */
export function isState(value: unknown): value is AppState {
  if (!isObj(value)) return false;
  return value.version === 1 && isList(value.cases, isCase) && isList(value.findings, isFinding) &&
    isList(value.letters, isLetter) && isList(value.jobs, isJob) && isList(value.activity, isActivity);
}

/** "2026-11-18T07-15-02" in local time: safe in a file name. */
export function fileStamp(when: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}T${p(when.getHours())}-${p(when.getMinutes())}-${p(when.getSeconds())}`;
}

/** The next ID in a list: "C0001", "C0002", ... A floor keeps a number that was given out before a reset. */
export function nextId(prefix: string, existing: { id: string }[], floor = 0): string {
  let max = floor;
  for (const item of existing) {
    if (item.id.startsWith(prefix)) {
      const n = Number(item.id.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(4, '0');
}

const ID_PREFIXES = ['C', 'F', 'T', 'J'] as const;
type IdPrefix = typeof ID_PREFIXES[number];

/** The highest number already given out for each kind of id, from the mark and from the records still held. */
export function keptIdMarks(state: AppState): Record<IdPrefix, number> {
  const marks: Record<IdPrefix, number> = { C: 0, F: 0, T: 0, J: 0, ...(state.issued ?? {}) };
  const scan = (prefix: IdPrefix, items: { id: string }[]): void => {
    for (const item of items) {
      if (!item.id.startsWith(prefix)) continue;
      const n = Number(item.id.slice(prefix.length));
      if (Number.isInteger(n) && n > marks[prefix]) marks[prefix] = n;
    }
  };
  scan('C', state.cases);
  scan('F', state.findings);
  scan('T', state.letters);
  scan('J', state.jobs);
  return marks;
}

/** Gives out the next id and remembers it, so a later reset cannot give the same id to another patient. */
export function takeId(state: AppState, prefix: IdPrefix, existing: { id: string }[]): string {
  const marks = keptIdMarks(state);
  const id = nextId(prefix, existing, marks[prefix]);
  const n = Number(id.slice(prefix.length));
  if (Number.isInteger(n) && n > marks[prefix]) marks[prefix] = n;
  state.issued = marks;
  return id;
}

export class StateStore {
  dataDir: string;
  file: string;
  backupDir: string;
  state: AppState;
  loadNote: string | null;            // set when the state file could not be read on start
  /** The file on disk is the only copy of a state that could not be read. save must not replace it. */
  private holdOriginal: boolean;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.backupDir = path.join(dataDir, 'backups');
    this.state = emptyState();
    this.loadNote = null;
    this.holdOriginal = false;
  }

  private freeBackupPath(name: string): string {
    fs.mkdirSync(this.backupDir, { recursive: true });
    let target = path.join(this.backupDir, `${name}.json`);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(this.backupDir, `${name}-${n}.json`);
    return target;
  }

  /** Reads the state file. A file that cannot be read is kept as a backup and a clean state is started. */
  load(now: Date = new Date()): void {
    this.loadNote = null;
    if (!fs.existsSync(this.file)) {
      this.state = emptyState();
      return;
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
      if (!isState(parsed)) throw new Error('not a state file');
      this.state = withNewFields(parsed);
    } catch {
      this.setAside(now);
    }
  }

  /**
   * Keeps the state file as a backup named "state-unreadable-<time>.json" and starts a clean state.
   * Used when the file cannot be read, and when the work in it cannot be picked up again.
   * When the copy cannot be made, the file is left as it is. A later save must not replace that only copy.
   */
  setAside(now: Date = new Date()): void {
    let name = '';
    let copyFailed = false;
    try {
      if (fs.existsSync(this.file)) {
        const kept = this.freeBackupPath(`state-unreadable-${fileStamp(now)}`);
        fs.copyFileSync(this.file, kept);
        name = path.basename(kept);
      }
    } catch {
      copyFailed = fs.existsSync(this.file);
    }
    this.state = emptyState();
    this.holdOriginal = copyFailed;
    this.loadNote = copyFailed
      ? 'The saved state could not be read, and it could not be kept as a backup. The file was left as it is.'
      : name
        ? `The saved state could not be read. It was kept as ${name} and a clean state was started.`
        : 'The saved state could not be read. A clean state was started.';
  }

  save(): void {
    if (this.holdOriginal) this.releaseOriginal();
    writeFileAtomic(this.file, JSON.stringify(this.state, null, 1));
  }

  /** Copies the held file aside. Throws, and writes nothing, when that copy still cannot be made. */
  private releaseOriginal(): void {
    if (!fs.existsSync(this.file)) {
      this.holdOriginal = false;
      return;
    }
    try {
      const kept = this.freeBackupPath(`state-unreadable-${fileStamp(new Date())}`);
      fs.copyFileSync(this.file, kept);
      this.holdOriginal = false;
    } catch {
      throw new Error('The saved state could not be copied aside, so the file was left as it is.');
    }
  }

  /** Starts a clean state. The old state file is kept as a dated backup. Returns the backup path, or null when there was nothing to keep. */
  reset(now: Date = new Date()): string | null {
    let kept: string | null = null;
    if (fs.existsSync(this.file)) {
      kept = this.freeBackupPath(`state-${fileStamp(now)}`);
      fs.copyFileSync(this.file, kept);
    }
    const marks = keptIdMarks(this.state);
    this.state = emptyState();
    this.state.issued = marks;
    this.save();
    return kept;
  }
}
