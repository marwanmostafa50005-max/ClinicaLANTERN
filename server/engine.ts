// The job queue and every change to the state.
// One job runs at a time: there is one GPU. Jobs are batched by stage so the model in memory
// changes as rarely as possible: all criteria of a case with Model 1, then all checks with
// Model 2, and letters with Model 3 when the pharmacist accepts.
// The state is saved after every step.
import fs from 'node:fs';
import path from 'node:path';
import type {
  Activity, AppState, CaseRecord, CheckResult, Criterion, EmailDraft, Finding, HistoryLine, ImportResponse, Job,
  LanternConfig, Letter, LetterDraft, LetterPointReply, PatientHeader, PharmacistQuestion, ReplyOutcome, ScreenResult, Stage, StateResponse
} from '../shared/types.ts';
import { criterionWaitsOnAnswer, listFacts, missingFactsOf } from '../shared/facts.ts';
import { latestSupplyDate, resolvePatientAge } from '../pipeline/age.ts';
import { DEFAULT_CONFIG } from '../pipeline/config.ts';
import { failedBecauseServerIsDown } from '../pipeline/ollama.ts';
import { parseCsv } from '../pipeline/csv.ts';
import { isRealDate } from '../pipeline/dates.ts';
import { readPdfTextRows } from '../pipeline/pdf.ts';
import {
  assemblePatientLetter, emailDraftFor, letterAsItLeaves, letterClosing, letterFindingIds, letterTextHash,
  mergeLegacyPatientLetters, partFromLetterBody, templateLetter, writingLine, type LetterClosing, type PatientLetterPart
} from '../pipeline/letter.ts';
import { linesFromRows, omitBirthDate } from '../pipeline/history.ts';
import { screenParts, type ScreenHooks, type ScreenOutcome } from '../pipeline/screen.ts';
import { cleanBase64, type TranscribeOutcome } from '../pipeline/transcribe.ts';
import { analyteName, analytesForFact, readLine, readPathology, type PathologyReading } from '../pipeline/pathology.ts';
import { agreedLines, type PathologyPageOutcome } from '../pipeline/transcribe-pathology.ts';
import { PageImages } from './images.ts';
import { takeId, writeFileAtomic, type StateStore } from './store.ts';
import { askWhenAnswered, casesForQuestionDisplay, chosenFrom, dayOf, leaveStanding, linesForModels, listedMedicineSupplied, loadConditionMarkerData, reopenQuestion as reopenFact, showStanding, syncCaseQuestions, takeAnswerBack, TAKEN_BACK_MARK, writeAnswer, type ConditionInPlay, type ConditionMarker } from './questions.ts';
import { awaitsTranscription, computeCounts, computeNow, disputedWaiting, HELD_FOR_MODELS, MODELS_NOT_RUNNING, reachedTheBell, type Progress } from './view.ts';

/** The most characters a subject may hold, after it is made one line. The page uses the same cap. */
const SUBJECT_CAP = 300;
/**
 * The letter placed when the criterion file could not be read.
 * It tells the pharmacist to write the clinical text. It is not a letter to send.
 */
const HAND_WRITTEN_LETTER =
  'Fictional patient. No real person.\n\nThe letter could not be drafted because the criterion file could not be read. Please write it by hand.';
/** The most characters a letter text may hold. The same cap as src/lib/draftStore.ts. The page uses it too. */
const LETTER_TEXT_CAP = 200_000;

/** An error with a plain message that is safe to show to the pharmacist, and the HTTP status to send. */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The four model jobs, as the queue calls them. Tests pass stand-ins.
 * signal stops the model call that is running: it is used when a clean demo is started.
 */
