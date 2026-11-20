// Typed calls to the local server, one for every call in docs/SPEC.md section 5.
// The page talks to this computer only: every address starts with /api.
//
// When the page address has ?mock=1 the same calls are answered from sample data in src/mock/,
// so the page can be looked at without the server and without the models.
//
// In the judges' build ("npm run build:replay") or with ?replay=1 the calls are answered from
// recorded frames (src/lib/replayBackend.ts). That view never talks to /api.
import type {
  DecisionRequest,
  HealthResponse,
  ImportRequest,
  ImportResponse,
  EmailDraft,
  Letter,
  LetterEditRequest,
  LetterReplyRequest,
  LetterSentRequest,
  QuestionAnswerRequest,
  StateResponse,
} from '../shared/types.ts';
import type { PathologySource } from './lib/pathologyAnswer.ts';
import type { PathologyResponse, PathologyUploadRequest } from './lib/pathologyFile.ts';
import { ApiError } from './apiError.ts';
import { readCriteria } from './lib/criteria.ts';
import type { CriterionView } from './lib/criteria.ts';
import { pageViewOf } from './lib/pageView.ts';
import type { PageView } from './lib/pageView.ts';
import { mockBackend } from './mock/server.ts';
import { replayBackend, replayControl } from './lib/replayBackend.ts';
import type { ReplayControl } from './lib/replayBackend.ts';

export { ApiError };

export interface Backend {
  /** GET /api/state: the whole state, the counts and what is running now. */
  getState(): Promise<StateResponse>;
  /** GET /api/criteria: the criteria in use, as the page shows them (label, statement, credit). */
  getCriteria(): Promise<CriterionView[]>;
  /** GET /api/health: is Ollama up and are the three models present. */
  getHealth(): Promise<HealthResponse>;
  /** POST /api/cases: import a history. Screening is queued at once. */
  importCase(body: ImportRequest): Promise<ImportResponse>;
  /**
   * POST /api/cases/:id/confirm-transcription: the pharmacist confirms rows read from a scan.
   * When he has corrected the rows, the corrected rows are sent and replace what the model read.
   */
  confirmTranscription(caseId: string, rows?: string[]): Promise<void>;
  /** POST /api/cases/:id/screen-again: screens the criteria that have no result yet. Nothing is imported twice. */
  screenAgain(caseId: string): Promise<void>;
  /** POST /api/cases/:id/discard: gives up a scan whose rows the pharmacist will not confirm. */
  discardScan(caseId: string): Promise<void>;
  /**
   * The addresses of the page pictures of a scan whose rows are not confirmed yet
   * (GET /api/cases/:id/pages/:n). They work after a page reload and in another window.
   * An empty list when this view has no server to ask.
   */
  pagePictures(caseId: string, pages: number): string[];
  /** POST /api/findings/:id/decision: accept or bypass. Accept queues the letter. */
  decideFinding(findingId: string, body: DecisionRequest): Promise<void>;
  /** POST /api/cases/:id/questions/:qid/answer: the pharmacist answers one fact. */
  answerQuestion(caseId: string, questionId: string, body: QuestionAnswerRequest & { source?: PathologySource }): Promise<void>;
  /**
   * POST /api/cases/:id/questions/:qid/pathology: what was read from an uploaded pathology test.
   * Nothing is written into the record.
   */
  readPathology(caseId: string, questionId: string, body: PathologyUploadRequest): Promise<PathologyResponse>;
  /** POST /api/cases/:id/questions/:qid/take-back: the answer is withdrawn and the finding is as it was. */
  takeBackQuestion(caseId: string, questionId: string): Promise<void>;
  /** POST /api/cases/:id/questions/:qid/reopen: a Not known question can be answered again. */
  reopenQuestion(caseId: string, questionId: string): Promise<void>;
  /** POST /api/cases/:id/questions/leave: leaves the standing questions unanswered, or shows them when show is true. */
  leaveStandingQuestions(caseId: string, show?: boolean): Promise<void>;
  /** POST /api/findings/:id/seen: clears the bell badge for this finding. */
  markFindingSeen(findingId: string): Promise<void>;
  /** POST /api/letters/:id/seen: clears the letter badge for this letter. */
  markLetterSeen(letterId: string): Promise<void>;
  /** PUT /api/letters/:id: save the pharmacist's edits. */
  saveLetter(letterId: string, body: LetterEditRequest): Promise<void>;
  /** POST /api/letters/:id/preview: records the preview and returns the letter as it will leave. */
  previewLetter?(letterId: string): Promise<{ ok: boolean; letter: Letter; text: string; previewedAt: string; emailDraft: EmailDraft; previewToken: string }>;
  /**
   * POST /api/letters/:id/agree: records that the patient was told and agrees.
   * `agreed: false` takes the tick away again, while the letter is not yet sent.
   */
  agreeLetter(letterId: string, agreed?: boolean): Promise<void>;
  /** POST /api/letters/:id/sent: how the letter went out. */
  markLetterSent(letterId: string, body: LetterSentRequest): Promise<void>;
  /** POST /api/letters/:id/reply: the doctor's answer. */
  recordReply(letterId: string, body: LetterReplyRequest): Promise<void>;
  /** POST /api/letters/:id/close: closes the case. */
  closeLetter(letterId: string): Promise<void>;
  /** POST /api/reset: start a clean demo. The server keeps the old state file as a dated backup. */
  resetDemo(): Promise<void>;
  /** Sample data only: the state at once, so the first picture of the page is complete. */
  peekState?(): StateResponse;
  /** Sample data only: the criteria at once. */
  peekCriteria?(): CriterionView[];
  /** The judges' view only: the steps of the recorded run, and which one is shown. */
  replay?: ReplayControl;
}

