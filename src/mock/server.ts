// A stand-in for the local server, used only when the page address has ?mock=1.
// It keeps sample data in memory and moves it along on a simple clock, so every state of the
// page can be looked at without the server and without the models. Nothing is saved:
// reloading the page starts the sample data again.
//
// Files imported in this view are NOT screened. They are shown as "Cannot assess" with the reason,
// so that a sample view can never be read as a real screening result.
import type {
  Activity,
  AppState,
  CaseRecord,
  Counts,
  Finding,
  HealthResponse,
  ImportRequest,
  Job,
  Letter,
  LetterPoint,
  LetterPointReply,
  NowRunning,
  PharmacistQuestion,
  ReplyOutcome,
  Stage,
  StateResponse,
} from '../../shared/types.ts';
import {
  headFromLetterBody,
  partFromLetterBody,
  prescriberMostNamed,
  renderPatientLetter,
} from '../../shared/patient-letter.ts';
import type { PatientLetterHead, PatientLetterPart } from '../../shared/patient-letter.ts';
import type { Backend } from '../api.ts';
import { ApiError } from '../apiError.ts';
import { readCriteria } from '../lib/criteria.ts';
import { LETTER_TEXT_CAP } from '../lib/draftStore.ts';
import { closingParts, emailDraftFromLetter, letterAsItLeaves } from '../lib/letters.ts';
import { JOB_NAMES } from '../lib/modelNames.ts';
import type { PathologyUploadRequest } from '../lib/pathologyFile.ts';
import { pathologyFromFixture } from './pathologyFixture.ts';
import {
  MODEL_NAMES,
  SAMPLE_CRITERIA,
  SAMPLE_LETTER_CLOSING,
  SAMPLE_LETTER_LINE,
  SCRIPTED,
  buildLetterBody,
  criterionById,
  letterSubject,
  makeFixture,
  makeManyFixture,
  numberLines,
} from './fixtures.ts';

/** How long each step takes on the sample clock, in milliseconds. */
const STEP_MS: Record<Stage, number> = { screen: 2500, check: 3200, letter: 2600 };
/** The step that is already running when the page opens lasts a little longer, so the first look is steady. */
const FIRST_STEP_MS = 7000;
const OVERDUE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOT_SCREENED = 'This is the sample view. The models are not connected, so this file was not screened.';

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface Runtime {
  state: AppState;
  /** When the running step ends. */
  runningUntil: number;
  /** When the queue last became free. */
  freeAt: number;
  /** When each waiting job was put in the queue. */
  queuedAt: Map<string, number>;
  nextCase: number;
  nextFinding: number;
  nextLetter: number;
  nextJob: number;
}

let runtime: Runtime | null = null;

function mockMany(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('many') === '1';
}

function start(nowMs: number): Runtime {
  return {
    state: mockMany() ? makeManyFixture(nowMs) : makeFixture(nowMs),
    runningUntil: nowMs + FIRST_STEP_MS,
    freeAt: nowMs,
    queuedAt: new Map(),
    nextCase: 8,
    nextFinding: 14,
    nextLetter: 8,
    nextJob: 33,
  };
}

function rt(): Runtime {
  runtime ??= start(Date.now());
  return runtime;
}

/** Sample view tests: puts one question on a sample history so the pathology route can be tried. */
export function addSampleQuestion(caseId: string, question: PharmacistQuestion): void {
  const c = caseOf(rt(), caseId);
  if (!c) throw new ApiError('This history was not found.', 404);
  c.questions = [...(c.questions ?? []), question];
}

const iso = (ms: number): string => new Date(ms).toISOString();
const pad = (n: number): string => String(n).padStart(4, '0');

function log(r: Runtime, entry: Activity): void {
  r.state.activity.push(entry);
}

function caseOf(r: Runtime, caseId: string): CaseRecord | undefined {
  return r.state.cases.find((c) => c.id === caseId);
}

function label(criterionId: string): string {
  return criterionById(criterionId)?.label ?? criterionId;
}

function queue(r: Runtime, stage: Stage, caseId: string, nowMs: number, findingId?: string): void {
  const job: Job = { id: `J${pad(r.nextJob++)}`, stage, caseId, status: 'queued' };
  if (findingId) job.findingId = findingId;
  r.state.jobs.push(job);
  r.queuedAt.set(job.id, nowMs);
}