export interface PipelineFns {
  screenCriterion(cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, signal?: AbortSignal):
    Promise<ScreenOutcome>;
  /**
   * A long history, every waiting criterion in one go: the parts are the outer loop, so each part
   * is read once. When a stand-in leaves this out, screenCriterion is called for each criterion.
   */
  screenHistory?(
    cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criteria: Criterion[], hooks: ScreenHooks, signal?: AbortSignal
  ): Promise<ScreenOutcome[]>;
  checkFinding(
    cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, screen: ScreenResult, signal?: AbortSignal
  ): Promise<CheckResult>;
  draftLetter(
    cfg: LanternConfig, patient: PatientHeader, lines: HistoryLine[], criterion: Criterion, finding: Finding, signal?: AbortSignal
  ): Promise<LetterDraft>;
  transcribePageImage(cfg: LanternConfig, base64Png: string, signal?: AbortSignal): Promise<TranscribeOutcome>;
  /** One reading of one page of an uploaded pathology test that has no text layer. Absent where no model reads pages. */
  transcribePathologyPage?(cfg: LanternConfig, base64Png: string, signal?: AbortSignal): Promise<PathologyPageOutcome>;
  /** One tiny answer from Model 1, so the model is in memory. Left out of the stand-in tests. */
  warmModel?(cfg: LanternConfig, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** A criterion file that did not load, by name. The others still load (pipeline/criteria.ts). */
export interface CriterionLoadProblem { id: string; error: string }

/**
 * What loadCriteria may give: the criteria alone (every one is then one of the ten), or the criteria
 * with the files that did not load. activeIds names the first ten. A loaded criterion not in that
 * list is further.
 */
export type LoadedCriteria = Criterion[] | {
  criteria: Criterion[];
  problems?: CriterionLoadProblem[];
  activeIds?: string[];
};

export interface EngineOptions {
  cfg: LanternConfig;
  store: StateStore;
  pipeline: PipelineFns;
  loadCriteria: () => Promise<LoadedCriteria>;
  images: PageImages;
  now?: () => Date;
  log?: (line: string) => void;
  /** Fixed shared list read only when cfg.conditionMarkers is true. */
  conditionMarkersFile?: string;
  saveRetryMs?: number;               // how long to wait before a failed write of the state file is tried again (default 1 second)
  /**
   * True when the model server can be reached. The default asks Ollama for its version.
   * A job is not run again until this says yes.
   */
  modelsUp?: () => Promise<boolean>;
  /** How long to wait before asking again while the model server is down. Default 5 seconds. */
  holdDelayMs?: number;
  /**
   * When true, and nothing is queued at start, Model 1 is asked for one tiny answer.
   * The server process sets this from the environment. Tests leave it off.
   * LANTERN_NO_WARMUP=1 keeps it off: a server that warms up uses the card.
   */
  warmup?: boolean;
}

const MAX_PAGES = 30;
/** An uploaded pathology test: the pages that hold the result, not a whole file of reports. */
const MAX_PATHOLOGY_PAGES = 10;
export const PATHOLOGY_NO_MODEL = 'This page has no text that can be read by program, and the reading model is not available now. Type the result from the report.';
export const PATHOLOGY_MODEL_BUSY = 'This page has no text that can be read by program, and the reading model is busy with a history now. Upload the pathology test again when that has finished, or type the result from the report.';
export const PATHOLOGY_TWO_READINGS = 'the two readings of this line did not agree. Read the value from the report yourself.';

/** What the page is given after a pathology test was read. Nothing of it is in the record until the pharmacist confirms. */
export interface PathologyResponse {
  fact: string;
  tests: { key: string; name: string }[];
  readings: (PathologyReading & { readBy: 'text' | 'model' })[];
  abstained: string[];
  collected?: { date: string; line: string };
  dateNote?: string;
  note?: string;
}
const MAX_ROWS = 5000;
const KEPT_FINISHED_JOBS = 300;
/**
 * The longest history the prototype screens. A longer one would hold the one GPU for a very long
 * time (each part is read for each criterion), so it is refused in plain words and never screened in part.
 */
export const MAX_HISTORY_LINES = 1000;
/** How long the server waits before it tries to write the state file again after a failed write. */
const SAVE_RETRY_MS = 1000;
/** How often a step that stopped with an error is started again by itself. After that it is shown as it is. */
const MAX_RETRIES_AFTER_ERROR = 2;
/** A screen queued because an answer was taken back and another answer for that criterion still stands. */
const TAKE_BACK_AGAIN = 'Screening again after an answer was taken back.';

/** Asks the model server if it is there. A refusal or a timeout means it is not. */
async function probeModelServer(base: string): Promise<boolean> {
  try {
    const res = await fetch(base + '/api/version', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when a screening is finished but one criterion or more could not be screened. */
export function hasFailedCriteria(c: CaseRecord): boolean {
  return c.screening.criteria.some(run => run.status === 'failed');
}

// ---------- queue helpers (plain functions, so they can be tested without a server) ----------

export function hasOpenJob(state: AppState, stage: Stage, caseId: string, findingId?: string): boolean {
  return state.jobs.some(j =>
    j.stage === stage && j.caseId === caseId && j.findingId === findingId &&
    (j.status === 'queued' || j.status === 'running'));
}

export function addJob(state: AppState, stage: Stage, caseId: string, findingId?: string): Job {
  const job: Job = { id: takeId(state, 'J', state.jobs), stage, caseId, status: 'queued' };
  if (findingId) job.findingId = findingId;
  state.jobs.push(job);
  const finished = state.jobs.filter(j => j.status === 'done' || j.status === 'failed');
  if (finished.length > KEPT_FINISHED_JOBS) {
    const drop = new Set(finished.slice(0, finished.length - KEPT_FINISHED_JOBS).map(j => j.id));
    state.jobs = state.jobs.filter(j => !drop.has(j.id));
  }
  return job;
}

/**
 * Picks the next job. A queued job for the model that is already in memory goes first,
 * so the model changes as rarely as possible. Otherwise the oldest queued job.
 */
function isFurtherScreen(job: Job): boolean {
  return job.stage === 'screen' && job.band === 'further';
}

export function pickNextJob(jobs: Job[], lastStage: Stage | null): Job | null {
  const queued = jobs.filter(j => j.status === 'queued');
  if (queued.length === 0) return null;
  // The first ten, their checks and a letter all go before the next block of further criteria.
  const ahead = queued.filter(j => !isFurtherScreen(j));
  const pool = ahead.length > 0 ? ahead : queued;
  if (lastStage) {
    const same = pool.find(j => j.stage === lastStage);
    if (same) return same;
  }
  return pool[0];
}

/** Queues the second check for every suspected finding of a case that has none queued yet. */
export function queueChecks(state: AppState, caseId: string): number {
  let added = 0;
  for (const f of state.findings) {
    if (f.caseId === caseId && f.state === 'suspected' && !hasOpenJob(state, 'check', caseId, f.id)) {
      addJob(state, 'check', caseId, f.id);
      added++;
    }
  }
  return added;
}

/**
 * Called once when the server starts. A job that was left running becomes interrupted.
 * Screening picks up at the first criterion that is not finished: finished criteria keep their results.
 * Every piece of unfinished work gets a queued job again.
 */
export function recoverAfterRestart(state: AppState, at: string, names: LanternConfig['modelNames'] = DEFAULT_CONFIG.modelNames): void {
  const note = (text: string, extra: Partial<Activity>): void => {
    state.activity.push({ at, kind: 'error', text, ...extra });
  };
  const who = names.screen;
  for (const job of state.jobs) {
    if (job.status !== 'running') continue;
    job.status = 'failed';
    job.detail = 'Interrupted. The server stopped while this was running.';
    const c = state.cases.find(x => x.id === job.caseId);
    if (job.stage === 'screen') {
      if (!c) continue;
      if (awaitsTranscription(c)) {
        note(`The server stopped while ${who} was reading the scan of ${c.fileName}. The reading starts again.`, { caseId: c.id });
      } else {
        c.screening.status = 'interrupted';
        const runs = c.screening.criteria;
        const first = runs.findIndex(r => r.status === 'waiting' || r.status === 'running') + 1;
        note(
          `The server stopped while ${who} was screening ${c.fileName}. ` +
          `Screening picks up at criterion ${first || runs.length} of ${runs.length}.`,
          { caseId: c.id }
        );
      }
    } else if (job.stage === 'check') {
      note('The server stopped during a second check. The check starts again.', { caseId: job.caseId, findingId: job.findingId });
    } else {
      note('The server stopped while a letter was being written. The letter is drafted again.', { caseId: job.caseId, findingId: job.findingId });
    }
  }

  for (const c of state.cases) {
    if (c.cannotAssess) continue;
    for (const run of c.screening.criteria) {
      if (run.status === 'running') run.status = 'waiting';
    }
    if (awaitsTranscription(c)) {
      if (c.lines.length === 0 && !hasOpenJob(state, 'screen', c.id)) addJob(state, 'screen', c.id);
      continue;
    }
    if (c.screening.status === 'running') c.screening.status = 'interrupted';
    if ((c.screening.status === 'waiting' || c.screening.status === 'interrupted') && !hasOpenJob(state, 'screen', c.id)) {
      addJob(state, 'screen', c.id);
    }
    if (c.screening.status === 'done') queueChecks(state, c.id);
  }
  for (const letter of state.letters) {
    if (letter.status !== 'drafting') continue;
    for (const findingId of letterFindingIds(letter)) {
      const point = letter.points?.find(item => item.findingId === findingId);
      if (point?.draft) continue;
      if (!hasOpenJob(state, 'letter', letter.caseId, findingId)) addJob(state, 'letter', letter.caseId, findingId);
    }
  }
}

// ---------- small readers for request bodies ----------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function safeFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || 'history';
}

function readPatient(value: unknown): PatientHeader {
  const p = asRecord(value);
  let label = shortText(p.label, 120) || 'Fictional patient';
  // Fictional patients only: the label always says so.
  if (!/fictional/i.test(label)) label = `Fictional patient ${label}`;
  const patient: PatientHeader = { label };
  if (typeof p.age === 'number' && Number.isInteger(p.age) && p.age >= 0 && p.age <= 130) patient.age = p.age;
  const sex = shortText(p.sex, 20);
  if (sex) patient.sex = sex;
  if (typeof p.dateOfBirth === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.dateOfBirth.trim());
    if (m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) patient.dateOfBirth = p.dateOfBirth.trim();
  }
  if (p.ageFrom === 'date_of_birth' || p.ageFrom === 'record') patient.ageFrom = p.ageFrom;
  return patient;
}

function many(n: number, one: string, more: string): string {
  return `${n} ${n === 1 ? one : more}`;
}

/** The demo clock file. It is not part of the state file, so a clean demo can put the date back on its own. */
const DEMO_CLOCK_FILE = 'demo-clock.json';
const MAX_DEMO_DAYS = 3650;

function readDemoDays(file: string): number {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 0;
    const days = (parsed as { days?: unknown }).days;
    if (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= MAX_DEMO_DAYS) return days;
  } catch {
    // No file, or a file that is not the clock: the real date.
  }
  return 0;
}

function tooLongWords(lineCount: number): string {
  return `This history has ${lineCount} lines. The prototype screens up to ${MAX_HISTORY_LINES} lines in one history. ` +
    'Import a shorter period of the same patient, for example the last two years.';
}

function longHistoryWords(parts: number, who: string): string {
  return `It is long. ${who} reads it in ${parts} overlapping parts, then reads the lines that matter together.`;
}

/**
 * linesFromRows keeps only the first 1000 characters and says the row is too long.
 * The pharmacist still has to see the rest, so the uncut row is put back until it is short enough to screen.
 */
function restoreUncutRows(lines: HistoryLine[], rows: string[]): void {
  const sources = rows.map(row => row.replace(/\s+/g, ' ').trim()).filter(row => row !== '');
  lines.forEach((line, index) => {
    const source = sources[index];
    if (source) line.text = source;
  });
}

/** What the pharmacist should look at before confirming the rows of a scan. */
function scanNotesFor(pages: number, rowsOnPage: number[], rowProblems: string[]): string[] {
  const notes: string[] = [];
  for (let p = 1; p <= pages; p++) {
    if ((rowsOnPage[p - 1] ?? 0) === 0) {
      notes.push(`Page ${p}: no rows were read. Look at the picture of page ${p}. If it holds supplies, do not confirm.`);
    }
  }
  return [...notes, ...rowProblems];
}

const REPLY_OUTCOMES: ReplyOutcome[] = ['changed', 'not_changed', 'will_review', 'other'];

// ---------- the engine ----------

export class Engine {
  cfg: LanternConfig;
  store: StateStore;
  pipeline: PipelineFns;
  images: PageImages;
  criteria: Criterion[];              // the criteria in use (the first ten, then the further ones), used for new imports
  firstTenIds: string[];              // the loaded first ten, in order. The rest of `criteria` are further.
  criteriaError: string | null;
  criteriaProblems: CriterionLoadProblem[];   // criterion files that did not load; the others are in use
  private notedProblems: string;      // the problems already written to the activity log
  private known: Map<string, Criterion>;   // every criterion read so far, by ID
  /** The criterion text each history was imported under. A later edit of the file is not used for that history. */
  private pins: Map<string, Map<string, Criterion>>;
  private furtherIds: Set<string>;    // criteria in use after the first ten
  private loadCriteriaFn: () => Promise<LoadedCriteria>;
  private nowFn: () => Date;
  private realNow: () => Date;
  private demoDays: number;
  private clockFile: string;
  private log: (line: string) => void;
  private conditionMarkers: ConditionMarker[];
  private conditionInPlay: Record<string, ConditionInPlay>;
  private working: boolean;
  private lastStage: Stage | null;
  private generation: number;         // goes up on reset; a job from before a reset drops its result
  private progress: Progress;
  private idleWaiters: (() => void)[];
  private running: AbortController | null;   // stops the model call of the job that is running
  private saveFailing: boolean;       // true from a failed write of the state file until the next good one
  private saveTimer: ReturnType<typeof setTimeout> | null;
  private saveRetryMs: number;
  private committedJson: string;      // the last state file that was written, so a refused action can be put back
  private retries: Map<string, number>;      // how often a step was started again after an error
  private modelsDown: boolean;        // a job is queued again because the model server could not be reached
  private toldWaiting: boolean;       // the activity log already says the models are not running, for this outage
  private holdTimer: ReturnType<typeof setTimeout> | null;
  private modelsUpFn: () => Promise<boolean>;
  private holdDelayMs: number;
  private warmup: boolean;
  private warmupFailed: boolean;

  constructor(options: EngineOptions) {
    this.cfg = options.cfg;
    this.store = options.store;
    this.pipeline = options.pipeline;
    this.images = options.images;
    this.loadCriteriaFn = options.loadCriteria;
    this.realNow = options.now ?? (() => new Date());
    this.clockFile = path.join(this.store.dataDir, DEMO_CLOCK_FILE);
    this.demoDays = readDemoDays(this.clockFile);
    this.nowFn = () => this.movedNow();
    this.log = options.log ?? (() => undefined);
    const markerData = this.cfg.conditionMarkers && options.conditionMarkersFile
      ? loadConditionMarkerData(options.conditionMarkersFile, this.log)
      : { markers: [], inPlay: {} };
    this.conditionMarkers = markerData.markers;
    this.conditionInPlay = markerData.inPlay;
    this.criteria = [];
    this.firstTenIds = [];
    this.criteriaError = null;
    this.criteriaProblems = [];
    this.notedProblems = '';
    this.known = new Map();
    this.pins = new Map();
    this.furtherIds = new Set();
    this.working = false;
    this.lastStage = null;
    this.generation = 0;
    this.progress = {};
    this.idleWaiters = [];
    this.running = null;
    this.saveFailing = false;
    this.saveTimer = null;
    this.saveRetryMs = options.saveRetryMs ?? SAVE_RETRY_MS;
    this.committedJson = '';
    this.retries = new Map();
    this.modelsDown = false;
    this.toldWaiting = false;
    this.holdTimer = null;
    this.modelsUpFn = options.modelsUp ?? (() => probeModelServer(this.cfg.ollamaBase));
    this.holdDelayMs = options.holdDelayMs ?? 5000;
    this.warmup = options.warmup === true;
    this.warmupFailed = false;
    this.rememberCommitted();
  }

  get state(): AppState {
    return this.store.state;
  }

  /** The sentence GET /api/health adds when the warm-up could not reach the models. */
  get modelsNote(): string | undefined {
    return this.warmupFailed ? MODELS_NOT_RUNNING : undefined;
  }

  private nowIso(): string {
    return this.nowFn().toISOString();
  }

  /** The server's clock: the real time, plus the demo days when the clock has been moved ahead. */
  private movedNow(): Date {
    const base = this.realNow();
    if (this.demoDays <= 0) return base;
    return new Date(base.getTime() + this.demoDays * 24 * 60 * 60 * 1000);
  }

  private note(kind: Activity['kind'], text: string, extra: Partial<Activity> = {}): void {
    this.state.activity.push({ at: this.nowIso(), kind, text, ...extra });
    this.log(text);
  }

  /**
   * Writes the state file for the queue. It never throws: one failed write must not strand a job.
   * The state in memory stays whole, the queue goes on, the activity log says what happened, and
   * the write is tried again every second until it works.
   * A pharmacist's action does not use this. It uses commit, which refuses the action instead.
   */
  private save(): void {
    try {
      this.store.save();
    } catch {
      this.onSaveFailed();
      return;
    }
    this.rememberCommitted();
    if (this.saveFailing) {
      this.saveFailing = false;
      this.note('error', 'The state file can be written again. Nothing was lost.');
      try {
        this.store.save();
        this.rememberCommitted();
      } catch {
        this.onSaveFailed();
      }
    }
  }

  /** The last state file that was written. A refused action is put back to this. */
  private rememberCommitted(): void {
    this.committedJson = JSON.stringify(this.state);
  }

  /** Puts memory back to the last file that was written, and drops pages and criterion copies of a history that was not kept. */
  private restoreCommitted(idsAtFailure: string[]): void {
    const committed = JSON.parse(this.committedJson) as AppState;
    const kept = new Set(committed.cases.map(c => c.id));
    this.store.state = committed;
    for (const id of idsAtFailure) {
      if (kept.has(id)) continue;
      this.pins.delete(id);
      this.images.remove(id);
    }
    this.reapPins();
  }

  /**
   * Writes the state file for a pharmacist's action. The action is acknowledged only when this
   * write works. When it does not, memory is put back and the action is refused, so a restart
   * cannot lose work the pharmacist was told had been kept.
   */
  private commit(): void {
    const ids = this.state.cases.map(c => c.id);
    try {
      this.store.save();
    } catch {
      this.restoreCommitted(ids);
      throw new ApiError(503, 'The state file could not be written. Nothing was changed. Please try again.');
    }
    this.rememberCommitted();
    if (this.saveFailing) {
      this.saveFailing = false;
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
  }

  private onSaveFailed(): void {
    if (!this.saveFailing) {
      this.saveFailing = true;
      this.note('error',
        'The state file could not be written. Another program may be holding it. The work goes on and the server tries again every second. ' +
        'Do not stop the server until this is cleared.');
    }
    if (this.saveTimer === null) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, this.saveRetryMs);
      this.saveTimer.unref?.();
    }
  }

  /**
   * Reads the criteria files again. On a failure the list for new imports is emptied and the reason
   * is kept as a plain message. Criteria that were read before stay known, so work that is already
   * running is not cut off by a file that is being edited.
   */
  async refreshCriteria(): Promise<void> {
    const generation = this.generation;
    try {
      const loaded = await this.loadCriteriaFn();
      // A reset while the files were loading owns the session. This load must not write into it.
      if (generation !== this.generation) return;
      if (Array.isArray(loaded)) {
        this.criteria = loaded;
        this.criteriaProblems = [];
        this.furtherIds = new Set();
      } else {
        this.criteria = loaded.criteria;
        this.criteriaProblems = loaded.problems ?? [];
        const active = new Set(loaded.activeIds ?? this.criteria.map(c => c.id));
        this.furtherIds = new Set(loaded.activeIds ? this.criteria.filter(c => !active.has(c.id)).map(c => c.id) : []);
      }
      this.firstTenIds = this.criteria.filter(c => !this.furtherIds.has(c.id)).map(c => c.id);
      this.criteriaError = this.criteria.length === 0 ? 'The list of criteria is empty.' : null;
      for (const c of this.criteria) this.known.set(c.id, c);
      this.noteCriteriaProblems();
    } catch (e) {
      if (generation !== this.generation) return;
      this.criteria = [];
      this.firstTenIds = [];
      this.furtherIds = new Set();
      this.criteriaProblems = [];
      this.criteriaError = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * A criterion file that did not load is named in the activity log, once for each change of the
   * list. The other criteria stay in use. A history is not screened against a criterion that did
   * not load, and the log says so in plain words.
   */
  private noteCriteriaProblems(): void {
    const names = this.criteriaProblems.map(p => p.id);
    const key = names.join('\n');
    if (key === this.notedProblems) return;
    this.notedProblems = key;
    if (names.length === 0) {
      this.note('error', 'Every criterion in the list loads again.');
      return;
    }
    const shown = names.slice(0, 10).join(', ') + (names.length > 10 ? ` and ${names.length - 10} more` : '');
    this.note('error',
      `${many(names.length, 'criterion', 'criteria')} could not be loaded and ${names.length === 1 ? 'is' : 'are'} not screened: ${shown}. ` +
      `The first reason: ${this.criteriaProblems[0].error} The other criteria are in use.`);
  }

  private criterionFor(id: string): Criterion | undefined {
    return this.known.get(id);
  }

  private pinPath(caseId: string): string {
    return path.join(this.store.dataDir, 'pins', `${caseId.replace(/[^A-Za-z0-9]/g, '')}.json`);
  }

  /** Keeps a copy of the criteria as they were when the history was imported. */
  private rememberCriteria(caseId: string, criteria: Criterion[]): void {
    const copy = criteria.map(item => structuredClone(item));
    this.pins.set(caseId, new Map(copy.map(item => [item.id, item])));
    try {
      writeFileAtomic(this.pinPath(caseId), JSON.stringify(copy));
    } catch {
      // The copy in memory still stands for this run. A restart without the file holds the work.
    }
  }

  /** The criteria pinned for one history, from memory or from the file written at import. */
  private pinsFor(caseId: string): Map<string, Criterion> | null {
    const held = this.pins.get(caseId);
    if (held) return held;
    const file = this.pinPath(caseId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) return null;
      const criteria = parsed.filter((item): item is Criterion =>
        !!item && typeof item === 'object' && typeof (item as Criterion).id === 'string');
      const map = new Map(criteria.map(item => [item.id, item]));
      this.pins.set(caseId, map);
      return map;
    } catch {
      return null;
    }
  }

  /**
   * The criterion text this history was screened under.
   * A saved copy is used as it stands, even when one id is missing from it.
   * A history marked as pinned whose copy is gone is not read from a newer file.
   * A history saved before copies existed has no mark and no file, so the current file is used.
   */
  private pinnedCriterion(caseId: string, id: string): Criterion | undefined {
    const map = this.pinsFor(caseId);
    if (map) return map.get(id);
    const c = this.state.cases.find(item => item.id === caseId);
    if (c?.criterionPinned) return undefined;
    return this.criterionFor(id);
  }

  private clearPins(): void {
    this.pins.clear();
    fs.rmSync(path.join(this.store.dataDir, 'pins'), { recursive: true, force: true });
  }

  /** Drops a pin whose history is not in the state, so a reused id cannot inherit it. */
  private reapPins(): void {
    const dir = path.join(this.store.dataDir, 'pins');
    if (!fs.existsSync(dir)) return;
    const kept = new Set(this.state.cases.map(item => item.id.replace(/[^A-Za-z0-9]/g, '')));
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      if (kept.has(name.slice(0, -'.json'.length))) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* already gone */ }
    }
  }

  /**
   * A saved step that names one history and a finding or letter of another.
   * Returns the words for the log, or null when the step belongs to one patient.
   */
  private crossedPatients(job: Job, c: CaseRecord): string | null {
    if (!job.findingId) return null;
    const finding = this.state.findings.find(item => item.id === job.findingId);
    if (finding && finding.caseId !== c.id) {
      return `A saved step was set aside: it joined history ${c.id} with finding ${finding.id}, which belongs to history ${finding.caseId}. Nothing was changed.`;
    }
    if (job.stage === 'letter') {
      const letter = this.state.letters.find(item => job.findingId !== undefined && letterFindingIds(item).includes(job.findingId));
      if (letter && letter.caseId !== c.id) {
        return `A saved step was set aside: it joined history ${c.id} with letter ${letter.id}, which belongs to history ${letter.caseId}. Nothing was changed.`;
      }
    }
    return null;
  }

  /** Marks the step failed and leaves both records as they were. True when the step was set aside. */
  private setAsideCrossed(job: Job, c: CaseRecord): boolean {
    const why = this.crossedPatients(job, c);
    if (!why) return false;
    this.note('error', why, { caseId: c.id, findingId: job.findingId });
    this.finish(job, 'failed', 'This step named two different patients, so it was set aside.');
    if (job.stage !== 'screen') this.maybeContinueScreen(c.id);
    return true;
  }

  private labelFor(id: string): string {
    return this.criterionFor(id)?.label ?? id;
  }

  /** Called once on start: loads the criteria, recovers interrupted work and starts the queue. */
  async start(): Promise<void> {
    await this.refreshCriteria();
    mergeLegacyPatientLetters(this.state);
    try {
      recoverAfterRestart(this.state, this.nowIso(), this.cfg.modelNames);
    } catch {
      // The file could be read, but the work in it cannot be picked up. It is kept as a backup and
      // a clean state is started: the server must start, never crash.
      this.store.setAside(this.nowFn());
      // The clean log names again a criterion file that did not load.
      this.notedProblems = '';
      this.noteCriteriaProblems();
    }
    this.reapPins();
    this.dropPagesOfConfirmedScans();
    this.tagQueuedScreens();
    if (this.state.jobs.some(j => j.status === 'queued' && (j.detail ?? '').startsWith('Waiting. The local model server'))) {
      this.modelsDown = true;
    }
    if (this.store.loadNote) this.note('error', this.store.loadNote);
    this.queueWarmupJob();
    this.save();
    this.kick();
  }

  /** One warm-up job when the queue is empty, so Model 1 is in memory before the first history. */
  private queueWarmupJob(): void {
    if (!this.warmup) return;
    if (this.state.jobs.some(j => j.status === 'queued' || j.status === 'running')) return;
    this.warmupFailed = false;
    const job = addJob(this.state, 'screen', '');
    job.warmup = true;
  }

  stateResponse(): StateResponse {
    // The page asks every second. If a job is waiting and no worker runs, the worker is started here,
    // so a slip anywhere else can never leave a history waiting while the page looks idle.
    if (!this.working && this.state.jobs.some(j => j.status === 'queued')) this.kick();
    const now = this.nowFn();
    const running = computeNow(this.state, this.progress, this.cfg.modelNames, this.cfg);
    if (this.warmupFailed && running.text === 'Idle') running.text = MODELS_NOT_RUNNING;
    if (this.demoDays > 0) running.text += ` Demo clock: ${many(this.demoDays, 'day', 'days')} ahead.`;
    const cases = casesForQuestionDisplay(this.state.cases);
    const state = cases.some((c, index) => c !== this.state.cases[index]) ? { ...this.state, cases } : this.state;
    return {
      state,
      counts: computeCounts(state, now),
      now: running,
      serverTime: now.toISOString(),
      recorded: false,
      disputedWaiting: disputedWaiting(state)
    };
  }

