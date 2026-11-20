// Answers every page call from a recorded run. Nothing is sent to the live server.
import type {
  DecisionRequest,
  HealthResponse,
  ImportRequest,
  Letter,
  LetterEditRequest,
  LetterReplyRequest,
  LetterSentRequest,
  StateResponse,
} from '../../shared/types.ts';
import { ApiError } from '../apiError.ts';
import type { Backend } from '../api.ts';
import { readCriteria } from './criteria.ts';
import type { CriterionView } from './criteria.ts';
import { emailDraftFromLetter, letterAsItLeaves, closingParts } from './letters.ts';
import {
  RecordingPlayer,
  emptyRecordedState,
  parseIndex,
  parseRecording,
  type RecordedIndexEntry,
  type RecordedRun,
} from './recorded.ts';
import { RECORDED_SAMPLE } from '../mock/recordedSample.ts';

export const RECORDED_BUTTONS_OFF = 'Recorded run. Buttons that change things are switched off.';
export const NO_IMPORT = 'Import is switched off in a recorded run.';

let activeRun: RecordedRun | null = null;
let player: RecordingPlayer | null = null;

function refuse(message = RECORDED_BUTTONS_OFF): never {
  throw new ApiError(message, 409);
}

function currentResponse(): StateResponse {
  return player?.response() ?? emptyRecordedState();
}

function findLetter(letterId: string): Letter {
  const letter = currentResponse().state.letters.find((l) => l.id === letterId);
  if (!letter) throw new ApiError('That letter is not in this frame of the recording.', 404);
  return letter;
}

export interface ReplayControl {
  /** Made-up sample only: load without reading recorded/index.json. */
  useSample(): void;
  /** Load a parsed recording and show its first frame. */
  loadRecording(run: RecordedRun): void;
  fetchIndex(): Promise<{ runs: RecordedIndexEntry[]; emptyMessage: string | null }>;
  loadRunFile(file: string): Promise<string | null>;
  madeHow(): string;
  title(): string;
  about(): string;
  player(): RecordingPlayer | null;
  goToFrame(index: number): void;
  nextFrame(): boolean;
  startAgain(): void;
}

export const replayControl: ReplayControl = {
  useSample() {
    activeRun = RECORDED_SAMPLE;
    player = new RecordingPlayer(RECORDED_SAMPLE);
  },

  loadRecording(run: RecordedRun) {
    activeRun = run;
    player = new RecordingPlayer(run);
  },

  async fetchIndex() {
    try {
      const res = await fetch('recorded/index.json', { cache: 'no-store' });
      if (!res.ok) return { runs: [], emptyMessage: 'No recorded runs are in this copy.' };
      const data: unknown = await res.json();
      return parseIndex(data);
    } catch {
      return { runs: [], emptyMessage: 'No recorded runs are in this copy.' };
    }
  },

  async loadRunFile(file: string) {
    const name = file.replace(/^\.\//, '').replace(/\\/g, '/');
    const path = name.startsWith('recorded/') ? name : `recorded/${name}`;
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) return 'This recording file could not be read.';
      const parsed = parseRecording(await res.json());
      if (!parsed.ok) return parsed.message;
      replayControl.loadRecording(parsed.recording);
      return null;
    } catch {
      return 'This recording file could not be read.';
    }
  },

  madeHow() {
    return activeRun?.madeHow ?? '';
  },

  title() {
    return activeRun?.title ?? '';
  },

  about() {
    return activeRun?.about ?? '';
  },

  player() {
    return player;
  },

  goToFrame(index: number) {
    player?.goTo(index);
  },

  nextFrame() {
    return player?.next() ?? false;
  },

  startAgain() {
    player?.startAgain();
  },
};

export const replayBackend: Backend = {
  replay: replayControl,

  peekState() {
    return currentResponse();
  },

  async getState() {
    return currentResponse();
  },

  peekCriteria(): CriterionView[] {
    return readCriteria(activeRun?.criteria ?? []);
  },

  async getCriteria() {
    return readCriteria(activeRun?.criteria ?? []);
  },

  async getHealth(): Promise<HealthResponse> {
    return {
      ollama: 'down',
      models: { screen: false, check: false, letter: false },
      names: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
    };
  },

  async importCase(_body: ImportRequest) {
    refuse(NO_IMPORT);
  },

  async confirmTranscription() {
    refuse();
  },

  async screenAgain() {
    refuse();
  },

  async discardScan() {
    refuse();
  },

  pagePictures() {
    return [];
  },

  async decideFinding(_findingId: string, _body: DecisionRequest) {
    refuse();
  },

  async answerQuestion() {
    refuse();
  },

  async readPathology() {
    refuse();
  },

  async takeBackQuestion() {
    refuse();
  },

  async reopenQuestion() {
    refuse();
  },

  async leaveStandingQuestions() {
    refuse();
  },

  async markFindingSeen() {},

  async markLetterSeen() {},

  async saveLetter(_letterId: string, _body: LetterEditRequest) {
    refuse();
  },

  async previewLetter(letterId: string) {
    const letter = findLetter(letterId);
    const text = letterAsItLeaves(letter.body, closingParts(letter));
    const previewedAt = letter.previewedAt ?? new Date().toISOString();
    return {
      ok: true,
      letter,
      text,
      previewedAt,
      emailDraft: emailDraftFromLetter(letter, letter.subject, letter.body),
      previewToken: letter.previewHash ?? '',
    };
  },

  async agreeLetter() {
    refuse();
  },

  async markLetterSent(_letterId: string, _body: LetterSentRequest) {
    refuse();
  },

  async recordReply(_letterId: string, _body: LetterReplyRequest) {
    refuse();
  },

  async closeLetter() {
    refuse();
  },

  async resetDemo() {
    refuse();
  },
};