function searchFlag(name: string): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get(name) === '1';
}

/**
 * True in the judges' build or when the page address has ?replay=1.
 * The backend is then the replay backend and nothing is sent to /api.
 */
export const isReplay: boolean = import.meta.env?.MODE === 'replay' || searchFlag('replay');

/** ?replay=1&mock=1 plays the made-up recording; the sample label is shown, not the recorded-run label. */
export const isReplayMock: boolean = isReplay && searchFlag('mock');

/** True when the page address has ?mock=1 and not in replay mode. */
export const isMock: boolean = !isReplay && searchFlag('mock');

/** The view the page shows, as one word: a live run, the sample view, a recorded run or the made-up recording. */
export const pageView: PageView = pageViewOf(isReplay, isReplayMock || isMock);

if (isReplayMock) replayControl.useSample();

const BASE = '/api';

function serverMessage(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['error', 'message', 'reason']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
    }
  }
  return null;
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      // Every POST and PUT carries a JSON body, even an empty one, so the server never has to guess.
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('The local server is not answering.', 0);
  }

  const text = await res.text();
  let data: unknown;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    throw new ApiError(
      serverMessage(data) ?? `The local server could not do this step (code ${res.status}).`,
      res.status,
    );
  }
  return data as T;
}

const id = (value: string): string => encodeURIComponent(value);

const httpBackend: Backend = {
  async getState() {
    const data = await call<StateResponse>('GET', '/state');
    if (!data || typeof data !== 'object' || !data.state || !data.counts || !data.now) {
      throw new ApiError('The local server sent an answer the page could not read.', 0);
    }
    return data;
  },

  async getCriteria() {
    // The server may send the list itself or an object that holds it. readCriteria accepts both.
    return readCriteria(await call<unknown>('GET', '/criteria'));
  },

  getHealth() {
    return call<HealthResponse>('GET', '/health');
  },

  importCase(body) {
    return call<ImportResponse>('POST', '/cases', body);
  },

  async confirmTranscription(caseId, rows) {
    await call<unknown>('POST', `/cases/${id(caseId)}/confirm-transcription`, rows ? { rows } : {});
  },

  async screenAgain(caseId) {
    await call<unknown>('POST', `/cases/${id(caseId)}/screen-again`);
  },

  async discardScan(caseId) {
    await call<unknown>('POST', `/cases/${id(caseId)}/discard`);
  },

  pagePictures(caseId, pages) {
    return Array.from({ length: Math.max(0, pages) }, (_, i) => `${BASE}/cases/${id(caseId)}/pages/${i + 1}`);
  },

  async decideFinding(findingId, body) {
    await call<unknown>('POST', `/findings/${id(findingId)}/decision`, body);
  },

  async answerQuestion(caseId, questionId, body) {
    await call<unknown>('POST', `/cases/${id(caseId)}/questions/${id(questionId)}/answer`, body);
  },

  readPathology(caseId, questionId, body) {
    return call<PathologyResponse>('POST', `/cases/${id(caseId)}/questions/${id(questionId)}/pathology`, body);
  },

  async takeBackQuestion(caseId, questionId) {
    await call<unknown>('POST', `/cases/${id(caseId)}/questions/${id(questionId)}/take-back`, {});
  },

  async reopenQuestion(caseId, questionId) {
    await call<unknown>('POST', `/cases/${id(caseId)}/questions/${id(questionId)}/reopen`, {});
  },

  async leaveStandingQuestions(caseId, show) {
    await call<unknown>('POST', `/cases/${id(caseId)}/questions/leave`, show ? { show: true } : {});
  },

  async markFindingSeen(findingId) {
    await call<unknown>('POST', `/findings/${id(findingId)}/seen`);
  },

  async markLetterSeen(letterId) {
    await call<unknown>('POST', `/letters/${id(letterId)}/seen`);
  },

  async saveLetter(letterId, body) {
    await call<unknown>('PUT', `/letters/${id(letterId)}`, body);
  },

  previewLetter(letterId) {
    return call<{ ok: boolean; letter: Letter; text: string; previewedAt: string; emailDraft: EmailDraft; previewToken: string }>(
      'POST',
      `/letters/${id(letterId)}/preview`,
      {},
    );
  },

  async agreeLetter(letterId, agreed = true) {
    await call<unknown>('POST', `/letters/${id(letterId)}/agree`, { agreed });
  },

  async markLetterSent(letterId, body) {
    await call<unknown>('POST', `/letters/${id(letterId)}/sent`, body);
  },

  async recordReply(letterId, body) {
    await call<unknown>('POST', `/letters/${id(letterId)}/reply`, body);
  },

  async closeLetter(letterId) {
    await call<unknown>('POST', `/letters/${id(letterId)}/close`);
  },

  async resetDemo() {
    await call<unknown>('POST', '/reset');
  },
};

/** The calls the page uses. The recording in the judges' build, sample data when ?mock=1, the local server otherwise. */
export const api: Backend = isReplay ? replayBackend : isMock ? mockBackend : httpBackend;

/** A message for the pharmacist from any thrown value. Only messages written for people are passed on. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