function finishJob(r: Runtime, job: Job, atMs: number): void {
  job.status = 'done';
  r.freeAt = atMs;
  // Keep the list short, the way a server would.
  const done = r.state.jobs.filter((j) => j.status === 'done');
  if (done.length > 8) r.state.jobs = r.state.jobs.filter((j) => j !== done[0]);
}

const REPLY_OUTCOMES: ReplyOutcome[] = ['changed', 'not_changed', 'will_review', 'other'];
const SAMPLE_DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

/** An open letter created under the one-letter rule. Sample letters have no finding list, so they are left as they are. */
function openPatientLetter(r: Runtime, caseId: string): Letter | undefined {
  return r.state.letters.find((letter) =>
    letter.caseId === caseId
    && (letter.status === 'drafting' || letter.status === 'ready')
    && letter.findingIds !== undefined
    && letter.findingIds.length > 0);
}

/** The letter that still needs a draft for this finding. */
function letterWaiting(r: Runtime, findingId: string | undefined): Letter | undefined {
  if (!findingId) return undefined;
  return r.state.letters.find((letter) => {
    const ids = letter.findingIds && letter.findingIds.length > 0 ? letter.findingIds : [letter.findingId];
    if (!ids.includes(findingId)) return false;
    const point = letter.points?.find((item) => item.findingId === findingId);
    if (point) return point.draft === undefined;
    return letter.status === 'drafting' && letter.findingId === findingId;
  });
}

/**
 * Joins the drafts already stored on a sample letter. The closing line stays the sample line.
 * No model wrote these words, so the line that names a model is never written here.
 */
function rebuildMockLetter(letter: Letter): void {
  const ids = letter.findingIds && letter.findingIds.length > 0 ? letter.findingIds : [letter.findingId];
  const parts: PatientLetterPart[] = ids.map((id) => {
    const point = letter.points?.find((item) => item.findingId === id);
    if (!point?.draft) {
      return { pending: true, subject: 'Being written', findingParagraph: '', evidenceParagraph: '', requestParagraph: '' };
    }
    return partFromLetterBody(point.draft.body, point.draft.subject, point.draft.origin);
  });
  const firstDraft = letter.points?.find((point) => point.draft)?.draft;
  const parsed = firstDraft ? headFromLetterBody(firstDraft.body) : null;
  const cited = parts.flatMap((part) => part.cited ?? []);
  const fallback = {
    name: parsed?.addresseeName || 'Dr F. Example (fictional)',
    practice: parsed?.addresseePractice || 'Example Family Practice',
  };
  const addressee = prescriberMostNamed(cited, fallback);
  const head: PatientLetterHead = parsed
    ? { ...parsed, addresseeName: addressee.name, addresseePractice: addressee.practice }
    : {
        pharmacyName: 'Example Community Pharmacy (fictional)',
        pharmacyAddress: '1 Example Street, Exampletown',
        phone: '(00) 0000 0000',
        pharmacist: 'The pharmacist on duty',
        dateText: SAMPLE_DATE.format(new Date()),
        addresseeName: addressee.name,
        addresseePractice: addressee.practice,
        patientLine: 'Fictional patient',
      };
  const closing = {
    closingLine: letter.closingLine || SAMPLE_LETTER_LINE,
    signatureName: letter.signatureName || 'The pharmacist on duty',
    signatureTitle: letter.signatureTitle || 'Pharmacist',
    signatureRegistration: letter.signatureRegistration || '',
  };
  const text = renderPatientLetter(head, parts, closing);
  const ready = ids.every((id) => letter.points?.some((point) => point.findingId === id && point.draft));
  letter.body = letterAsItLeaves(text, closing);
  letter.subject = `${ids.length} ${ids.length === 1 ? 'point' : 'points'} for this patient`;
  letter.editedByPharmacist = false;
  if (!ready) {
    letter.status = 'drafting';
    delete letter.draft;
    return;
  }
  letter.status = 'ready';
  letter.seenByPharmacist = false;
  if (!firstDraft) return;
  const origins = parts.map((part) => part.origin);
  const allTemplate = origins.length > 0 && origins.every((origin) => origin === 'template');
  letter.draft = {
    ...firstDraft,
    subject: letter.subject,
    body: letter.body,
    origin: allTemplate ? 'template' : 'model',
    checkNotes: (letter.points ?? []).flatMap((point) => point.draft?.checkNotes ?? []),
    seconds: (letter.points ?? []).reduce((sum, point) => sum + (point.draft?.seconds ?? 0), 0),
  };
  if (allTemplate) {
    const why = (letter.points ?? []).find((point) => point.draft?.templateReason)?.draft?.templateReason;
    if (why) letter.draft.templateReason = why;
  } else {
    delete letter.draft.templateReason;
  }
}