  /** Resolves when no job is running or queued. Used by tests. */
  whenIdle(): Promise<void> {
    if (!this.working && !this.state.jobs.some(j => j.status === 'queued')) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  // ---------- import ----------

  async importCase(body: unknown): Promise<ImportResponse> {
    const req = asRecord(body);
    const source = req.source;
    if (source !== 'csv' && source !== 'pdf-text' && source !== 'pdf-image') {
      throw new ApiError(400, 'The import must say what kind of file it is: csv, pdf-text or pdf-image.');
    }
    const generation = this.generation;
    await this.refreshCriteria();
    // A clean demo started while the criteria were loading. This file is not the first history of that session.
    if (generation !== this.generation) {
      throw new ApiError(409, 'A clean demo was started while this file was being imported. Import it again.');
    }
    if (this.criteria.length === 0) {
      throw new ApiError(503, `The criteria could not be loaded, so nothing can be screened. ${this.criteriaError ?? ''}`.trim());
    }

    let patient: PatientHeader = readPatient(req.patient);
    let lines: HistoryLine[] = [];
    let problems: string[] = [];
    let pages: string[] = [];
    if (source === 'csv') {
      if (typeof req.csvText !== 'string') throw new ApiError(400, 'The CSV text is missing.');
      const parsed = parseCsv(req.csvText);
      lines = parsed.lines;
      problems = parsed.problems;
      // The patient named in the file wins. A label sent with the import is used only when the file has none.
      if (parsed.patient.label !== 'Fictional patient' || patient.label === 'Fictional patient') {
        patient = { ...patient, ...parsed.patient };
      } else {
        patient = { ...parsed.patient, ...patient };
      }
    } else if (source === 'pdf-text') {
      if (!Array.isArray(req.rows) || req.rows.some(r => typeof r !== 'string')) {
        throw new ApiError(400, 'The rows read from the PDF are missing.');
      }
      if (req.rows.length > MAX_ROWS) throw new ApiError(400, `The file has more than ${MAX_ROWS} rows. That is too many for one history.`);
      // The page sends the title, the patient line and the column headings with the supplies.
      // The headings name the cells. Title rows are not dispensing lines. The patient named in
      // the file wins, as it does for a CSV.
      const parsed = readPdfTextRows(req.rows);
      const read = linesFromRows(parsed.rows);
      lines = read.lines;
      problems = [...read.problems, ...(parsed.problems ?? [])];
      if (parsed.patient.label !== 'Fictional patient' || patient.label === 'Fictional patient') {
        patient = { ...patient, ...parsed.patient };
      } else {
        patient = { ...parsed.patient, ...patient };
      }
    } else {
      const list = Array.isArray(req.pageImages) ? req.pageImages : [];
      pages = list.filter((p): p is string => typeof p === 'string').map(cleanBase64).filter(p => p !== '');
      if (pages.length === 0 || pages.length !== list.length) throw new ApiError(400, 'The page images are missing.');
      if (pages.length > MAX_PAGES) throw new ApiError(400, `The scan has more than ${MAX_PAGES} pages. Please import it in smaller parts.`);
    }

    // A history that is too long for the prototype is not screened in part: it is refused in plain words.
    if (lines.length > MAX_HISTORY_LINES) problems.push(tooLongWords(lines.length));

    const id = takeId(this.state, 'C', this.state.cases);
    const waitsForScan = source === 'pdf-image';
    const c: CaseRecord = {
      id,
      fileName: safeFileName(req.fileName),
      importedAt: this.nowIso(),
      source,
      patient,
      lines,
      transcriptionConfirmed: !waitsForScan,
      parts: screenParts(this.cfg, lines).length,
      screening: {
        status: problems.length > 0 || waitsForScan ? 'not_started' : 'waiting',
        criteria: this.criteria.map(k => ({ criterionId: k.id, status: 'waiting' }))
      }
    };
    if (problems.length > 0) c.cannotAssess = problems.join(' ');
    if (waitsForScan) c.pages = pages.length;
    c.criterionPinned = true;
    this.rememberCriteria(id, this.criteria);
    this.state.cases.push(c);

    if (waitsForScan) {
      this.images.save(id, pages);
      addJob(this.state, 'screen', id);
      this.note('import', `Scan imported: ${c.fileName}, ${many(pages.length, 'page', 'pages')}. ${this.who('screen')} will read the rows. Please check them before screening.`, { caseId: id });
    } else if (c.cannotAssess) {
      this.note('import', `History imported: ${c.fileName}. Cannot assess: ${c.cannotAssess}`, { caseId: id });
    } else {
      this.syncQuestions(c);
      addJob(this.state, 'screen', id);
      const parts = c.parts > 1 ? ` ${longHistoryWords(c.parts, this.who('screen'))}` : '';
      this.note('import', `History imported: ${c.fileName}, ${many(lines.length, 'line', 'lines')}. Screening is queued.${parts}`, { caseId: id });
    }
    this.commit();
    this.kick();
    return { caseId: id };
  }

  /** The pharmacist confirms the rows read from a scan. Edited rows may be sent; then they replace what the model read. */
  confirmTranscription(caseId: string, body: unknown): CaseRecord {
    const c = this.state.cases.find(x => x.id === caseId);
    if (!c) throw new ApiError(404, 'This history was not found.');
    if (c.source !== 'pdf-image') throw new ApiError(409, 'This history was not read from a scan. There is nothing to confirm.');
    if (c.transcriptionConfirmed) {
      // A removal that stopped after the rows were saved is finished here. The rows stay.
      this.images.remove(c.id);
      return c;
    }
    if (c.cannotAssess) throw new ApiError(409, `This history cannot be assessed. ${c.cannotAssess}`);
    if (c.birthDatesRead && c.birthDatesRead.length > 1) {
      throw new ApiError(409, 'These pages give more than one date of birth, so they are not one patient. Correct the scan or import each patient on their own. Screening has not started.');
    }
    if (hasOpenJob(this.state, 'screen', c.id)) {
      throw new ApiError(409, `The pages are still being read. Please wait for ${this.who('screen')} to finish.`);
    }
    const pages = this.images.check(c.id);
    if (!pages.ok) throw new ApiError(409, pages.words);
    const rows = asRecord(body).rows;
    let lines = c.lines;
    // The check uses the rows as sent, before any shortening. A row that is too long is a problem
    // of those rows, not of the shortened copy.
    let problems: string[];
    if (rows !== undefined) {
      if (!Array.isArray(rows) || rows.some(r => typeof r !== 'string')) throw new ApiError(400, 'The rows must be a list of text lines.');
      if (rows.length > MAX_ROWS) throw new ApiError(400, `There are more than ${MAX_ROWS} rows. That is too many for one history.`);
      const samePages = rows.length === c.lines.length ? c.lines.map(l => l.page ?? 0) : undefined;
      const read = linesFromRows(rows, samePages?.every(p => p > 0) ? samePages : undefined, { everyRowDated: true });
      problems = read.problems;
      lines = read.lines;
    } else if (c.lines.length === 0) {
      throw new ApiError(409, `The pages have not been read yet. Please wait for ${this.who('screen')} to finish.`);
    } else {
      problems = linesFromRows(lines.map(l => l.text), undefined, { everyRowDated: true }).problems;
    }
    // The rows of a scan are checked the way a CSV file is: every row is one supply and needs a date
    // that can be read. A row that is too long is the same kind of stop. The pharmacist can correct it and confirm again.
    if (lines.length > MAX_HISTORY_LINES) problems.push(tooLongWords(lines.length));
    if (problems.length > 0) {
      throw new ApiError(409, `These rows cannot be screened yet. ${problems.join(' ')} Correct the rows and confirm again, or import a clearer scan.`);
    }
    c.lines = lines;
    if (c.patient.dateOfBirth) {
      resolvePatientAge(c.patient, {
        birthDates: [c.patient.dateOfBirth],
        recordAge: c.patient.ageFrom === 'record' ? c.patient.age : undefined,
        latestSupplyDate: latestSupplyDate(c.lines.map(line => line.text))
      });
    }
    c.transcriptionConfirmed = true;
    delete c.scanNotes;
    c.parts = screenParts(this.cfg, c.lines).length;
    c.screening.status = 'waiting';
    this.syncQuestions(c);
    if (!hasOpenJob(this.state, 'screen', c.id)) addJob(this.state, 'screen', c.id);
    this.note('import', `The pharmacist confirmed ${many(c.lines.length, 'row', 'rows')} read from the scan of ${c.fileName}. Screening is queued.`, { caseId: c.id });
    this.commit();
    try {
      this.images.remove(c.id);
    } catch {
      // The rows are already in the state file. The next start removes the pages.
    }
    this.kick();
    return c;
  }

  /** A confirmed scan no longer needs its pictures. A removal that stopped after the save is finished on the next start. */
  private dropPagesOfConfirmedScans(): void {
    for (const c of this.state.cases) {
      if (c.source !== 'pdf-image' || !c.transcriptionConfirmed) continue;
      try { this.images.remove(c.id); } catch { /* the next start tries again */ }
    }
  }

  /**
   * The pharmacist gives up a scan he will not confirm. The history stays in the list, marked as
   * not screened, and its page pictures are removed. Nothing is deleted from the log.
   */
  discardScan(caseId: string): CaseRecord {
    const c = this.state.cases.find(x => x.id === caseId);
    if (!c) throw new ApiError(404, 'This history was not found.');
    if (c.source !== 'pdf-image' || c.transcriptionConfirmed) {
      throw new ApiError(409, 'Only a scan whose rows are not confirmed yet can be discarded.');
    }
    if (c.cannotAssess) return c;
    if (hasOpenJob(this.state, 'screen', c.id)) {
      throw new ApiError(409, `The pages are still being read. Please wait for ${this.who('screen')} to finish.`);
    }
    c.cannotAssess = 'The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened.';
    delete c.scanNotes;
    this.note('import', `The pharmacist discarded the scan ${c.fileName}. It was not screened.`, { caseId: c.id });
    this.commit();
    this.images.remove(c.id);
    return c;
  }

  /** One page picture of a scan whose rows are not confirmed yet, as PNG bytes. Null when there is none. */
  pageImage(caseId: string, page: number): Buffer | null {
    const c = this.state.cases.find(x => x.id === caseId);
    if (!c || c.source !== 'pdf-image' || !Number.isInteger(page) || page < 1) return null;
    const file = this.images.fileFor(c.id, page);
    if (!file) return null;
    try {
      const bytes = Buffer.from(this.images.read(file), 'base64');
      return bytes.length > 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  /**
   * Screens again what was not screened: criteria that could not be screened, and a screening that
   * was interrupted. Criteria that have a result keep it. Nothing is imported twice.
   */
  screenAgain(caseId: string): CaseRecord {
    const c = this.state.cases.find(x => x.id === caseId);
    if (!c) throw new ApiError(404, 'This history was not found.');
    if (c.cannotAssess) throw new ApiError(409, `This history cannot be assessed. ${c.cannotAssess}`);
    if (awaitsTranscription(c)) throw new ApiError(409, 'The rows of this scan are not confirmed yet.');
    if (hasOpenJob(this.state, 'screen', c.id)) throw new ApiError(409, 'This history is already being screened, or is waiting in line.');
    const failed = c.screening.criteria.filter(run => run.status === 'failed');
    const unfinished = c.screening.criteria.filter(run => run.status === 'waiting' || run.status === 'running');
    if (failed.length === 0 && unfinished.length === 0) {
      throw new ApiError(409, 'Every criterion already has a result for this history. There is nothing to screen again.');
    }
    for (const run of [...failed, ...unfinished]) {
      run.status = 'waiting';
      delete run.error;
      delete run.seconds;
    }
    c.screening.status = 'waiting';
    delete c.screening.finishedAt;
    this.retries.delete(`screen:${c.id}:`);
    this.queueScreen(c.id);
    this.note('import',
      `The pharmacist asked to screen ${c.fileName} again: ${many(failed.length + unfinished.length, 'criterion that has no result', 'criteria that have no result')}.`,
      { caseId: c.id });
    this.commit();
    this.kick();
    return c;
  }

  /** Questions for facts the history does not show, and for facts a criterion asks before it can run. */
  private syncQuestions(c: CaseRecord): void {
    const ids = this.state.cases.flatMap(item => item.questions ?? []);
    const pinned = this.pinsFor(c.id);
    syncCaseQuestions(
      c, pinned ? [...pinned.values()] : this.criteria, this.state.findings, ids, this.conditionMarkers, this.conditionInPlay
    );
  }

  private questionOf(caseId: string, questionId: string): { c: CaseRecord; q: PharmacistQuestion } {
    const c = this.state.cases.find(item => item.id === caseId);
    if (!c) throw new ApiError(404, 'This history was not found.');
    const q = (c.questions ?? []).find(item => item.id === questionId);
    if (!q) throw new ApiError(404, 'This question was not found.');
    return { c, q };
  }

  /** An answer waits until the screen and every second check of this history have finished. */
  private assertQuestionsIdle(c: CaseRecord): void {
    // A real second check names the finding. hasOpenJob with no finding id does not see that job.
    const checkOpen = this.state.jobs.some(job =>
      job.stage === 'check' && job.caseId === c.id && (job.status === 'queued' || job.status === 'running'));
    if (hasOpenJob(this.state, 'screen', c.id) || checkOpen) {
      throw new ApiError(409, 'This history is still being screened. The question can be answered when that finishes.');
    }
  }

  /** Only work whose result could overwrite this answer holds it back. */
  private assertAnswerAllowed(c: CaseRecord, q: PharmacistQuestion): void {
    const criterionIds = new Set(q.criterionIds);
    const screenRunning = this.state.jobs.some(job =>
      job.stage === 'screen' && job.caseId === c.id && job.status === 'running');
    const ownScreenRunning = screenRunning && c.screening.criteria.some(run =>
      criterionIds.has(run.criterionId) && run.status === 'running');
    if (ownScreenRunning) {
      throw new ApiError(409, 'The criterion for this question is being screened. The question can be answered when that finishes.');
    }
    const findingIds = new Set(q.findingIds);
    const ownCheckOpen = this.state.jobs.some(job =>
      job.stage === 'check' && job.caseId === c.id && job.findingId !== undefined && findingIds.has(job.findingId) &&
      (job.status === 'queued' || job.status === 'running'));
    if (ownCheckOpen) {
      throw new ApiError(409, 'The second check for this finding is queued or running. The question can be answered when that finishes.');
    }
  }

  /** The pharmacist answers one question. Not known releases an ask-when criterion but leaves a possible finding. */
  answerQuestion(caseId: string, questionId: string, body: unknown): PharmacistQuestion {
    const { c, q } = this.questionOf(caseId, questionId);
    this.assertAnswerAllowed(c, q);
    if (q.status === 'answered') throw new ApiError(409, 'This question already has an answer. Take it back before answering again.');
    if (q.status === 'not_known') throw new ApiError(409, 'This question is closed. Open it again to answer it.');
    const parsed = chosenFrom(q, asRecord(body), dayOf(this.nowFn()));
    if (!parsed.chosen) throw new ApiError(400, parsed.error ?? 'Choose one of the answers.');
    const beforeIds = new Map(this.state.letters.map(letter => [letter.id, letterFindingIds(letter).join('\n')]));
    const released = parsed.chosen.effect === 'unknown' && q.source !== 'possible';
    const again = writeAnswer(c, this.state.findings, this.state.letters, q, parsed.chosen, this.nowIso());
    for (const letter of this.state.letters) {
      if (letter.caseId !== c.id || (letter.status !== 'drafting' && letter.status !== 'ready')) continue;
      const prev = beforeIds.get(letter.id);
      if (prev === undefined || prev === letterFindingIds(letter).join('\n')) continue;
      this.rebuildPatientLetter(letter);
    }
    const screens = again || released;
    const staleLongScreen = screens && c.parts > 1
      ? this.state.jobs.find(job => job.stage === 'screen' && job.caseId === c.id && job.status === 'running')
      : undefined;
    if (staleLongScreen) {
      staleLongScreen.status = 'queued';
      this.generation++;
      this.running?.abort();
    }
    const how = screens
      ? (q.criterionIds.length === 1
        ? 'The criterion that was waiting for it is screened again.'
        : 'The criteria that were waiting for it are screened again.')
      : 'The finding stays a possible finding. The question stays closed until it is opened again.';
    this.note('decision', `The pharmacist answered "${parsed.chosen.words}" for ${q.what} on ${c.fileName}. ${how}`, { caseId: c.id });
    const queued = screens && !hasOpenJob(this.state, 'screen', c.id);
    if (queued) this.queueScreen(c.id);
    this.commit();
    if (queued) setTimeout(() => this.kick(), 20);
    return q;
  }

  /**
   * Reads the result a question asks for from an uploaded pathology test (the clinical reviewer's wireframe of
   * 20 November 2026: type the number, or upload the test that holds it). A page with a text layer is read by
   * rule (pipeline/pathology.ts). A page without one is read twice by the reading model, and a line is used only
   * when both readings hold it. NOTHING IS WRITTEN INTO THE RECORD HERE: the page shows what was read with the
   * line it stands on, and the pharmacist confirms it with the answer call. The file itself is not kept.
   */
  async readPathologyTest(caseId: string, questionId: string, body: unknown): Promise<PathologyResponse> {
    const { q } = this.questionOf(caseId, questionId);
    if (q.status !== 'open') throw new ApiError(409, 'This question already has an answer. Take it back before reading a pathology test for it.');
    const keys = q.needsValue && q.kind === 'result' ? analytesForFact(q.what) : [];
    if (keys.length === 0) throw new ApiError(400, 'This question is not answered from a pathology test. Type the answer.');
    const tests = keys.map(key => ({ key, name: analyteName(key) }));
    const req = asRecord(body);
    if (req.pages !== undefined && !Array.isArray(req.pages)) throw new ApiError(400, 'The text pages must be an array of pages.');
    if (req.pageImages !== undefined && !Array.isArray(req.pageImages)) throw new ApiError(400, 'The page pictures must be an array of base64 images.');
    const textPages = Array.isArray(req.pages) ? req.pages : [];
    const sent = Array.isArray(req.pageImages) ? req.pageImages : [];
    const images = sent.map(page => {
      if (typeof page !== 'string') throw new ApiError(400, 'A page picture is not valid base64 image data. Upload the page again, or type the result yourself.');
      const image = cleanBase64(page);
      if (image.length === 0 || image.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) {
        throw new ApiError(400, 'A page picture is not valid base64 image data. Upload the page again, or type the result yourself.');
      }
      return image;
    });
    if (textPages.length + images.length === 0) throw new ApiError(400, 'The pathology test is empty.');
    if (textPages.length + images.length > MAX_PATHOLOGY_PAGES) {
      throw new ApiError(400, `The pathology test has more than ${MAX_PATHOLOGY_PAGES} pages. Upload only the pages that hold the result.`);
    }
    const sentPageNumbers = req.pageNumbers;
    const suppliedPageCount = textPages.length + images.length;
    if (sentPageNumbers !== undefined && (
      !Array.isArray(sentPageNumbers) ||
      sentPageNumbers.length !== suppliedPageCount ||
      sentPageNumbers.some((page, index) =>
        typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 ||
        (index > 0 && page <= sentPageNumbers[index - 1])
      )
    )) {
      throw new ApiError(400, 'The page numbers must give one whole number of at least 1 for each supplied page, in strictly rising order.');
    }
    const pageNumbers: number[] = Array.isArray(sentPageNumbers)
      ? sentPageNumbers
      : Array.from({ length: suppliedPageCount }, (_, index) => index + 1);
    const abstained: string[] = [];
    const pages: string[][] = textPages.map((page, pageIndex) => {
      if (!Array.isArray(page)) throw new ApiError(400, 'Each text page must be an array of lines.');
      if (page.length > 400) throw new ApiError(400, 'A text page has more than 400 lines. Upload only the page that holds the result.');
      const kept: string[] = [];
      let skipped = 0;
      for (const line of page) {
        if (typeof line !== 'string') throw new ApiError(400, 'Every line of a text page must be a string.');
        if (line.length > 300) { skipped += 1; continue; }
        kept.push(line);
      }
      if (skipped === 1) abstained.push(`One line on page ${pageNumbers[pageIndex]} is too long to be a result row and was not read.`);
      if (skipped > 1) abstained.push(`${skipped} lines on page ${pageNumbers[pageIndex]} are too long to be result rows and were not read.`);
      return kept;
    });
    let note: string | undefined;

    // Pages with no text layer: the reading model writes each one out twice.
    const modelPages: string[][] = [];
    if (images.length > 0) {
      const read = this.pipeline.transcribePathologyPage;
      if (!read || this.modelsDown) note = PATHOLOGY_NO_MODEL;
      else if (this.working || this.state.jobs.some(job => job.status === 'queued' || job.status === 'running')) note = PATHOLOGY_MODEL_BUSY;
      else {
        // The one model does one thing at a time: no screening starts while the pages are read.
        this.working = true;
        try {
          for (let i = 0; i < images.length; i++) {
            const pageNo = pageNumbers[pages.length + i];
            const first = await read(this.cfg, images[i]);
            const second = first.ok ? await read(this.cfg, images[i]) : first;
            if (!first.ok || !second.ok) {
              modelPages.push([]);
              note = PATHOLOGY_NO_MODEL;
              continue;
            }
            const both = agreedLines(first.lines, second.lines);
            const disagreed = both.onlyInOne.some(line => readLine(line, keys) !== null);
            modelPages.push(disagreed ? [] : both.agreed);
            // A wanted line in only one reading withholds model-read results from this page.
            if (disagreed) abstained.push(`Page ${pageNo}: ${PATHOLOGY_TWO_READINGS}`);
          }
        } finally {
          this.working = false;
          if (this.state.jobs.some(job => job.status === 'queued')) this.kick();
          else { const waiters = this.idleWaiters; this.idleWaiters = []; for (const resolve of waiters) resolve(); }
        }
      }
    }

    const got = readPathology([...pages, ...modelPages], keys, Array.isArray(sentPageNumbers) ? pageNumbers : undefined);
    const textPageNumbers = new Set(pageNumbers.slice(0, pages.length));
    const readings = got.readings.map(reading => ({ ...reading, readBy: textPageNumbers.has(reading.page) ? 'text' as const : 'model' as const }));
    const response: PathologyResponse = { fact: q.what, tests, readings, abstained: [...got.abstained, ...abstained] };
    if (got.collected) response.collected = got.collected;
    else if (got.dateNote) response.dateNote = got.dateNote;
    if (readings.length === 0) {
      response.note = note ?? `No ${tests.map(test => test.name).join(' or ')} result was found in this document. Type the result from the report.`;
    } else if (note) response.note = note;
    return response;
  }

  /** Takes an answer back. The fact line stays, marked as taken back, and the finding is as it was. */
  takeBackQuestion(caseId: string, questionId: string): PharmacistQuestion {
    const { c, q } = this.questionOf(caseId, questionId);
    // A screen that has not started, queued only because another answer still stood, is replaced by this take-back.
    const queuedAgain = this.state.jobs.filter(job =>
      job.stage === 'screen' && job.caseId === c.id && job.status === 'queued' && job.detail === TAKE_BACK_AGAIN
    );
    if (queuedAgain.length > 0) {
      const drop = new Set(queuedAgain.map(job => job.id));
      this.state.jobs = this.state.jobs.filter(job => !drop.has(job.id));
    }
    this.assertQuestionsIdle(c);
    if (!q.answer || q.answer.takenBackAt) throw new ApiError(409, 'This question has no answer to take back.');
    const again = takeAnswerBack(c, this.state.findings, q, this.nowIso());
    this.dropPartsNoLongerAccepted(c);
    const how = again
      ? 'A criterion that still has an answer is screened again from the answers that remain.'
      : 'The finding is as it was.';
    this.note('decision', `The pharmacist took back the answer for ${q.what} on ${c.fileName}. ${how}`, { caseId: c.id });
    const queued = again && !hasOpenJob(this.state, 'screen', c.id);
    if (queued) {
      const job = this.queueScreen(c.id);
      job.detail = TAKE_BACK_AGAIN;
    }
    this.commit();
    if (queued) setTimeout(() => this.kick(), 20);
    return q;
  }

  /** Opens a Not known question again. */
  reopenQuestion(caseId: string, questionId: string): PharmacistQuestion {
    const { c, q } = this.questionOf(caseId, questionId);
    if (q.status !== 'not_known') throw new ApiError(409, 'This question is already open.');
    reopenFact(c, q, this.nowIso());
    this.note('decision', `The pharmacist opened the question for ${q.what} on ${c.fileName} again.`, { caseId: c.id });
    this.commit();
    return q;
  }

  /**
   * Leaves the standing questions unanswered, or shows them again when the body says show.
   * No answer is written. Screening is not held up, so this does not wait for an idle history.
   */
  leaveStandingQuestions(caseId: string, body: unknown): PharmacistQuestion[] {
    const c = this.state.cases.find(item => item.id === caseId);
    if (!c) throw new ApiError(404, 'This history was not found.');
    const show = asRecord(body).show === true;
    const changed = show ? showStanding(c) : leaveStanding(c);
    this.note('decision', show
      ? `The pharmacist asked to see the standing questions again on ${c.fileName}.`
      : `The pharmacist left the standing questions unanswered on ${c.fileName}. The checks still wait.`,
      { caseId: c.id });
    this.commit();
    return changed;
  }

  // ---------- findings ----------

  /** The name a person sees for one job, from the settings. */
  private who(stage: 'screen' | 'check' | 'letter'): string {
    return this.cfg.modelNames[stage];
  }

  private findingOrThrow(id: string): Finding {
    const f = this.state.findings.find(x => x.id === id);
    if (!f) throw new ApiError(404, 'This finding was not found.');
    return f;
  }

  decide(findingId: string, body: unknown): Finding {
    const f = this.findingOrThrow(findingId);
    const req = asRecord(body);
    const action = req.action;
    if (action !== 'accept' && action !== 'bypass' && action !== 'dismiss') {
      throw new ApiError(400, 'The decision must be "accept", "bypass" or "dismiss".');
    }
    if (f.state === 'suspected') throw new ApiError(409, 'The second check has not finished for this finding yet.');
    if (f.state === 'accepted' || f.state === 'bypassed' || f.decision?.action === 'dismiss') {
      if (f.decision?.action === action) return f;
      throw new ApiError(409, `This finding was already ${f.decision?.action === 'dismiss' ? 'dismissed' : f.state}. The decision cannot be changed here.`);
    }
    const disputed = f.state === 'not_confirmed';
    if (action === 'dismiss' && !disputed) throw new ApiError(409, 'Dismiss is for a finding the two models disagree on.');
    const reason = shortText(req.reason, 500);
    if (action === 'bypass' && !reason) throw new ApiError(400, 'Please give a short reason for bypassing this finding.');
    if (action === 'accept' && disputed && !reason) {
      throw new ApiError(400, 'Please give a short reason for accepting this finding anyway.');
    }

    const at = this.nowIso();
    f.decision = { action, by: this.cfg.pharmacy.pharmacist, at };
    if (reason) f.decision.reason = reason;
    f.seenByPharmacist = true;
    const label = this.labelFor(f.criterionId);
    const where = { caseId: f.caseId, findingId: f.id, criterionId: f.criterionId };
    if (action === 'dismiss') {
      // The state stays not_confirmed: that is the disputed finding. The decision closes it, with no letter.
      this.note('decision',
        `The two models disagreed on the finding for ${label}. The pharmacist dismissed it.${reason ? ` Reason: ${reason}` : ''} No letter was written.`,
        where);
      this.commit();
      return f;
    }
    f.state = action === 'accept' ? 'accepted' : 'bypassed';
    if (action === 'accept') {
      const letter = this.letterForAcceptance(f);
      addJob(this.state, 'letter', f.caseId, f.id);
      const next = letter.afterSent ? ' This is the next letter for this patient. An earlier letter was marked as sent.' : '';
      const text = disputed
        ? `The two models disagreed on the finding for ${label}. The pharmacist accepted it anyway. Reason: ${reason}. A letter to the GP is queued.${next}`
        : `The pharmacist accepted the finding for ${label}. A letter to the GP is queued.${next}`;
      this.note('decision', text, { ...where, letterId: letter.id });
    } else {
      const text = disputed
        ? `The two models disagreed on the finding for ${label}. The pharmacist bypassed it. Reason: ${reason}`
        : `The pharmacist bypassed the finding for ${label}. Reason: ${reason}`;
      this.note('decision', text, where);
    }
    this.commit();
    this.kick();
    return f;
  }

  markFindingSeen(findingId: string): Finding {
    const f = this.findingOrThrow(findingId);
    if (!f.seenByPharmacist) {
      f.seenByPharmacist = true;
      this.commit();
    }
    return f;
  }

  // ---------- letters ----------

  private letterOrThrow(id: string): Letter {
    const letter = this.state.letters.find(x => x.id === id);
    if (!letter) throw new ApiError(404, 'This letter was not found.');
    return letter;
  }

  private letterNote(letter: Letter, text: string): void {
    const f = this.state.findings.find(x => x.id === letter.findingId);
    this.note('letter_status', text, { letterId: letter.id, findingId: letter.findingId, caseId: letter.caseId, criterionId: f?.criterionId });
  }

  /**
   * The signature stored on the letter. An empty closing line stays empty: a template letter has none.
   * A letter with no saved signature is not given today's name here. The pharmacist saves it first.
   */
  private closingOf(letter: Letter): LetterClosing {
    if (letter.signatureName && letter.signatureTitle && letter.signatureRegistration) {
      return {
        closingLine: letter.closingLine ?? '',
        signatureName: letter.signatureName,
        signatureTitle: letter.signatureTitle,
        signatureRegistration: letter.signatureRegistration
      };
    }
    throw new ApiError(409, 'This letter has no saved signature. Review it and save it before it can be sent.');
  }

  private stampClosing(letter: Letter, closing: LetterClosing): void {
    letter.closingLine = closing.closingLine;
    letter.signatureName = closing.signatureName;
    letter.signatureTitle = closing.signatureTitle;
    letter.signatureRegistration = closing.signatureRegistration;
  }

  /** The open letter for this patient, or a new one. A finding accepted after a letter was sent starts the next letter. */
  private letterForAcceptance(f: Finding): Letter {
    const open = this.state.letters.find(letter =>
      letter.caseId === f.caseId && (letter.status === 'drafting' || letter.status === 'ready'));
    if (open && !letterFindingIds(open).includes(f.id)) {
      const ids = letterFindingIds(open);
      open.findingIds = [...ids, f.id];
      open.points = [...(open.points ?? [{ findingId: open.findingId, ...(open.draft ? { draft: open.draft } : {}) }]), { findingId: f.id }];
      open.status = 'drafting';
      delete open.previewedAt;
      delete open.previewHash;
      delete open.patientAgreed;
      delete open.withdrawnNote;
      this.rebuildPatientLetter(open);
      return open;
    }
    if (open) return open;
    const afterSent = this.state.letters.some(letter => letter.caseId === f.caseId && letter.sentAt !== undefined);
    const letter: Letter = {
      id: takeId(this.state, 'T', this.state.letters),
      findingId: f.id,
      findingIds: [f.id],
      points: [{ findingId: f.id }],
      caseId: f.caseId,
      status: 'drafting',
      subject: '',
      body: '',
      editedByPharmacist: false,
      seenByPharmacist: false,
      ...(afterSent ? { afterSent: true } : {})
    };
    this.state.letters.push(letter);
    return letter;
  }

  /** The letter that still needs a draft for this finding. */
  private letterWaitingFor(findingId: string): Letter | undefined {
    return this.state.letters.find(letter => {
      if (!letterFindingIds(letter).includes(findingId)) return false;
      const point = letter.points?.find(item => item.findingId === findingId);
      if (point) return point.draft === undefined;
      return letter.findingId === findingId && letter.status === 'drafting';
    });
  }

  /** True while any point of the letter has no draft yet. */
  private stillWriting(letter: Letter): boolean {
    if (letter.status === 'drafting') return true;
    const ids = letterFindingIds(letter);
    if (!letter.points || ids.length <= 1) return false;
    return ids.some(id => !letter.points!.some(point => point.findingId === id && point.draft));
  }

  /** Joins the drafts already stored on the letter into the one letter the pharmacist reads. */
  private rebuildPatientLetter(letter: Letter): void {
    const ids = letterFindingIds(letter);
    const c = this.state.cases.find(item => item.id === letter.caseId);
    const parts: PatientLetterPart[] = ids.map(id => {
      const point = letter.points?.find(item => item.findingId === id);
      if (!point?.draft) {
        return { pending: true, subject: 'Being written', findingParagraph: '', evidenceParagraph: '', requestParagraph: '' };
      }
      return partFromLetterBody(point.draft.body, point.draft.subject, point.draft.origin);
    });
    const drafts = (letter.points ?? []).flatMap(point => point.draft ? [point.draft] : []);
    let latest = 0;
    for (const draft of drafts) {
      const at = Date.parse(draft.at);
      if (Number.isFinite(at) && at > latest) latest = at;
    }
    const text = assemblePatientLetter({
      cfg: this.cfg,
      patient: c?.patient ?? { label: 'Fictional patient' },
      when: latest > 0 ? new Date(latest) : this.nowFn(),
      parts
    });
    const origins = parts.map(part => part.origin);
    const closing = {
      closingLine: writingLine(origins),
      signatureName: this.cfg.pharmacy.pharmacist,
      signatureTitle: this.cfg.pharmacy.pharmacistTitle,
      signatureRegistration: this.cfg.pharmacy.registration
    };
    this.stampClosing(letter, closing);
    letter.body = letterAsItLeaves(text, closing);
    letter.subject = `${ids.length} ${ids.length === 1 ? 'point' : 'points'} for this patient`;
    const ready = ids.every(id => letter.points?.some(point => point.findingId === id && point.draft));
    letter.editedByPharmacist = false;
    if (!ready) {
      letter.status = 'drafting';
      delete letter.draft;
      return;
    }
    letter.status = 'ready';
    letter.seenByPharmacist = false;
    const first = drafts[0];
    if (!first) return;
    const allTemplate = origins.length > 0 && origins.every(origin => origin === 'template');
    letter.draft = {
      ...first,
      subject: letter.subject,
      body: letter.body,
      origin: allTemplate ? 'template' : 'model',
      checkNotes: (letter.points ?? []).flatMap(point => point.draft?.checkNotes ?? []),
      seconds: (letter.points ?? []).reduce((sum, point) => sum + (point.draft?.seconds ?? 0), 0)
    };
    if (allTemplate) {
      const why = (letter.points ?? []).find(point => point.draft?.templateReason)?.draft?.templateReason;
      if (why) letter.draft.templateReason = why;
    } else {
      delete letter.draft.templateReason;
    }
  }

  /** True when this finding is still accepted for this patient. A taken-back answer is not. */
  private findingAccepted(caseId: string, findingId: string): boolean {
    const finding = this.state.findings.find(item => item.id === findingId);
    return !!finding && finding.caseId === caseId && finding.state === 'accepted';
  }

  /** Every point of the letter is an accepted finding. An empty letter matches nothing. */
  private letterMatchesAccepted(letter: Letter): boolean {
    const ids = letterFindingIds(letter);
    return ids.length > 0 && ids.every(id => this.findingAccepted(letter.caseId, id));
  }

  /**
   * Agree, preview and send stay off while the letter does not match the findings.
   * A letter that is still being written stays off for that reason, as before.
   */
  private assertCanReview(letter: Letter): void {
    const alreadyOut = letter.status === 'sent' || letter.status === 'reply_recorded' || letter.status === 'closed';
    if (!alreadyOut && letter.withdrawnNote && !this.letterMatchesAccepted(letter)) {
      throw new ApiError(409, letter.withdrawnNote);
    }
    if (this.stillWriting(letter)) {
      throw new ApiError(409, 'This letter is still being written. Please wait until it is ready.');
    }
  }

  /**
   * A remaining draft can still quote a pharmacist line that was taken back for another point.
   * That point is written again from the standard letter. No model is asked.
   */
  private rewritePointsThatQuoteATakenBackLine(c: CaseRecord, letter: Letter): void {
    const quotes = c.lines.flatMap(line => {
      const at = line.text.lastIndexOf(TAKEN_BACK_MARK);
      if (at < 0) return [];
      const original = line.text.slice(0, at).trim();
      return original.length >= 12 ? [original] : [];
    });
    if (quotes.length === 0 || !letter.points) return;
    const lines = linesForModels(c.lines);
    for (const point of letter.points) {
      const body = point.draft?.body ?? '';
      if (!quotes.some(quote => body.includes(quote))) continue;
      const finding = this.state.findings.find(item => item.id === point.findingId);
      const criterion = finding ? this.pinnedCriterion(c.id, finding.criterionId) : undefined;
      if (!finding || !criterion) continue;
      point.draft = templateLetter(
        this.cfg, c.patient, lines, criterion, finding, 'error',
        ['A line this point quoted was taken back, so this point was written again from the standard letter.'],
        this.nowFn()
      );
    }
  }

  /**
   * A point whose finding is no longer accepted leaves the open letter.
   * The preview and the agreement are cleared. A letter already marked as sent is not changed.
   * A draft that is still queued for a finding that left is not started.
   */
  private dropPartsNoLongerAccepted(c: CaseRecord): void {
    const standing = new Set(
      this.state.findings.filter(f => f.caseId === c.id && f.state === 'accepted').map(f => f.id)
    );
    for (const letter of this.state.letters) {
      if (letter.caseId !== c.id) continue;
      const ids = letterFindingIds(letter);
      if (ids.every(id => standing.has(id))) continue;
      const alreadyOut = letter.status === 'sent' || letter.status === 'reply_recorded' || letter.status === 'closed' || letter.sentAt !== undefined;
      if (alreadyOut) {
        letter.withdrawnNote = 'An answer this letter rested on was taken back. The letter was not changed, because it was already marked as sent.';
        this.letterNote(letter, letter.withdrawnNote);
        continue;
      }
      const keep = ids.filter(id => standing.has(id));
      delete letter.previewedAt;
      delete letter.previewHash;
      delete letter.patientAgreed;
      letter.findingIds = keep;
      letter.points = (letter.points ?? []).filter(point => keep.includes(point.findingId));
      if (keep.length > 0) {
        letter.findingId = keep[0];
        this.rewritePointsThatQuoteATakenBackLine(c, letter);
        this.rebuildPatientLetter(letter);
        const said = 'A point left this letter because an answer it rested on was taken back. The preview was cleared, so the letter must be agreed and previewed again before it can be sent.';
        this.letterNote(letter, said);
        // The note stays only while the letter does not match the findings. Once it does, it is cleared.
        if (this.letterMatchesAccepted(letter)) delete letter.withdrawnNote;
        else letter.withdrawnNote = said;
      } else {
        letter.withdrawnNote = 'This point is withdrawn. An answer it rested on was taken back. Agree, preview and send stay off until the letter matches the findings again.';
        letter.subject = 'This point is withdrawn';
        letter.body = letter.withdrawnNote;
        letter.status = 'drafting';
        delete letter.draft;
        letter.editedByPharmacist = false;
        letter.points = [];
        this.letterNote(letter, letter.withdrawnNote);
      }
    }
    this.state.jobs = this.state.jobs.filter(job => {
      if (job.stage !== 'letter' || job.caseId !== c.id || job.status !== 'queued') return true;
      return !!job.findingId && standing.has(job.findingId);
    });
  }

  /** Puts a finished draft on the letter, with the signature put back so it cannot be left off. */
  private placeReadyLetter(letter: Letter, draft: LetterDraft, findingId = letter.findingId): boolean {
    if (!findingId || !this.findingAccepted(letter.caseId, findingId)) return false;
    if (letter.findingIds && !letter.findingIds.includes(findingId)) return false;
    if (!letter.findingIds || letter.findingIds.length === 0) letter.findingIds = letterFindingIds(letter);
    if (!letter.points || letter.points.length === 0) letter.points = [{ findingId: letter.findingId }];
    let point = letter.points.find(item => item.findingId === findingId);
    if (!point) {
      point = { findingId };
      letter.points.push(point);
      if (!letter.findingIds.includes(findingId)) letter.findingIds.push(findingId);
    }
    point.draft = draft;
    if (letterFindingIds(letter).length > 1) {
      this.rebuildPatientLetter(letter);
      return true;
    }
    letter.draft = draft;
    letter.subject = draft.subject;
    const closing = letterClosing(this.cfg, draft.origin, draft.templateReason);
    this.stampClosing(letter, closing);
    letter.body = letterAsItLeaves(draft.body, closing);
    letter.status = 'ready';
    letter.editedByPharmacist = false;
    letter.seenByPharmacist = false;
    return true;
  }

  /**
   * The letter used when the letter step stops and will not be tried again.
   * When the criterion is known it is the standard template. When it is not, the pharmacist writes it.
   */
  private lastResortLetter(c: CaseRecord | undefined, findingId: string | undefined, why: string): LetterDraft {
    const f = findingId ? this.state.findings.find(x => x.id === findingId) : undefined;
    const criterion = c && f ? this.pinnedCriterion(c.id, f.criterionId) : undefined;
    if (c && f && criterion) {
      return templateLetter(this.cfg, c.patient, c.lines, criterion, f, 'error', [
        `The letter step stopped with an error. ${why}`
      ], this.nowFn());
    }
    return {
      subject: 'Request for a medicines review',
      body: HAND_WRITTEN_LETTER,
      origin: 'template', templateReason: 'error',
      checkNotes: ['The criterion file could not be read, so no letter was drafted.'],
      model: this.cfg.models.letter, at: this.nowIso(), seconds: 0
    };
  }

  /** True while the saved letter still tells the pharmacist to write it. That text is not sent. */
  private letterAwaitsHandwriting(letter: Letter): boolean {
    return letter.body.includes('Please write it by hand.');
  }

  /** The letter exactly as it will leave, with the line about AI and the signature put back. */
  private leavingText(letter: Letter): string {
    const closing = this.closingOf(letter);
    this.stampClosing(letter, closing);
    return letterAsItLeaves(letter.body, closing);
  }

  markLetterSeen(letterId: string): Letter {
    const letter = this.letterOrThrow(letterId);
    if (!letter.seenByPharmacist) {
      letter.seenByPharmacist = true;
      this.commit();
    }
    return letter;
  }

  editLetter(letterId: string, body: unknown): Letter {
    const letter = this.letterOrThrow(letterId);
    const req = asRecord(body);
    if (typeof req.subject !== 'string' || typeof req.body !== 'string') {
      throw new ApiError(400, 'The letter needs a subject and a text.');
    }
    this.assertCanReview(letter);
    if (letter.status !== 'ready') throw new ApiError(409, 'This letter was already sent. It can no longer be changed.');
    const rawSubject = req.subject.replace(/\s+/g, ' ').trim();
    const rawText = req.body.replace(/\r\n?/g, '\n');
    // A letter past the limit is refused whole. Cutting it here would drop the pharmacist's words and still say the save worked.
    if (rawSubject.length > SUBJECT_CAP) {
      throw new ApiError(400, `The subject is longer than ${SUBJECT_CAP} characters. Shorten it, then save. Nothing was changed.`);
    }
    if (rawText.length > LETTER_TEXT_CAP) {
      throw new ApiError(400, 'The letter is longer than 200,000 characters. Shorten it, then save. Nothing was changed.');
    }
    // A date of birth is worked out as an age. It is not written into the letter the doctor reads.
    const dob = this.state.cases.find(c => c.id === letter.caseId)?.patient.dateOfBirth;
    const subject = omitBirthDate(rawSubject, dob);
    const text = omitBirthDate(rawText, dob);
    if (!text.trim()) throw new ApiError(400, 'The letter text is empty.');
    if (!subject && rawSubject) {
      throw new ApiError(400, 'The subject is a date of birth. The date of birth is not written in a letter. Write a subject, then save. Nothing was changed.');
    }
    // A save is the review that may give a signature to a letter that was stored without one.
    if (!letter.signatureName || !letter.signatureTitle || !letter.signatureRegistration) {
      this.stampClosing(letter, letterClosing(this.cfg, letter.draft?.origin ?? 'model', letter.draft?.templateReason));
    }
    const nextBody = letterAsItLeaves(text, this.closingOf(letter));
    this.stampClosing(letter, this.closingOf(letter));
    if (subject === letter.subject && nextBody === letter.body) return letter;
    const current = letter.draftRevision ?? 0;
    if (req.expectedRevision !== current) {
      throw new ApiError(409, `This is not the latest copy of the letter. It is at revision ${current}. Open it again, then save.`);
    }
    letter.subject = subject;
    letter.body = nextBody;
    letter.draftRevision = current + 1;
    letter.editedByPharmacist = subject !== (letter.draft?.subject ?? '') || nextBody !== (letter.draft?.body ?? '');
    delete letter.previewedAt;
    delete letter.previewHash;
    this.letterNote(letter, `The pharmacist saved changes to letter ${letter.id}.`);
    this.commit();
    return letter;
  }

  /** The token for one preview: the subject and the letter exactly as it will leave. */
  private previewRevision(subject: string, text: string): string {
    return letterTextHash(`${subject}\n${text}`);
  }

  /**
   * Records that the pharmacist previewed the letter exactly as it will leave.
   * The answer is that text, the time, the email draft, and the token for this subject and text.
   */
  previewLetter(letterId: string): { letter: Letter; text: string; previewedAt: string; emailDraft: EmailDraft; previewToken: string } {
    const letter = this.letterOrThrow(letterId);
    this.assertCanReview(letter);
    if (letter.status !== 'ready') throw new ApiError(409, 'This letter was already sent. Preview it before it is sent.');
    if (this.letterAwaitsHandwriting(letter)) {
      throw new ApiError(409, 'This letter is not written yet. Write it, save it, then open the preview.');
    }
    const text = this.leavingText(letter);
    letter.body = text;
    const previewedAt = this.nowIso();
    letter.previewedAt = previewedAt;
    letter.previewHash = this.previewRevision(letter.subject, text);
    const emailDraft = emailDraftFor(letter.subject, text, this.cfg.emailDraftLimit ?? 1800);
    this.letterNote(letter, `Letter ${letter.id} was previewed, ${text.length} characters, exactly as it will leave.`);
    this.commit();
    return { letter, text, previewedAt, emailDraft, previewToken: letter.previewHash };
  }

  agree(letterId: string, body: unknown): Letter {
    const letter = this.letterOrThrow(letterId);
    const req = asRecord(body);
    this.assertCanReview(letter);
    if (letter.status !== 'ready') throw new ApiError(409, 'This letter was already sent.');
    if (req.agreed === false) {
      if (letter.patientAgreed) {
        delete letter.patientAgreed;
        this.letterNote(letter, `The patient agreement tick was removed from letter ${letter.id}.`);
        this.commit();
      }
      return letter;
    }
    letter.patientAgreed = { at: this.nowIso() };
    const note = shortText(req.note, 500);
    if (note) letter.patientAgreed.note = note;
    this.letterNote(letter, `Recorded for letter ${letter.id}: discussed with the patient, and the patient agrees.`);
    this.commit();
    return letter;
  }

  markSent(letterId: string, body: unknown): Letter {
    const letter = this.letterOrThrow(letterId);
    const req = asRecord(body);
    const by = req.by;
    if (by !== 'print' && by !== 'email') throw new ApiError(400, 'Please say how the letter went out: "print" or "email".');
    this.assertCanReview(letter);
    if (letter.status !== 'ready') {
      if (letter.status === 'sent' && letter.sentBy === by) return letter;
      throw new ApiError(409, 'This letter was already marked as sent.');
    }
    if (this.letterAwaitsHandwriting(letter)) {
      throw new ApiError(409, 'This letter is not written yet. Write it, save it, then open the preview.');
    }
    const text = this.leavingText(letter);
    const hash = this.previewRevision(letter.subject, text);
    if (!letter.previewedAt || letter.previewHash !== hash) {
      throw new ApiError(409, letter.previewedAt
        ? 'The letter changed after the preview. Open the preview again, then mark it as sent.'
        : 'This letter has not been previewed. Open the preview, read the letter, then mark it as sent.');
    }
    if (req.previewToken !== letter.previewHash) {
      throw new ApiError(409, 'This is not the copy that was previewed. Open the preview again, then mark it as sent.');
    }
    const now = this.nowFn();
    letter.status = 'sent';
    letter.sentAt = now.toISOString();
    letter.sentBy = by;
    letter.dueAt = new Date(now.getTime() + this.cfg.overdueDays * 24 * 60 * 60 * 1000).toISOString();
    letter.seenByPharmacist = true;
    const agreed = letter.patientAgreed ? 'Patient agreement was recorded.' : 'Patient agreement was not recorded.';
    this.letterNote(letter, `Letter ${letter.id} was marked as sent by ${by}. ${agreed} A reply is due in ${many(this.cfg.overdueDays, 'day', 'days')}.`);
    this.commit();
    return letter;
  }

  recordReply(letterId: string, body: unknown): Letter {
    const letter = this.letterOrThrow(letterId);
    const req = asRecord(body);
    const outcome = req.outcome as ReplyOutcome;
    if (!REPLY_OUTCOMES.includes(outcome)) {
      throw new ApiError(400, 'Please choose the outcome of the reply: changed, not_changed, will_review or other.');
    }
    if (letter.status !== 'sent' && letter.status !== 'reply_recorded') {
      throw new ApiError(409, letter.status === 'closed'
        ? 'This letter is closed.'
        : 'A reply can be recorded after the letter is marked as sent.');
    }
    const points = this.replyPointOverrides(letter, outcome, req.points);
    const note = typeof req.note === 'string' ? req.note.trim().slice(0, 2000) : '';
    letter.reply = { at: this.nowIso(), outcome, note, ...(points.length > 0 ? { points } : {}) };
    letter.status = 'reply_recorded';
    const words: Record<ReplyOutcome, string> = {
      changed: 'the doctor changed the treatment',
      not_changed: 'the doctor made no change',
      will_review: 'the doctor will review the patient',
      other: 'other'
    };
    const extra = points.length === 0 ? '' : ` ${points.length === 1 ? 'One point differs' : `${points.length} points differ`} from that outcome.`;
    this.letterNote(letter, `The doctor's reply to letter ${letter.id} was recorded: ${words[outcome]}.${extra}`);
    this.commit();
    return letter;
  }

  /** A point stored only when the doctor answered it differently from the letter as a whole. */
  private replyPointOverrides(letter: Letter, outcome: ReplyOutcome, raw: unknown): LetterPointReply[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new ApiError(400, 'A reply for one point must be a list.');
    const ids = new Set(letterFindingIds(letter));
    const seen = new Set<string>();
    const out: LetterPointReply[] = [];
    for (const item of raw) {
      const row = asRecord(item);
      const findingId = typeof row.findingId === 'string' ? row.findingId : '';
      if (!ids.has(findingId)) throw new ApiError(400, 'That point is not on this letter.');
      if (seen.has(findingId)) throw new ApiError(400, 'That point is named more than once.');
      seen.add(findingId);
      const pointOutcome = row.outcome as ReplyOutcome;
      if (!REPLY_OUTCOMES.includes(pointOutcome)) {
        throw new ApiError(400, 'Please choose the outcome of the reply: changed, not_changed, will_review or other.');
      }
      if (pointOutcome === outcome) continue;
      const pointNote = typeof row.note === 'string' ? row.note.trim().slice(0, 2000) : '';
      out.push(pointNote ? { findingId, outcome: pointOutcome, note: pointNote } : { findingId, outcome: pointOutcome });
    }
    return out;
  }

  closeLetter(letterId: string): Letter {
    const letter = this.letterOrThrow(letterId);
    if (letter.status === 'closed') return letter;
    if (this.stillWriting(letter) && !letter.withdrawnNote) {
      throw new ApiError(409, 'This letter is still being written. Please wait until it is ready.');
    }
    const how = letter.status === 'ready' ? ' It was not sent.' : letter.reply ? '' : ' No reply was recorded.';
    letter.status = 'closed';
    letter.closedAt = this.nowIso();
    letter.seenByPharmacist = true;
    this.letterNote(letter, `Letter ${letter.id} was closed.${how}`);
    this.commit();
    return letter;
  }

  // ---------- the demo clock ----------

  /**
   * Moves the server's clock ahead by a whole number of days. 0 puts the real date back.
   * The number is kept in data/demo-clock.json, so a restart keeps it. Due dates, overdue
   * and every new time stamp use the moved time.
   */
  setDemoClock(body: unknown): { days: number; serverTime: string } {
    const days = asRecord(body).days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_DEMO_DAYS) {
      throw new ApiError(400, 'The demo clock takes a whole number of days, 0 or more.');
    }
    if (days === this.demoDays) return { days, serverTime: this.nowIso() };
    const previous = this.demoDays;
    this.demoDays = days;
    try {
      writeFileAtomic(this.clockFile, JSON.stringify({ days }) + '\n');
    } catch {
      this.demoDays = previous;
      throw new ApiError(500, 'The demo clock could not be saved, so it was left as it was.');
    }
    this.note('reset', days === 0
      ? 'The demo clock is back to the real date.'
      : `The demo clock was moved ${many(days, 'day', 'days')} ahead.`);
    try {
      this.commit();
    } catch (e) {
      this.demoDays = previous;
      try {
        if (previous === 0) {
          if (fs.existsSync(this.clockFile)) fs.unlinkSync(this.clockFile);
        } else {
          writeFileAtomic(this.clockFile, JSON.stringify({ days: previous }) + '\n');
        }
      } catch {
        // The clock file could not be put back. The date in memory was.
      }
      throw e;
    }
    return { days, serverTime: this.nowIso() };
  }

  // ---------- reset ----------

  /** Starts a clean demo. The old state file is kept as a dated backup. A job that is running drops its result. */
  async reset(): Promise<{ backup: string | null }> {
    // The copy is made before the running job is stopped. A copy that fails leaves that job running.
    const kept = this.store.keepBackup(this.nowFn());
    const prior = JSON.parse(JSON.stringify(this.state)) as AppState;
    const daysBefore = this.demoDays;
    this.generation++;
    // The model call that is running is stopped at once, so the next import does not wait for it.
    this.running?.abort();
    this.retries.clear();
    this.modelsDown = false;
    this.toldWaiting = false;
    this.warmupFailed = false;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    const wasAhead = this.demoDays;
    let clockFileSaved = true;
    if (wasAhead !== 0) {
      this.demoDays = 0;
      try {
        writeFileAtomic(this.clockFile, JSON.stringify({ days: 0 }) + '\n');
      } catch {
        clockFileSaved = false;
      }
    }
    const unconfirmed = this.state.cases
      .filter(c => c.source === 'pdf-image' && !c.transcriptionConfirmed)
      .map(c => c.id);
    try {
      this.store.replaceWithClean();
    } catch (e) {
      // The clean demo did not start. The old session comes back, and the stopped job is queued again.
      this.store.state = prior;
      this.demoDays = daysBefore;
      for (const job of this.state.jobs) {
        if (job.status === 'running') job.status = 'queued';
      }
      if (daysBefore !== 0) {
        try {
          writeFileAtomic(this.clockFile, JSON.stringify({ days: daysBefore }) + '\n');
        } catch {
          // The clock file could not be put back. The date in memory was.
        }
      }
      try {
        this.save();
      } catch {
        // The session is back in memory. The next save writes it.
      }
      this.kick();
      throw e;
    }
    this.rememberCommitted();
    this.clearPins();
    // The state backup names the scan. The page files are copied beside it and checked before they are removed.
    const withPages = unconfirmed.filter(id => this.images.list(id).length > 0);
    let pagesLeftInPlace = false;
    if (withPages.length > 0) {
      const archive = kept ? path.join(path.dirname(kept), `${path.basename(kept, '.json')}-pages`) : '';
      if (!archive) pagesLeftInPlace = true;
      else {
        try {
          for (const id of withPages) this.images.copyCase(id, archive);
          const restored = new PageImages(archive);
          for (const id of withPages) {
            const check = restored.check(id);
            if (!check.ok) throw new Error(check.words);
          }
        } catch {
          pagesLeftInPlace = true;
        }
      }
    }
    if (!pagesLeftInPlace) this.images.clear();
    this.progress = {};
    this.notedProblems = '';            // a criterion that still does not load is named again in the clean log
    const backup = kept ? path.basename(kept) : null;
    if (wasAhead !== 0) {
      this.note('reset', clockFileSaved
        ? 'The demo clock is back to the real date.'
        : 'The demo clock is back to the real date for this run. The clock file could not be saved.');
    }
    const pagesNote = withPages.length === 0
      ? ''
      : pagesLeftInPlace
        ? ' The pages of a scan that was not confirmed could not be copied, so they were left in place.'
        : ' The pages of a scan that was not confirmed were kept with it.';
    this.note('reset', backup
      ? `A clean demo was started. The earlier state was kept as ${backup}.${pagesNote}`
      : 'A clean demo was started.');
    this.save();
    await this.refreshCriteria();
    this.queueWarmupJob();
    if (this.state.jobs.some(j => j.warmup)) {
      this.save();
      this.kick();
    }
    return { backup };
  }

  // ---------- the queue ----------

  /** Starts the worker when it is not already running. */
  kick(): void {
    if (this.working) return;
    this.working = true;
    void this.work();
  }

  private async work(): Promise<void> {
    try {
      for (;;) {
        if (this.modelsDown) {
          let up = false;
          try {
            up = await this.modelsUpFn();
          } catch {
            up = false;
          }
          if (!up) {
            this.armHold();
            break;
          }
          this.modelsDown = false;
          this.toldWaiting = false;
          this.note('error', 'The local models are answering again. The waiting step starts.');
          this.save();
        }
        const job = pickNextJob(this.state.jobs, this.lastStage);
        if (!job) break;
        const generation = this.generation;
        const running = new AbortController();
        this.running = running;
        try {
          job.status = 'running';
          this.lastStage = job.stage;
          this.save();
          await this.runJob(job, generation, running.signal);
        } catch (e) {
          if (generation === this.generation) {
            try {
              this.afterJobError(job, e);
            } catch (worse) {
              // The last net: the queue must go on whatever happens here.
              job.status = 'failed';
              this.log(`A step could not be tidied up after an error: ${worse instanceof Error ? worse.message : String(worse)}`);
            }
          }
        } finally {
          if (this.running === running) this.running = null;
        }
        this.progress = {};
      }
    } finally {
      this.working = false;
    }
    if (this.modelsDown && this.state.jobs.some(j => j.status === 'queued')) {
      this.armHold();
      return;
    }
    if (this.state.jobs.some(j => j.status === 'queued')) {
      this.kick();
      return;
    }
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Asks again later. One timer only, so a down server is not probed in a tight loop. */
  private armHold(): void {
    if (this.holdTimer) return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.kick();
    }, this.holdDelayMs);
    this.holdTimer.unref?.();
  }

  /**
   * The model server could not be reached. The job stays queued. It is not failed.
   * It runs again when the server answers. No new status: the contract has queued, running, done and failed,
   * and docs/SPEC.md does not name another one.
   */
  private pauseForServer(job: Job, text: string): void {
    job.status = 'queued';
    job.detail = HELD_FOR_MODELS;
    this.modelsDown = true;
    if (!this.toldWaiting) {
      this.toldWaiting = true;
      this.note('error', text);
    }
    this.save();
  }

  private finish(job: Job, status: 'done' | 'failed', detail?: string): void {
    job.status = status;
    if (detail) job.detail = detail;
    // A warm-up that could not reach the models must not keep saying so after a real step has finished.
    // A step that failed, or that is waiting because the server is still down, leaves the line in place.
    if (status === 'done' && !job.warmup) this.warmupFailed = false;
    this.save();
  }

  /**
   * A step stopped with an error it did not expect. The job is marked failed and the reason is
   * logged. The work is not left waiting for a restart: it is queued again, a few times at most.
   * After that a check is shown as "second check not completed", a letter gets a note to write
   * it by hand, and a screening stays "interrupted" with the button "Screen again" on the page.
   */
  private afterJobError(job: Job, e: unknown): void {
    const why = e instanceof Error ? e.message : String(e);
    job.status = 'failed';
    job.detail = `Stopped with an error: ${why}`;
    const c = this.state.cases.find(x => x.id === job.caseId);
    // A screening that stopped half way is shown as interrupted, never as done.
    if (job.stage === 'screen' && c && c.screening.status === 'running') {
      c.screening.status = 'interrupted';
      for (const run of c.screening.criteria) {
        if (run.status === 'running') run.status = 'waiting';
      }
    }
    this.note('error', `A step stopped with an error. ${why}`, { caseId: job.caseId, findingId: job.findingId });

    const key = `${job.stage}:${job.caseId}:${job.findingId ?? ''}`;
    const tries = (this.retries.get(key) ?? 0) + 1;
    this.retries.set(key, tries);
    const again = tries <= MAX_RETRIES_AFTER_ERROR;
    if (job.stage === 'screen') {
      const unfinished = c && !c.cannotAssess &&
        (awaitsTranscription(c) ? c.lines.length === 0 : c.screening.status === 'interrupted' || c.screening.status === 'waiting');
      if (c && unfinished && again && !hasOpenJob(this.state, 'screen', c.id)) {
        addJob(this.state, 'screen', c.id);
        this.note('error', `The step for ${c.fileName} is started again.`, { caseId: c.id });
      }
    } else if (job.stage === 'check') {
      const f = this.state.findings.find(x => x.id === job.findingId);
      if (f && f.state === 'suspected') {
        if (again && !hasOpenJob(this.state, 'check', job.caseId, f.id)) {
          addJob(this.state, 'check', job.caseId, f.id);
        } else if (!again) {
          // The finding must not wait for ever: it goes to the bell, marked "second check not completed".
          f.check = {
            confirmed: false, lineIds: f.screen.lineIds,
            whatMatches: `The second check did not finish, so this finding is shown without it. ${why}`,
            whatCannotBeSeen: this.criterionFor(f.criterionId)?.cannot_be_seen ?? '',
            completed: false, model: this.cfg.models.check, at: this.nowIso(), seconds: 0
          };
          f.state = 'confirmed';
          f.seenByPharmacist = false;
          this.note('error',
            `The second check for ${this.labelFor(f.criterionId)} was not completed. The finding is shown to the pharmacist, marked "second check not completed".`,
            { caseId: job.caseId, findingId: f.id, criterionId: f.criterionId });
        }
      }
    } else {
      const letter = job.findingId ? this.letterWaitingFor(job.findingId) : undefined;
      if (letter) {
        if (again && !hasOpenJob(this.state, 'letter', job.caseId, job.findingId)) {
          addJob(this.state, 'letter', job.caseId, job.findingId);
        } else if (!again) {
          const draft = this.lastResortLetter(c, job.findingId, why);
          if (this.placeReadyLetter(letter, draft, job.findingId)) {
            const byHand = !draft.body.includes('The criterion this is based on');
            this.note('error', byHand
              ? `Letter ${letter.id} could not be drafted. Please write it by hand.`
              : `Letter ${letter.id} could not be drafted, so it was built from the template.`,
            { caseId: job.caseId, findingId: job.findingId, letterId: letter.id });
          }
        }
      }
    }
    if (job.stage !== 'screen') this.maybeContinueScreen(job.caseId);
    this.save();
  }

  private async runWarmup(job: Job, generation: number, signal: AbortSignal): Promise<void> {
    const model = this.cfg.models.screen;
    let answer: { ok: true } | { ok: false; error: string };
    try {
      const ask = this.pipeline.warmModel;
      answer = ask
        ? await ask(this.cfg, signal)
        : { ok: false, error: 'The warm-up step is not connected.' };
    } catch (e) {
      answer = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (generation !== this.generation) return;
    if (answer.ok) {
      this.warmupFailed = false;
      this.note('screen', `${this.who('screen')} is warm.`, { model });
      this.finish(job, 'done', 'Warm');
      return;
    }
    this.warmupFailed = true;
    this.note('error',
      'The local models are not running. The server is up. Screening starts when they answer.',
      { model });
    this.finish(job, 'failed', MODELS_NOT_RUNNING);
  }

  private async runJob(job: Job, generation: number, signal: AbortSignal): Promise<void> {
    if (job.warmup) {
      await this.runWarmup(job, generation, signal);
      return;
    }
    const c = this.state.cases.find(x => x.id === job.caseId);
    if (!c) {
      this.finish(job, 'failed', 'The history for this step was not found.');
      return;
    }
    if (job.stage === 'screen') {
      if (awaitsTranscription(c)) await this.runTranscription(job, c, generation, signal);
      else await this.runScreening(job, c, generation, signal);
    } else if (job.stage === 'check') {
      await this.runCheck(job, c, generation, signal);
    } else {
      await this.runLetter(job, c, generation, signal);
    }
  }

  private async runTranscription(job: Job, c: CaseRecord, generation: number, signal: AbortSignal): Promise<void> {
    const model = this.cfg.models.screen;
    const files = this.images.list(c.id);
    if (files.length === 0) {
      c.cannotAssess = 'The scanned pages are no longer on this computer. Please import the file again.';
      this.note('error', `The scan of ${c.fileName} could not be read: the page images are missing.`, { caseId: c.id, model });
      this.finish(job, 'failed', 'The page images are missing.');
      return;
    }
    const stored = this.images.check(c.id);
    if (!stored.ok) {
      // The count recorded at import stays. A missing page is not given the next page's number.
      c.cannotAssess = stored.words;
      this.note('error', `The scan of ${c.fileName} was not read. ${stored.words}`, { caseId: c.id, model });
      this.finish(job, 'failed', 'The stored pages are not the pages that were imported.');
      return;
    }
    const rows: string[] = [];
    const pageOf: number[] = [];
    const birthDates: string[] = [];
    let unreadableDateOfBirth = false;
    let recordAge = c.patient.age;
    for (const item of stored.pages) {
      this.progress = { page: item.page, pages: c.pages ?? stored.pages.length };
      let answer: Awaited<ReturnType<PipelineFns['transcribePageImage']>>;
      try {
        answer = await this.pipeline.transcribePageImage(this.cfg, this.images.read(item.file), signal);
      } catch (e) {
        answer = { ok: false, error: `The reading step stopped with an error: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (generation !== this.generation) return;
      if (!answer.ok && failedBecauseServerIsDown(answer.error)) {
        this.pauseForServer(job,
          `${this.who('screen')} is waiting. The local models are not running, so the scan of ${c.fileName} is not read yet. The reading starts again when the models answer.`);
        return;
      }
      if (!answer.ok) {
        c.cannotAssess = `Page ${item.page} of the scan could not be read. ${answer.error}`;
        this.note('error', `${this.who('screen')} could not read page ${item.page} of ${c.fileName}. The history was not screened.`, { caseId: c.id, model });
        this.finish(job, 'failed', `Page ${item.page} could not be read.`);
        return;
      }
      if (answer.patient?.dateOfBirth) birthDates.push(answer.patient.dateOfBirth);
      if (answer.patient?.dateOfBirthUnreadable) unreadableDateOfBirth = true;
      if (answer.patient?.age !== undefined && (recordAge === undefined || answer.patient.age > recordAge)) {
        recordAge = answer.patient.age;
      }
      if (answer.patient?.sex) c.patient.sex = answer.patient.sex;
      for (const row of answer.rows) {
        rows.push(row);
        pageOf.push(item.page);
      }
    }
    if (birthDates.length === 0 && c.patient.dateOfBirth) birthDates.push(c.patient.dateOfBirth);
    const distinctBirths = [...new Set(birthDates)];
    let ageProblems: string[];
    if (distinctBirths.length > 1) {
      // The first date must not become the age for every supply. The scan is not one patient.
      c.birthDatesRead = distinctBirths;
      delete c.patient.dateOfBirth;
      delete c.patient.age;
      delete c.patient.ageFrom;
      ageProblems = ['These pages give more than one date of birth, so they are not one patient. Correct the scan or import each patient on their own.'];
    } else {
      delete c.birthDatesRead;
      ageProblems = resolvePatientAge(c.patient, {
        birthDates, unreadableDateOfBirth, recordAge, latestSupplyDate: latestSupplyDate(rows)
      });
    }
    const read = linesFromRows(rows, pageOf, { everyRowDated: true });
    c.lines = read.lines;
    restoreUncutRows(c.lines, rows);
    c.parts = screenParts(this.cfg, c.lines).length;
    if (c.lines.length === 0) {
      c.cannotAssess = 'No rows could be read from the scan.';
      this.note('error', `${this.who('screen')} found no rows in the scan of ${c.fileName}. The history was not screened.`, { caseId: c.id, model });
      this.finish(job, 'failed', 'No rows were read.');
      return;
    }
    // A page that gave no rows, and a row whose date cannot be read, are never passed over without a word.
    const pageCount = c.pages ?? stored.pages.length;
    const rowsOnPage: number[] = [];
    for (let p = 1; p <= pageCount; p++) rowsOnPage.push(c.lines.filter(l => l.page === p).length);
    const notes = scanNotesFor(pageCount, rowsOnPage, [...read.problems, ...ageProblems]);
    if (notes.length > 0) c.scanNotes = notes;
    else delete c.scanNotes;
    const perPage = pageCount > 1
      ? ` (${rowsOnPage.map((n, i) => `page ${i + 1}: ${n === 0 ? 'no rows' : many(n, 'row', 'rows')}`).join(', ')})`
      : '';
    const empty = rowsOnPage.map((n, i) => (n === 0 ? i + 1 : 0)).filter(n => n > 0);
    if (empty.length > 0) {
      this.note('error',
        `${this.who('screen')} read no rows from ${empty.length === 1 ? 'page' : 'pages'} ${empty.join(', ')} of ${c.fileName}. Please check ${empty.length === 1 ? 'that page' : 'those pages'} against the paper before confirming.`,
        { caseId: c.id, model });
    }
    this.note('import',
      `${this.who('screen')} read ${many(c.lines.length, 'row', 'rows')} from ${many(pageCount, 'page', 'pages')} of the scan of ${c.fileName}${perPage}. ` +
      'Read from a scan: please check the rows before screening.',
      { caseId: c.id, model });
    this.finish(job, 'done', `${many(c.lines.length, 'row', 'rows')} read`);
  }

  /** How many further criteria are screened before their findings are double-checked. */
  private blockSize(): number {
    const n = this.cfg.screenBlockSize;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 200 ? n : 20;
  }

  /** An open standing or supply link holds its criterion. A possible-finding link does not. */
  private waitingOnAnswer(c: CaseRecord, criterionId: string): boolean {
    return (c.questions ?? []).some(q => criterionWaitsOnAnswer(q, criterionId));
  }

  /**
   * 0: a listed medicine stands in the supply lines.
   * 1: an ask-when question for this criterion is answered.
   * 2: every other criterion, kept in the order it has now.
   * A criterion that is still waiting on an answer is not in any rank.
   */
  private screenRank(c: CaseRecord, criterionId: string): number {
    const criterion = this.pinnedCriterion(c.id, criterionId);
    if (criterion && listedMedicineSupplied(c.lines, criterion)) return 0;
    if (askWhenAnswered(c, criterionId)) return 1;
    return 2;
  }

  /** The waiting and running criteria of the rank that is screened next. Nothing is left out of a later rank. */
  private bestOpen(c: CaseRecord): { index: number; ten: boolean; status: string }[] {
    const open: { index: number; rank: number; ten: boolean; status: string }[] = [];
    c.screening.criteria.forEach((run, index) => {
      if (run.status !== 'waiting' && run.status !== 'running') return;
      if (this.waitingOnAnswer(c, run.criterionId)) return;
      open.push({
        index,
        rank: this.screenRank(c, run.criterionId),
        ten: !this.furtherIds.has(run.criterionId),
        status: run.status
      });
    });
    if (open.length === 0) return [];
    const best = Math.min(...open.map(item => item.rank));
    return open.filter(item => item.rank === best);
  }

  /** True when the next criteria to screen are further criteria, not one of the ten of that rank. */
  private nextIsFurther(c: CaseRecord): boolean {
    const group = this.bestOpen(c);
    return group.length > 0 && group.every(item => !item.ten);
  }

  /**
   * The criteria this screen job reads. Within the rank that is next, the ten come first, all of
   * them, then one block of further criteria. The next rank starts only when this one is done.
   */
  private segmentIndexes(c: CaseRecord): number[] {
    const group = this.bestOpen(c).filter(item => item.status === 'waiting');
    const ten = group.filter(item => item.ten).map(item => item.index);
    const further = group.filter(item => !item.ten).map(item => item.index);
    if (ten.length > 0) return ten;
    return further.slice(0, this.blockSize());
  }

  /** Queues the next screen segment. A segment of further criteria is marked so it waits its turn. */
  private queueScreen(caseId: string): Job {
    const job = addJob(this.state, 'screen', caseId);
    const c = this.state.cases.find(x => x.id === caseId);
    if (c && !awaitsTranscription(c) && this.nextIsFurther(c)) job.band = 'further';
    return job;
  }

  /**
   * After a segment and its checks, queue the next block. A check that is still open, or a screen
   * that is already queued, holds the next block back.
   */
  private maybeContinueScreen(caseId: string): void {
    const c = this.state.cases.find(x => x.id === caseId);
    if (!c || c.cannotAssess || awaitsTranscription(c)) return;
    const stillToRun = c.screening.criteria.some(r =>
      (r.status === 'waiting' || r.status === 'running') && !this.waitingOnAnswer(c, r.criterionId)
    );
    if (!stillToRun) return;
    // A check job carries a finding id, so a call without one does not see it. Any open check for
    // this history holds the next rank: the finding reaches the bell before more criteria are screened.
    const checkOpen = this.state.jobs.some(j =>
      j.stage === 'check' && j.caseId === c.id && (j.status === 'queued' || j.status === 'running'));
    if (hasOpenJob(this.state, 'screen', c.id) || checkOpen) return;
    this.queueScreen(c.id);
    this.save();
  }

  /** A screen job queued by a restart is marked when it will read further criteria, not the ten. */
  private tagQueuedScreens(): void {
    for (const job of this.state.jobs) {
      if (job.status !== 'queued' || job.stage !== 'screen') continue;
      const c = this.state.cases.find(x => x.id === job.caseId);
      if (!c || awaitsTranscription(c)) continue;
      if (this.nextIsFurther(c)) job.band = 'further';
      else delete job.band;
    }
  }

  /** Writes down what Model 1 gave for one criterion: could not be screened, suspected, or clear. */
  private recordScreen(c: CaseRecord, index: number, criterion: Criterion, outcome: ScreenOutcome, seconds: number): void {
    const model = this.cfg.models.screen;
    const runs = c.screening.criteria;
    const run = runs[index];
    const place = `criterion ${index + 1} of ${runs.length}`;
    run.seconds = seconds;
    const extra = { caseId: c.id, criterionId: criterion.id, model };
    if (!outcome.ok) {
      run.status = 'failed';
      run.error = `Could not be screened. ${outcome.error}`;
      this.note('error', `${this.who('screen')} could not screen ${criterion.label} on ${c.fileName}. This is not a clear result. ${outcome.error}`, extra);
    } else if (outcome.suspected) {
      run.status = 'suspected';
      delete run.error;
      // A finding with a missing fact is a possible finding (docs/SPEC.md section 6a): the medicines
      // match and the record holds no line about a fact the criterion needs.
      const missing = missingFactsOf({ screen: outcome.result });
      // An answer keeps the old finding aside so it can be put back. Its id stays reserved.
      const reserved = [
        ...this.state.findings,
        ...this.state.cases.flatMap(item => (item.questions ?? []).flatMap(q => q.heldFindings ?? []))
      ];
      const finding: Finding = {
        id: takeId(this.state, 'F', reserved),
        caseId: c.id,
        criterionId: criterion.id,
        state: 'suspected',
        possible: missing.length > 0,
        screen: { ...outcome.result, missingFacts: missing },
        seenByPharmacist: false
      };
      this.state.findings.push(finding);
      const lines = outcome.result.linesVerified ? '' : ' Lines not verified.';
      this.note('screen', finding.possible
        ? `${this.who('screen')} suspects a possible finding for ${criterion.label} on ${c.fileName} (${place}). The record does not show: ${listFacts(missing)}.${lines} It goes to the second check.`
        : `${this.who('screen')} suspects a finding for ${criterion.label} on ${c.fileName} (${place}).${lines} It goes to the second check.`,
        { ...extra, findingId: finding.id });
    } else {
      run.status = 'clear';
      delete run.error;
      // What Model 1 wrote is kept, so that a miss can be looked into later.
      if (outcome.result.reason) run.reason = outcome.result.reason;
      this.note('screen', `${this.who('screen')} screened ${criterion.label} on ${c.fileName} (${place}): nothing suspected.`, extra);
    }
    this.save();
  }

  private async runScreening(job: Job, c: CaseRecord, generation: number, signal: AbortSignal): Promise<void> {
    const model = this.cfg.models.screen;
    if (c.cannotAssess) {
      this.finish(job, 'failed', 'This history cannot be assessed.');
      return;
    }
    c.screening.status = 'running';
    if (!c.screening.startedAt) c.screening.startedAt = this.nowIso();
    this.save();

    const runs = c.screening.criteria;
    for (const run of runs) {
      if (run.status === 'running') run.status = 'waiting';
    }
    // A criterion whose file cannot be read is never "clear".
    for (const run of runs) {
      if (run.status !== 'waiting' || this.pinnedCriterion(c.id, run.criterionId)) continue;
      run.status = 'failed';
      run.error = 'Could not be screened. The criterion file could not be read.';
      this.note('error', `${run.criterionId} could not be screened on ${c.fileName}: its criterion file could not be read. This is not a clear result.`,
        { caseId: c.id, criterionId: run.criterionId, model });
      this.save();
    }

    // One segment: every waiting criterion of the ten, or one block of further criteria.
    // Finished criteria keep their results. The checks of this segment run before the next block.
    const todo = this.segmentIndexes(c).map(index => ({ run: runs[index], index })).filter(x => x.run.status === 'waiting');
    const longHistory = c.parts > 1 && this.pipeline.screenHistory !== undefined && todo.length > 0;
    if (longHistory && this.pipeline.screenHistory) {
      // A long history: every part is read once and reused for every criterion. Then, for each
      // criterion, the lines that hold a listed medicine are read together.
      const criteria = todo.map(x => this.pinnedCriterion(c.id, x.run.criterionId) as Criterion);
      let live = -1;
      let heldDown = false;
      const mark = (at: number): void => {
        if (live >= 0 && todo[live].run.status === 'running') todo[live].run.status = 'waiting';
        live = at;
        if (at >= 0 && todo[at].run.status === 'waiting') todo[at].run.status = 'running';
      };
      try {
        await this.pipeline.screenHistory(this.cfg, c.patient, linesForModels(c.lines), criteria, {
          onStep: step => {
            if (generation !== this.generation) return;
            mark(step.criterion - 1);
            this.progress = { part: step.part, parts: step.parts };
            job.detail = step.part > 0
              ? `part ${step.part} of ${step.parts}, criterion ${todo[step.criterion - 1].index + 1} of ${runs.length}`
              : `reading the listed lines together, criterion ${todo[step.criterion - 1].index + 1} of ${runs.length}`;
          },
          onResult: (at, outcome, seconds) => {
            if (generation !== this.generation) return;
            if (live === at) live = -1;
            if (!outcome.ok && failedBecauseServerIsDown(outcome.error)) {
              const run = todo[at].run;
              run.status = 'waiting';
              delete run.error;
              heldDown = true;
              return;
            }
            this.recordScreen(c, todo[at].index, criteria[at], outcome, Math.round(seconds * 10) / 10);
          }
        }, signal);
      } catch (e) {
        if (generation !== this.generation) return;
        mark(-1);
        const why = `The screening step stopped with an error: ${e instanceof Error ? e.message : String(e)}`;
        if (failedBecauseServerIsDown(why)) {
          heldDown = true;
        } else {
          // Whatever has no result yet could not be screened. It is never counted as clear.
          todo.forEach((x, at) => {
            if (x.run.status === 'waiting' || x.run.status === 'running') this.recordScreen(c, x.index, criteria[at], { ok: false, error: why }, 0);
          });
        }
      }
      if (generation !== this.generation) return;
      mark(-1);
      if (heldDown) {
        for (const run of runs) {
          if (run.status === 'running') run.status = 'waiting';
        }
        c.screening.status = 'waiting';
        this.pauseForServer(job,
          `${this.who('screen')} is waiting. The local models are not running, so ${c.fileName} is not screened yet. This is not a clear result. The step starts again when the models answer.`);
        return;
      }
    } else {
      for (const { run, index } of todo) {
        const criterion = this.pinnedCriterion(c.id, run.criterionId) as Criterion;
        run.status = 'running';
        job.detail = `criterion ${index + 1} of ${runs.length}`;
        this.save();
        const started = performance.now();
        let outcome: ScreenOutcome;
        try {
          outcome = await this.pipeline.screenCriterion(this.cfg, c.patient, linesForModels(c.lines), criterion, signal);
        } catch (e) {
          outcome = { ok: false, error: `The screening step stopped with an error: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (generation !== this.generation) return;
        if (!outcome.ok && failedBecauseServerIsDown(outcome.error)) {
          run.status = 'waiting';
          delete run.error;
          c.screening.status = 'waiting';
          this.pauseForServer(job,
            `${this.who('screen')} is waiting. The local models are not running, so ${c.fileName} is not screened yet. This is not a clear result. The step starts again when the models answer.`);
          return;
        }
        this.recordScreen(c, index, criterion, outcome, Math.round((performance.now() - started) / 100) / 10);
      }
    }

    const unfinished = runs.some(r => r.status === 'waiting' || r.status === 'running');
    if (unfinished) {
      // The ten, or this block, are screened. Their checks reach the bell before the next block.
      c.screening.status = 'waiting';
      this.syncQuestions(c);
      queueChecks(this.state, c.id);
      const done = runs.filter(r => r.status !== 'waiting' && r.status !== 'running').length;
      this.finish(job, 'done', `${done} of ${many(runs.length, 'criterion', 'criteria')} screened`);
      this.maybeContinueScreen(c.id);
      return;
    }

    c.screening.status = 'done';
    c.screening.finishedAt = this.nowIso();
    this.syncQuestions(c);
    // Newly queued checks are for the queue only. The closing line counts every finding of this
    // history, including one an earlier block already passed on. "Nothing suspected" is said only
    // when every criterion ran and the list is empty. A criterion that could not be screened is
    // never a clear result.
    queueChecks(this.state, c.id);
    const forCase = this.state.findings.filter(f => f.caseId === c.id);
    const stillSuspected = forCase.filter(f => f.state === 'suspected').length;
    const alreadyInList = forCase.length - stillSuspected;
    const failed = runs.filter(r => r.status === 'failed').length;
    const screened = runs.length - failed;
    const passedOn = [
      stillSuspected > 0 ? `${many(stillSuspected, 'suspected finding goes', 'suspected findings go')} to the second check.` : '',
      alreadyInList > 0 ? `${many(alreadyInList, 'finding is', 'findings are')} already in the list.` : ''
    ].filter(part => part !== '').join(' ');
    if (failed === 0) {
      this.note('screen', `${this.who('screen')} finished screening ${c.fileName}: ${passedOn || 'nothing suspected.'}`, { caseId: c.id, model });
    } else {
      const ran = passedOn || (screened > 0 ? `Nothing was suspected in the ${many(screened, 'criterion', 'criteria')} that ran.` : '');
      this.note('error',
        `${this.who('screen')} could not fully screen ${c.fileName}: ${many(failed, 'criterion', 'criteria')} of ${runs.length} could not be screened. ` +
        `${ran ? ran + ' ' : ''}This is not a clear result. Use "Screen again" on the history when the models are running.`,
        { caseId: c.id, model });
    }
    this.finish(job, 'done', failed > 0
      ? `${screened} of ${many(runs.length, 'criterion', 'criteria')} screened, ${failed} could not be screened`
      : `${many(runs.length, 'criterion', 'criteria')} screened`);
  }

  private async runCheck(job: Job, c: CaseRecord, generation: number, signal: AbortSignal): Promise<void> {
    if (this.setAsideCrossed(job, c)) return;
    const model = this.cfg.models.check;
    const f = this.state.findings.find(x => x.id === job.findingId);
    if (!f) {
      this.finish(job, 'failed', 'The finding for this check was not found.');
      this.maybeContinueScreen(c.id);
      return;
    }
    if (f.state !== 'suspected') {
      this.finish(job, 'done', 'Already checked.');
      this.maybeContinueScreen(c.id);
      return;
    }
    const criterion = this.pinnedCriterion(c.id, f.criterionId);
    let result: CheckResult;
    if (!criterion) {
      result = {
        confirmed: false, lineIds: f.screen.lineIds,
        whatMatches: 'The second check did not finish, so this finding is shown without it. The criterion file could not be read.',
        whatCannotBeSeen: '', completed: false, model, at: this.nowIso(), seconds: 0
      };
    } else {
      try {
        result = await this.pipeline.checkFinding(this.cfg, c.patient, linesForModels(c.lines), criterion, f.screen, signal);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (failedBecauseServerIsDown(why)) {
          if (generation !== this.generation) return;
          this.pauseForServer(job,
            `The second check is waiting. The local models are not running, so the finding for ${this.labelFor(f.criterionId)} on ${c.fileName} stays with ${this.who('screen')} until ${this.who('check')} can look at it. It is not dismissed.`);
          return;
        }
        result = {
          confirmed: false, lineIds: f.screen.lineIds,
          whatMatches: `The second check did not finish, so this finding is shown without it. ${why}`,
          whatCannotBeSeen: criterion.cannot_be_seen, completed: false, model, at: this.nowIso(), seconds: 0
        };
      }
    }
    if (generation !== this.generation) return;
    if (!result.completed && failedBecauseServerIsDown(result.whatMatches)) {
      this.pauseForServer(job,
        `The second check is waiting. The local models are not running, so the finding for ${this.labelFor(f.criterionId)} on ${c.fileName} stays with ${this.who('screen')} until ${this.who('check')} can look at it. It is not dismissed.`);
      return;
    }
    // An answer that is not a check result is never read as "not confirmed": the finding is shown.
    const usable = typeof result === 'object' && result !== null && typeof result.confirmed === 'boolean' &&
      typeof result.completed === 'boolean' && Array.isArray(result.lineIds);
    if (!usable) {
      result = {
        confirmed: false, lineIds: f.screen.lineIds,
        whatMatches: 'The second check did not finish, so this finding is shown without it. Its answer could not be read.',
        whatCannotBeSeen: criterion?.cannot_be_seen ?? '', completed: false, model, at: this.nowIso(), seconds: 0
      };
    }
    f.check = result;
    f.state = reachedTheBell(f) ? 'confirmed' : 'not_confirmed';
    f.seenByPharmacist = false;
    const label = this.labelFor(f.criterionId);
    const extra = { caseId: c.id, findingId: f.id, criterionId: f.criterionId, model };
    if (!result.completed) {
      this.note('error', `The second check for ${label} on ${c.fileName} was not completed. The finding is shown to the pharmacist, marked "second check not completed".`, extra);
    } else if (result.confirmed) {
      this.note('check', f.possible
        ? `${this.who('check')} confirmed the possible finding for ${label} on ${c.fileName}. The record does not show: ${listFacts(missingFactsOf(f))}. It is waiting for the pharmacist.`
        : `${this.who('check')} confirmed the finding for ${label} on ${c.fileName}. It is waiting for the pharmacist.`, extra);
    } else if (result.unclear) {
      this.note('check', `${this.who('check')} answered "not confirmed" for ${label} on ${c.fileName} but named lines as proof. The finding is shown to the pharmacist, marked "second check unclear".`, extra);
    } else {
      this.note('check',
        `${this.who('screen')} suspected a finding for ${label} on ${c.fileName}. ${this.who('check')} turned it back. The two models disagree. It is waiting for the pharmacist.`,
        extra);
    }
    this.finish(job, 'done', !result.completed ? 'second check not completed'
      : result.confirmed ? 'confirmed' : result.unclear ? 'second check unclear' : 'not confirmed');
    this.maybeContinueScreen(c.id);
  }

  private async runLetter(job: Job, c: CaseRecord, generation: number, signal: AbortSignal): Promise<void> {
    if (this.setAsideCrossed(job, c)) return;
    const model = this.cfg.models.letter;
    const f = this.state.findings.find(x => x.id === job.findingId);
    const letter = job.findingId ? this.letterWaitingFor(job.findingId) : undefined;
    if (!f || !letter) {
      this.finish(job, 'done', 'No letter is waiting for this finding.');
      return;
    }
    const criterion = this.pinnedCriterion(c.id, f.criterionId);
    let draft: LetterDraft;
    if (!criterion) {
      draft = {
        subject: `Request for a medicines review: ${f.criterionId}`,
        body: HAND_WRITTEN_LETTER,
        origin: 'template', templateReason: 'error',
        checkNotes: ['The criterion file could not be read, so no letter was drafted.'],
        model, at: this.nowIso(), seconds: 0
      };
    } else {
      try {
        draft = await this.pipeline.draftLetter(this.cfg, c.patient, linesForModels(c.lines), criterion, f, signal);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (failedBecauseServerIsDown(why)) {
          if (generation !== this.generation) return;
          this.pauseForServer(job,
            `${this.who('letter')} is waiting. The local models are not running, so the letter for ${this.labelFor(f.criterionId)} on ${c.fileName} is not written yet. It is not built from the template.`);
          return;
        }
        draft = templateLetter(this.cfg, c.patient, c.lines, criterion, f, 'error', [
          `The letter step stopped with an error. ${why}`
        ], this.nowFn());
      }
    }
    if (generation !== this.generation) return;
    if (draft.origin === 'template' && draft.templateReason === 'no_answer' && draft.checkNotes.some(note => failedBecauseServerIsDown(note))) {
      this.pauseForServer(job,
        `${this.who('letter')} is waiting. The local models are not running, so the letter for ${this.labelFor(f.criterionId)} on ${c.fileName} is not written yet. It is not built from the template.`);
      return;
    }
    if (!this.placeReadyLetter(letter, draft, f.id)) {
      this.note('letter',
        `A draft for ${this.labelFor(f.criterionId)} on ${c.fileName} arrived after the answer was taken back. It was not joined to the letter.`,
        { caseId: c.id, findingId: f.id, letterId: letter.id, criterionId: f.criterionId, model });
      this.finish(job, 'done', 'not joined: the answer was taken back');
      return;
    }
    const label = this.labelFor(f.criterionId);
    // Said as it happened: a draft that failed its checks is not the same as a model that did not answer.
    const byHand = draft.body.includes('Please write it by hand.');
    let how: string;
    if (draft.origin === 'model') {
      how = draft.checkNotes.length === 0 ? 'The letter checks found nothing.' : 'The first draft failed a check. The second draft passed.';
    } else if (byHand) {
      how = 'The criterion file could not be read, so no letter was drafted. Please write it by hand.';
    } else if (draft.templateReason === 'no_answer') {
      how = `${this.who('letter')} did not answer, so the letter was built from the template.`;
    } else if (draft.templateReason === 'error') {
      how = 'The draft could not be made, so the letter was built from the template.';
    } else {
      how = 'The model draft did not pass its checks, so the letter was built from the template.';
    }
    const said = byHand
      ? `The letter for ${label} on ${c.fileName} is not written yet. ${how}`
      : this.stillWriting(letter)
        ? `A point of the letter for ${label} on ${c.fileName} is written. The letter waits until every point is written. ${how}`
        : `The letter for ${label} on ${c.fileName} is ready. ${how}`;
    this.note('letter', said,
      { caseId: c.id, findingId: f.id, letterId: letter.id, criterionId: f.criterionId, model });
    this.finish(job, 'done', draft.origin === 'model' ? 'drafted by the model' : byHand ? 'needs the pharmacist to write it' : 'built from the template');
  }
}
