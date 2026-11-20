// The backend of the judges' view (the build made by "npm run build:replay").
// It answers the page's calls from a recording of a real run on the entrant's computer:
// cases/_demo/recorded-state.json, written by tools/record-run.mjs. No server and no model is used.
// Every answer says recorded: true, so the page shows
// "Recorded run from the entrant's computer. The live models are not connected."
// Nothing can be changed here: an import, a decision or an edit is refused in one plain sentence.
import type { HealthResponse } from '../../shared/types.ts';
import { ApiError } from '../apiError.ts';
import type { Backend } from '../api.ts';
import { readCriteria } from '../lib/criteria.ts';
import recorded from '../../cases/_demo/recorded-state.json';
import { responseAt, stepsOf } from './replay.ts';
import type { Recording, ReplayStep } from './replay.ts';

const recording = recorded as unknown as Recording & { models?: HealthResponse['names'] };

// The steps are worked out when the judges' view first asks for them, not when this file is loaded.
// Nothing here runs by itself, so the build of the live page leaves this file and the recording out.
let steps: ReplayStep[] | null = null;
function allSteps(): ReplayStep[] {
  steps ??= stepsOf(recording.state);
  return steps;
}

/** The step being shown. The run starts at its first step and is played forward by the page. */
let index = 0;

export const RECORDED_ONLY = 'This is a recorded run. The live models are not connected, so nothing can be changed here.';
export const NO_IMPORT = 'This is a recorded run. A file cannot be imported here, because the live models are not connected.';

function refuse(message = RECORDED_ONLY): never {
  throw new ApiError(message, 409);
}

export interface ReplayControl {
  /** One sentence about the recording: what was run, and when. */
  note: string;
  how: string;
  steps: ReplayStep[];
  /** The step being shown, from 0. */
  index(): number;
  goTo(step: number): void;
}

export const replayControl: ReplayControl = {
  note: recording.note,
  how: recording.how,
  get steps() {
    return allSteps();
  },
  index: () => index,
  goTo(step: number) {
    index = Math.max(0, Math.min(allSteps().length - 1, Math.round(step)));
  },
};

export const replayBackend: Backend = {
  peekState() {
    return responseAt(recording, index);
  },

  async getState() {
    return responseAt(recording, index);
  },

  peekCriteria() {
    return readCriteria(recording.criteria);
  },

  async getCriteria() {
    return readCriteria(recording.criteria);
  },

  async getHealth(): Promise<HealthResponse> {
    // No model is behind a recorded run, and the page says so.
    return {
      ollama: 'down',
      models: { screen: false, check: false, letter: false },
      names: recording.models ?? { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
    };
  },

  async importCase() {
    return refuse(NO_IMPORT);
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
  async decideFinding() {
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
  // Looking at a finding or a letter changes nothing in a recording, and is not an error.
  async markFindingSeen() {},
  async markLetterSeen() {},
  async saveLetter() {
    refuse();
  },
  async agreeLetter() {
    refuse();
  },
  async markLetterSent() {
    refuse();
  },
  async recordReply() {
    refuse();
  },
  async closeLetter() {
    refuse();
  },
  async resetDemo() {
    refuse();
  },
};