/** A point stored only when the doctor answered it differently from the letter as a whole. */
function replyPointOverrides(letter: Letter, outcome: ReplyOutcome, raw: LetterPointReply[] | undefined): LetterPointReply[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ApiError('A reply for one point must be a list.', 400);
  const ids = new Set(letter.findingIds && letter.findingIds.length > 0 ? letter.findingIds : [letter.findingId]);
  const seen = new Set<string>();
  const out: LetterPointReply[] = [];
  for (const item of raw) {
    const findingId = typeof item?.findingId === 'string' ? item.findingId : '';
    if (!ids.has(findingId)) throw new ApiError('That point is not on this letter.', 400);
    if (seen.has(findingId)) throw new ApiError('That point is named more than once.', 400);
    seen.add(findingId);
    if (!REPLY_OUTCOMES.includes(item.outcome)) {
      throw new ApiError('Please choose the outcome of the reply: changed, not_changed, will_review or other.', 400);
    }
    if (item.outcome === outcome) continue;
    const pointNote = typeof item.note === 'string' ? item.note.trim().slice(0, 2000) : '';
    out.push(pointNote ? { findingId, outcome: item.outcome, note: pointNote } : { findingId, outcome: item.outcome });
  }
  return out;
}

/** Finish the step that is running. The job may go on with its next step. */
function finishStep(r: Runtime, job: Job, atMs: number): void {
  const at = iso(atMs);

  if (job.stage === 'screen') {
    const c = caseOf(r, job.caseId);
    const runs = c?.screening.criteria ?? [];
    const index = runs.findIndex((run) => run.status === 'running');
    if (!c || index < 0) {
      finishJob(r, job, atMs);
      return;
    }
    const run = runs[index];
    const scripted = SCRIPTED[`${c.id}:${run.criterionId}`];
    run.seconds = STEP_MS.screen / 1000;
    if (scripted) {
      run.status = 'suspected';
      const finding: Finding = {
        id: `F${pad(r.nextFinding++)}`,
        caseId: c.id,
        criterionId: run.criterionId,
        state: 'suspected',
        // The two findings that appear on the sample clock rest on supplies alone: no fact is missing.
        possible: false,
        screen: { ...scripted.screen, linesVerified: true, missingFacts: [], model: MODEL_NAMES.screen, at, seconds: run.seconds },
        seenByPharmacist: false,
      };
      r.state.findings.push(finding);
      queue(r, 'check', c.id, atMs, finding.id);
      log(r, {
        at,
        kind: 'screen',
        text: `${SCREEN_NAME} suspected ${label(run.criterionId)} on ${c.fileName}.`,
        model: MODEL_NAMES.screen,
        caseId: c.id,
        criterionId: run.criterionId,
      });
    } else {
      run.status = 'clear';
    }
    const next = runs[index + 1];
    if (next) {
      next.status = 'running';
      job.detail = `criterion ${index + 2} of ${runs.length}`;
      r.runningUntil = atMs + STEP_MS.screen;
      return;
    }
    c.screening.status = 'done';
    c.screening.finishedAt = at;
    log(r, { at, kind: 'screen', text: `${SCREEN_NAME} finished screening ${c.fileName}.`, model: MODEL_NAMES.screen, caseId: c.id });
    finishJob(r, job, atMs);
    return;
  }

  if (job.stage === 'check') {
    const finding = r.state.findings.find((f) => f.id === job.findingId);
    if (finding && finding.state === 'suspected') {
      const scripted = SCRIPTED[`${finding.caseId}:${finding.criterionId}`];
      const confirmed = scripted?.check.confirmed ?? true;
      finding.check = {
        confirmed,
        lineIds: scripted?.check.lineIds ?? finding.screen.lineIds,
        whatMatches: scripted?.check.whatMatches ?? finding.screen.reason,
        whatCannotBeSeen: scripted?.check.whatCannotBeSeen ?? '',
        completed: true,
        model: MODEL_NAMES.check,
        at,
        seconds: STEP_MS.check / 1000,
      };
      finding.state = confirmed ? 'confirmed' : 'not_confirmed';
      log(r, {
        at,
        kind: 'check',
        text: `${CHECK_NAME} ${confirmed ? 'confirmed' : 'did not confirm'} ${label(finding.criterionId)}.`,
        model: MODEL_NAMES.check,
        findingId: finding.id,
        criterionId: finding.criterionId,
      });
    }
    finishJob(r, job, atMs);
    return;
  }

  // letter
  const letter = letterWaiting(r, job.findingId);
  const finding = r.state.findings.find((f) => f.id === job.findingId);
  const c = finding ? caseOf(r, finding.caseId) : undefined;
  const criterion = finding ? criterionById(finding.criterionId) : undefined;
  if (letter && finding && c && criterion) {
    const subject = letterSubject(c, criterion, finding);
    const body = buildLetterBody(c, finding, criterion, at, 'model');
    const draft = { subject, body, origin: 'model' as const, checkNotes: [] as string[], model: MODEL_NAMES.letter, at, seconds: STEP_MS.letter / 1000 };
    const ids = letter.findingIds && letter.findingIds.length > 0 ? letter.findingIds : [letter.findingId];
    if (!letter.points || letter.points.length === 0) letter.points = [{ findingId: letter.findingId }];
    let point: LetterPoint | undefined = letter.points.find((item) => item.findingId === finding.id);
    if (!point) {
      point = { findingId: finding.id };
      letter.points.push(point);
    }
    point.draft = draft;
    if (ids.length <= 1) {
      letter.draft = draft;
      letter.subject = subject;
      letter.body = body;
      letter.status = 'ready';
      letter.seenByPharmacist = false;
      log(r, { at, kind: 'letter', text: `Sample: letter ${letter.id} is shown as ready.`, model: MODEL_NAMES.letter, letterId: letter.id });
    } else {
      rebuildMockLetter(letter);
      log(r, {
        at,
        kind: 'letter',
        text: letter.status === 'ready'
          ? `Sample: letter ${letter.id} is shown as ready.`
          : `Sample: a point of letter ${letter.id} is written. The letter waits until every point is written.`,
        model: MODEL_NAMES.letter,
        letterId: letter.id,
      });
    }
  }
  finishJob(r, job, atMs);
}

/** Start the next waiting job, if any. One job at a time, first in first out. */
function startNext(r: Runtime): boolean {
  const job = r.state.jobs.find((j) => j.status === 'queued');
  if (!job) return false;
  const startMs = Math.max(r.freeAt, r.queuedAt.get(job.id) ?? r.freeAt);
  r.queuedAt.delete(job.id);
  job.status = 'running';
  if (job.stage === 'screen') {
    const c = caseOf(r, job.caseId);
    if (c) {
      c.screening.status = 'running';
      c.screening.startedAt ??= iso(startMs);
      const first = c.screening.criteria.find((run) => run.status === 'waiting');
      if (first) first.status = 'running';
      job.detail = `criterion 1 of ${c.screening.criteria.length}`;
    }
  }
  r.runningUntil = startMs + STEP_MS[job.stage];
  return true;
}

/** Bring the sample data up to the given time. */
function advance(r: Runtime, nowMs: number): void {
  for (let guard = 0; guard < 500; guard++) {
    const running = r.state.jobs.find((j) => j.status === 'running');
    if (running) {
      if (nowMs < r.runningUntil) return;
      finishStep(r, running, r.runningUntil);
    } else if (!startNext(r)) {
      return;
    }
  }
}

function countsOf(state: AppState, nowMs: number): Counts {
  const { cases, findings, letters } = state;
  const isOverdue = (l: Letter): boolean =>
    l.status === 'sent' && !l.reply && l.dueAt !== undefined && new Date(l.dueAt).getTime() < nowMs;
  return {
    historiesScreened: cases.filter((c) => c.screening.status === 'done' && !c.screening.criteria.some((run) => run.status === 'failed')).length,
    findingsConfirmed: findings.filter((f) => f.check !== undefined && f.check.completed && f.check.confirmed).length,
    accepted: findings.filter((f) => f.state === 'accepted').length,
    bypassed: findings.filter((f) => f.state === 'bypassed').length,
    lettersReady: letters.filter((l) => l.status === 'ready').length,
    lettersSent: letters.filter((l) => l.sentAt !== undefined).length,
    repliesRecorded: letters.filter((l) => l.reply !== undefined).length,
    closed: letters.filter((l) => l.status === 'closed').length,
    overdue: letters.filter(isOverdue).length,
    bellBadge: findings.filter((f) => f.state === 'confirmed').length,
    letterBadge: letters.filter((l) => l.status === 'ready' && !l.seenByPharmacist).length,
  };
}

// The names a person sees, the same defaults the live settings carry (docs/SPEC.md section 5).
const SCREEN_NAME = JOB_NAMES.screen;
const CHECK_NAME = JOB_NAMES.check;
const LETTER_NAME = JOB_NAMES.letter;

/** The status line of the sample view. It shows the words of the real page and says that it is a sample: no model is working. */
export const SAMPLE_STATUS = 'Sample of the status line';

function nowOf(state: AppState): NowRunning {
  const job = state.jobs.find((j) => j.status === 'running');
  if (!job) return { stage: null, text: 'Idle' };
  if (job.stage === 'screen') {
    const runs = state.cases.find((c) => c.id === job.caseId)?.screening.criteria ?? [];
    const index = runs.findIndex((run) => run.status === 'running');
    return { stage: 'screen', text: `${SAMPLE_STATUS}: ${SCREEN_NAME} is screening: criterion ${Math.max(1, index + 1)} of ${runs.length}` };
  }
  if (job.stage === 'check') {
    const waiting = state.findings.filter((f) => f.state === 'suspected').length;
    return {
      stage: 'check',
      text: `${SAMPLE_STATUS}: ${CHECK_NAME} is double-checking ${waiting === 1 ? '1 finding' : `${Math.max(1, waiting)} findings`}`,
    };
  }
  const drafting = state.letters.filter((l) => l.status === 'drafting').length;
  return { stage: 'letter', text: `${SAMPLE_STATUS}: ${LETTER_NAME} is writing ${drafting <= 1 ? 'a letter' : `${drafting} letters`}` };
}

function snapshot(r: Runtime, nowMs: number): StateResponse {
  advance(r, nowMs);
  // A copy, so the page never holds the live sample data.
  const state = structuredClone(r.state);
  return { state, counts: countsOf(state, nowMs), now: nowOf(state), serverTime: iso(nowMs), recorded: false };
}

/** A very small CSV reader, enough to show the rows of an imported file in the sample view. */
function csvToRows(text: string): string[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows
    .map((cells) => cells.map((c) => c.trim()).filter((c) => c !== '').join(' | '))
    .filter((line, i) => line !== '' && !(i === 0 && /dispense_date/i.test(line)));
}

function findLetter(r: Runtime, letterId: string): Letter {
  const letter = r.state.letters.find((l) => l.id === letterId);
  if (!letter) throw new Error(`No letter ${letterId} in the sample data.`);
  return letter;
}

export const mockBackend: Backend = {
  peekState() {
    return snapshot(rt(), Date.now());
  },

  async getState() {
    return snapshot(rt(), Date.now());
  },

  peekCriteria() {
    return readCriteria(SAMPLE_CRITERIA);
  },

  async getCriteria() {
    return readCriteria(SAMPLE_CRITERIA);
  },

  async getHealth(): Promise<HealthResponse> {
    // The sample view has no models behind it, and says so.
    return {
      ollama: 'down',
      models: { screen: false, check: false, letter: false },
      names: { ...MODEL_NAMES },
    };
  },

  async importCase(body: ImportRequest) {
    const r = rt();
    const nowMs = Date.now();
    advance(r, nowMs);
    const id = `C${pad(r.nextCase++)}`;
    const rows =
      body.source === 'csv' ? csvToRows(body.csvText ?? '') : body.source === 'pdf-text' ? (body.rows ?? []) : [];
    r.state.cases.push({
      id,
      fileName: body.fileName,
      importedAt: iso(nowMs),
      source: body.source,
      patient: body.patient ?? { label: 'Fictional patient (sample view)' },
      lines: numberLines(rows),
      cannotAssess: NOT_SCREENED,
      transcriptionConfirmed: body.source !== 'pdf-image',
      parts: 1,
      screening: { status: 'not_started', criteria: [] },
    });
    log(r, { at: iso(nowMs), kind: 'import', text: `Imported ${body.fileName}. Sample view: not screened.`, caseId: id });
    return { caseId: id };
  },

  async confirmTranscription(caseId: string, rows?: string[]) {
    const r = rt();
    const nowMs = Date.now();
    advance(r, nowMs);
    const c = caseOf(r, caseId);
    if (!c || c.transcriptionConfirmed || c.cannotAssess) return;
    // Rows the pharmacist corrected replace what was read from the scan.
    if (rows) c.lines = numberLines(rows.map((row) => row.trim()).filter((row) => row !== ''), 1);
    c.transcriptionConfirmed = true;
    c.screening = {
      status: 'waiting',
      criteria: SAMPLE_CRITERIA.map((criterion) => ({ criterionId: criterion.id, status: 'waiting' })),
    };
    queue(r, 'screen', c.id, nowMs);
    log(r, { at: iso(nowMs), kind: 'import', text: `The pharmacist confirmed the rows read from ${c.fileName}.`, caseId: c.id });
    advance(r, nowMs);
  },

  async screenAgain(caseId: string) {
    const r = rt();
    const nowMs = Date.now();
    advance(r, nowMs);
    const c = caseOf(r, caseId);
    if (!c || c.cannotAssess) return;
    const failed = c.screening.criteria.filter((run) => run.status === 'failed');
    if (failed.length === 0 || r.state.jobs.some((j) => j.caseId === c.id && j.stage === 'screen' && j.status !== 'done')) return;
    for (const run of failed) {
      run.status = 'waiting';
      delete run.error;
      delete run.seconds;
    }
    c.screening.status = 'waiting';
    delete c.screening.finishedAt;
    queue(r, 'screen', c.id, nowMs);
    log(r, { at: iso(nowMs), kind: 'import', text: `The pharmacist asked to screen ${c.fileName} again.`, caseId: c.id });
    advance(r, nowMs);
  },

  async discardScan(caseId: string) {
    const r = rt();
    const c = caseOf(r, caseId);
    if (!c || c.source !== 'pdf-image' || c.transcriptionConfirmed || c.cannotAssess) return;
    c.cannotAssess = 'The pharmacist discarded this scan. Its rows were not confirmed, so it was not screened.';
    log(r, { at: iso(Date.now()), kind: 'import', text: `The pharmacist discarded the scan ${c.fileName}. It was not screened.`, caseId: c.id });
  },

  pagePictures() {
    // The sample view has no server that keeps pictures.
    return [];
  },

  async answerQuestion() {
    throw new ApiError('The sample view does not take an answer.', 400);
  },

  async readPathology(caseId, questionId, body: PathologyUploadRequest) {
    const c = caseOf(rt(), caseId);
    if (!c) throw new ApiError('This history was not found.', 404);
    const question = (c.questions ?? []).find((item) => item.id === questionId);
    return pathologyFromFixture(question, body);
  },

  async takeBackQuestion() {
    throw new ApiError('The sample view does not take an answer.', 400);
  },

  async reopenQuestion() {
    throw new ApiError('The sample view does not take an answer.', 400);
  },

  async leaveStandingQuestions() {
    throw new ApiError('The sample view does not take an answer.', 400);
  },

  async decideFinding(findingId, body) {
    const r = rt();
    const nowMs = Date.now();
    advance(r, nowMs);
    const finding = r.state.findings.find((f) => f.id === findingId);
    if (!finding || (finding.state !== 'confirmed' && finding.state !== 'not_confirmed')) return;
    // A finding the pharmacist has dismissed is decided. It is not decided again.
    if (finding.decision) return;
    // A finding that the second check turned back: the two models disagree, and the pharmacist decides.
    const disputed = finding.state === 'not_confirmed';
    const reason = (body.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (body.action === 'dismiss' && !disputed) throw new ApiError('Dismiss is for a finding the two models disagree on.', 409);
    if (body.action === 'bypass' && !reason) throw new ApiError('Please give a short reason for bypassing this finding.', 400);
    if (body.action === 'accept' && disputed && !reason) {
      throw new ApiError('Please give a short reason for accepting this finding anyway.', 400);
    }
    const at = iso(nowMs);
    finding.seenByPharmacist = true;
    if (body.action === 'dismiss') {
      // The state stays not_confirmed. The decision closes the finding, and no letter is written.
      finding.decision = { action: 'dismiss', by: 'The pharmacist on duty', at };
      if (reason) finding.decision.reason = reason;
      log(r, {
        at,
        kind: 'decision',
        text: `The two models disagreed on ${label(finding.criterionId)}. The pharmacist dismissed it. No letter was written.`,
        findingId,
        criterionId: finding.criterionId,
      });
    } else if (body.action === 'accept') {
      finding.state = 'accepted';
      finding.decision = { action: 'accept', by: 'The pharmacist on duty', at };
      // Accepting a finding that was turned back needs a reason, and the reason is kept.
      if (reason) finding.decision.reason = reason;
      const open = openPatientLetter(r, finding.caseId);
      if (open && !open.findingIds!.includes(finding.id)) {
        open.findingIds = [...open.findingIds!, finding.id];
        const kept = open.points && open.points.length > 0
          ? open.points
          : [{ findingId: open.findingId, ...(open.draft ? { draft: open.draft } : {}) }];
        open.points = [...kept, { findingId: finding.id }];
        open.status = 'drafting';
        delete open.previewedAt;
        delete open.previewHash;
        delete open.patientAgreed;
        rebuildMockLetter(open);
      } else if (!open) {
        const afterSent = r.state.letters.some((letter) => letter.caseId === finding.caseId && letter.sentAt !== undefined);
        r.state.letters.push({
          id: `T${pad(r.nextLetter++)}`,
          findingId: finding.id,
          findingIds: [finding.id],
          points: [{ findingId: finding.id }],
          caseId: finding.caseId,
          status: 'drafting',
          subject: '',
          body: '',
          ...SAMPLE_LETTER_CLOSING,
          editedByPharmacist: false,
          seenByPharmacist: false,
          ...(afterSent ? { afterSent: true } : {}),
        });
      }
      queue(r, 'letter', finding.caseId, nowMs, finding.id);
      log(r, {
        at,
        kind: 'decision',
        text: disputed
          ? `The two models disagreed on ${label(finding.criterionId)}. The pharmacist accepted it anyway. Reason: ${reason}`
          : `The pharmacist accepted ${label(finding.criterionId)}.`,
        findingId,
        criterionId: finding.criterionId,
      });
    } else {
      finding.state = 'bypassed';
      finding.decision = { action: 'bypass', reason, by: 'The pharmacist on duty', at };
      log(r, {
        at,
        kind: 'decision',
        text: `The pharmacist bypassed ${label(finding.criterionId)}. Reason: ${reason}`,
        findingId,
        criterionId: finding.criterionId,
      });
    }
    advance(r, nowMs);
  },

  async markFindingSeen(findingId) {
    const finding = rt().state.findings.find((f) => f.id === findingId);
    if (finding) finding.seenByPharmacist = true;
  },

  async markLetterSeen(letterId) {
    findLetter(rt(), letterId).seenByPharmacist = true;
  },

  async saveLetter(letterId, body) {
    const letter = findLetter(rt(), letterId);
    if (letter.status !== 'ready') return;
    // Tidied the way the real server tidies it. The text is kept as it will leave: "Yours sincerely,",
    // the line about who wrote the words and the signature are put back at its end, once, so an edit
    // cannot delete them.
    const subject = body.subject.replace(/\s+/g, ' ').trim();
    const text = body.body.replace(/\r\n?/g, '\n');
    if (subject.length > 300) {
      throw new ApiError('The subject is longer than 300 characters. Shorten it, then save. Nothing was changed.', 400);
    }
    if (text.length > LETTER_TEXT_CAP) {
      throw new ApiError('The letter is longer than 200,000 characters. Shorten it, then save. Nothing was changed.', 400);
    }
    if (!text.trim()) throw new ApiError('The letter text is empty.', 400);
    const nextBody = letterAsItLeaves(text, closingParts(letter));
    if (subject === letter.subject && nextBody === letter.body) return;
    const current = letter.draftRevision ?? 0;
    if (body.expectedRevision !== current) {
      throw new ApiError(`This is not the latest copy of the letter. It is at revision ${current}. Open it again, then save.`, 409);
    }
    letter.subject = subject;
    letter.body = nextBody;
    letter.draftRevision = current + 1;
    letter.editedByPharmacist =
      letter.subject !== (letter.draft?.subject ?? '') || letter.body !== (letter.draft?.body ?? '');
    // Any edit after a preview asks for a new preview.
    delete letter.previewedAt;
    delete letter.previewHash;
  },

  async previewLetter(letterId) {
    const letter = findLetter(rt(), letterId);
    if (letter.status !== 'ready') {
      throw new ApiError('Only a letter that is ready to review can be previewed.', 409);
    }
    const text = letterAsItLeaves(letter.body, closingParts(letter));
    letter.body = text;
    const previewedAt = iso(Date.now());
    letter.previewedAt = previewedAt;
    letter.previewHash = await sha256Hex(`${letter.subject}\n${text}`);
    const emailDraft = emailDraftFromLetter(letter, letter.subject, letter.body);
    return { ok: true as const, letter, text, previewedAt, emailDraft, previewToken: letter.previewHash };
  },

  async agreeLetter(letterId, agreed = true) {
    const r = rt();
    const letter = findLetter(r, letterId);
    if (letter.status !== 'ready') return;
    if (agreed) {
      letter.patientAgreed = { at: iso(Date.now()) };
      log(r, { at: iso(Date.now()), kind: 'letter_status', text: `Letter ${letterId}: the patient was told and agrees.`, letterId });
    } else if (letter.patientAgreed) {
      delete letter.patientAgreed;
      log(r, { at: iso(Date.now()), kind: 'letter_status', text: `Letter ${letterId}: the agreement tick was removed.`, letterId });
    }
  },

  async markLetterSent(letterId, body) {
    const r = rt();
    const nowMs = Date.now();
    const letter = findLetter(r, letterId);
    if (letter.status !== 'ready') return;
    const text = letterAsItLeaves(letter.body, closingParts(letter));
    const hash = await sha256Hex(`${letter.subject}\n${text}`);
    if (!letter.previewedAt || letter.previewHash !== hash) {
      throw new ApiError(
        letter.previewedAt
          ? 'The letter changed after the preview. Open the preview again, then mark it as sent.'
          : 'This letter has not been previewed. Open the preview, read the letter, then mark it as sent.',
        409,
      );
    }
    if (body.previewToken !== letter.previewHash) {
      throw new ApiError('This is not the copy that was previewed. Open the preview again, then mark it as sent.', 409);
    }
    letter.status = 'sent';
    letter.sentAt = iso(nowMs);
    letter.sentBy = body.by;
    letter.dueAt = iso(nowMs + OVERDUE_DAYS * DAY_MS);
    letter.seenByPharmacist = true;
    const agreed = letter.patientAgreed ? 'Patient agreement was recorded.' : 'Patient agreement was not recorded.';
    log(r, { at: iso(nowMs), kind: 'letter_status', text: `Letter ${letterId} marked as sent by ${body.by}. ${agreed}`, letterId });
  },

  async recordReply(letterId, body) {
    const r = rt();
    const letter = findLetter(r, letterId);
    if (letter.status !== 'sent' && letter.status !== 'reply_recorded') return;
    const points = replyPointOverrides(letter, body.outcome, body.points);
    letter.reply = { at: iso(Date.now()), outcome: body.outcome, note: body.note, ...(points.length > 0 ? { points } : {}) };
    letter.status = 'reply_recorded';
    const extra = points.length === 0 ? '' : points.length === 1 ? ' One point differs from that outcome.' : ` ${points.length} points differ from that outcome.`;
    log(r, { at: iso(Date.now()), kind: 'letter_status', text: `Reply recorded for letter ${letterId}.${extra}`, letterId });
  },

  async closeLetter(letterId) {
    const r = rt();
    const letter = findLetter(r, letterId);
    if (letter.status === 'drafting' || letter.status === 'closed') return;
    const how = letter.status === 'ready' ? ' It was not sent.' : letter.reply ? '' : ' No reply was recorded.';
    letter.status = 'closed';
    letter.closedAt = iso(Date.now());
    letter.seenByPharmacist = true;
    log(r, { at: iso(Date.now()), kind: 'letter_status', text: `Letter ${letterId} closed.${how}`, letterId });
  },

  async resetDemo() {
    const nowMs = Date.now();
    const fresh = start(nowMs);
    fresh.state = {
      version: 1,
      cases: [],
      findings: [],
      letters: [],
      jobs: [],
      activity: [{ at: iso(nowMs), kind: 'reset', text: 'A clean demo was started.' }],
    };
    fresh.nextCase = 1;
    fresh.nextFinding = 1;
    fresh.nextLetter = 1;
    fresh.nextJob = 1;
    runtime = fresh;
  },
};
